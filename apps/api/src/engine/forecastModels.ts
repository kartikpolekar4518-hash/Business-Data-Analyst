// The candidate forecasting methods the bake-off chooses between. Each one fits a
// `Model` — an in-sample one-step fit plus a function that projects past the end of
// the history — and `forecast.ts` decides which one wins on held-out error.
//
// This file exists because the `Model` seam in forecast.ts grew from two
// implementations to eleven; it is that seam split by size, not a plugin system.
// There is deliberately no registry: `CANDIDATES` is one array literal, iterated in
// one place.
//
// Everything here is pure and deterministic. Smoothing parameters come from a fixed
// grid enumerated in a fixed order, never from an optimiser with a random seed, so
// the same history always selects the same parameters.

import { periodIndexInYear } from "./calendar.js";
import { mean } from "./statistics.js";

export interface Model {
  method: string;
  fitted: number[];                                  // one-step in-sample fit, for residuals
  at: (x: number, month: number | null) => number;   // central value at series index x
  params?: Record<string, number>;                   // grid-chosen values, for the scoreboard
}

export interface Candidate {
  method: string;
  label: string;                                     // display text; `method` stays the id
  params: number;                                    // estimated-parameter count — the parsimony tie-break
  minPoints: number;                                 // history required before it can be fitted
  eligible?: (values: number[]) => boolean;          // extra guard, e.g. multiplicative needs positives
  build: (values: number[], periods: string[]) => Model | null;
}

export const SEASON = 12;        // monthly data -> yearly season; retail years also run 12 periods

// 0-based slot within the year. Retail years also run 12 periods, so SEASON holds for
// both calendar and retail schemes and seasonality works identically on each.
export function monthOf(period: string): number | null {
  const index = periodIndexInYear(period);
  return index === null ? null : index - 1;
}

// The grid every smoothing parameter is drawn from. Enumerated in this order, ties
// kept at first-encountered, so the chosen parameters are a function of the data
// alone. Five values, not nine: the three-parameter Holt-Winters sweep is cubic in
// this length, and at nine it put a 60-period forecast at ~175ms — over the budget
// the selfcheck timing guard enforces, on a path `refreshAlerts` runs on every
// upload. Coarsening costs a little accuracy on the smoothing constant; a fast/slow
// mode would cost reproducibility, which is not for sale.
const GRID = [0.1, 0.3, 0.5, 0.7, 0.9];
const DAMPING = [0.8, 0.85, 0.9, 0.95, 0.98];
const WINDOWS = [2, 3, 4, 6, 12];

// Sum of squared one-step in-sample errors. Grid search scores on this rather than on
// the fold's held-out window: choosing parameters against the window you are about to
// be graded on leaks the test into the fit, and would systematically flatter the
// models with the most knobs — exactly the models the leaderboard must not favour.
function sse(values: number[], fitted: number[]): number {
  let s = 0;
  for (let i = 1; i < values.length; i++) s += (values[i] - fitted[i]) ** 2;
  return s;
}

// Enumerate `combos` in order, build each, keep the lowest SSE. Ties go to the
// earlier combination, which is why GRID ascends: the smallest smoothing that fits
// as well wins, and a near-flat error surface still resolves to one answer.
function bestOf<T>(combos: T[], values: number[], make: (c: T) => Model | null): Model | null {
  let best: Model | null = null, bestScore = Infinity;
  for (const c of combos) {
    const m = make(c);
    if (!m) continue;
    const score = sse(values, m.fitted);
    if (Number.isFinite(score) && score < bestScore) { best = m; bestScore = score; }
  }
  return best;
}

// ---- trend-free baselines -------------------------------------------------

export function naiveModel(values: number[]): Model {
  const last = values[values.length - 1];
  const fitted = values.map((v, i) => (i === 0 ? v : values[i - 1]));
  return { method: "naive", fitted, at: () => last };
}

// The value from the same slot one season back. The honest baseline for anything
// seasonal, and the scale MASE is measured against.
export function seasonalNaiveModel(values: number[]): Model {
  const n = values.length;
  const fitted = values.map((v, i) => (i >= SEASON ? values[i - SEASON] : v));
  return {
    method: "seasonal_naive",
    fitted,
    at: (x) => { let i = x - SEASON; while (i >= n) i -= SEASON; return values[Math.max(0, i)]; },
  };
}

export function movingAverageModel(values: number[], w: number): Model | null {
  const n = values.length;
  if (w < 2 || w > Math.floor(n / 2)) return null;
  const avg = (end: number, width: number) => mean(values.slice(Math.max(0, end - width), end));
  const fitted = values.map((v, i) => (i === 0 ? v : avg(i, Math.min(w, i))));
  const last = avg(n, w);
  return { method: "moving_average", fitted, at: () => last, params: { window: w } };
}

// ---- exponential smoothing ------------------------------------------------

