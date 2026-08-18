// Integration test: cross-tenant isolation over real HTTP against a real DB.
// Runs only via `npm run test:integration` (NODE_ENV=test + a live DATABASE_URL,
// migrations applied). Excluded from the unit glob (*.test.ts) so `npm test`
// stays DB-free. CI provides a Postgres service.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { app } from "./index.js";
import { prisma } from "./prisma.js";

const stamp = Date.now();
const emailA = `a-${stamp}@itest.dev`;
const emailB = `b-${stamp}@itest.dev`;
const orgA = `ItestOrgA-${stamp}`;
const orgB = `ItestOrgB-${stamp}`;

async function signup(email: string, organizationName: string): Promise<string> {
  const res = await request(app)
    .post("/api/auth/signup")
    .send({ name: "Test", email, password: "password123", organizationName, industry: "retail" });
  assert.equal(res.status, 201, `signup ${email} failed: ${res.status} ${res.text}`);
  return res.body.token as string;
}

let tokenA = "";
let tokenB = "";
let datasetId = "";

before(async () => {
  tokenA = await signup(emailA, orgA);
  tokenB = await signup(emailB, orgB);
  const load = await request(app)
    .post("/api/uploads/sample")
    .set("Authorization", `Bearer ${tokenA}`)
    .send({});
  assert.equal(load.status, 201, `sample load failed: ${load.status} ${load.text}`);
  datasetId = load.body.dataset.id;
  assert.ok(datasetId, "sample load returned a dataset id");
});

test("the owning org can read its own dataset", async () => {
  const res = await request(app).get(`/api/datasets/${datasetId}`).set("Authorization", `Bearer ${tokenA}`);
  assert.equal(res.status, 200);
});

test("a different org cannot read the dataset (tenant isolation)", async () => {
  const res = await request(app).get(`/api/datasets/${datasetId}`).set("Authorization", `Bearer ${tokenB}`);
  assert.equal(res.status, 404, "cross-tenant read must 404, not leak data");
});

test("a different org cannot preview the dataset's rows either", async () => {
  const res = await request(app).get(`/api/datasets/${datasetId}/preview`).set("Authorization", `Bearer ${tokenB}`);
  assert.equal(res.status, 404);
});

test("an unauthenticated request is rejected", async () => {
  const res = await request(app).get(`/api/datasets/${datasetId}`);
  assert.equal(res.status, 401);
});

after(async () => {
  // Cascade deletes members, datasets, alerts, etc.
  await prisma.organization.deleteMany({ where: { name: { in: [orgA, orgB] } } });
  await prisma.user.deleteMany({ where: { email: { in: [emailA, emailB] } } });
  await prisma.$disconnect();
});
