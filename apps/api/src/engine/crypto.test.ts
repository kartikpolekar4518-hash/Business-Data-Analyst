import { test } from "node:test";
import assert from "node:assert/strict";
import { encrypt, decrypt } from "./crypto.js";

test("encrypt → decrypt round-trips arbitrary strings", () => {
  for (const s of ["", "hello", "p@ssw0rd!", "unicode: café ☕ 🔐", "a".repeat(5000)]) {
    assert.equal(decrypt(encrypt(s)), s);
  }
});

test("ciphertext is randomized (fresh IV per call)", () => {
  assert.notEqual(encrypt("same"), encrypt("same"));
});

test("output is versioned and base64 after the v1 prefix", () => {
  const blob = encrypt("secret");
  assert.match(blob, /^v1:[A-Za-z0-9+/=]+$/);
});

test("tampered ciphertext fails the GCM auth tag instead of returning garbage", () => {
  const blob = encrypt("connector-password");
  const [, payload] = blob.split(":");
  const buf = Buffer.from(payload, "base64");
  buf[buf.length - 1] ^= 0xff; // flip a ciphertext bit
  const tampered = `v1:${buf.toString("base64")}`;
  assert.throws(() => decrypt(tampered));
});

test("unrecognized formats are rejected, not silently parsed", () => {
  assert.throws(() => decrypt("v2:whatever"), /Unrecognized secret format/);
  assert.throws(() => decrypt("no-version"), /Unrecognized secret format/);
});
