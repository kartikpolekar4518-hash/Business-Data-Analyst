// Integration tests for shareable saved views: real Express + Prisma + Postgres.
// Covers CRUD, the save-over-a-name replacement rule, RBAC, and tenant isolation.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { app } from "./app.js";
import { prisma } from "./prisma.js";
import { signToken } from "./auth/middleware.js";

const RUN = randomUUID().slice(0, 8);
const email = (tag: string) => `view-${RUN}-${tag}@example.test`;
const orgIds = new Set<string>();

async function setupOrg(tag: string) {
  const res = await request(app).post("/api/auth/signup").send({
    name: `User ${tag}`, email: email(tag), password: "password123", organizationName: `Org ${tag}`,
  });
  const orgId = res.body.organization.id as string;
  orgIds.add(orgId);
  return { orgId, token: `Bearer ${res.body.token}` };
}

before(async () => { await prisma.$connect(); });
after(async () => {
  for (const id of orgIds) await prisma.organization.delete({ where: { id } }).catch(() => {});
  await prisma.user.deleteMany({ where: { email: { startsWith: `view-${RUN}-` } } });
  await prisma.$disconnect();
});

test("CRUD: create, list, rename, and delete a view", async () => {
  const { token } = await setupOrg("crud");
  const created = await request(app).post("/api/views").set("Authorization", token)
    .send({ name: "West — last 30 days", query: "region=West&dateFrom=2026-08-01" });
  assert.equal(created.status, 201);
  const id = created.body.view.id;

  const list = await request(app).get("/api/views").set("Authorization", token);
  assert.equal(list.body.views.length, 1);
  assert.equal(list.body.views[0].query, "region=West&dateFrom=2026-08-01", "query stored verbatim");

  const renamed = await request(app).patch(`/api/views/${id}`).set("Authorization", token).send({ name: "West" });
  assert.equal(renamed.status, 200);
  assert.equal(renamed.body.view.name, "West");
  assert.equal(renamed.body.view.query, "region=West&dateFrom=2026-08-01", "rename leaves the query alone");

  assert.equal((await request(app).delete(`/api/views/${id}`).set("Authorization", token)).status, 204);
  assert.equal((await request(app).get("/api/views").set("Authorization", token)).body.views.length, 0);
});

test("saving over an existing name replaces that view instead of adding a second", async () => {
  const { token } = await setupOrg("replace");
  const first = await request(app).post("/api/views").set("Authorization", token).send({ name: "Top", query: "region=West" });
  assert.equal(first.status, 201);
  const second = await request(app).post("/api/views").set("Authorization", token).send({ name: "Top", query: "region=East" });
  assert.equal(second.status, 200, "a replacement is 200, not 201");
  assert.equal(second.body.view.id, first.body.view.id, "same row, updated");

  const list = await request(app).get("/api/views").set("Authorization", token);
  assert.equal(list.body.views.length, 1);
  assert.equal(list.body.views[0].query, "region=East");
});

test("renaming onto another view's name is refused (409)", async () => {
  const { token } = await setupOrg("clash");
  await request(app).post("/api/views").set("Authorization", token).send({ name: "A", query: "region=West" });
  const b = await request(app).post("/api/views").set("Authorization", token).send({ name: "B", query: "region=East" });
  assert.equal((await request(app).patch(`/api/views/${b.body.view.id}`).set("Authorization", token).send({ name: "A" })).status, 409);
});

test("a saved view is visible to every member of the organization, not just its author", async () => {
  const { orgId, token } = await setupOrg("share");
  await request(app).post("/api/views").set("Authorization", token).send({ name: "Shared", query: "region=West" });
  const mate = await prisma.user.create({ data: { email: email("share-2"), name: "Mate", passwordHash: "x" } });
  await prisma.organizationMember.create({ data: { userId: mate.id, organizationId: orgId, role: "VIEWER" } });
  const mtoken = `Bearer ${signToken({ userId: mate.id, organizationId: orgId, role: "VIEWER" })}`;
  const list = await request(app).get("/api/views").set("Authorization", mtoken);
  assert.equal(list.status, 200);
  assert.ok(list.body.views.some((v: any) => v.name === "Shared"), "the other member sees it");
});

test("RBAC: a VIEWER can read views but cannot create, rename or delete one", async () => {
  const { orgId, token } = await setupOrg("rbac");
  const created = await request(app).post("/api/views").set("Authorization", token).send({ name: "Locked", query: "region=West" });
  const id = created.body.view.id;
  const viewer = await prisma.user.create({ data: { email: email("rbac-v"), name: "V", passwordHash: "x" } });
  await prisma.organizationMember.create({ data: { userId: viewer.id, organizationId: orgId, role: "VIEWER" } });
  const vtoken = `Bearer ${signToken({ userId: viewer.id, organizationId: orgId, role: "VIEWER" })}`;
  assert.equal((await request(app).get("/api/views").set("Authorization", vtoken)).status, 200);
  assert.equal((await request(app).post("/api/views").set("Authorization", vtoken).send({ name: "x", query: "" })).status, 403);
  assert.equal((await request(app).patch(`/api/views/${id}`).set("Authorization", vtoken).send({ name: "x" })).status, 403);
  assert.equal((await request(app).delete(`/api/views/${id}`).set("Authorization", vtoken)).status, 403);
});

test("unauthenticated requests are rejected", async () => {
  assert.equal((await request(app).get("/api/views")).status, 401);
});

test("tenant isolation: org B cannot see, rename or delete org A's view, and may reuse its name", async () => {
  const a = await setupOrg("iso-a");
  const b = await setupOrg("iso-b");
  const created = await request(app).post("/api/views").set("Authorization", a.token).send({ name: "A view", query: "region=West" });
  const id = created.body.view.id;
  assert.deepEqual((await request(app).get("/api/views").set("Authorization", b.token)).body.views, []);
  assert.equal((await request(app).patch(`/api/views/${id}`).set("Authorization", b.token).send({ name: "hijack" })).status, 404);
  assert.equal((await request(app).delete(`/api/views/${id}`).set("Authorization", b.token)).status, 404);
  // The name is unique per organization, not globally.
  assert.equal((await request(app).post("/api/views").set("Authorization", b.token).send({ name: "A view", query: "region=East" })).status, 201);
  assert.equal((await request(app).get("/api/views").set("Authorization", a.token)).body.views[0].query, "region=West", "A's view untouched");
});

test("validation: an empty name is rejected", async () => {
  const { token } = await setupOrg("valid");
  assert.equal((await request(app).post("/api/views").set("Authorization", token).send({ name: "", query: "" })).status, 400);
});
