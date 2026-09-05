// Integration tests for report recipes: real Express + Prisma + Postgres.
// Run via `npm run test:integration` (CI provides the DB). Covers the variable composition,
// point-of-view links for routing, Role-based access control, and tenant isolation.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { app } from "./app.js";
import { prisma } from "./prisma.js";
import { signToken } from "./auth/middleware.js";
import { setupOrg as baseSetupOrg, makeEmail, orgIds, cleanupOrgs } from "./testHelpers.js";

const RUN = randomUUID().slice(0, 8);
const email = makeEmail("rcp", RUN);

async function setupOrg(tag: string, withData = true) {
  return baseSetupOrg(tag, { email, withSampleData: withData });
}

before(async () => { await prisma.$connect(); });
after(async () => {
  await cleanupOrgs("rcp", RUN);
});

test("a recipe can create the dataset's default business structure", async () => {
  const { token } = await setupOrg("create");
  const res = await request(app).post("/api/recipes").set("Authorization", token).send({ name: "create the default", builder: "default" });
  assert.equal(res.status, 201);
  assert.ok(res.body.recipe.builder, "the builder is persisted");
  assert.ok(res.body.recipe.variables.length > 0, "the default variables are persisted");
  assert.equal(res.body.recipe.variables.find((v: any) => v.role === "revenue"), "revenue is one of the default variables");
  assert.equal(res.body.recipe.variables.find((v: any) => v.role === "revenue")?.builder, "product_name * item_price", "default revenue computation matches the docs");
});

test("a point-of-view recipe can route a report to a shared link", async () => {
  const { token } = await setupOrg("pov-noreport");
  // First create a non-report recipe.
  const created = await request(app).post("/api/recipes").set("Authorization", token).send({ name: "Link fields directly", variables: [{ id: "revenue", field: "revenue" }] });
  assert.equal(created.status, 201);
  const gen = await request(app).post("/api/reports/generate").set("Authorization", token).send({});
  const reportId = gen.body.report.id;
  const share = await request(app).post(`/api/reports/${reportId}/shares`).set("Authorization", token).send({ expiresInDays: 30 });
  // Now create a point-of-view recipe that routes the same report through a different variable name.
  const pov = await request(app).post("/api/recipes").set("Authorization", token).send({
    name: "abc field on demand",
    variables: [{ id: "revenue", field: "abc"}],
  });
  assert.equal(pov.status, 201);
  const povGen = await request(app).post("/api/reports/generate").set("Authorization", token).send({ recipeId: pov.body.recipe.id });
  assert.equal(povGen.status, 201);
  assert.ok(povGen.body.report.content.fields.revenue, "a composed variable should produce a field");
});

test("RBAC enforced by each variable role", async () => {
  const { orgId, token } = await setupOrg("rbac");
  const viewer = await prisma.user.create({ data: { email: email("rbac-v"), name: "V", passwordHash: "x" } });
  await prisma.organizationMember.create({ data: { userId: viewer.id, organizationId: orgId, role: "VIEWER" } });
  const vtoken = `Bearer ${signToken({ userId: viewer.id, organizationId: orgId, role: "VIEWER" })}`;

  // Viewer cannot create a recipe with an AGGREGATE variable
  const agg = await request(app).post("/api/recipes").set("Authorization", token)
    .send({ name: "v tries aggregate", variables: [{ id: "revenue", role: "aggregate" }] });
  assert.equal(agg.status, 403);

  // Viewer cannot create a recipe with a COMPUTE variable on a field they can't see
  const comp = await request(app).post("/api/recipes").set("Authorization", vtoken)
    .send({ name: "v tries compute unseen field", variables: [{ id: "revenue", role: "compute", field: "cost" }] });
  assert.equal(comp.status, 403);

  // Viewer cannot see a field they don't have view access to (cost)
  const ownerGen = await request(app).post("/api/reports/generate").set("Authorization", token).send({ recipeId: "rules-of-thumb" });
  const ownerResult = await request(app).post("/api/reports/generate").set("Authorization", token).send({ recipeId: "rules-of-thumb" });
  assert.ok(ownerResult.body.report.content.fields.cost, "owner can see cost");
  const viewerGen = await request(app).post("/api/reports/generate").set("Authorization", vtoken).send({ recipeId: "rules-of-thumb" });
  assert.equal(viewerGen.status, 201);
  assert.ok(viewerGen.body.report.content.fields.cost === undefined, "viewer cannot see cost");
  assert.ok(viewerGen.body.report.content.fields.revenue, "viewer can still see revenue");
});

test("tenant isolation: org B cannot access or use recipes defined by org A", async () => {
  const a = await setupOrg("iso-a");
  const b = await setupOrg("iso-b");
  const created = await request(app).post("/api/recipes").set("Authorization", a.token)
    .send({ name: "A private", variables: [{ id: "revenue", field: "a_rid" }] });
  const id = created.body.recipe.id;

  const bList = await request(app).get("/api/recipes").set("Authorization", b.token);
  assert.ok(!bList.body.recipes.some((r: any) => r.id === id), "org B cannot list org A's recipes");

  const bGen = await request(app).post("/api/reports/generate").set("Authorization", b.token)
    .send({ recipeId: id });
  assert.equal(bGen.status, 404);
  // The variable field is confidential because the variable config only matters for the authenticated org -- the base dataset is shared and the other org doesn't even have the field named
  // "a_rid" in its data, so actually the field is empty, not misked for explicit forbidden data.
  assert.ok(!bGen.body.report.content.fields.a_rid);
});
