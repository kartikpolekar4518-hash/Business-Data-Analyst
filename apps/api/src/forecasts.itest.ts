// Integration tests for what-if scenario forecasts: real Express + Prisma + Postgres.
// Run via `npm run test:integration` (CI provides the DB). Covers the scenario round
// trip through POST /forecasts, lever validation, RBAC, and tenant isolation.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { app } from "./app.js";
import { prisma } from "./prisma.js";
import { signToken } from "./auth/middleware.js";

const RUN = randomUUID().slice(0, 8);
const email = (tag: string) => `fc-${RUN}-${tag}@example.test`;
const orgIds = new Set<string>();

// Revenue is DERIVED here (quantity x unit_price), which is the one shape in which a
// price lever reaches revenue and profit — the limitation the panel has to state.
const rows = Array.from({ length: 18 }, (_, i) => ({
  order_date: `2025-${String((i % 12) + 1).padStart(2, "0")}-14`,
  qty: 10 + i, price: 20, cost: 100 + i, region: i % 2 ? "West" : "East",
}));

async function setupOrg(tag: string) {
  const res = await request(app).post("/api/auth/signup").send({
    name: `User ${tag}`, email: email(tag), password: "password123", organizationName: `Org ${tag}`,
  });
  const orgId = res.body.organization.id as string;
  orgIds.add(orgId);
  await prisma.dataset.create({
    data: {
      organizationId: orgId, name: "Sales", fileName: "sales.csv", fileType: "csv", fileSize: 1024,
      rowCount: rows.length, columnCount: 5,
      columns: [], profile: {}, rows,
      schemaMap: { date: "order_date", quantity: "qty", unit_price: "price", cost: "cost", region: "region" },
    },
  });
  return { orgId, token: `Bearer ${res.body.token}` };
}

before(async () => { await prisma.$connect(); });
after(async () => {
  for (const id of orgIds) await prisma.organization.delete({ where: { id } }).catch(() => {});
  await prisma.user.deleteMany({ where: { email: { startsWith: `fc-${RUN}-` } } });
  await prisma.$disconnect();
});

test("a plain forecast stores no scenario and is unchanged by the feature existing", async () => {
  const { token } = await setupOrg("plain");
  const res = await request(app).post("/api/forecasts").set("Authorization", token).send({ metric: "revenue", horizon: 3 });
  assert.equal(res.status, 201);
  assert.equal(res.body.forecast.scenario, null, "no levers, no goal, no delta — nothing to record");
  assert.equal(res.body.forecast.points.length, 3);
  // The impact report is always returned; with no levers it reports on no levers.
  assert.deepEqual(res.body.impact.levers, []);
  assert.equal(res.body.impact.revenueDerived, true, "this dataset derives revenue from quantity x unit_price");
});

test("a price lever lifts the projection and the scenario is recorded on the saved row", async () => {
  const { token } = await setupOrg("lever");
  const base = await request(app).post("/api/forecasts").set("Authorization", token).send({ metric: "revenue", horizon: 3 });
  const scenario = await request(app).post("/api/forecasts").set("Authorization", token)
    .send({ metric: "revenue", horizon: 3, levers: [{ field: "unit_price", changePct: 10 }] });

  assert.equal(scenario.status, 201);
  assert.deepEqual(scenario.body.forecast.scenario.levers, [{ field: "unit_price", changePct: 10 }],
    "a saved scenario is re-identifiable — the inputs used to be accepted and discarded");
  assert.equal(scenario.body.forecast.scenario.goal, null);
  for (let i = 0; i < 3; i++) {
    assert.ok(
      scenario.body.forecast.points[i].value > base.body.forecast.points[i].value,
      "every projected period sits above the base one",
    );
  }
  assert.deepEqual(scenario.body.impact.levers[0].propagatesTo, ["revenue", "profit"]);
  assert.equal(scenario.body.impact.levers[0].note, null, "nothing to caveat on a derived shape");

  const listed = await request(app).get("/api/forecasts").set("Authorization", token);
  assert.equal(listed.body.forecasts.find((f: any) => f.id === scenario.body.forecast.id).scenario.levers.length, 1);
});

test("a lever this dataset's shape cannot propagate is reported, not hidden", async () => {
  const { orgId, token } = await setupOrg("stored");
  // Same rows, but revenue is now a STORED column, so a price lever moves nothing headline.
  await prisma.dataset.updateMany({
    where: { organizationId: orgId },
    data: {
      rows: rows.map((r) => ({ ...r, revenue: r.qty * r.price })),
      schemaMap: { date: "order_date", revenue: "revenue", quantity: "qty", unit_price: "price", cost: "cost" },
    },
  });
  const res = await request(app).post("/api/forecasts").set("Authorization", token)
    .send({ metric: "revenue", horizon: 3, levers: [{ field: "unit_price", changePct: 10 }] });
  assert.equal(res.status, 201);
  assert.equal(res.body.impact.revenueDerived, false);
  assert.deepEqual(res.body.impact.levers[0].propagatesTo, []);
  assert.match(res.body.impact.levers[0].note, /cannot move revenue or profit/);
});

