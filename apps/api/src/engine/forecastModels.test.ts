import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CANDIDATES, SEASON, naiveModel, seasonalNaiveModel, movingAverageModel,
  sesModel, holtModel, holtWinters, seasonalMultiplicativeModel,
} from "./forecastModels.js";

// Build `months` period keys starting at 2020-01.
function periods(months: number): string[] {
  const out: string[] = [];
  let y = 2020, m = 1;
  for (let i = 0; i < months; i++) { out.push(`${y}-${String(m).padStart(2, "0")}`); if (++m > 12) { m = 1; y++; } }
  return out;
}

const close = (a: number, b: number, tol = 1e-6) =>
  assert.ok(Math.abs(a - b) < tol, `expected ${b}, got ${a}`);

test("naive repeats the last value and fits with the previous one", () => {
  const m = naiveModel([10, 20, 30]);
  assert.equal(m.at(3, null), 30);
  assert.equal(m.at(99, null), 30);
  assert.deepEqual(m.fitted, [10, 10, 20]);
});

test("seasonal naive returns the value from the same slot one season back", () => {
  const values = Array.from({ length: 24 }, (_, i) => i);   // 0..23
  const m = seasonalNaiveModel(values);
  assert.equal(m.at(24, null), values[12]);                 // one season back from index 24
  assert.equal(m.at(30, null), values[18]);
  // Two seasons ahead still resolves back into the observed range.
  assert.equal(m.at(36, null), values[12]);
  assert.equal(m.fitted[12], values[0]);
  assert.equal(m.fitted[0], values[0]);                     // no history a season back yet
});

test("moving average projects the mean of the last window, and refuses a window it cannot fill", () => {
  const values = [2, 4, 6, 8, 10, 12];
  const m = movingAverageModel(values, 3)!;
  close(m.at(6, null), (8 + 10 + 12) / 3);
  close(m.fitted[3], (2 + 4 + 6) / 3);
  assert.equal(m.params!.window, 3);
  assert.equal(movingAverageModel(values, 12), null, "a window over half the history is not fittable");
});

// Hand-computed: l0 = 10; l_t = 0.5*y_t + 0.5*l_{t-1} over 10,20,30,40,50,60
// -> 15, 22.5, 31.25, 40.625, 50.3125, and fitted[t] is the level before y_t.
test("simple exponential smoothing reproduces the hand-computed level path", () => {
  const m = sesModel([10, 20, 30, 40, 50, 60], 0.5);
  assert.deepEqual(m.fitted, [10, 10, 15, 22.5, 31.25, 40.625]);
  close(m.at(6, null), 50.3125);
  close(m.at(20, null), 50.3125, 1e-9);   // no trend term, so it stays flat
});

test("Holt tracks a perfect line and keeps extending it", () => {
  const values = [100, 200, 300, 400, 500, 600];
  const m = holtModel(values, 0.5, 0.5, 1, "holt")!;
  close(m.at(6, null), 700, 1e-6);
  close(m.at(8, null), 900, 1e-6);
  assert.deepEqual(m.params, { alpha: 0.5, beta: 0.5 });
});

test("damping flattens the projection instead of running away", () => {
  const values = [100, 200, 300, 400, 500, 600];
  const plain = holtModel(values, 0.5, 0.5, 1, "holt")!;
  const damp = holtModel(values, 0.5, 0.5, 0.8, "damped_holt")!;
  assert.ok(damp.at(11, null) < plain.at(11, null), "a damped trend falls behind an undamped one");
  // The projection adds trend * (phi + phi^2 + ... + phi^h), so each further step adds
  // exactly phi times what the previous one did — the flattening, stated exactly.
  const step = (h: number) => damp.at(5 + h, null) - damp.at(5 + h - 1, null);
  close(step(2) / step(1), 0.8, 1e-9);
  close(step(3) / step(2), 0.8, 1e-9);
  assert.ok(step(1) > 0 && step(1) < 100, "the damped trend estimate sits below the raw slope");
  assert.deepEqual(damp.params, { alpha: 0.5, beta: 0.5, phi: 0.8 });
});

