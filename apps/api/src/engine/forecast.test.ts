import { test } from "node:test";
import assert from "node:assert/strict";
import { forecast, type HistoryPoint } from "./forecast.js";

test("forecast fits a linear trend and projects it forward", () => {
  const history: HistoryPoint[] = [
    { period: "2024-01", value: 100 },
    { period: "2024-02", value: 200 },
    { period: "2024-03", value: 300 },
    { period: "2024-04", value: 400 },
  ];
  const r = forecast(history, 2);
  assert.equal(r.method, "linear_regression");
  assert.equal(r.points.length, 2);
  assert.equal(r.points[0].period, "2024-05");
  // Perfectly linear series (slope 100) -> next point ~500.
  assert.ok(Math.abs(r.points[0].value - 500) < 1, `expected ~500, got ${r.points[0].value}`);
  assert.ok(r.points[1].value > r.points[0].value, "trend keeps rising");
});

test("confidence band brackets the value and widens with horizon", () => {
  const history: HistoryPoint[] = [
    { period: "2024-01", value: 100 },
    { period: "2024-02", value: 180 },
    { period: "2024-03", value: 260 },
    { period: "2024-04", value: 300 },
  ];
  const r = forecast(history, 3);
  for (const p of r.points) {
    assert.ok(p.lower <= p.value && p.value <= p.upper, "lower <= value <= upper");
  }
  const width = (p: { lower: number; upper: number }) => p.upper - p.lower;
  assert.ok(width(r.points[2]) >= width(r.points[0]), "band widens further out");
});

test("forecast degrades to a flat projection when there is too little history", () => {
  const r = forecast([{ period: "2024-01", value: 50 }], 2);
  assert.equal(r.method, "flat");
  assert.equal(r.points[0].value, 50);
  assert.ok(r.points[0].lower < 50 && r.points[0].upper > 50);
});
