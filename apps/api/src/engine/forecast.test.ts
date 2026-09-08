import { test } from "node:test";
import assert from "node:assert/strict";
import { forecast, type HistoryPoint } from "./forecast.js";
import { canonicalJson } from "./identity.js";

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

// Which seasonal method wins is the bake-off's call, not this test's: a sinusoid is
// fitted well by several of them, and pinning one string would mean tuning the
// selection rule to preserve a label. What the test has always been about is that a
// clear yearly pattern is not flattened into a trend line.
const SEASONAL_METHODS = [
  "seasonal_naive", "seasonal_additive", "seasonal_multiplicative",
  "holt_winters_additive", "holt_winters_multiplicative",
];

test("picks a seasonal model when a clear yearly pattern backtests better", () => {
  const p = periods(36);
  const history = p.map((period, i) => ({
    period,
    value: 1000 + 20 * i + 300 * Math.sin((2 * Math.PI * (i % 12)) / 12),
  }));
  const r = forecast(history, 6);
  assert.ok(SEASONAL_METHODS.includes(r.method), `expected a seasonal method, got ${r.method}`);
  assert.equal(r.points.length, 6);
});

// This is now the regression guard on the parsimony tie-break. `holt` can drive its
// error on a perfect line to ~0 too, but it sits after `linear_regression` at equal
// parameter cost, so the simplest-within-5% rule must keep the label linear.
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

// ---- the bake-off ---------------------------------------------------------

test("the scoreboard names exactly one winner, and it is the method used", () => {
  const p = periods(36);
  const history = p.map((period, i) => ({ period, value: 800 + 15 * i + 120 * Math.sin((2 * Math.PI * i) / 12) }));
  const r = forecast(history, 4);

  const winners = r.scoreboard.filter((s) => s.winner);
  assert.equal(winners.length, 1, "exactly one winner");
  assert.equal(winners[0].method, r.method, "the winner is the method that produced the points");
  assert.ok(r.selection.rule.length > 0, "the selection rule is printable");
  assert.ok(r.selection.origins > 0, "36 periods is enough to hold data out");
  for (const s of r.scoreboard) {
    assert.ok(s.label.length > 0, `${s.method} has a display label`);
    assert.ok(s.mase !== null || s.reason !== null, `${s.method} either scored or says why not`);
  }
});

test("a short history marks the seasonal candidates ineligible with a reason", () => {
  const history = periods(6).map((period, i) => ({ period, value: 100 + 5 * i }));
  const r = forecast(history, 3);
  for (const method of ["seasonal_additive", "holt_winters_additive", "holt_winters_multiplicative"]) {
    const row = r.scoreboard.find((s) => s.method === method)!;
    assert.equal(row.eligible, false, `${method} cannot be fitted to 6 periods`);
    assert.match(row.reason!, /24 periods of history, has 6/);
  }
});

test("a series containing zeros still ranks, but reports no percentage error", () => {
  const p = periods(24);
  const history = p.map((period, i) => ({ period, value: i % 6 === 0 ? 0 : 40 + i }));
  const r = forecast(history, 3);
  const winner = r.scoreboard.find((s) => s.winner)!;
  assert.equal(winner.mape, null, "MAPE is undefined when an actual is zero");
  assert.ok(winner.mase !== null, "MASE still ranks it");
  assert.equal(r.scoreboard.find((s) => s.method === "holt_winters_multiplicative")!.eligible, false);
});

test("the same history forecasts identically twice, key order included", () => {
  const p = periods(40);
  const history = p.map((period, i) => ({ period, value: 900 + 12 * i + 200 * Math.sin((2 * Math.PI * i) / 12) }));
  const a = forecast(history, 6), b = forecast(history, 6);
  assert.deepEqual(a, b);
  // canonicalJson also catches key-order drift and -0/NaN differences deepEqual tolerates.
  assert.equal(canonicalJson(a), canonicalJson(b));
});

test("one anomalous spike is toned down before fitting instead of tilting the line", () => {
  const p = periods(30);
  const clean = p.map((period, i) => ({ period, value: 500 + 10 * i }));
  const spiked = clean.map((h, i) => (i === 14 ? { ...h, value: h.value * 10 } : h));

  const a = forecast(clean, 3), b = forecast(spiked, 3);
  assert.deepEqual(b.selection.winsorized, [p[14]], "the spike's period is named as clamped");
  const drift = Math.abs(b.points[0].value - a.points[0].value) / a.points[0].value;
  assert.ok(drift < 0.05, `spike moved the projection by ${(drift * 100).toFixed(1)}%, expected under 5%`);
});

test("the band brackets the projection on a long history without being forced to widen", () => {
  const p = periods(60);
  const noise = [4, -7, 2, 9, -3, 5, -8, 1, 6, -2];
  const history = p.map((period, i) => ({ period, value: 1000 + 9 * i + noise[i % 10] * 12 }));
  const r = forecast(history, 6);
  assert.equal(r.selection.bandBasis, "empirical", "60 periods yields 8 rolling origins");
  for (const pt of r.points) {
    assert.ok(pt.lower <= pt.value && pt.value <= pt.upper, `band brackets ${pt.period}`);
    assert.ok(isFinite(pt.lower) && isFinite(pt.upper), "band is finite");
  }
});
