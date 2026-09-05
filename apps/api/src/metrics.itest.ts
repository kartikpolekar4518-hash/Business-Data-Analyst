// Integration tests for custom metrics: real Express + Prisma + Postgres.
// Run via `npm run test:integration` (CI provides the DB). Covers CRUD, RBAC, tenant
// isolation, spec validation, key collisions, and the two integrations that make a
// custom metric worth having — it appears on the dashboard, and it can be explained.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { app } from "./app.js";
import { prisma } from "./prisma.js";
import { signToken } from "./auth/middleware.js";
import { setupOrg as baseSetupOrg, makeEmail, orgIds, cleanupOrgs } from "./testHelpers.js";

const RUN = randomUUID().slice(0, 8);
const email = makeEmail("metric", RUN);

async function setupOrg(tag: string, withData = true) {
  return baseSetupOrg(tag, { email, withSampleData: withData });
}


const costRatio = {
  key: "cost_ratio", label: "Cost Ratio", kind: "ratio", format: "percent",
  field: { kind: "semantic", name: "cost" },
  denominator: { kind: "semantic", name: "revenue" },
};

before(async () => { await prisma.$connect(); });
after(async () => {
  await cleanupOrgs("metric", RUN);
});

test("a custom metric can be created, listed and deleted", async () => {
  const { token } = await setupOrg("crud");

  const created = await request(app).post("/api/metrics").set("Authorization", token).send(costRatio);
  assert.equal(created.status, 201);
  assert.equal(created.body.metric.key, "cost_ratio");

  const listed = await request(app).get("/api/metrics").set("Authorization", token);
  assert.equal(listed.status, 200);
  assert.equal(listed.body.metrics.length, 1);
  assert.equal(listed.body.metrics[0].label, "Cost Ratio");

  const deleted = await request(app).delete `/api/metrics/${created.body.metric.id}`).set("Authorization", token);
  assert.equal(deleted.status, 204);

  const after = await request(app).get("/api/metrics").set("Authorization", token);
  assert.equal(after.body.metrics.length, 0);
});

test("an invalid spec is rejected with a reason", async () => {
  const { token } = await setupOrg("invalid");

  // A ratio without a denominator cannot be computed.
  const noDenominator = await request(app).post("/api/metrics").set("Authorization", token)
    .send({ ...costRatio, denominator: undefined });
  assert.equal(noDenominator.status, 400);

  // A count aggregates nothing, so a field is meaningless.
  const countWithField = await request(app).post("/api/metrics").set("Authorization", token)
    .send({ key: "row_count", label: "Rows", kind: "count", format: "number", field: { kind: "semantic", name: "revenue" } });
  assert.equal(countWithField.status, 400);
});

// A duplicate key would make which implementation runs depend on lookup order.
test("a metric key cannot collide with another custom metric or a built-in", async () => {
  const { token } = await setupOrg("collide");
  await request(app).post("/api/metrics").set("Authorization", token).send(costRatio);

  const duplicate = await request(app).post("/api/metrics").set("Authorization", token).send(costRatio);
  assert.equal(duplicate.status, 409);

  const shadowsBuiltin = await request(app).post("/api/metrics").set("Authorization", token)
    .send({ ...costRatio, key: "revenue", label: "My Revenue" });
  assert.equal(shadowsBuiltin.status, 409);
});

test("a VIEWER can read metrics but not change them", async () => {
  const { orgId, token } = await setupOrg("rbac");
  const created = await request(app).post("/api/metrics").set("Authorization", token).send(costRatio);
  assert.equal(created.status, 201);

  const viewer = await prisma.user.create({
    data: { email: email("viewer"), name: "Viewer", passwordHash: "x", memberships: { create: { organizationId: orgId, role: "VIEWER" } } },
    include: { memberships: true },
  });
  const viewerToken = `Bearer ${signToken({ userId: viewer.id, organizationId: orgId, role: "VIEWER", tokenVersion: 0 })}`;

  const read = await request(app).get("/api/metrics").set("Authorization", viewerToken);
  assert.equal(read.status, 200, "a viewer can see the org's metrics");

  const write = await request(app).post("/api/metrics").set("Authorization", viewerToken)
    .send({ ...costRatio, key: "viewer_metric" });
  assert.equal(write.status, 403);

  const del = await request(app).delete `/api/metrics/${created.body.metric.id}`).set("Authorization", viewerToken);
  assert.equal(del.status, 403);
});

