// Integration tests for report share links: real Express + Prisma + Postgres.
// Run via `npm run test:integration` (CI provides the DB). Covers RBAC, tenant
// isolation, the public read/PDF surface, expiry/revocation, and the audit trail.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { app } from "./app.js";
import { prisma } from "./prisma.js";
import { signToken } from "./auth/middleware.js";

const RUN = randomUUID().slice(0, 8);
const email = (tag: string) => `share-${RUN}-${tag}@example.test`;
const orgIds = new Set<string>();

async function setupOrg(tag: string, withReport = true) {
  const res = await request(app).post("/api/auth/signup").send({
    name: `User ${tag}`, email: email(tag), password: "password123", organizationName: `Org ${tag}`,
  });
  const orgId = res.body.organization.id as string;
  orgIds.add(orgId);
  const token = `Bearer ${res.body.token}`;
  let reportId: string | undefined;
  if (withReport) {
    await request(app).post("/api/uploads/sample").set("Authorization", token);
    const gen = await request(app).post("/api/reports/generate").set("Authorization", token).send({});
    reportId = gen.body.report.id;
  }
  return { orgId, token, reportId };
}

before(async () => { await prisma.$connect(); });
after(async () => {
  for (const id of orgIds) await prisma.organization.delete({ where: { id } }).catch(() => {});
  await prisma.user.deleteMany({ where: { email: { startsWith: `share-${RUN}-` } } });
  await prisma.$disconnect();
});

test("create → public view returns only the report + org name, and a PDF", async () => {
  const { token, reportId } = await setupOrg("view");
  const created = await request(app).post(`/api/reports/${reportId}/shares`).set("Authorization", token).send({ expiresInDays: 30 });
  assert.equal(created.status, 201);
  const { token: shareToken, url, expiresAt } = created.body.share;
  assert.ok(shareToken && url.endsWith(`/share/${shareToken}`));
  assert.ok(expiresAt, "a 30-day link has an expiry");

  // Public read — no auth header.
  const pub = await request(app).get(`/api/share/${shareToken}`);
  assert.equal(pub.status, 200);
  assert.ok(pub.body.report.title && pub.body.report.content, "report content present");
  assert.ok(pub.body.org.name, "org name present");
  assert.equal(pub.body.report.organizationId, undefined, "no org id leaked");
  assert.equal(pub.body.org.id, undefined, "no org id leaked");

  const pdf = await request(app).get(`/api/share/${shareToken}/pdf`);
  assert.equal(pdf.status, 200);
  assert.match(pdf.headers["content-type"], /application\/pdf/);
});

test("never-expiring link: null expiresInDays yields a link with no expiry", async () => {
  const { token, reportId } = await setupOrg("never");
  const created = await request(app).post(`/api/reports/${reportId}/shares`).set("Authorization", token).send({ expiresInDays: null });
  assert.equal(created.status, 201);
  assert.equal(created.body.share.expiresAt, null);
  assert.equal((await request(app).get(`/api/share/${created.body.share.token}`)).status, 200);
});

test("expired and revoked links both 404 on the public read", async () => {
  const { token, reportId } = await setupOrg("dead");
  // Expired: create then back-date its expiry.
  const exp = await request(app).post(`/api/reports/${reportId}/shares`).set("Authorization", token).send({ expiresInDays: 7 });
  await prisma.reportShare.update({ where: { id: exp.body.share.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
  assert.equal((await request(app).get(`/api/share/${exp.body.share.token}`)).status, 404, "expired link 404s");

  // Revoked: create then DELETE.
  const rev = await request(app).post(`/api/reports/${reportId}/shares`).set("Authorization", token).send({ expiresInDays: 30 });
  assert.equal((await request(app).delete(`/api/reports/${reportId}/shares/${rev.body.share.id}`).set("Authorization", token)).status, 204);
  assert.equal((await request(app).get(`/api/share/${rev.body.share.token}`)).status, 404, "revoked link 404s");
  assert.equal((await request(app).get(`/api/share/${rev.body.share.token}/pdf`)).status, 404, "revoked link PDF 404s");
});

test("unknown token 404s", async () => {
  assert.equal((await request(app).get(`/api/share/does-not-exist`)).status, 404);
});

test("RBAC: a VIEWER cannot create a share (403)", async () => {
  const { orgId, reportId } = await setupOrg("rbac");
  const viewer = await prisma.user.create({ data: { email: email("rbac-v"), name: "V", passwordHash: "x" } });
  await prisma.organizationMember.create({ data: { userId: viewer.id, organizationId: orgId, role: "VIEWER" } });
  const vtoken = `Bearer ${signToken({ userId: viewer.id, organizationId: orgId, role: "VIEWER" })}`;
  assert.equal((await request(app).post(`/api/reports/${reportId}/shares`).set("Authorization", vtoken).send({})).status, 403);
  // Listing exposes live bearer tokens — a VIEWER must not be able to enumerate them.
  assert.equal((await request(app).get(`/api/reports/${reportId}/shares`).set("Authorization", vtoken)).status, 403);
});

test("tenant isolation: org B cannot create, list, or revoke shares on org A's report", async () => {
  const a = await setupOrg("iso-a");
  const b = await setupOrg("iso-b", false);
  assert.equal((await request(app).post(`/api/reports/${a.reportId}/shares`).set("Authorization", b.token).send({})).status, 404);
  assert.equal((await request(app).get(`/api/reports/${a.reportId}/shares`).set("Authorization", b.token)).status, 404);
  // A real share owned by A must not be revocable by B.
  const created = await request(app).post(`/api/reports/${a.reportId}/shares`).set("Authorization", a.token).send({});
  assert.equal((await request(app).delete(`/api/reports/${a.reportId}/shares/${created.body.share.id}`).set("Authorization", b.token)).status, 404);
  assert.equal((await request(app).get(`/api/share/${created.body.share.token}`)).status, 200, "A's link still works after B's failed revoke");
});

test("audit trail: sharing writes a report.shared activity entry", async () => {
  const { orgId, token, reportId } = await setupOrg("audit");
  await request(app).post(`/api/reports/${reportId}/shares`).set("Authorization", token).send({});
  const logged = await prisma.activityLog.findFirst({ where: { organizationId: orgId, action: "report.shared" } });
  assert.ok(logged, "a report.shared entry was recorded");
});
