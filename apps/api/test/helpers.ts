import request from "supertest";
import type { Role } from "@prisma/client";
import { prisma } from "../src/prisma.js";
import { createApp } from "../src/app.js";
import { signToken } from "../src/auth/middleware.js";

export const app = createApp();
export { prisma };

// Truncate every application table between tests. Discovered dynamically so new
// models are covered automatically; _prisma_migrations is preserved.
export async function resetDb() {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (!tables.length) return;
  const list = tables.map((t) => `"${t.tablename}"`).join(", ");
  await prisma.$executeRawUnsafe(`TRUNCATE ${list} RESTART IDENTITY CASCADE`);
}

let seq = 0;
// Sign up a fresh org+admin through the real endpoint. Returns the parsed body
// plus a convenience Authorization header value.
export async function signup(overrides: Partial<{ name: string; email: string; password: string; organizationName: string; industry: string }> = {}) {
  const email = overrides.email ?? `user${++seq}@example.com`;
  const body = {
    name: overrides.name ?? "Test User",
    email,
    password: overrides.password ?? "password123",
    organizationName: overrides.organizationName ?? `Org ${seq}`,
    ...(overrides.industry ? { industry: overrides.industry } : {}),
  };
  const res = await request(app).post("/api/auth/signup").send(body);
  return { res, ...res.body as { token: string; user: { id: string }; organization: { id: string }; role: Role } };
}

// Add an extra member (default VIEWER) to an org and mint a token for them, so
// role-gate tests don't depend on the signup path (which always creates ADMINs).
export async function addMember(organizationId: string, role: Role = "VIEWER") {
  const user = await prisma.user.create({
    data: { name: "Member", email: `member${++seq}@example.com`, passwordHash: "x" },
  });
  await prisma.organizationMember.create({ data: { userId: user.id, organizationId, role } });
  return { userId: user.id, token: signToken({ userId: user.id, organizationId, role }) };
}

// Insert a minimal valid dataset directly (bypasses the file-upload path).
export async function seedDataset(organizationId: string, name = "Seeded") {
  return prisma.dataset.create({
    data: {
      organizationId,
      name,
      fileName: `${name}.csv`,
      fileType: "csv",
      fileSize: 0,
      status: "PROFILED",
      rowCount: 0,
      columnCount: 0,
      qualityScore: 100,
      columns: [],
      schemaMap: {},
      profile: {},
      rows: [],
    },
  });
}

export const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
