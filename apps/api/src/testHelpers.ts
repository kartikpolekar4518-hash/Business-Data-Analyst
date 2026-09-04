// Shared integration-test helpers: signup, create org, track for cleanup.
// Each test file has its own email prefix and run-id for parallel isolation,
// but the signup + cleanup pattern is identical everywhere.
import request from "supertest";
import { app } from "./app.js";
import { prisma } from "./prisma.js";

export const orgIds = new Set<string>();

export function makeEmail(prefix: string, runId: string) {
  return (tag: string) => `${prefix}-${runId}-${tag}@example.test`;
}

export interface SetupOrgOptions {
  email: (tag: string) => string;
  withSampleData?: boolean;
}

// Signup, create org, track orgId for cleanup. Returns orgId + token + userId.
export async function setupOrg(
  tag: string,
  opts: SetupOrgOptions,
) {
  const res = await request(app).post("/api/auth/signup").send({
    name: `User ${tag}`, email: opts.email(tag), password: "password123", organizationName: `Org ${tag}`,
  });
  const orgId = res.body.organization.id as string;
  const userId = res.body.user.id as string;
  orgIds.add(orgId);
  const token = `Bearer ${res.body.token}`;
  if (opts.withSampleData) {
    await request(app).post("/api/uploads/sample").set("Authorization", token);
  }
  return { orgId, token, userId };
}

// Cleanup: delete orgs (cascades members/datasets) + users by email prefix.
export async function cleanupOrgs(prefix: string, runId: string) {
  for (const id of orgIds) await prisma.organization.delete({ where: { id } }).catch(() => {});
  await prisma.user.deleteMany({ where: { email: { startsWith: `${prefix}-${runId}-` } } });
  await prisma.$disconnect();
}
