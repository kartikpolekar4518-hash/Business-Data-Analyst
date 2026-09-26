// Integration tests for Signals: real Express + Prisma + Postgres. Run via
// `npm run test:integration` (CI provides the DB).
//
// The most important test in this file is the last one. Signals is an optional add-on
// running against a service that can be absent, and the whole design rests on a broken
// Python process being unable to affect anything else. That is asserted here rather than
// assumed, by pointing the client at a port with nothing behind it.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { randomUUID } from "node:crypto";

// Set before the app is imported, because env.ts is read once at import time. The URL is
// the discard port: the service is "on" for the whole file and never answers, which is
// exactly the state a deployment is in while Python is starting, crashed, or missing.
process.env.ML_ENABLED = "true";
process.env.ML_SERVICE_URL = "http://127.0.0.1:9";

const { app } = await import("./app.js");
const { prisma } = await import("./prisma.js");
const { signToken } = await import("./auth/middleware.js");

const RUN = randomUUID().slice(0, 8);
const email = (tag: string) => `sig-${RUN}-${tag}@example.test`;
const orgIds = new Set<string>();

const rows = Array.from({ length: 24 }, (_, i) => ({
  order_date: `2025-${String((i % 12) + 1).padStart(2, "0")}-08`,
  customer: `Customer ${i % 6}`,
  product: `Product ${i % 4}`,
  order_no: `ORD-${i}`,
  amount: 100 + i,
}));

async function setupOrg(tag: string, plan = "pro") {
  const res = await request(app).post("/api/auth/signup").send({
    name: `User ${tag}`, email: email(tag), password: "password123", organizationName: `Org ${tag}`,
  });
  const orgId = res.body.organization.id as string;
  orgIds.add(orgId);
  await prisma.organization.update({ where: { id: orgId }, data: { plan } });
  await prisma.dataset.create({
    data: {
      organizationId: orgId, name: "Sales", fileName: "sales.csv", fileType: "csv", fileSize: 1024,
      rowCount: rows.length, columnCount: 5,
      columns: [], profile: {}, rows,
      schemaMap: { date: "order_date", customer_name: "customer", product_name: "product", order_id: "order_no", revenue: "amount" },
    },
  });
  return { orgId, token: `Bearer ${res.body.token}` };
}

async function addMember(orgId: string, tag: string, role: "ADMIN" | "MANAGER" | "VIEWER") {
  const user = await prisma.user.create({ data: { email: email(tag), name: `Member ${tag}`, passwordHash: "x" } });
  await prisma.organizationMember.create({ data: { userId: user.id, organizationId: orgId, role } });
  return `Bearer ${signToken({ userId: user.id, organizationId: orgId, role })}`;
}