test("levers are validated: unknown field or out-of-range percentage is a 400", async () => {
  const { token } = await setupOrg("valid");
  const post = (levers: unknown) => request(app).post("/api/forecasts").set("Authorization", token)
    .send({ metric: "revenue", horizon: 3, levers });
  assert.equal((await post([{ field: "headcount", changePct: 5 }])).status, 400, "no expression language, no unknown fields");
  assert.equal((await post([{ field: "unit_price", changePct: -101 }])).status, 400, "below −100% is not a percentage change");
  assert.equal((await post([{ field: "unit_price", changePct: 100_000 }])).status, 400);
  assert.equal((await post([{ field: "unit_price" }])).status, 400);
  assert.equal((await post([{ field: "unit_price", changePct: -100 }])).status, 201, "−100% zeroes the column and is valid");
});

test("running a scenario is a write: a VIEWER cannot, and forecasts stay inside their org", async () => {
  const a = await setupOrg("rbac");
  const b = await setupOrg("other");
  const viewer = await prisma.user.create({ data: { name: "Vic", email: email("viewer"), passwordHash: "x" } });
  await prisma.organizationMember.create({ data: { userId: viewer.id, organizationId: a.orgId, role: "VIEWER" } });
  const viewerToken = `Bearer ${signToken({ userId: viewer.id, organizationId: a.orgId, role: "VIEWER" })}`;

  assert.equal(
    (await request(app).post("/api/forecasts").set("Authorization", viewerToken)
      .send({ metric: "revenue", horizon: 3, levers: [{ field: "unit_price", changePct: 5 }] })).status,
    403,
  );
  assert.equal((await request(app).get("/api/forecasts").set("Authorization", viewerToken)).status, 200, "a viewer can still read");

  const mine = await request(app).post("/api/forecasts").set("Authorization", a.token).send({ metric: "revenue", horizon: 3 });
  const theirs = await request(app).get("/api/forecasts").set("Authorization", b.token);
  assert.ok(!theirs.body.forecasts.some((f: any) => f.id === mine.body.forecast.id), "another org never sees it");
});

// ---- the bake-off scoreboard, and the production track record ----

// The scenario fixture above deliberately cycles through the same twelve months, so
// adding rows to it adds no later period. Scoring needs the opposite: a history that
// genuinely extends, so a forecast's periods can later complete.
// The row shape is stated concretely rather than as Record<string, unknown>: a
// `unknown` value is not assignable to Prisma's InputJsonValue, so the loose type
// makes every `data: { rows }` below a type error.
function monthlyRows(months: number) {
  const out: { order_date: string; qty: number; price: number; cost: number; region: string }[] = [];
  let y = 2023, m = 1;
  for (let i = 0; i < months; i++) {
    out.push({
      order_date: `${y}-${String(m).padStart(2, "0")}-14`,
      qty: 10 + (i % 5), price: 20 + i, cost: 100 + i, region: i % 2 ? "West" : "East",
    });
    if (++m > 12) { m = 1; y++; }
  }
  return out;
}

test("a saved forecast carries the bake-off that chose its method", async () => {
  const { token } = await setupOrg("board");
  const res = await request(app).post("/api/forecasts").set("Authorization", token).send({ metric: "revenue", horizon: 3 });
  assert.equal(res.status, 201);

  const board = res.body.forecast.scoreboard;
  assert.ok(board, "the comparison is stored beside the points it produced, not re-derived on read");
  const winners = board.candidates.filter((c: any) => c.winner);
  assert.equal(winners.length, 1, "exactly one winner");
  assert.equal(winners[0].method, res.body.forecast.method, "the winner is the method that produced the points");
  assert.ok(board.selection.rule.length > 0, "the rule is printable, so the page never restates it");
  assert.ok(board.candidates.every((c: any) => c.mase !== null || c.reason !== null),
    "every candidate either scored or says why it could not");
});

test("the track record is empty, not broken, before any prediction has matured", async () => {
  const { token } = await setupOrg("empty");
  const res = await request(app).get("/api/forecasts/accuracy").set("Authorization", token);
  assert.equal(res.status, 200, "an org with no matured predictions gets an empty page, not a 500");
  assert.equal(res.body.summary.predictions, 0);
  assert.equal(res.body.summary.accuracyPct, null, "no predictions is not 0% accurate");
  assert.deepEqual(res.body.byMetric, []);
  assert.deepEqual(res.body.byHorizonStep, []);
  assert.deepEqual(res.body.recent, []);
});

