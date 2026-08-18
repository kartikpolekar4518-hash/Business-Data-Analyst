// Integration tests: real Express app + real Prisma against a live Postgres.
// Run via `npm run test:integration` (CI provides the DB). Kept out of the
// default unit glob (*.itest.ts, not *.test.ts) so `npm test` stays DB-free.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { app } from "./app.js";
import { prisma } from "./prisma.js";
import { signToken } from "./auth/middleware.js";

// Every org/user created here is tagged with this run id so cleanup is exact
// and parallel runs never collide.
const RUN = randomUUID().slice(0, 8);
const email = (tag: string) => `it-${RUN}-${tag}@example.test`;
const orgIds = new Set<string>();

async function signup(tag: string, industry?: string) {
  const res = await request(app).post("/api/auth/signup").send({
    name: `User ${tag}`, email: email(tag), password: "password123",
    organizationName: `Org ${tag}`, ...(industry ? { industry } : {}),
  });
  if (res.body?.organization?.id) orgIds.add(res.body.organization.id);
  return res;
}

before(async () => { await prisma.$connect(); });

after(async () => {
  // Cascades from Organization clean up members/datasets; users are deleted by email tag.
  for (const id of orgIds) await prisma.organization.delete({ where: { id } }).catch(() => {});
  await prisma.user.deleteMany({ where: { email: { startsWith: `it-${RUN}-` } } });
  await prisma.$disconnect();
});

test("health check responds without auth", async () => {
  const res = await request(app).get("/api/health");
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { ok: true });
});

test("signup creates an org + ADMIN membership and returns a token", async () => {
  const res = await signup("admin");
  assert.equal(res.status, 201);
  assert.equal(res.body.role, "ADMIN");
  assert.ok(res.body.token, "a JWT is issued");
  assert.equal(res.body.organization.plan, "free", "new orgs start on the Free plan");
});

test("signup with a duplicate email is rejected with 409", async () => {
  await signup("dupe");
  const again = await signup("dupe");
  assert.equal(again.status, 409);
});

test("login succeeds with the right password and fails with the wrong one", async () => {
  await signup("login");
  const ok = await request(app).post("/api/auth/login").send({ email: email("login"), password: "password123" });
  assert.equal(ok.status, 200);
  assert.ok(ok.body.token);
  const bad = await request(app).post("/api/auth/login").send({ email: email("login"), password: "wrong" });
  assert.equal(bad.status, 401);
});

test("a protected route rejects a request with no token as 401", async () => {
  const res = await request(app).get("/api/uploads");
  assert.equal(res.status, 401);
});

test("RBAC: a VIEWER is forbidden from an ADMIN/MANAGER-only route (403)", async () => {
  const admin = await signup("rbac");
  const orgId = admin.body.organization.id;
  // Add a second member with the lowest role to the same org, then act as them.
  const viewer = await prisma.user.create({ data: { email: email("viewer"), name: "Viewer", passwordHash: "x" } });
  await prisma.organizationMember.create({ data: { userId: viewer.id, organizationId: orgId, role: "VIEWER" } });
  const viewerToken = signToken({ userId: viewer.id, organizationId: orgId, role: "VIEWER" });

  const res = await request(app).post("/api/uploads/sample").set("Authorization", `Bearer ${viewerToken}`);
  assert.equal(res.status, 403, "VIEWER cannot load datasets");

  // Same route as the ADMIN succeeds — proves it's the role gate, not the route.
  const okAsAdmin = await request(app).post("/api/uploads/sample").set("Authorization", `Bearer ${admin.body.token}`);
  assert.equal(okAsAdmin.status, 201, "ADMIN can load the sample dataset");
});

test("plan limits: the Free plan blocks the 3rd dataset with 402", async () => {
  const admin = await signup("limit");
  const token = `Bearer ${admin.body.token}`;
  const load = () => request(app).post("/api/uploads/sample").set("Authorization", token);

  assert.equal((await load()).status, 201, "1st dataset allowed");
  assert.equal((await load()).status, 201, "2nd dataset allowed (Free limit is 2)");
  const third = await load();
  assert.equal(third.status, 402, "3rd dataset exceeds the Free plan limit");
  assert.match(third.body.error, /plan limit/i);
});
