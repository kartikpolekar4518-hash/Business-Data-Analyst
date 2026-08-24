// Deterministic forecasting. Fits the trend, and — when there is enough history —
// an additive seasonal model, picking whichever backtests better on held-out
// periods. A residual-based 95% confidence band brackets the central projection,
// and best/base/worst scenarios fan out from the trend's slope uncertainty. Pure:
// same history always yields the same forecast.

export interface HistoryPoint { period: string; value: number; }
export interface ForecastPoint {
  period: string;
  value: number;   // central (base) projection
  lower: number;   // 95% confidence band
  upper: number;
  best: number;    // optimistic scenario (steeper sustained trend)
  worst: number;   // pessimistic scenario (flatter/declining sustained trend)
}

export interface ForecastResult {
  method: string;  // "flat" | "linear_regression" | "seasonal_additive"
  history: HistoryPoint[];
  points: ForecastPoint[];
}

// Goal evaluation: is the forecast on track vs a target?
export interface GoalStatus {
  goal: number;
  forecastValue: number;
  status: "on_track" | "at_risk" | "missed";
  gap: number;            // goal - forecastValue (positive = shortfall)
  gapPct: number;         // gap / goal, as a percentage
}

export interface WhatIfResult {
  base: ForecastResult;
  scenario: ForecastResult;
  driverDelta: number;    // the applied driver change
  goal?: GoalStatus;
}

function nextPeriod(last: string): string {
  // periods look like "YYYY-MM"
  const m = /^(\d{4})-(\d{2})$/.exec(last);
  if (!m) return last + "+1";
  let year = Number(m[1]), month = Number(m[2]) + 1;
  if (month > 12) { month = 1; year++; }
  return `${year}-${String(month).padStart(2, "0")}`;
}

// Ordinary-least-squares line `value = a + b*x` over `ys` at x = 0..n-1, plus the
// residual population std-dev. Shared by the forecaster and the anomaly detector so
// both measure "expected value" and "normal variation" identically.
export interface LinearFit { a: number; b: number; std: number; }
export function linearFit(ys: number[]): LinearFit {
  const n = ys.length;
  if (n === 0) return { a: 0, b: 0, std: 0 };
  const meanX = (n - 1) / 2;
  const meanY = ys.reduce((s, y) => s + y, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) { num += (i - meanX) * (ys[i] - meanY); den += (i - meanX) ** 2; }
  const b = den === 0 ? 0 : num / den;
  const a = meanY - b * meanX;
  const resid = ys.map((y, i) => y - (a + b * i));
  const std = Math.sqrt(resid.reduce((s, r) => s + r * r, 0) / n);
  return { a, b, std };
}

const SEASON = 12;        // monthly data -> yearly season
const Z95 = 1.96;

function monthOf(period: string): number | null {
  const m = /^\d{4}-(\d{2})$/.exec(period);
  return m ? Number(m[1]) - 1 : null;
}

// Centered additive seasonal indices (one per month), or null if the periods aren't
// month-shaped or there isn't at least one point per season slot on average.
function seasonalIndices(values: number[], periods: string[]): number[] | null {
  const months = periods.map(monthOf);
  if (months.some((m) => m === null)) return null;
  const { a, b } = linearFit(values);
  const sum = new Array(SEASON).fill(0), cnt = new Array(SEASON).fill(0);
  for (let i = 0; i < values.length; i++) {
    const m = months[i]!;
    sum[m] += values[i] - (a + b * i); cnt[m]++;
  }
  if (cnt.some((c) => c === 0)) return null; // an uncovered month makes the index unreliable
  const idx = sum.map((s, m) => s / cnt[m]);
  const mean = idx.reduce((x, y) => x + y, 0) / SEASON;
  return idx.map((v) => v - mean); // center so the seasonal part nets to zero
}

interface Model {
  method: string;
  fitted: number[];                                  // in-sample fit, for residual std
  at: (x: number, month: number | null) => number;   // central value at future index x
}

function linearModel(values: number[]): Model {
  const { a, b } = linearFit(values);
  return { method: "linear_regression", fitted: values.map((_, i) => a + b * i), at: (x) => a + b * x };
}

function seasonalModel(values: number[], periods: string[]): Model | null {
  const idx = seasonalIndices(values, periods);
  if (!idx) return null;
  const { a, b } = linearFit(values);
  const fitted = values.map((_, i) => a + b * i + idx[monthOf(periods[i])!]);
  return { method: "seasonal_additive", fitted, at: (x, month) => a + b * x + (month === null ? 0 : idx[month]) };
}

function residStd(values: number[], fitted: number[]): number {
  const n = values.length;
  const ss = values.reduce((s, y, i) => s + (y - fitted[i]) ** 2, 0);
  return Math.sqrt(ss / n);
}