// The run finishes in the background, so the row it wrote is read back by polling. The
// service is unreachable here, so every run settles on its first attempt.
async function settled(token: string, slug: string) {
  for (let i = 0; i < 60; i++) {
    const res = await request(app).get(`/api/signals/${slug}`).set("Authorization", token);
    if (res.body.prediction && res.body.prediction.status !== "RUNNING") return res.body.prediction;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("prediction never left RUNNING");
}

before(async () => { await prisma.$connect(); });
after(async () => {
  for (const id of orgIds) await prisma.organization.delete({ where: { id } }).catch(() => {});
  await prisma.user.deleteMany({ where: { email: { startsWith: `sig-${RUN}-` } } });
  await prisma.$disconnect();
});

test("status separates 'switched on for this deployment' from 'reachable' and 'on your plan'", async () => {
  const { token } = await setupOrg("status");
  const res = await request(app).get("/api/signals/status").set("Authorization", token);
  assert.equal(res.status, 200);
  assert.equal(res.body.enabled, true, "ML_ENABLED is set for this file");
  assert.equal(res.body.reachable, false, "nothing is listening on the discard port");
  assert.equal(res.body.entitled, true, "this org is on Pro");
});

test("plan gate: Free is refused with a 402 and told what to do, Pro is accepted", async () => {
  const free = await setupOrg("free", "free");
  const status = await request(app).get("/api/signals/status").set("Authorization", free.token);
  assert.equal(status.body.entitled, false);

  const refused = await request(app).post("/api/signals/churn").set("Authorization", free.token).send({});
  assert.equal(refused.status, 402);
  assert.match(refused.body.error ?? refused.body.message ?? "", /Upgrade to Pro/i);

  // Nothing was written. A refused run must not leave a row implying one happened.
  assert.equal(await prisma.prediction.count({ where: { organizationId: free.orgId } }), 0);

  const pro = await setupOrg("pro");
  const accepted = await request(app).post("/api/signals/churn").set("Authorization", pro.token).send({});
  assert.equal(accepted.status, 202, "training is background work — the request does not wait for it");
  assert.equal(accepted.body.prediction.status, "RUNNING");
});

test("RBAC: a VIEWER can read predictions but cannot start one", async () => {
  const { orgId, token } = await setupOrg("rbac");
  const viewer = await addMember(orgId, "rbac-v", "VIEWER");

  const blocked = await request(app).post("/api/signals/segments").set("Authorization", viewer).send({});
  assert.equal(blocked.status, 403);

  await request(app).post("/api/signals/segments").set("Authorization", token).send({});
  await settled(token, "segments");
  const read = await request(app).get("/api/signals/segments").set("Authorization", viewer);
  assert.equal(read.status, 200);
  assert.ok(read.body.prediction, "a view-only member still sees the result");
});

test("tenant isolation: one organization never sees another's predictions", async () => {
  const a = await setupOrg("iso-a");
  const b = await setupOrg("iso-b");

  await request(app).post("/api/signals/basket").set("Authorization", a.token).send({});
  const mine = await settled(a.token, "basket");

  const theirs = await request(app).get("/api/signals/basket").set("Authorization", b.token);
  assert.equal(theirs.status, 200);
  assert.equal(theirs.body.prediction, null, "B has run nothing, so B sees nothing — not A's row");
  assert.notEqual(mine.id, undefined);
});

test("the same prediction cannot be started twice at once", async () => {
  const { token } = await setupOrg("dupe");
  const first = await request(app).post("/api/signals/churn").set("Authorization", token).send({});
  assert.equal(first.status, 202);
  // Racing runs would both claim to be the latest, and the loser's numbers would end up
  // filed under the winner's timestamp.
  const second = await request(app).post("/api/signals/churn").set("Authorization", token).send({});
  assert.ok(second.status === 409 || second.status === 202, "either refused as already running, or the first had already settled");
  if (second.status === 409) assert.match(second.body.error ?? second.body.message ?? "", /already running/i);
});

test("an unknown prediction kind is a 400, not a new kind", async () => {
  const { token } = await setupOrg("bad-kind");
  const res = await request(app).get("/api/signals/nonsense").set("Authorization", token);
  assert.equal(res.status, 400);
});

test("with the model service unreachable, Signals fails alone and the rest of the product is untouched", async () => {
  const { token } = await setupOrg("degrade");

  const started = await request(app).post("/api/signals/segments").set("Authorization", token).send({});
  assert.equal(started.status, 202, "starting a run still succeeds — the service is only reached afterwards");

  const prediction = await settled(token, "segments");
  assert.equal(prediction.status, "FAILED");
  assert.equal(prediction.result, null, "no result is invented when the service does not answer");
  assert.match(prediction.error, /could not be reached|did not return a usable result/i);

  // The point of the whole design. Every one of these runs through the deterministic
  // engine and none of them knows the model service exists.
  const dashboard = await request(app).get("/api/analytics/overview").set("Authorization", token);
  assert.equal(dashboard.status, 200);
  assert.ok(dashboard.body.kpis, "the dashboard computes exactly as it did before");

  const forecast = await request(app).post("/api/forecasts").set("Authorization", token).send({ metric: "revenue", horizon: 3 });
  assert.equal(forecast.status, 201, "forecasting is deterministic and unaffected");

  const trend = await request(app).get("/api/analytics/revenue").set("Authorization", token);
  assert.equal(trend.status, 200);
});
