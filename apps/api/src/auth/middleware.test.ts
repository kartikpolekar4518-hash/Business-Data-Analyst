import { test } from "node:test";
import assert from "node:assert/strict";
import type { Request, Response } from "express";
import type { Role } from "@prisma/client";
import { requireAuth, requireRole, signToken } from "./middleware.js";
import { HttpError } from "../errors.js";

function fakeReq(over: Partial<Request> = {}): Request {
  return { headers: {}, ...over } as Request;
}
// Captures whatever requireRole/requireAuth passes to next().
function capture() {
  let arg: unknown = "UNCALLED";
  const next = (e?: unknown) => { arg = e; };
  return { next, get: () => arg };
}

test("requireRole calls next() with no error when the role is allowed", () => {
  const req = fakeReq({ auth: { userId: "u", organizationId: "o", role: "ADMIN" as Role } });
  const c = capture();
  requireRole("ADMIN", "MANAGER")(req, {} as Response, c.next);
  assert.equal(c.get(), undefined);
});

test("requireRole rejects a disallowed role with 403", () => {
  const req = fakeReq({ auth: { userId: "u", organizationId: "o", role: "VIEWER" as Role } });
  const c = capture();
  requireRole("ADMIN")(req, {} as Response, c.next);
  const err = c.get();
  assert.ok(err instanceof HttpError);
  assert.equal((err as HttpError).status, 403);
});

test("requireRole rejects an unauthenticated request with 401", () => {
  const c = capture();
  requireRole("ADMIN")(fakeReq(), {} as Response, c.next);
  assert.equal((c.get() as HttpError).status, 401);
});

test("requireAuth rejects a request with no Bearer token as 401", async () => {
  const c = capture();
  await requireAuth(fakeReq(), {} as Response, c.next);
  const err = c.get();
  assert.ok(err instanceof HttpError);
  assert.equal((err as HttpError).status, 401);
});

test("signToken produces a verifiable token round-trip", async () => {
  const jwt = (await import("jsonwebtoken")).default;
  const { env } = await import("../env.js");
  const token = signToken({ userId: "u1", organizationId: "o1", role: "MANAGER" as Role });
  const decoded = jwt.verify(token, env.jwtSecret) as { userId: string; role: string };
  assert.equal(decoded.userId, "u1");
  assert.equal(decoded.role, "MANAGER");
});
