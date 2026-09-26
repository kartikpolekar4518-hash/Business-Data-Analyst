import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { app } from "./app.js";
import { prisma } from "./prisma.js";
import { signToken } from "./auth/middleware.js";

const RUN = randomUUID().slice(0, 8);
const orgIds = new Set<string>();

async function signup(tag: string) {
  const res = await request(app).post("/api/auth/signup").send({
    name: `User ${tag}`, email: `tenant-${RUN}-${tag}@example.test`, password: "password123",
    organizationName: `Org ${tag}`
  });
  if (res.body?.organization?.id) orgIds.add(res.body.organization.id);
  return res;
}

after(async () => {
  if (orgIds.size > 0) await prisma.organization.deleteMany({ where: { id: { in: [...orgIds] } } });
});

test("tenant isolation: organization A cannot access organization B's dataset", async () => {
  const a = await signup("A");
  const b = await signup("B");
  
  const tokenA = a.body.token;
  const tokenB = b.body.token;
  
  // Org A uploads a dataset
  const csv = "id,name,value\n1,Test,100";
  const upload = await request(app)
    .post("/api/uploads")
    .set("Authorization", `Bearer ${tokenA}`)
    .attach("file", Buffer.from(csv), "data.csv");
  
  assert.equal(upload.status, 201);
  const datasetId = upload.body.dataset?.id ?? upload.body.id;
  
  // Org A can access it
  const getA = await request(app)
    .get(`/api/datasets/${datasetId}`)
    .set("Authorization", `Bearer ${tokenA}`);
  assert.equal(getA.status, 200);
  
  // Org B cannot access it
  const getB = await request(app)
    .get(`/api/datasets/${datasetId}`)
    .set("Authorization", `Bearer ${tokenB}`);
  assert.equal(getB.status, 404);
});

test("tenant isolation: organization A cannot access another organization's analytics", async () => {
  const a = await signup("A2");
  const b = await signup("B2");
  
  const tokenA = a.body.token;
  const tokenB = b.body.token;
  
  const csv = "id,value\n1,100";
  const upload = await request(app)
    .post("/api/uploads")
    .set("Authorization", `Bearer ${tokenA}`)
    .attach("file", Buffer.from(csv), "data.csv");
  
  const datasetId = upload.body.id;
  
  // Org B cannot access Org A's analytics export
  const exportB = await request(app)
    .get(`/api/analytics/export?datasetId=${datasetId}`)
    .set("Authorization", `Bearer ${tokenB}`);
  assert.equal(exportB.status, 404);
});
