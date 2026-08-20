import { test } from "node:test";
import assert from "node:assert/strict";
import { analyzeCorrelations } from "./correlate.js";
import type { Row } from "./parse.js";

test("detects a perfect positive correlation", () => {
  const rows: Row[] = [];
  for (let i = 1; i <= 8; i++) rows.push({ x: i, y: i * 3 });
  const r = analyzeCorrelations(rows, ["x", "y"]);
  const pair = r.pairs[0];
  assert.equal(pair.coefficient, 1);
  assert.equal(pair.direction, "positive");
  assert.equal(pair.strength, "very strong");
  assert.equal(pair.sampleSize, 8);
});

test("detects a negative correlation", () => {
  const rows: Row[] = [];
  for (let i = 1; i <= 8; i++) rows.push({ x: i, y: 100 - i * 5 });
  const pair = analyzeCorrelations(rows, ["x", "y"]).pairs[0];
  assert.equal(pair.coefficient, -1);
  assert.equal(pair.direction, "negative");
});

test("wording never implies causation", () => {
  const rows: Row[] = [];
  for (let i = 1; i <= 8; i++) rows.push({ spend: i, sales: i * 2 });
  const r = analyzeCorrelations(rows, ["spend", "sales"]);
  assert.match(r.caveat, /does not mean one causes the other/);
  for (const p of r.pairs) assert.doesNotMatch(p.interpretation, /caus|because|leads to|drives|results in/i);
});

test("ignores non-numeric columns and parses currency strings", () => {
  const rows: Row[] = [];
  for (let i = 1; i <= 6; i++) rows.push({ region: "West", revenue: `$${i * 100}`, cost: i * 40 });
  const r = analyzeCorrelations(rows);
  assert.ok(!r.columns.includes("region"), "text column excluded");
  assert.ok(r.columns.includes("revenue") && r.columns.includes("cost"), "currency strings counted as numeric");
});

test("parses accounting-style parenthesized negatives", () => {
  // y = -x written accounting-style; the sign must survive parsing, giving r = -1.
  const rows: Row[] = [];
  for (let i = 1; i <= 6; i++) rows.push({ x: i, y: `(${i})` });
  const pair = analyzeCorrelations(rows, ["x", "y"]).pairs[0];
  assert.equal(pair.coefficient, -1);
  assert.equal(pair.direction, "negative");
});

test("skips pairs with too few shared rows", () => {
  const rows: Row[] = [
    { x: 1, y: 2 }, { x: 2, y: null }, { x: 3, y: null }, { x: 4, y: null },
    { x: 5, y: null }, { x: 6, y: null }, { x: 7, y: 14 },
  ];
  const r = analyzeCorrelations(rows, ["x", "y"]);
  assert.equal(r.pairs.length, 0, "only 2 shared rows -> no pair reported");
});

test("a flat column yields no spurious correlation", () => {
  const rows: Row[] = [];
  for (let i = 1; i <= 8; i++) rows.push({ x: i, flat: 5 });
  assert.equal(analyzeCorrelations(rows, ["x", "flat"]).pairs.length, 0);
});

test("is deterministic", () => {
  const rows: Row[] = [];
  for (let i = 1; i <= 8; i++) rows.push({ a: i, b: i * 2, c: 100 - i });
  assert.equal(
    JSON.stringify(analyzeCorrelations(rows)),
    JSON.stringify(analyzeCorrelations(rows)),
  );
});
