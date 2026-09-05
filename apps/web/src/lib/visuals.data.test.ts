import { test } from "node:test";
import assert from "node:assert/strict";
import {
  toPercentRows, pivot, rankByPeriod, matchRegions, quantize, normalizeRegion, TOTAL_COLUMN,
} from "./visuals.data";

/* ───────── toPercentRows ───────── */

test("toPercentRows: each row sums to 100 and keeps its raw values", () => {
  const [row] = toPercentRows([{ label: "Q1", a: 30, b: 10 }], ["a", "b"]);
  assert.equal(row.a, 75);
  assert.equal(row.b, 25);
  assert.equal(row.__total, 40);
  assert.deepEqual(row.__raw, { a: 30, b: 10 });
});

test("toPercentRows: an all-zero row gives 0%, not NaN", () => {
  const [row] = toPercentRows([{ label: "Q1", a: 0, b: 0 }], ["a", "b"]);
  assert.equal(row.a, 0);
  assert.equal(row.b, 0);
  assert.equal(row.__total, 0);
});

test("toPercentRows: negatives take a share of the absolute total, raw keeps the sign", () => {
  const [row] = toPercentRows([{ label: "Q1", a: 30, b: -10 }], ["a", "b"]);
  assert.equal(row.a, 75);
  assert.equal(row.b, 25);
  assert.equal(row.__raw.b, -10);
});

test("toPercentRows: a missing or non-numeric series reads as 0, not NaN", () => {
  const [row] = toPercentRows([{ label: "Q1", a: 50, b: "n/a" }], ["a", "b", "c"]);
  assert.equal(row.b, 0);
  assert.equal(row.c, 0);
  assert.equal(row.a, 100);
});

/* ───────── pivot ───────── */

const SALES = [
  { region: "West", city: "LA", month: "Jan", amount: 100 },
  { region: "West", city: "LA", month: "Feb", amount: 50 },
  { region: "West", city: "SF", month: "Jan", amount: 30 },
  { region: "East", city: "NY", month: "Jan", amount: 200 },
];

test("pivot: subtotals equal the sum of their children", () => {
  const r = pivot(SALES, { rowFields: ["region", "city"], columnField: "month", valueField: "amount" });
  const west = r.rows.find((n) => n.label === "West")!;
  assert.equal(west.total, 180);
  assert.equal(west.children.reduce((a, c) => a + c.total, 0), 180);
});

test("pivot: grand total equals the flat sum", () => {
  const r = pivot(SALES, { rowFields: ["region"], columnField: "month", valueField: "amount" });
  assert.equal(r.grand.total, 380);
  assert.equal(r.rows.reduce((a, n) => a + n.total, 0), 380);
});

test("pivot: a combination with no data is absent, not zero", () => {
  const r = pivot(SALES, { rowFields: ["region"], columnField: "month", valueField: "amount" });
  const east = r.rows.find((n) => n.label === "East")!;
  // East sold nothing in Feb — the cell must not exist, so the matrix can render "—"
  // rather than a zero it was never told about.
  assert.equal("Feb" in east.cells, false);
  assert.equal(east.cells.Jan, 200);
});

test("pivot: a real zero is kept as a zero", () => {
  const r = pivot([{ region: "West", month: "Jan", amount: 0 }], {
    rowFields: ["region"], columnField: "month", valueField: "amount",
  });
  assert.equal(r.rows[0].cells.Jan, 0);
  assert.equal("Jan" in r.rows[0].cells, true);
});

test("pivot: rows sort by total descending", () => {
  const r = pivot(SALES, { rowFields: ["region"], columnField: "month", valueField: "amount" });
  assert.deepEqual(r.rows.map((n) => n.label), ["East", "West"]);
});

test("pivot: no column field puts everything in one Total column", () => {
  const r = pivot(SALES, { rowFields: ["region"], valueField: "amount" });
  assert.deepEqual(r.columns, [TOTAL_COLUMN]);
  assert.equal(r.grand.cells[TOTAL_COLUMN], 380);
});

test("pivot: sibling paths that share words do not collide", () => {
  const r = pivot(
    [{ a: "A B", b: "C", v: 1 }, { a: "A", b: "B C", v: 2 }],
    { rowFields: ["a", "b"], valueField: "v" },
  );
  assert.equal(r.rows.length, 2);
  assert.equal(r.grand.total, 3);
});

test("pivot: the row cap keeps whole groups and reports truncation", () => {
  const many = Array.from({ length: 40 }, (_, i) => ({ g: `g${i}`, c: "x", v: 1 }));
  const r = pivot(many, { rowFields: ["g", "c"], valueField: "v", maxRows: 10 });
  // Each group is a parent plus one child, so a cap of 10 fits exactly 5 whole groups.
  assert.equal(r.rows.length, 5);
  assert.ok(r.rows.every((n) => n.children.length === 1));
  assert.ok(r.truncated);
});

