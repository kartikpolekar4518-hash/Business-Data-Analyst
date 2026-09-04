// Integration tests for report templates: real Express + Prisma + Postgres.
// Run via `npm run test:integration` (CI provides the DB). Covers CRUD, RBAC,
// tenant isolation, and the templated-generate path (blocks are dropped).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { app } from "./app.js";
import { prisma } from "./prisma.js";
import { signToken } from "./auth/middleware.js";
import { setupOrg as baseSetupOrg, makeEmail, orgIds, cleanupOrgs } from "./testHelpers.js";

const RUN = randomUUID().slice(0, 8);
const email = makeEmail("tpl", RUN);

async function setupOrg(tag: string, withData = true) {
  return baseSetupOrg(tag, { email, withSampleData: withData });
}


before(async () => { await prisma.$connect(); });
after(async () => {
  await cleanupOrgs("tpl", RUN);
});

test("CRUD: create, list, and delete a template", async () => {
  const { token } = await setupOrg("crud");
  const created = await request(app).post("/api/reports/templates").set("Authorization", token)
    .send({ name: "KPIs only", include: { summary: false, kpis: true, sections: false, forecast: false, recommendations: false } });
  assert.equal(created.status, 201);
  const id = created.body.template.id;
  const list = await request(app).get("/api/reports/templates").set("Authorization", token);
  assert.ok(list.body.templates.some((t: any) => t.id === id));
  assert.equal((await request(app).delete(`/api/reports/templates/${id}`).set("Authorization", token)).status, 204);  assert.ok(!(await request(app).get("/api/reports/templates").set("Authorization", token)).body.templates.some((t: any) => t.id === id)));
});

test("generate with a template drops the deselected blocks", async () => {
  const { token } = await setupOrg("gen");
  const tpl = await request(app).post("/api/reports/templates").set("Authorization", token)
    .send({ name: "Summary + KPIs", include: { summary: true, kpis: true, sections: false, forecast: false, recommendations: false } });
  const gen = await request(app).post("/api/reports/generate").set("Authorization", token).send({ templateId: tpl.body.template.id });
  assert.equal(gen.status, 201);
  const c = gen.body.report.content;
  assert.ok(c.summary && c.kpis.length, "included blocks present");
  assert.deepEqual(c.sections, [], "sections dropped");
  assert.equal(c.forecast, null, "forecast dropped");
  assert.deepEqual(c.recommendations, [], "recommendations dropped");
});

test("generate without a template still returns the full report", async () => {
  const { token } = await setupOrg("full");
  const gen = await request(app).post("/api/reports/generate").set("Authorization", token).send({});
  assert.equal(gen.status, 201);
  assert.ok(gen.body.report.content.kpis.length, "full report has KPIs");
});

test("generate with an unknown template id 404s", async () => {
  const { token } = await setupOrg("badtpl");
  assert.equal((await request(app).post("/api/reports/generate").set("Authorization", token).send({ templateId: "nope" })).status, 404);
});

test("RBAC: a VIEWER cannot create a template (403)", async () => {
  const { orgId } = await setupOrg("rbac", false);
  const viewer = await prisma.user.create({ data: { email: email("rbac-v"), name: "V", passwordHash: "x" } });
  await prisma.organizationMember.create({ data: { userId: viewer.id, organizationId: orgId, role: "VIEWER" } });
  const vtoken = `Bearer ${signToken({ userId: viewer.id, organizationId: orgId, role: "VIEWER" })}`;
  assert.equal((await request(app).post("/api/reports/templates").set("Authorization", vtoken).send({ name: "x", include: { kpis: true } })).status, 403);
});

test("tenant isolation: org B cannot see, edit, delete, or generate from org A's template", async () => {
  const a = await setupOrg("iso-a");
  const b = await setupOrg("iso-b", false);
  const created = await request(app).post("/api/reports/templates").set("Authorization", a.token).send({ name: "A tpl", include: { kpis: true } });
  const id = created.body.template.id;
  assert.ok(!(await request(app).get("/api/reports/templates").set("Authorization", b.token)).body.templates.some((t: any) => t.id === id));
  assert.equal((await request(app).patch(`/api/reports/templates/${id}`).set("Authorization", b.token).send({ name: "hijack" })).status, 404);
  assert.equal((await request(app).delete(`/api/reports/templates/${id}`).set("Authorization", b.token)).status, 404);
  assert.equal((await request(app).post("/api/reports/generate").set("Authorization", b.token).send({ templateId: id })).status, 404);
});