test("a matured prediction is scored, and re-scoring converges instead of accumulating", async () => {
  const { orgId, token } = await setupOrg("score");
  // Forecast from 18 months, then let the data run on to 24: the projected periods
  // are now complete, so they can be graded against what actually happened.
  const full = monthlyRows(24);
  await prisma.dataset.updateMany({ where: { organizationId: orgId }, data: { rows: full.slice(0, 18) } });
  const made = await request(app).post("/api/forecasts").set("Authorization", token).send({ metric: "revenue", horizon: 3 });
  assert.equal(made.status, 201);

  await prisma.dataset.updateMany({ where: { organizationId: orgId }, data: { rows: full } });
  const scored = await request(app).post("/api/forecasts/rescore").set("Authorization", token).send({});
  assert.equal(scored.status, 200);
  assert.ok(scored.body.summary.predictions > 0, "periods the data has since completed are graded");

  const first = await prisma.forecastScore.count({ where: { organizationId: orgId } });
  await request(app).post("/api/forecasts/rescore").set("Authorization", token).send({});
  const second = await prisma.forecastScore.count({ where: { organizationId: orgId } });
  assert.equal(second, first, "scoring is an upsert — re-running it does not pile up second verdicts");

  // Production accuracy is a different measurement from the bake-off's held-out error,
  // and the payload keeps them apart: nothing here carries a backtest figure.
  const page = await request(app).get("/api/forecasts/accuracy").set("Authorization", token);
  assert.equal(page.body.summary.predictions, first - page.body.summary.staleCount);
  assert.ok(page.body.byHorizonStep.every((h: any) => h.horizonStep >= 1));
  assert.ok(page.body.recent.every((r: any) => typeof r.actual === "number"), "every row states what actually happened");
});

test("a what-if forecast is never graded against the real world", async () => {
  const { orgId, token } = await setupOrg("lever-score");
  const full = monthlyRows(24);
  await prisma.dataset.updateMany({ where: { organizationId: orgId }, data: { rows: full.slice(0, 18) } });
  const scenario = await request(app).post("/api/forecasts").set("Authorization", token)
    .send({ metric: "revenue", horizon: 3, levers: [{ field: "unit_price", changePct: 10 }] });
  assert.equal(scenario.status, 201);

  await prisma.dataset.updateMany({ where: { organizationId: orgId }, data: { rows: full } });
  await request(app).post("/api/forecasts/rescore").set("Authorization", token).send({});
  assert.equal(
    await prisma.forecastScore.count({ where: { forecastId: scenario.body.forecast.id } }),
    0,
    "a lever projects a counterfactual world; grading it against the real one measures nothing",
  );
});

test("the track record stays inside its own organisation", async () => {
  const a = await setupOrg("acc-mine");
  const b = await setupOrg("acc-theirs");
  const full = monthlyRows(24);
  await prisma.dataset.updateMany({ where: { organizationId: a.orgId }, data: { rows: full.slice(0, 18) } });
  await request(app).post("/api/forecasts").set("Authorization", a.token).send({ metric: "revenue", horizon: 3 });
  await prisma.dataset.updateMany({ where: { organizationId: a.orgId }, data: { rows: full } });
  await request(app).post("/api/forecasts/rescore").set("Authorization", a.token).send({});

  const mine = await request(app).get("/api/forecasts/accuracy").set("Authorization", a.token);
  const theirs = await request(app).get("/api/forecasts/accuracy").set("Authorization", b.token);
  assert.ok(mine.body.summary.predictions > 0, "org A has a track record");
  assert.equal(theirs.body.summary.predictions, 0, "org B's track record never counts org A's predictions");
  assert.deepEqual(theirs.body.recent, []);
});

test("a viewer can read the track record but cannot trigger a re-score", async () => {
  const { orgId, token } = await setupOrg("acc-rbac");
  const viewer = await prisma.user.create({ data: { name: "Val", email: email("acc-viewer"), passwordHash: "x" } });
  await prisma.organizationMember.create({ data: { userId: viewer.id, organizationId: orgId, role: "VIEWER" } });
  const viewerToken = `Bearer ${signToken({ userId: viewer.id, organizationId: orgId, role: "VIEWER" })}`;
  void token;

  assert.equal((await request(app).get("/api/forecasts/accuracy").set("Authorization", viewerToken)).status, 200);
  assert.equal((await request(app).post("/api/forecasts/rescore").set("Authorization", viewerToken).send({})).status, 403);
});