export function sesModel(values: number[], alpha: number): Model {
  let level = values[0];
  const fitted: number[] = [values[0]];
  for (let i = 1; i < values.length; i++) {
    fitted.push(level);
    level = alpha * values[i] + (1 - alpha) * level;
  }
  return { method: "simple_exponential_smoothing", fitted, at: () => level, params: { alpha } };
}

// Holt's linear trend, optionally damped. `phi = 1` is plain Holt; below 1 the trend
// decays, so a long horizon flattens instead of running away — which is why damping
// is a separate candidate rather than a tweak.
export function holtModel(values: number[], alpha: number, beta: number, phi: number, method: string): Model | null {
  const n = values.length;
  if (n < 3) return null;
  let level = values[0], trend = values[1] - values[0];
  const fitted: number[] = [values[0]];
  for (let i = 1; i < n; i++) {
    const f = level + phi * trend;
    fitted.push(f);
    const prev = level;
    level = alpha * values[i] + (1 - alpha) * f;
    trend = beta * (level - prev) + (1 - beta) * phi * trend;
  }
  const params: Record<string, number> = phi === 1 ? { alpha, beta } : { alpha, beta, phi };
  return {
    method, fitted, params,
    at: (x) => {
      // Damped projection sums phi + phi^2 + ... + phi^h; at phi = 1 that is just h.
      const h = x - (n - 1);
      let damped = 0, p = phi;
      for (let k = 0; k < h; k++) { damped += p; p *= phi; }
      return level + trend * damped;
    },
  };
}

// ---- regression-based seasonality (unchanged behaviour) -------------------

export interface LinearParts { a: number; b: number; }

function fitLine(ys: number[]): LinearParts {
  const n = ys.length;
  if (n === 0) return { a: 0, b: 0 };
  const meanX = (n - 1) / 2, meanY = mean(ys);
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) { num += (i - meanX) * (ys[i] - meanY); den += (i - meanX) ** 2; }
  const b = den === 0 ? 0 : num / den;
  return { a: meanY - b * meanX, b };
}

function linearModel(values: number[]): Model {
  const { a, b } = fitLine(values);
  return { method: "linear_regression", fitted: values.map((_, i) => a + b * i), at: (x) => a + b * x };
}

// Centered additive seasonal indices (one per month), or null if the periods aren't
// month-shaped or a slot is uncovered.
export function seasonalIndices(values: number[], periods: string[]): number[] | null {
  const months = periods.map(monthOf);
  if (months.some((m) => m === null)) return null;
  const { a, b } = fitLine(values);
  const sum = new Array(SEASON).fill(0), cnt = new Array(SEASON).fill(0);
  for (let i = 0; i < values.length; i++) {
    const m = months[i]!;
    sum[m] += values[i] - (a + b * i); cnt[m]++;
  }
  if (cnt.some((c) => c === 0)) return null; // an uncovered month makes the index unreliable
  const idx = sum.map((s, m) => s / cnt[m]);
  const m = mean(idx);
  return idx.map((v) => v - m); // center so the seasonal part nets to zero
}

function seasonalModel(values: number[], periods: string[]): Model | null {
  const idx = seasonalIndices(values, periods);
  if (!idx) return null;
  const { a, b } = fitLine(values);
  const fitted = values.map((_, i) => a + b * i + idx[monthOf(periods[i])!]);
  return { method: "seasonal_additive", fitted, at: (x, month) => a + b * x + (month === null ? 0 : idx[month]) };
}

// Ratio-to-trend indices, normalised to average 1. December as "x1.4 of trend"
// rather than "+50k" — which is what a growing business's seasonality actually is,
// and the reason the additive form alone was not enough.
export function seasonalMultiplicativeModel(values: number[], periods: string[]): Model | null {
  const months = periods.map(monthOf);
  if (months.some((m) => m === null)) return null;
  const { a, b } = fitLine(values);
  const sum = new Array(SEASON).fill(0), cnt = new Array(SEASON).fill(0);
  for (let i = 0; i < values.length; i++) {
    const trend = a + b * i;
    if (trend <= 0) return null; // a ratio to a non-positive trend is meaningless
    sum[months[i]!] += values[i] / trend; cnt[months[i]!]++;
  }
  if (cnt.some((c) => c === 0)) return null;
  const raw = sum.map((s, m) => s / cnt[m]);
  const avg = mean(raw);
  if (avg <= 0) return null;
  const idx = raw.map((v) => v / avg);
  const fitted = values.map((_, i) => (a + b * i) * idx[months[i]!]);
  return {
    method: "seasonal_multiplicative", fitted,
    at: (x, month) => (a + b * x) * (month === null ? 1 : idx[month]),
  };
}

// ---- Holt-Winters ---------------------------------------------------------

