import { test } from "node:test";
import assert from "node:assert/strict";

// APP_URL is a comma-separated allow-list, and it is read exactly once in env.ts. These
// pin the parsing rather than the module, which reads process.env at import time.
function urlListEnv(raw: string | undefined, fallback: string): string[] {
  const list = (raw ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return list.length ? list : [fallback];
}

const FALLBACK = "http://localhost:5173";

test("APP_URL: a space after the comma does not become part of the origin", () => {
  // A bare .split(",") yielded " https://b.example", which no browser Origin header
  // matches — that origin silently failed CORS while looking configured.
  assert.deepEqual(
    urlListEnv("https://a.example, https://b.example", FALLBACK),
    ["https://a.example", "https://b.example"],
  );
});

test("APP_URL: a single origin is unchanged", () => {
  assert.deepEqual(urlListEnv("https://a.example", FALLBACK), ["https://a.example"]);
});

test("APP_URL: unset, blank or comma-only falls back rather than allowing nothing", () => {
  // An empty allow-list would block every origin and put `undefined` in share links.
  for (const raw of [undefined, "", "   ", ",", " , "]) {
    assert.deepEqual(urlListEnv(raw, FALLBACK), [FALLBACK], `input ${JSON.stringify(raw)}`);
  }
});
