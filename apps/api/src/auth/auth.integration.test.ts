import { describe, it, expect, beforeEach, afterAll } from "vitest";
import request from "supertest";
import { app, prisma, resetDb, signup, addMember, seedDataset, bearer } from "../../test/helpers.js";

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

describe("POST /api/auth/signup", () => {
  it("creates an org + admin and returns a token", async () => {
    const { res, token, role } = await signup();
    expect(res.status).toBe(201);
    expect(token).toBeTruthy();
    expect(role).toBe("ADMIN");
  });

  it("rejects a duplicate email with 409", async () => {
    await signup({ email: "dup@example.com" });
    const { res } = await signup({ email: "dup@example.com" });
    expect(res.status).toBe(409);
  });

  it("rejects an invalid body with 400 (Zod)", async () => {
    const res = await request(app).post("/api/auth/signup").send({ email: "bad", password: "short" });
    expect(res.status).toBe(400);
  });
});

describe("POST /api/auth/login", () => {
  it("logs in with correct credentials", async () => {
    await signup({ email: "a@example.com", password: "password123" });
    const res = await request(app).post("/api/auth/login").send({ email: "a@example.com", password: "password123" });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeTruthy();
  });

  it("rejects a wrong password with 401 (not 404 — no user enumeration)", async () => {
    await signup({ email: "a@example.com", password: "password123" });
    const res = await request(app).post("/api/auth/login").send({ email: "a@example.com", password: "wrong" });
    expect(res.status).toBe(401);
  });

  it("returns 401 for an unknown email (same as wrong password)", async () => {
    const res = await request(app).post("/api/auth/login").send({ email: "nobody@example.com", password: "password123" });
    expect(res.status).toBe(401);
  });
});

describe("password reset flow", () => {
  it("always 200s and does not leak whether the email exists", async () => {
    await signup({ email: "known@example.com" });
    const known = await request(app).post("/api/auth/forgot-password").send({ email: "known@example.com" });
    const unknown = await request(app).post("/api/auth/forgot-password").send({ email: "ghost@example.com" });
    expect(known.status).toBe(200);
    expect(unknown.status).toBe(200);
    expect(known.body.devToken).toBeTruthy(); // NODE_ENV=test is not prod
    expect(unknown.body.devToken).toBeUndefined(); // no token generated for a non-user
  });

  it("resets the password with a valid token, then rejects reuse", async () => {
    await signup({ email: "reset@example.com", password: "password123" });
    const { body } = await request(app).post("/api/auth/forgot-password").send({ email: "reset@example.com" });
    const token = body.devToken as string;

    const first = await request(app).post("/api/auth/reset-password").send({ token, password: "newpassword1" });
    expect(first.status).toBe(200);

    // Single-use: the same token can't reset again.
    const reuse = await request(app).post("/api/auth/reset-password").send({ token, password: "another12345" });
    expect(reuse.status).toBe(400);

    // The new password now works; the old one does not.
    const good = await request(app).post("/api/auth/login").send({ email: "reset@example.com", password: "newpassword1" });
    const old = await request(app).post("/api/auth/login").send({ email: "reset@example.com", password: "password123" });
    expect(good.status).toBe(200);
    expect(old.status).toBe(401);
  });

  it("rejects an expired reset token", async () => {
    const { user } = await signup({ email: "exp@example.com" });
    await prisma.passwordResetToken.create({
      data: { token: "expired-token", userId: user.id, expiresAt: new Date(Date.now() - 1000) },
    });
    const res = await request(app).post("/api/auth/reset-password").send({ token: "expired-token", password: "newpassword1" });
    expect(res.status).toBe(400);
  });
});

describe("requireAuth (GET /api/auth/me)", () => {
  it("401s without a token", async () => {
    expect((await request(app).get("/api/auth/me")).status).toBe(401);
  });

  it("401s on a garbage token", async () => {
    const res = await request(app).get("/api/auth/me").set(bearer("not-a-jwt"));
    expect(res.status).toBe(401);
  });

  it("401s once the membership is revoked, even with a still-valid JWT", async () => {
    const { token, user, organization } = await signup();
    expect((await request(app).get("/api/auth/me").set(bearer(token))).status).toBe(200);

    // Membership is the org-isolation source of truth: revoke it and the token dies.
    await prisma.organizationMember.deleteMany({ where: { userId: user.id, organizationId: organization.id } });
    const res = await request(app).get("/api/auth/me").set(bearer(token));
    expect(res.status).toBe(401);
  });
});

describe("multi-tenant isolation", () => {
  it("does not let org A read org B's dataset (404, not the data)", async () => {
    const orgA = await signup();
    const orgB = await signup();
    const datasetB = await seedDataset(orgB.organization.id, "OrgB Secret");

    const res = await request(app).get(`/api/datasets/${datasetB.id}`).set(bearer(orgA.token));
    expect(res.status).toBe(404);
    expect(JSON.stringify(res.body)).not.toContain("OrgB Secret");
  });

  it("does not let org A delete org B's dataset", async () => {
    const orgA = await signup();
    const orgB = await signup();
    const datasetB = await seedDataset(orgB.organization.id);

    const res = await request(app).delete(`/api/uploads/${datasetB.id}`).set(bearer(orgA.token));
    expect(res.status).toBe(404);
    // Still present for its real owner.
    expect(await prisma.dataset.findUnique({ where: { id: datasetB.id } })).not.toBeNull();
  });
});

describe("requireRole", () => {
  it("forbids a VIEWER from deleting a dataset (403)", async () => {
    const org = await signup();
    const dataset = await seedDataset(org.organization.id);
    const viewer = await addMember(org.organization.id, "VIEWER");

    const res = await request(app).delete(`/api/uploads/${dataset.id}`).set(bearer(viewer.token));
    expect(res.status).toBe(403);
  });
});