function slopeStdErr(values: number[], std: number): number {
  const n = values.length;
  const meanX = (n - 1) / 2;
  let sxx = 0;
  for (let i = 0; i < n; i++) sxx += (i - meanX) ** 2;
  return sxx > 0 ? std / Math.sqrt(sxx) : 0;
}

// Mean absolute error of a model trained on all-but-last-`h` points, scored on the
// held-out tail. Used to choose seasonal vs linear honestly rather than by assumption.
function backtestMae(build: (v: number[], p: string[]) => Model | null, values: number[], periods: string[], h: number): number | null {
  const cut = values.length - h;
  if (cut < 2) return null;
  const model = build(values.slice(0, cut), periods.slice(0, cut));
  if (!model) return null;
  let err = 0;
  for (let i = cut; i < values.length; i++) err += Math.abs(values[i] - model.at(i, monthOf(periods[i])));
  return err / h;
}

export function forecast(history: HistoryPoint[], horizon = 3): ForecastResult {
  const n = history.length;
  if (n < 2) {
    const base = history[0]?.value ?? 0;
    let last = history[0]?.period ?? "2024-01";
    const points: ForecastPoint[] = [];
    for (let i = 0; i < horizon; i++) {
      last = nextPeriod(last);
      points.push({ period: last, value: base, lower: base * 0.8, upper: base * 1.2, best: base, worst: base });
    }
    return { method: "flat", history, points };
  }

  const values = history.map((h) => h.value);
  const periods = history.map((h) => h.period);

  // Model selection: prefer seasonal only when there are ≥2 full seasons AND it
  // backtests at least as well as the linear trend. Otherwise stay linear.
  let model = linearModel(values);
  const seasonal = n >= 2 * SEASON ? seasonalModel(values, periods) : null;
  if (seasonal) {
    const h = Math.min(SEASON, Math.max(1, Math.floor(n / 4)));
    const linMae = backtestMae((v) => linearModel(v), values, periods, h);
    const seaMae = backtestMae((v, p) => seasonalModel(v, p), values, periods, h);
    // Only switch to seasonal when it materially beats the trend (≥10% lower error),
    // so a near-linear series with negligible seasonality stays labelled linear.
    if (linMae !== null && seaMae !== null && seaMae < linMae * 0.9) model = seasonal;
  }

  const std = residStd(values, model.fitted);
  const seB = slopeStdErr(values, std); // slope uncertainty drives the scenario fan-out

  let last = periods[n - 1];
  const points: ForecastPoint[] = [];
  for (let i = 1; i <= horizon; i++) {
    const x = n - 1 + i;
    last = nextPeriod(last);
    const month = monthOf(last);
    const value = Math.max(0, model.at(x, month));
    const band = Z95 * std * Math.sqrt(1 + i / n);        // noise band, widens with horizon
    // Scenarios: sustained steeper / flatter slope, so they fan out over the horizon.
    // Scale by the horizon offset i (distance beyond the last actual), not the absolute
    // time index x, so the fan widens with the forecast rather than the history length.
    const best = Math.max(0, value + seB * i);
    const worst = Math.max(0, value - seB * i);
    points.push({
      period: last, value: round(value),
      lower: round(Math.max(0, value - band)), upper: round(value + band),
      best: round(Math.max(best, value)), worst: round(Math.min(worst, value)),
    });
  }
  return { method: model.method, history, points };
}

function round(n: number): number { return Math.round(n * 100) / 100; }

/**
 * Evaluate a forecast against a goal/target. Deterministic band-based judgement:
 * - on_track: forecast value is at/above the goal
 * - at_risk:  forecast is within 10% below the goal
 * - missed:   forecast is more than 10% below the goal
 */
export function evaluateGoal(forecastValue: number, goal: number): GoalStatus {
  const gap = goal - forecastValue;
  const gapPct = goal === 0 ? 0 : Math.round((gap / Math.abs(goal)) * 1000) / 10;
  let status: GoalStatus["status"];
  if (forecastValue >= goal) status = "on_track";
  else if (gapPct <= 10) status = "at_risk";
  else status = "missed";
  return { goal, forecastValue, status, gap: round(gap), gapPct };
}

/**
 * What-if / driver-based projection: re-run the forecast with a driver delta
 * applied to the most recent history value (e.g. "what if we add 5% more volume?").
 * The scenario shifts the trend's intercept so the whole fan moves with the lever.
 */
export function whatIf(history: HistoryPoint[], horizon: number, driverDelta: number, goal?: number): WhatIfResult {
  const base = forecast(history, horizon);
  // Apply the driver delta to the last history point, then re-forecast.
  const last = history[history.length - 1];
  const shifted = last ? [...history.slice(0, -1), { period: last.period, value: last.value + driverDelta }] : history;
  const scenario = forecast(shifted, horizon);
  return {
    base,
    scenario,
    driverDelta,
    goal: goal === undefined ? undefined : evaluateGoal(scenario.points[0]?.value ?? 0, goal),
  };
}
