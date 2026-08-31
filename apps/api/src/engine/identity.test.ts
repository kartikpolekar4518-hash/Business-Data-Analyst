import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { rawFileHash, canonicalDatasetHash, canonicalJson } from "./identity.js";
import { ENGINE_VERSION } from "./version.js";
import type { Row } from "./parse.js";

test("engine version stays in sync with package.json", () => {
  const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
  assert.equal(ENGINE_VERSION, pkg.version, "bump ENGINE_VERSION and package.json together");
});

test("same file bytes produce the same raw hash; one changed byte does not", () => {
  assert.equal(rawFileHash(Buffer.from("a,b\n1,2")), rawFileHash(Buffer.from("a,b\n1,2")));
  assert.notEqual(rawFileHash(Buffer.from("a,b\n1,2")), rawFileHash(Buffer.from("a,b\n1,3")));
});

test("column order does not change the analytical hash", () => {
  const a: Row[] = [{ Revenue: "100", Customer: "A" }, { Revenue: "200", Customer: "B" }];
  const b: Row[] = [{ Customer: "A", Revenue: "100" }, { Customer: "B", Revenue: "200" }];
  assert.equal(canonicalDatasetHash(a), canonicalDatasetHash(b), "keys are sorted before hashing");
});

test("a changed value changes the analytical hash", () => {
  const a: Row[] = [{ revenue: "100" }];
  const b: Row[] = [{ revenue: "101" }];
  assert.notEqual(canonicalDatasetHash(a), canonicalDatasetHash(b));
});

test("row order IS significant — the hash does not claim order-independence", () => {
  const a: Row[] = [{ revenue: "100" }, { revenue: "200" }];
  const b: Row[] = [{ revenue: "200" }, { revenue: "100" }];
  assert.notEqual(canonicalDatasetHash(a), canonicalDatasetHash(b));
});

// Documented V1 limitation, asserted so it can never silently look "fixed": the CSV
// reader yields strings while the XLSX reader yields native numbers, so the same
// business data in two formats is NOT guaranteed to share an analytical hash. The
// hash means "the same analytical rows", not "the same business data".
test("known limitation: differing value types hash differently", () => {
  const asCsv: Row[] = [{ revenue: "100" }];
  const asXlsx: Row[] = [{ revenue: 100 }];
  assert.notEqual(canonicalDatasetHash(asCsv), canonicalDatasetHash(asXlsx));
});

test("canonical JSON sorts keys recursively and drops undefined", () => {
  assert.equal(canonicalJson({ b: 1, a: { d: 2, c: 3 } }), canonicalJson({ a: { c: 3, d: 2 }, b: 1 }));
  assert.equal(canonicalJson({ a: 1, b: undefined }), '{"a":1}');
});