// Seasonal state is indexed by calendar slot, not by position in the array, so a
// history that starts mid-year still learns the right month's shape.
export function holtWinters(
  values: number[], periods: string[], alpha: number, beta: number, gamma: number, multiplicative: boolean,
): Model | null {
  const n = values.length;
  const months = periods.map(monthOf);
  if (months.some((m) => m === null)) return null;
  if (n < 2 * SEASON) return null;

  const first = values.slice(0, SEASON), second = values.slice(SEASON, 2 * SEASON);
  let level = mean(first);
  if (multiplicative && level <= 0) return null;
  let trend = (mean(second) - level) / SEASON;

  // Seed each slot from its occurrences in the first season.
  const season = new Array(SEASON).fill(multiplicative ? 1 : 0);
  for (let i = 0; i < SEASON; i++) {
    const m = months[i]!;
    season[m] = multiplicative ? values[i] / level : values[i] - level;
  }

  const fitted: number[] = [];
  for (let i = 0; i < n; i++) {
    const m = months[i]!;
    const base = level + trend;
    const f = multiplicative ? base * season[m] : base + season[m];
    fitted.push(f);
    const prev = level;
    if (multiplicative) {
      if (season[m] === 0) return null;
      level = alpha * (values[i] / season[m]) + (1 - alpha) * base;
      if (level === 0) return null;
      season[m] = gamma * (values[i] / level) + (1 - gamma) * season[m];
    } else {
      level = alpha * (values[i] - season[m]) + (1 - alpha) * base;
      season[m] = gamma * (values[i] - level) + (1 - gamma) * season[m];
    }
    trend = beta * (level - prev) + (1 - beta) * trend;
  }
  if (!Number.isFinite(level) || !Number.isFinite(trend)) return null;

  const method = multiplicative ? "holt_winters_multiplicative" : "holt_winters_additive";
  return {
    method, fitted, params: { alpha, beta, gamma },
    at: (x, month) => {
      const h = x - (n - 1);
      const base = level + trend * h;
      const s = month === null ? (multiplicative ? 1 : 0) : season[month];
      return multiplicative ? base * s : base + s;
    },
  };
}

// ---- the candidate set ----------------------------------------------------

const pairs: [number, number][] = [];
for (const a of GRID) for (const b of GRID) pairs.push([a, b]);
const triples: [number, number, number][] = [];
for (const a of GRID) for (const b of GRID) for (const g of GRID) triples.push([a, b, g]);
const damped: [number, number, number][] = [];
for (const a of GRID) for (const b of GRID) for (const p of DAMPING) damped.push([a, b, p]);

const positive = (values: number[]) => values.every((v) => v > 0);

// Ordered by parameter count ascending. That order IS the tie-break in the selection
// rule — the simplest candidate within 5% of the best error wins — so entries must
// stay sorted, and `linear_regression` must precede `holt` at equal cost to keep a
// plainly linear history labelled linear.
export const CANDIDATES: readonly Candidate[] = [
  { method: "naive", label: "Last value", params: 0, minPoints: 2,
    build: (v) => naiveModel(v) },

  { method: "seasonal_naive", label: "Same period last year", params: 0, minPoints: SEASON + 1,
    build: (v) => seasonalNaiveModel(v) },

  { method: "moving_average", label: "Moving average", params: 1, minPoints: 4,
    build: (v) => bestOf(WINDOWS, v, (w) => movingAverageModel(v, w)) },

  { method: "simple_exponential_smoothing", label: "Exponential smoothing", params: 1, minPoints: 3,
    build: (v) => bestOf(GRID, v, (a) => sesModel(v, a)) },

  { method: "linear_regression", label: "Trend line", params: 2, minPoints: 2,
    build: (v) => linearModel(v) },

  { method: "holt", label: "Trend smoothing (Holt)", params: 2, minPoints: 4,
    build: (v) => bestOf(pairs, v, ([a, b]) => holtModel(v, a, b, 1, "holt")) },

  { method: "damped_holt", label: "Damped trend", params: 3, minPoints: 5,
    build: (v) => bestOf(damped, v, ([a, b, p]) => holtModel(v, a, b, p, "damped_holt")) },

  { method: "seasonal_additive", label: "Trend + seasonal pattern", params: 14, minPoints: 2 * SEASON,
    build: (v, p) => seasonalModel(v, p) },

  { method: "seasonal_multiplicative", label: "Trend x seasonal pattern", params: 14, minPoints: 2 * SEASON,
    eligible: positive,
    build: (v, p) => seasonalMultiplicativeModel(v, p) },

  { method: "holt_winters_additive", label: "Holt-Winters (additive)", params: 15, minPoints: 2 * SEASON,
    build: (v, p) => bestOf(triples, v, ([a, b, g]) => holtWinters(v, p, a, b, g, false)) },

  { method: "holt_winters_multiplicative", label: "Holt-Winters (multiplicative)", params: 15, minPoints: 2 * SEASON,
    eligible: positive,
    build: (v, p) => bestOf(triples, v, ([a, b, g]) => holtWinters(v, p, a, b, g, true)) },
];

export const LABELS: Record<string, string> = Object.fromEntries(CANDIDATES.map((c) => [c.method, c.label]));
