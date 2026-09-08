import { test } from "node:test";
import assert from "node:assert/strict";
import { scoreForecastPoints, summarize, type PredictedPoint } from "./accuracy.js";

const points: PredictedPoint[] = [
  { period: "2024-01", value: 100, lower: 90, upper: 110 },
  { period: "2024-02", value: 200, lower: 180, upper: 220 },
  { period: "2024-03", value: 300, lower: 280, upper: 320 },
];

test("only periods with a strictly later complete period are scored", () => {
  const actuals = new Map([["2024-01", 105], ["2024-02", 190], ["2024-03", 60]]);
  // March is the newest period in the data, so it is still in progress: its 60 is a
  // partial month, and scoring it would record a 80% miss that never happened.
  const scored = scoreForecastPoints(points, actuals, "2024-03");
  assert.deepEqual(scored.map((s) => s.period), ["2024-01", "2024-02"]);
  assert.equal(scored[0].horizonStep, 1);
  assert.equal(scored[1].horizonStep, 2);
});

test("a period the current data does not contain is skipped, not counted as a miss", () => {
  const actuals = new Map([["2024-01", 105], ["2024-03", 310], ["2024-04", 400]]);
  const scored = scoreForecastPoints(points, actuals, "2024-04");
  assert.deepEqual(scored.map((s) => s.period), ["2024-01", "2024-03"]);
});

test("nothing is scored before any period has completed", () => {
  assert.deepEqual(scoreForecastPoints(points, new Map([["2024-01", 100]]), null), []);
  assert.deepEqual(scoreForecastPoints(points, new Map([["2024-01", 100]]), "2024-01"), []);
});

test("a zero actual has an absolute error but no percentage error", () => {
  const scored = scoreForecastPoints(points, new Map([["2024-01", 0], ["2024-02", 200]]), "2024-02");
  assert.equal(scored.length, 1);
  assert.equal(scored[0].absError, 100, "being 100 out is still being 100 out");
  assert.equal(scored[0].pctError, null, "a percentage of zero does not exist");
});

test("withinBand is inclusive at both edges", () => {
  const edge: PredictedPoint[] = [
    { period: "2024-01", value: 100, lower: 90, upper: 110 },
    { period: "2024-02", value: 100, lower: 90, upper: 110 },
    { period: "2024-03", value: 100, lower: 90, upper: 110 },
    { period: "2024-04", value: 100, lower: 90, upper: 110 },
  ];
  const actuals = new Map([["2024-01", 90], ["2024-02", 110], ["2024-03", 89.99], ["2024-04", 110.01], ["2024-05", 100]]);
  const scored = scoreForecastPoints(edge, actuals, "2024-05");
  assert.deepEqual(scored.map((s) => s.withinBand), [true, true, false, false]);
});

test("summarize over nothing returns zeros, never NaN", () => {
  const s = summarize([]);
  assert.deepEqual(s, { predictions: 0, accuracyPct: null, mape: null, mae: 0, withinBandRate: null });
});

test("summarize averages the percentage errors it has and reports band coverage", () => {
  const s = summarize([
    { absError: 10, pctError: 10, withinBand: true },
    { absError: 30, pctError: 20, withinBand: true },
    { absError: 20, pctError: null, withinBand: false },  // a zero actual — excluded from MAPE only
  ]);
  assert.equal(s.predictions, 3);
  assert.equal(s.mape, 15, "MAPE averages the two percentages that exist");
  assert.equal(s.accuracyPct, 85);
  assert.equal(s.mae, 20, "MAE averages all three absolute errors");
  assert.equal(s.withinBandRate, 66.67);
});

test("accuracy floors at 0 rather than going negative when the miss exceeds 100%", () => {
  const s = summarize([{ absError: 500, pctError: 250, withinBand: false }]);
  assert.equal(s.mape, 250);
  assert.equal(s.accuracyPct, 0, "being 250% out is 0% accurate, not -150%");
});

test("summarize reports null accuracy when no percentage error exists at all", () => {
  const s = summarize([{ absError: 5, pctError: null, withinBand: true }]);
  assert.equal(s.accuracyPct, null);
  assert.equal(s.mape, null);
  assert.equal(s.mae, 5);
  assert.equal(s.withinBandRate, 100);
});

test("scoring the same inputs twice gives the same verdict", () => {
  const actuals = new Map([["2024-01", 105], ["2024-02", 190], ["2024-03", 310], ["2024-04", 400]]);
  assert.deepEqual(
    scoreForecastPoints(points, actuals, "2024-04"),
    scoreForecastPoints(points, actuals, "2024-04"),
  );
});
