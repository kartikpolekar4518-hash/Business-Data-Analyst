import { test } from "node:test";
import assert from "node:assert/strict";
import { analyzeDrivers } from "./drivers.js";
import type { Row } from "./parse.js";
import type { SchemaMap } from "./schema.js";

const schema: SchemaMap = { date: "date", product_name: "product", region: "region", revenue: "revenue" };

// Two periods, an even span so both equal-duration windows are fully populated:
// Widget grows, Gadget falls.
const rows: Row[] = [
  { date: "2024-01-01", product: "Widget", region: "West", revenue: 100 },
  { date: "2024-01-01", product: "Gadget", region: "East", revenue: 200 },
  { date: "2024-02-01", product: "Widget", region: "West", revenue: 100 },
  { date: "2024-02-01", product: "Gadget", region: "East", revenue: 200 },
  { date: "2024-07-01", product: "Widget", region: "West", revenue: 300 },
  { date: "2024-07-01", product: "Gadget", region: "East", revenue: 50 },
  { date: "2024-08-01", product: "Widget", region: "West", revenue: 300 },
  { date: "2024-08-01", product: "Gadget", region: "East", revenue: 50 },
];

test("contributions reconcile exactly with the overall change", () => {
  const r = analyzeDrivers(rows, schema, "revenue");
  const sum = r.drivers.reduce((a, d) => a + d.contribution, 0);
  assert.ok(r.reconciled, "reconciled flag is set");
  assert.ok(Math.abs(sum - r.totalChange) < 0.01, `Σ contributions (${sum}) == totalChange (${r.totalChange})`);
  // prev = 100+100+200+200=600, cur = 300+300+50+50=700, change = +100
  assert.equal(r.totalPrevious, 600);
  assert.equal(r.totalCurrent, 700);
  assert.equal(r.totalChange, 100);
});

test("identifies both the biggest riser and the biggest faller with correct direction", () => {
  const r = analyzeDrivers(rows, schema, "revenue", "product_name");
  const widget = r.drivers.find((d) => d.label === "Widget")!;
  const gadget = r.drivers.find((d) => d.label === "Gadget")!;
  assert.equal(widget.direction, "up");
  assert.equal(widget.contribution, 400);   // 200 -> 600
  assert.equal(gadget.direction, "down");
  assert.equal(gadget.contribution, -300);  // 400 -> 100
});

test("shareOfChange can exceed 100% when movers offset each other", () => {
  const r = analyzeDrivers(rows, schema, "revenue", "product_name");
  const widget = r.drivers.find((d) => d.label === "Widget")!;
  // Widget added 400 against a net change of only 100 -> 400% of the net change.
  assert.equal(widget.shareOfChange, 400);
});

test("still reconciles when attributed by a different dimension", () => {
  const r = analyzeDrivers(rows, schema, "revenue", "region");
  const sum = r.drivers.reduce((a, d) => a + d.contribution, 0);
  assert.ok(Math.abs(sum - r.totalChange) < 0.01);
});

test("truncated drivers plus the 'other' remainder still sum to the total change", () => {
  const r = analyzeDrivers(rows, schema, "revenue", "product_name", {}, 1);
  assert.equal(r.drivers.length, 1);
  assert.ok(r.otherCount >= 1, "the second product falls into other");
  const shown = r.drivers.reduce((a, d) => a + d.contribution, 0);
  assert.ok(Math.abs(shown + r.otherContribution - r.totalChange) < 0.01, "shown + other == totalChange");
});

test("no dimension -> empty but reconciled result, never throws", () => {
  const r = analyzeDrivers(rows, { date: "date", revenue: "revenue" }, "revenue");
  assert.equal(r.dimension, null);
  assert.equal(r.drivers.length, 0);
  assert.ok(r.reconciled);
});

test("is deterministic", () => {
  const a = JSON.stringify(analyzeDrivers(rows, schema, "revenue"));
  const b = JSON.stringify(analyzeDrivers(rows, schema, "revenue"));
  assert.equal(a, b);
});
