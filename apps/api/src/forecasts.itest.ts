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
import { setupOrg as baseSetupOrg, makeEmail, orgIds, cleanupOrgs } from "./testHelpers.js";

const RUN = randomUUID().slice(0, 8);
const email = makeEmail("fc", RUN);

async function setupOrg(tag: string) {
  const { orgId, token } = await baseSetupOrg(tag, { email });
  await prisma.dataset.create({
    data: {
      organizationId: orgId, name: "Sales", fileName: "sales.csv", fileType: "csv", fileSize: 1024,
      rowCount: rows.length, columnCount: 5,
      columns: [], profile: {}, rows,
      schemaMap: { date: "order_date", quantity: "qty", unit_price: "price", cost: "cost", region: "region" },
    },
  });
  return { orgId, token };
}

// Revenue is DERIVED here (quantity x unit_price), which is the one shape in which a
// price level reaches revenue and profit — the limitation the panel has to state.
const rows = Array.from({ length: 18 }, (_, i) => ({
  order_date: `2025-${String((i % 12) + 1).padStart(2, "0")}-14`,
  qty: 10 + i, price: 20, cost: 100 + i, region: i % 2 ? "West" : "East",
}));


before(async () => { await prisma.$connect(); });
after(async () => {
  await cleanupOrgs("fc", RUN);
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
