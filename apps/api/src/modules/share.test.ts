import { test } from "node:test";
import assert from "node:assert/strict";
import { isShareLive } from "./share.js";

const now = new Date("2026-08-20T12:00:00.000Z");
const past = new Date("2026-08-19T12:00:00.000Z");
const future = new Date("2026-08-21T12:00:00.000Z");

test("isShareLive: never-expiring, unrevoked link is live", () => {
  assert.equal(isShareLive({ revokedAt: null, expiresAt: null }, now), true);
});

test("isShareLive: a future expiry is live, a past expiry is dead", () => {
  assert.equal(isShareLive({ revokedAt: null, expiresAt: future }, now), true);
  assert.equal(isShareLive({ revokedAt: null, expiresAt: past }, now), false);
});

test("isShareLive: expiry exactly at now is treated as expired", () => {
  assert.equal(isShareLive({ revokedAt: null, expiresAt: now }, now), false);
});

test("isShareLive: a revoked link is dead regardless of expiry", () => {
  assert.equal(isShareLive({ revokedAt: past, expiresAt: future }, now), false);
  assert.equal(isShareLive({ revokedAt: past, expiresAt: null }, now), false);
});
