import { test } from "node:test";
import assert from "node:assert/strict";
import type { Request, Response } from "express";
import { z, ZodError } from "zod";
import { MulterError } from "multer";
import { errorHandler, HttpError, wrap } from "./errors.js";

// Minimal res double that records status(code).json(body).
function fakeRes() {
  const rec = { code: 0, body: undefined as unknown };
  const res = {
    status(c: number) { rec.code = c; return res; },
    json(b: unknown) { rec.body = b; return res; },
  } as unknown as Response;
  return { res, rec };
}
const run = (err: unknown) => { const { res, rec } = fakeRes(); errorHandler(err, {} as Request, res, () => {}); return rec; };

test("ZodError → 400 with field details", () => {
  let zerr: ZodError;
  try { z.object({ email: z.string().email() }).parse({ email: "nope" }); throw new Error("unreachable"); }
  catch (e) { zerr = e as ZodError; }
  const rec = run(zerr!);
  assert.equal(rec.code, 400);
  assert.equal((rec.body as { error: string }).error, "Validation failed");
});

test("HttpError → its own status and message", () => {
  const rec = run(new HttpError(404, "No dataset found"));
  assert.equal(rec.code, 404);
  assert.deepEqual(rec.body, { error: "No dataset found" });
});

test("Multer LIMIT_FILE_SIZE → 413, other multer errors → 400", () => {
  assert.equal(run(new MulterError("LIMIT_FILE_SIZE")).code, 413);
  assert.equal(run(new MulterError("LIMIT_UNEXPECTED_FILE")).code, 400);
});

test("unknown errors → 500 without leaking the message", () => {
  const rec = run(new Error("stack trace with secrets"));
  assert.equal(rec.code, 500);
  assert.deepEqual(rec.body, { error: "Internal server error" });
});

test("wrap forwards a rejected handler to next()", async () => {
  let forwarded: unknown = "UNCALLED";
  const handler = wrap(async () => { throw new HttpError(418, "teapot"); });
  await handler({} as Request, {} as Response, (e?: unknown) => { forwarded = e; });
  assert.ok(forwarded instanceof HttpError);
  assert.equal((forwarded as HttpError).status, 418);
});