test("pivot: the source cap limits rows read and is reported", () => {
  const many = Array.from({ length: 100 }, () => ({ g: "g", v: 1 }));
  const r = pivot(many, { rowFields: ["g"], valueField: "v", maxSourceRows: 10 });
  assert.equal(r.grand.total, 10);
  assert.deepEqual(r.truncated, { source: 100, used: 10 });
});

test("pivot: within the caps nothing is reported as truncated", () => {
  assert.equal(pivot(SALES, { rowFields: ["region"], valueField: "amount" }).truncated, null);
});

/* ───────── rankByPeriod ───────── */

test("rankByPeriod: each period is ranked on its own values", () => {
  const bands = rankByPeriod(
    [{ label: "Jan", values: { a: 1, b: 9 } }, { label: "Feb", values: { a: 8, b: 2 } }],
    ["a", "b"],
  );
  assert.deepEqual(bands[0].map((x) => x.series), ["b", "a"]);
  assert.deepEqual(bands[1].map((x) => x.series), ["a", "b"]);
});

test("rankByPeriod: stacking offsets run without gaps", () => {
  const [jan] = rankByPeriod([{ label: "Jan", values: { a: 3, b: 7 } }], ["a", "b"]);
  assert.deepEqual(jan.map((x) => [x.y0, x.y1]), [[0, 7], [7, 10]]);
});

test("rankByPeriod: ties keep the declared series order", () => {
  const [p] = rankByPeriod([{ label: "Jan", values: { a: 5, b: 5, c: 5 } }], ["a", "b", "c"]);
  assert.deepEqual(p.map((x) => x.series), ["a", "b", "c"]);
});

/* ───────── matchRegions ───────── */

const MAP_NAMES = ["United States of America", "United Kingdom", "India", "Côte d'Ivoire", "Czechia"];

test("matchRegions: exact names match", () => {
  const { matched, unmatched } = matchRegions([{ label: "India", value: 5 }], MAP_NAMES);
  assert.equal(matched.get("India"), 5);
  assert.deepEqual(unmatched, []);
});

test("matchRegions: aliases and casing resolve to the map's name", () => {
  const { matched } = matchRegions(
    [{ label: "USA", value: 1 }, { label: "uk", value: 2 }, { label: "Czech Republic", value: 3 }],
    MAP_NAMES,
  );
  assert.equal(matched.get("United States of America"), 1);
  assert.equal(matched.get("United Kingdom"), 2);
  assert.equal(matched.get("Czechia"), 3);
});

test("matchRegions: accents fold, so a plain-ASCII spelling still lands", () => {
  const { matched } = matchRegions([{ label: "Cote d'Ivoire", value: 4 }], MAP_NAMES);
  assert.equal(matched.get("Côte d'Ivoire"), 4);
});

test("matchRegions: two rows resolving to one region are summed, not overwritten", () => {
  const { matched } = matchRegions(
    [{ label: "USA", value: 10 }, { label: "United States", value: 5 }],
    MAP_NAMES,
  );
  assert.equal(matched.get("United States of America"), 15);
});

test("matchRegions: unknown regions are reported, never silently dropped", () => {
  const { matched, unmatched } = matchRegions(
    [{ label: "Atlantis", value: 99 }, { label: "India", value: 1 }],
    MAP_NAMES,
  );
  assert.deepEqual(unmatched, ["Atlantis"]);
  assert.equal(matched.size, 1);
});

test("normalizeRegion: strips case, accents and punctuation", () => {
  assert.equal(normalizeRegion("Côte d'Ivoire"), "cotedivoire");
  assert.equal(normalizeRegion("  United-States  "), "unitedstates");
});

/* ───────── quantize ───────── */

test("quantize: buckets rise with value and cover the range", () => {
  const s = quantize([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 5);
  assert.equal(s.bucketOf(1), 0);
  assert.equal(s.bucketOf(10), s.breaks.length);
  assert.ok(s.bucketOf(1) < s.bucketOf(10));
});

test("quantize: all-equal input collapses to one bucket with no breaks", () => {
  const s = quantize([7, 7, 7], 5);
  assert.deepEqual(s.breaks, []);
  assert.equal(s.bucketOf(7), 0);
});

test("quantize: empty input is safe", () => {
  const s = quantize([], 5);
  assert.deepEqual(s.breaks, []);
  assert.equal(s.bucketOf(1), 0);
});

test("quantize: repeated values do not create buckets nothing can land in", () => {
  const s = quantize([1, 1, 1, 1, 9], 5);
  assert.equal(new Set(s.breaks).size, s.breaks.length);
});

test("quantize: a non-finite value falls into the first bucket rather than NaN", () => {
  const s = quantize([1, 2, 3, 4, 5], 5);
  assert.equal(s.bucketOf(NaN), 0);
});
