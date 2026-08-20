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

test("auth: a valid token whose membership was removed is rejected 401", async () => {
  const admin = await signup("revoke");
  const orgId = admin.body.organization.id;
  const token = `Bearer ${admin.body.token}`;

  // Token still verifies, but the membership row is the source of truth.
  assert.equal((await request(app).get("/api/uploads").set("Authorization", token)).status, 200);
  await prisma.organizationMember.deleteMany({ where: { organizationId: orgId } });
  const after = await request(app).get("/api/uploads").set("Authorization", token);
  assert.equal(after.status, 401, "removed membership takes effect on an unexpired token");
});

test("auth: role comes from the DB membership, not the JWT claim", async () => {
  const admin = await signup("dbrole");
  const orgId = admin.body.organization.id;
  const viewer = await prisma.user.create({ data: { email: email("dbrole-v"), name: "Viewer", passwordHash: "x" } });
  await prisma.organizationMember.create({ data: { userId: viewer.id, organizationId: orgId, role: "VIEWER" } });

  // Forge a token claiming ADMIN for a member the DB says is only a VIEWER.
  const forged = signToken({ userId: viewer.id, organizationId: orgId, role: "ADMIN" });
  const res = await request(app).post("/api/uploads/sample").set("Authorization", `Bearer ${forged}`);
  assert.equal(res.status, 403, "the DB role (VIEWER) governs, so the ADMIN-only route is forbidden");
});

test("tenant isolation: org B cannot read or delete org A's dataset", async () => {
  const orgA = await signup("iso-a");
  const orgB = await signup("iso-b");
  const authA = `Bearer ${orgA.body.token}`;
  const authB = `Bearer ${orgB.body.token}`;

  const created = await request(app).post("/api/uploads/sample").set("Authorization", authA);
  assert.equal(created.status, 201);
  const id = created.body.dataset.id;

  // Org A owns it — the positive control that the route works at all.
  assert.equal((await request(app).get(`/api/datasets/${id}`).set("Authorization", authA)).status, 200);

  // Org B holds a valid token but a different org: every path must 404 on the foreign id.
  assert.equal((await request(app).get(`/api/datasets/${id}`).set("Authorization", authB)).status, 404, "read is org-scoped");
  assert.equal((await request(app).get(`/api/datasets/${id}/preview`).set("Authorization", authB)).status, 404, "preview is org-scoped");
  assert.equal((await request(app).delete(`/api/uploads/${id}`).set("Authorization", authB)).status, 404, "delete is org-scoped");

  // The failed cross-tenant delete must not have touched org A's dataset.
  assert.equal((await request(app).get(`/api/datasets/${id}`).set("Authorization", authA)).status, 200, "org A's dataset survives org B's delete attempt");
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

test("activity feed: returns org actions newest-first with actor resolved, and paginates", async () => {
  const admin = await signup("activity");
  const token = `Bearer ${admin.body.token}`;
  // Generate a few log entries on top of the org.created one from signup.
  await request(app).post("/api/uploads/sample").set("Authorization", token);
  await request(app).post("/api/uploads/sample").set("Authorization", token);

  const first = await request(app).get("/api/organizations/activity?limit=2").set("Authorization", token);
  assert.equal(first.status, 200);
  assert.equal(first.body.activity.length, 2, "respects the limit");
  assert.ok(first.body.nextCursor, "more pages available -> a cursor is returned");
  // Newest first: the two sample loads precede org.created.
  assert.equal(first.body.activity[0].action, "dataset.sampleLoaded");
  assert.ok(first.body.activity[0].actor?.name && first.body.activity[0].actor?.email, "actor name/email resolved from actorId");

  const second = await request(app).get(`/api/organizations/activity?limit=2&cursor=${first.body.nextCursor}`).set("Authorization", token);
  assert.equal(second.status, 200);
  assert.ok(second.body.activity.some((a: any) => a.action === "org.created"), "the org.created entry appears on the next page");
  // No overlap between pages.
  const ids1 = new Set(first.body.activity.map((a: any) => a.id));
  assert.ok(second.body.activity.every((a: any) => !ids1.has(a.id)), "cursor paging does not repeat rows");
});

test("activity feed: is tenant-scoped — org B never sees org A's actions", async () => {
  const a = await signup("act-a");
  const b = await signup("act-b");
  await request(app).post("/api/uploads/sample").set("Authorization", `Bearer ${a.body.token}`);
  const bView = await request(app).get("/api/organizations/activity").set("Authorization", `Bearer ${b.body.token}`);
  assert.equal(bView.status, 200);
  // Org B loaded no data, so it must see only its own org.created entry — never org A's sample-load.
  assert.ok(bView.body.activity.every((x: any) => x.action !== "dataset.sampleLoaded"), "org B does not see org A's dataset activity");
});
