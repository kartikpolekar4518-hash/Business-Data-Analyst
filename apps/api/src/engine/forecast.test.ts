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

// Build `months` periods starting at 2020-01.
function periods(months: number): string[] {
  const out: string[] = [];
  let y = 2020, m = 1;
  for (let i = 0; i < months; i++) { out.push(`${y}-${String(m).padStart(2, "0")}`); if (++m > 12) { m = 1; y++; } }
  return out;
}

test("picks the seasonal model when a clear yearly pattern backtests better", () => {
  const p = periods(36);
  const history = p.map((period, i) => ({
    period,
    value: 1000 + 20 * i + 300 * Math.sin((2 * Math.PI * (i % 12)) / 12),
  }));
  const r = forecast(history, 6);
  assert.equal(r.method, "seasonal_additive");
  assert.equal(r.points.length, 6);
});

test("plain linear history stays linear (seasonal not forced)", () => {
  const p = periods(30);
  const history = p.map((period, i) => ({ period, value: 500 + 10 * i }));
  assert.equal(forecast(history, 3).method, "linear_regression");
});

test("scenarios and band are mathematically consistent and fan out", () => {
  const history = [
    { period: "2024-01", value: 100 }, { period: "2024-02", value: 130 },
    { period: "2024-03", value: 150 }, { period: "2024-04", value: 200 },
    { period: "2024-05", value: 230 }, { period: "2024-06", value: 260 },
  ];
  const r = forecast(history, 4);
  for (const pt of r.points) {
    assert.ok(pt.worst <= pt.value && pt.value <= pt.best, "worst <= base <= best");
    assert.ok(pt.lower <= pt.value && pt.value <= pt.upper, "lower <= base <= upper");
  }
  const spread = (pt: { best: number; worst: number }) => pt.best - pt.worst;
  assert.ok(spread(r.points[3]) >= spread(r.points[0]), "scenarios fan out with horizon");
});

test("handles noisy data without throwing and returns the requested horizon", () => {
  const p = periods(24);
  const noise = [3, -5, 2, 7, -4, 1, -2, 6, -3, 4, -1, 5, -6, 2, 3, -4, 1, 8, -2, 0, 4, -5, 2, -1];
  const history = p.map((period, i) => ({ period, value: 400 + 8 * i + noise[i] * 10 }));
  const r = forecast(history, 5);
  assert.equal(r.points.length, 5);
  assert.ok(r.points.every((pt) => isFinite(pt.value) && isFinite(pt.best) && isFinite(pt.worst)));
});

test("insufficient/empty history never throws", () => {
  assert.equal(forecast([], 3).method, "flat");
  assert.equal(forecast([], 3).points.length, 3);
});
