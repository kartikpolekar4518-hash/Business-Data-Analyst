// Integration tests for saved views: real Express + Prisma + Postgres.
// Run via `npm run test:integration` (CI provides the DB). Covers CRUD, RBAC,
// tenant isolation, save-by-name overwrite, and query validation.
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

test("CRUD: create, list, rename, and delete a saved view", async () => {
  const { token } = await setupOrg("crud");
  const created = await request(app).post("/api/analytics/views").set("Authorization", token)
    .send({ name: "West — last 30 days", query: "region=West&dateFrom=2026-01-01" });
  assert.equal(created.status, 201);
  const id = created.body.view.id;

  const list = await request(app).get("/api/analytics/views").set("Authorization", token);
  const found = list.body.views.find((v: any) => v.id === id);
  assert.equal(found.query, "region=West&dateFrom=2026-01-01", "the query round-trips verbatim");

  const renamed = await request(app).patch(`/api/analytics/views/${id}`).set("Authorization", token).send({ name: "West" });
  assert.equal(renamed.status, 200);
  assert.equal(renamed.body.view.name, "West");

  assert.equal((await request(app).delete(`/api/analytics/views/${id}`).set("Authorization", token)).status, 204);
  assert.ok(!(await request(app).get("/api/analytics/views").set("Authorization", token)).body.views.some((v: any) => v.id === id));
});

test("saving under an existing name overwrites that view rather than duplicating it", async () => {
  const { token } = await setupOrg("upsert");
  const first = await request(app).post("/api/analytics/views").set("Authorization", token).send({ name: "Mine", query: "region=West" });
  const second = await request(app).post("/api/analytics/views").set("Authorization", token).send({ name: "Mine", query: "region=East" });
  assert.equal(second.status, 201);
  assert.equal(second.body.view.id, first.body.view.id, "same row, updated");
  const list = await request(app).get("/api/analytics/views").set("Authorization", token);
  assert.equal(list.body.views.filter((v: any) => v.name === "Mine").length, 1);
  assert.equal(list.body.views.find((v: any) => v.name === "Mine").query, "region=East");
});

test("renaming onto another view's name is refused (409)", async () => {
  const { token } = await setupOrg("clash");
  await request(app).post("/api/analytics/views").set("Authorization", token).send({ name: "A", query: "region=West" });
  const b = await request(app).post("/api/analytics/views").set("Authorization", token).send({ name: "B", query: "region=East" });
  assert.equal((await request(app).patch(`/api/analytics/views/${b.body.view.id}`).set("Authorization", token).send({ name: "A" })).status, 409);
});

test("a query the analytics routes would reject cannot be saved (400)", async () => {
  const { token } = await setupOrg("badq");
  assert.equal((await request(app).post("/api/analytics/views").set("Authorization", token)
    .send({ name: "bad date", query: "dateFrom=last-tuesday" })).status, 400);
  assert.equal((await request(app).post("/api/analytics/views").set("Authorization", token)
    .send({ name: "unknown filter", query: "planet=mars" })).status, 400);
  // Repeated params are how the UI sends a multi-select, and must stay savable.
  assert.equal((await request(app).post("/api/analytics/views").set("Authorization", token)
    .send({ name: "two regions", query: "region=West&region=East" })).status, 201);
});

test("RBAC: a VIEWER can read views but cannot create or delete one", async () => {
  const { orgId, token } = await setupOrg("rbac");
  const created = await request(app).post("/api/analytics/views").set("Authorization", token).send({ name: "Shared", query: "region=West" });
  const viewer = await prisma.user.create({ data: { email: email("rbac-v"), name: "V", passwordHash: "x" } });
  await prisma.organizationMember.create({ data: { userId: viewer.id, organizationId: orgId, role: "VIEWER" } });
  const vtoken = `Bearer ${signToken({ userId: viewer.id, organizationId: orgId, role: "VIEWER" })}`;

  const list = await request(app).get("/api/analytics/views").set("Authorization", vtoken);
  assert.equal(list.status, 200);
  assert.ok(list.body.views.some((v: any) => v.id === created.body.view.id), "a viewer sees the org's views");
  assert.equal((await request(app).post("/api/analytics/views").set("Authorization", vtoken).send({ name: "x", query: "region=West" })).status, 403);
  assert.equal((await request(app).delete(`/api/analytics/views/${created.body.view.id}`).set("Authorization", vtoken)).status, 403);
});

test("tenant isolation: org B cannot see, rename, or delete org A's view", async () => {
  const a = await setupOrg("iso-a");
  const b = await setupOrg("iso-b");
  const created = await request(app).post("/api/analytics/views").set("Authorization", a.token).send({ name: "A view", query: "region=West" });
  const id = created.body.view.id;
  assert.ok(!(await request(app).get("/api/analytics/views").set("Authorization", b.token)).body.views.some((v: any) => v.id === id));
  assert.equal((await request(app).patch(`/api/analytics/views/${id}`).set("Authorization", b.token).send({ name: "hijack" })).status, 404);
  assert.equal((await request(app).delete(`/api/analytics/views/${id}`).set("Authorization", b.token)).status, 404);
  // The same name is free in another org — uniqueness is per organization, not global.
  assert.equal((await request(app).post("/api/analytics/views").set("Authorization", b.token).send({ name: "A view", query: "region=East" })).status, 201);
});