test("one organization cannot see or delete another's metrics", async () => {
  const a = await setupOrg("tenant-a");
  const b = await setupOrg("tenant-b");
  const created = await request(app).post("/api/metrics").set("Authorization", a.token).send(costRatio);

  const bList = await request(app).get("/api/metrics").set("Authorization", b.token);
  assert.equal(bList.body.metrics.length, 0, "org B sees none of org A's metrics");

  const bDelete = await request(app).delete `/api/metrics/${created.body.metric.id}`).set("Authorization", b.token);
  assert.equal(bDelete.status, 404, "org B gets 404, not 403, for an id it does not own");

  // Org B may reuse the same key: keys are unique per organization, not globally.
  const bCreate = await request(app).post("/api/metrics").set("Authorization", b.token).send(costRatio);
  assert.equal(bCreate.status, 201);
});

// The whole point of the feature: a metric defined once works where built-ins do.
test("a custom metric appears on the dashboard and can explain itself", async () => {
  const { token } = await setupOrg("integrated");
  await request(app).post("/api/metrics").set("Authorization", token).send(costRatio);

  const overview = await request(app).get("/api/analytics/overview").set("Authorization", token);
  assert.equal(overview.status, 200);
  const tile = overview.body.kpis.find((k: { key: string }) => k.key === "cost_ratio");
  assert.ok(tile, "the custom metric is rendered as a dashboard KPI");
  assert.equal(tile.format, "percent");

  const explained = await request(app)
    .get("/api/analytics/explain?metric=cost_ratio").set("Authorization", token);
  assert.equal(explained.status, 200, "a custom metric is explainable, not a 400");
  assert.equal(explained.body.metric.value, tile.value, "evidence agrees with the dashboard");
  assert.match(explained.body.formula.expression, /SUM\(.+\) \/ SUM\(.+\) x 100/);
  assert.ok(explained.body.formula.sources.length > 0, "evidence names the columns it read");
});

test("preview evaluates a spec against real data without saving it", async () => {
  const { token } = await setupOrg("preview");

  const preview = await request(app).post("/api/metrics/preview").set("Authorization", token).send({ spec: costRatio });
  assert.equal(preview.status, 200);
  assert.ok(Number.isFinite(preview.body.value));
  assert.equal(preview.body.resolves, true);

  const listed = await request(app).get("/api/metrics").set("Authorization", token);
  assert.equal(listed.body.metrics.length, 0, "previewing must not persist the metric");
});

// A rule pointing at a deleted metric would evaluate to null and silently never fire.
test("a metric in use by an alert rule cannot be deleted", async () => {
  const { token } = await setupOrg("in-use");
  const created = await request(app).post("/api/metrics").set("Authorization", token).send(costRatio);

  const rule = await request(app).post("/api/schedules/alert-rules").set("Authorization", token)
    .send({ name: "Cost ratio too high", metric: "cost_ratio", comparator: "GT", threshold: 50, frequency: "DAILY" });
  assert.equal(rule.status, 201, "an alert rule can target a custom metric");

  const blocked = await request(app).delete `/api/metrics/${created.body.metric.id}`).set("Authorization", token);
  assert.equal(blocked.status, 409);
  assert.match(blocked.body.error, /alert rule/i);
});

test("an alert rule cannot target a metric that does not exist", async () => {
  const { token } = await setupOrg("unknown-metric");
  const rule = await request(app).post("/api/schedules/alert-rules").set("Authorization", token)
    .send({ name: "Nonsense", metric: "not_a_metric", comparator: "GT", threshold: 1, frequency: "DAILY" });
  assert.equal(rule.status, 400);
});