test("Holt-Winters additive reproduces an exactly repeating seasonal series", () => {
  const p = periods(2 * SEASON);
  const shape = [0, 30, 60, 90, 60, 30, 0, -30, -60, -90, -60, -30];
  const values = p.map((_, i) => 1000 + shape[i % SEASON]);
  const m = holtWinters(values, p, 0.3, 0.1, 0.3, false)!;
  // A flat level with a fixed seasonal shape: the projection carries the shape forward.
  for (let step = 1; step <= SEASON; step++) {
    const x = values.length - 1 + step;
    const month = (x % SEASON);
    const projected = m.at(x, month);
    assert.ok(Math.abs(projected - (1000 + shape[month])) < 25,
      `month ${month} projects ~${1000 + shape[month]}, got ${projected.toFixed(1)}`);
  }
});

test("Holt-Winters multiplicative refuses a level it cannot divide by", () => {
  const p = periods(2 * SEASON);
  const zeros = p.map(() => 0);
  assert.equal(holtWinters(zeros, p, 0.5, 0.5, 0.5, true), null, "a zero level is not a scale");
});

test("multiplicative seasonality scales the trend rather than shifting it", () => {
  const p = periods(3 * SEASON);
  const factor = [1.4, 0.8, 0.9, 1.0, 1.1, 1.0, 0.9, 0.8, 1.0, 1.1, 1.2, 0.9];
  const values = p.map((_, i) => (1000 + 20 * i) * factor[i % SEASON]);
  const m = seasonalMultiplicativeModel(values, p)!;
  const x = values.length;              // the next period, which is a January (slot 0)
  const projected = m.at(x, 0);
  const trend = 1000 + 20 * x;
  assert.ok(projected > trend, "a x1.4 January sits above the trend line");
  assert.ok(Math.abs(projected / trend - 1.4) < 0.05, `expected ~x1.4, got x${(projected / trend).toFixed(3)}`);
});

test("every candidate projects a finite value past the end of the history", () => {
  const p = periods(36);
  const values = p.map((_, i) => 500 + 10 * i + 80 * Math.sin((2 * Math.PI * i) / 12));
  for (const c of CANDIDATES) {
    if (values.length < c.minPoints) continue;
    if (c.eligible && !c.eligible(values)) continue;
    const m = c.build(values, p);
    assert.ok(m, `${c.method} builds on 36 periods`);
    assert.equal(m!.fitted.length, values.length, `${c.method} fits every period`);
    for (let step = 1; step <= 6; step++) {
      const x = values.length - 1 + step;
      assert.ok(Number.isFinite(m!.at(x, x % SEASON)), `${c.method} is finite ${step} ahead`);
    }
  }
});

test("multiplicative candidates are ineligible when any period is not positive", () => {
  const withZero = [5, 0, 7, 9];
  for (const method of ["seasonal_multiplicative", "holt_winters_multiplicative"]) {
    const c = CANDIDATES.find((x) => x.method === method)!;
    assert.equal(c.eligible!(withZero), false, `${method} needs every period above zero`);
    assert.equal(c.eligible!([5, 1, 7, 9]), true);
  }
});

test("the candidate list stays ordered by parameter count — the tie-break depends on it", () => {
  for (let i = 1; i < CANDIDATES.length; i++) {
    assert.ok(CANDIDATES[i].params >= CANDIDATES[i - 1].params,
      `${CANDIDATES[i].method} (${CANDIDATES[i].params}) must not precede ${CANDIDATES[i - 1].method} (${CANDIDATES[i - 1].params})`);
  }
  const names = CANDIDATES.map((c) => c.method);
  assert.ok(names.indexOf("linear_regression") < names.indexOf("holt"),
    "at equal cost the trend line must win the tie, so a linear history stays labelled linear");
});
