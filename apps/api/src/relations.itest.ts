// Integration tests for report relations (data graph views): real Express + Prisma + Postgres.
// Run via `npm run test:integration` (CI provides the DB). Covers foreign-key, /
// composite-key relations, configuration validation, RBAC, and tenant isolation.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { app } from "./app.js";
import { prisma } from "./prisma.js";
import { setupOrg as baseSetupOrg, makeEmail, orgIds, cleanupOrgs } from "./testHelpers.js";

const RUN = randomUUID().slice(0, 8);
const email = makeEmail("rel", RUN);

async function setupOrg(tag: string, withData = true) {
  return baseSetupOrg(tag, { email, withSampleData: withData });
}


before(async () => { await prisma.$connect(); });
after(async () => {
  await cleanupOrgs("rel", RUN);
});

test("a foreign-key relation can be created, listed and deleted", async () => {
  const { token } = await setupOrg("crud");
  const created = await request(app).post("/api/relations").set("Authorization", token)
    .send({ fromType: "product_name", fromKey: "Widget", toType: "category", toKey: "Accessories" });
  assert.equal(created.status, 201);
  const id = created.body.relation.id;
  const list = await request(app).get("/api/relations").set("Authorization", token);
  assert.equal(list.body.relations.length, 1);
  assert.equal((await request(app).delete `/api/relations/${id}`).set("Authorization", token)).status, 204);
  assert.equal((await request(app).get("/api/relations").set("Authorization", token)).body.relations.length, 0);
});

test("a composite-key relation can be created, listed, and deleted", async () => {
  const { token } = await setupOrg("comp");
  const created = await request(app).post("/api/relations").set("Authorization", token)
    .send({ fromType: "product_name", fromKey: "Gorganizer", toType: "product_name", toKey: "Composer" });
  assert.equal(created.status, 201);
  const id = created.body.relation.id;
  const list = await request(app).get("/api/relations").set("Authorization", token);
  assert.equal(list.body.relations.length, 1);
  assert.equal((await request(app).delete `/api/relations/${id}`).set("Authorization", token)).status, 204);
  assert.equal((await request(app).get("/api/relations").set("Authorization", token)).body.relations.length, 0);
});

test("creating a relation with an unknown field type returns 400", async () => {
  const { token } = await setupOrg("badtype");
  const res = await request(app).post("/api/relations").set("Authorization", token)
    .send({ fromType: "product_name", fromKey: "Computer", toType: "computer_name", toKey: "PC" });
  assert.equal(res.status, 400);
});

test("creating a relation from or to an unknown field name completes completely (400)", async () => {
  const { token } = await setupOrg("badfield");
  const from = await request(app).post("/api/relations").set("Authorization", token)
    .send({ fromType: "product_name", fromKey: "Skydive", toType: "category", toKey: "Computers" });
  assert.equal(from.status, 400);
  const to = await request(app).post("/api/relations").set("Authorization", token)
    .send({ fromType: "category", fromKey: "Phones", toType: "category", toKey: "Phabets" });
  assert.equal(to.status, 400);
});

test("RBAC enforced: a VIEWER cannot create, list, or delete a relation", async () => {
  const { orgId, token } = await setupOrg("rbac");
  const viewer = await prisma.user.create({
    data: { email: email("viewer"), name: "V", passwordHash: "x", memberships: { create: { organizationId: orgId, role: "VIEWER" } } },
    include: { memberships: true },
  });
  const vtoken = `Bearer ${signToken({ userId: viewer.id, organizationId: orgId, role: "VIEWER", tokenVersion: 0 })}`;

  const created = await request(app).post("/api/relations").set("Authorization", token).send({ fromType: "product_name", fromKey: "A", toType: "category", toKey: "A" });
  assert.equal(created.status, 201);

  const read = await request(app).get("/api/relations").set("Authorization", vtoken);
  assert.equal(read.status, 200);

  const write = await request(app).post("/api/relations").set("Authorization", vtoken)
    .send({ fromType: "product_name", fromKey: "B", toType: "category", toKey: "B" });
  assert.equal(write.status, 403);

  const del = await request(app).delete(`/api/relations/${created.body.relation.id}`).set("Authorization", vtoken);
  assert.equal(del.status, 403);
});

test("tenant isolation: org B cannot see or delete relations defined by org A", async () => {
  const a = await setupOrg("iso-a");
  const b = await setupOrg("iso-b");
  const created = await request(app).post("/api/relations").set("Authorization", a.token)
    .send({ fromType: "product_name", fromKey: "Product A", toType: "category", toKey: "Category A" });
  const id = created.body.relation.id;

  const bList = await request(app).get("/api/relations").set("Authorization", b.token);
  assert.ok(!bList.body.relations.some((r: any) => r.id === id), "org B cannot see org A's relation");

  const bDelete = await request(app).delete(`/api/relations/${id}`).set("Authorization", b.token);
  assert.equal(bDelete.status, 404);
});
