// Deterministic forecasting. Eleven candidate methods compete on the history you
// actually uploaded: each is fitted on a training slice and scored on periods held
// out from it, at several rolling origins, and the simplest one that gets within 5%
// of the best error wins. The full scoreboard is returned so the interface can show
// what was tried and why one won, rather than asserting a choice.
//
// The confidence band is measured, not assumed: where enough origins were scored it
// is the empirical spread of the winner's own held-out errors at that step ahead.
// Anomalous periods are toned down before fitting, using the same MAD band the
// Alerts page draws, so the two screens cannot disagree about what is abnormal.
//
// Pure: same history always yields the same forecast, down to the chosen smoothing
// parameters. No model chooses a number here — the code does, and shows its work.

import { nextPeriodKey } from "./calendar.js";
import { round } from "./analytics.js";
import { mean, stdDev } from "./statistics.js";
import { percentile } from "./quantiles.js";
import { detectAnomalies, type SeriesPoint } from "./anomaly.js";
import { CANDIDATES, LABELS, SEASON, monthOf, type Candidate, type Model } from "./forecastModels.js";

export interface HistoryPoint { period: string; value: number; }
export interface ForecastPoint {
  period: string;
  value: number;   // central (base) projection
  lower: number;   // 95% confidence band
  upper: number;
  best: number;    // optimistic scenario (steeper sustained trend)
  worst: number;   // pessimistic scenario (flatter/declining sustained trend)
}

// One row of the bake-off. `mase` ranks; `mape` is for humans and is null whenever a
// scored actual was zero, where a percentage error does not exist.
export interface CandidateScore {
  method: string;
  label: string;
  params: Record<string, number> | null;
  mase: number | null;
  mape: number | null;
  mae: number | null;
  origins: number;
  eligible: boolean;
  reason: string | null;
  winner: boolean;
}

export interface ForecastSelection {
  origins: number;          // rolling origins the winner was scored over
  horizonScored: number;    // steps ahead each origin was scored to
  metric: "mase";
  rule: string;             // the printable selection rule
  winsorized: string[];     // periods toned down before fitting
  bandBasis: "empirical" | "normal" | "residual";
}

export interface ForecastResult {
  method: string;  // "flat" | "linear_regression" | "holt_winters_additive" | ...
  history: HistoryPoint[];
  points: ForecastPoint[];
  scoreboard: CandidateScore[];
  selection: ForecastSelection;
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

export const SELECTION_RULE =
  "The winner is the simplest method whose held-out error (MASE) is within 5% of the best, " +
  "where simplest means fewest fitted parameters.";

const Z95 = 1.96;
const TOLERANCE = 1.05;   // "within 5% of the best"
const MAX_SCORED_HORIZON = 6;

// Periods are "YYYY-MM" on a calendar year and "FY2026-P03" on a retail one; the
// calendar module owns both formats so the forecaster never has to know which is which.
function nextPeriod(last: string): string {
  return nextPeriodKey(last) ?? last + "+1";
}

// Ordinary-least-squares line `value = a + b*x` over `ys` at x = 0..n-1, plus the
// residual population std-dev. Still exported: it is the shape the scenario fan-out
// is derived from, and callers outside the bake-off use it to mean "the trend".
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

// A spike or a data-entry error would otherwise tilt every fitted line through it.
// The clamp band comes from the anomaly detector rather than a fresh rule of its own,
// so a period the Alerts page calls abnormal is exactly the period the forecaster
// tones down — a second rule here would let one screen flag what the other kept.
function winsorize(history: HistoryPoint[]): { values: number[]; clamped: string[] } {
  const values = history.map((h) => h.value);
  const { points } = detectAnomalies(history as SeriesPoint[], "forecast");
  if (!points.length) return { values, clamped: [] };
  const clamped: string[] = [];
  const out = values.map((v, i) => {
    const p = points[i];
    if (!p || !p.isAnomaly) return v;
    clamped.push(history[i].period);
    return Math.min(p.upper, Math.max(p.lower, v));
  });
  return { values: out, clamped };
}

// Mean absolute one-step error of the seasonal-naive forecast on the TRAINING window
// only — never the held-out one, which is the window being graded. This is what makes
// MASE comparable across metrics and across organisations: an error of 1.0 means "no
// better than repeating last year's same period".
function maseScale(train: number[]): number {
  const lag = train.length > SEASON ? SEASON : 1;
  if (train.length <= lag) return 0;
  let s = 0;
  for (let i = lag; i < train.length; i++) s += Math.abs(train[i] - train[i - lag]);
  return s / (train.length - lag);
}

interface FoldOutcome {
  errorsByStep: number[][];   // [step][fold], signed actual - predicted
  mase: number | null;
  mape: number | null;
  mae: number | null;
  origins: number;
}

const EMPTY_FOLD: FoldOutcome = { errorsByStep: [], mase: null, mape: null, mae: null, origins: 0 };

// Rolling-origin evaluation. Fitting uses the winsorized series; scoring always uses
// the raw one — grading a model against data it was allowed to clean would be
// circular, and would hide exactly the misses an anomalous period causes.
function rollingOrigin(
  candidate: Candidate, raw: number[], fitValues: number[], periods: string[], H: number, K: number,
): FoldOutcome {
  const n = raw.length;
  const errorsByStep: number[][] = Array.from({ length: H }, () => []);
  let absSum = 0, scaledSum = 0, pctSum = 0, scored = 0, origins = 0;
  let scaleUsable = true, pctUsable = true;

  for (let k = 0; k < K; k++) {
    const cut = n - H - k;
    if (cut < candidate.minPoints) continue;
    const model = candidate.build(fitValues.slice(0, cut), periods.slice(0, cut));
    if (!model) continue;
    const scale = maseScale(raw.slice(0, cut));
    if (scale <= 0) scaleUsable = false;
    origins++;
    for (let step = 0; step < H; step++) {
      const i = cut + step;
      const predicted = model.at(i, monthOf(periods[i]));
      if (!Number.isFinite(predicted)) continue;
      const err = raw[i] - predicted;
      errorsByStep[step].push(err);
      const abs = Math.abs(err);
      absSum += abs; scored++;
      if (scale > 0) scaledSum += abs / scale;
      if (raw[i] === 0) pctUsable = false;
      else pctSum += abs / Math.abs(raw[i]);
    }
  }

  if (!scored) return EMPTY_FOLD;
  return {
    errorsByStep,
    mase: scaleUsable && scaledSum >= 0 ? round4(scaledSum / scored) : null,
    mape: pctUsable ? round4((pctSum / scored) * 100) : null,
    mae: round4(absSum / scored),
    origins,
  };
}

function round4(n: number): number {
  return Number.isFinite(n) ? Math.round(n * 10000) / 10000 : 0;
}

function ineligible(c: Candidate, reason: string): CandidateScore {
  return {
    method: c.method, label: c.label, params: null,
    mase: null, mape: null, mae: null, origins: 0,
    eligible: false, reason, winner: false,
  };
}

function flatResult(history: HistoryPoint[], horizon: number): ForecastResult {
  const base = history[0]?.value ?? 0;
  let last = history[0]?.period ?? "2024-01";
  const points: ForecastPoint[] = [];
  for (let i = 0; i < horizon; i++) {
    last = nextPeriod(last);
    points.push({ period: last, value: base, lower: base * 0.8, upper: base * 1.2, best: base, worst: base });
  }
  return {
    method: "flat", history, points, scoreboard: [],
    selection: {
      origins: 0, horizonScored: 0, metric: "mase", rule: SELECTION_RULE,
      winsorized: [], bandBasis: "residual",
    },
  };
}

export function forecast(history: HistoryPoint[], horizon = 3): ForecastResult {
  const n = history.length;
  if (n < 2) return flatResult(history, horizon);

  const raw = history.map((h) => h.value);
  const periods = history.map((h) => h.period);
  const { values: fitValues, clamped } = winsorize(history);

  // Which candidates could be fitted at all, before any scoring.
  const runnable = CANDIDATES.filter((c) => n >= c.minPoints && (!c.eligible || c.eligible(raw)));

  // One scored horizon for every candidate, so their errors stay comparable. Shrink
  // it only if no candidate can hold that many periods out of a history this short.
  let H = Math.min(horizon, MAX_SCORED_HORIZON);
  while (H > 1 && !runnable.some((c) => n - H - c.minPoints + 1 >= 1)) H--;
  const baseK = n < 12 ? 1 : n < 24 ? 3 : n < 48 ? 5 : 8;

  const outcomes = new Map<string, FoldOutcome>();
  const models = new Map<string, Model>();
  const scoreboard: CandidateScore[] = CANDIDATES.map((c) => {
    if (n < c.minPoints) return ineligible(c, `needs ${c.minPoints} periods of history, has ${n}`);
    if (c.eligible && !c.eligible(raw)) return ineligible(c, "needs every period above zero");

    const model = c.build(fitValues, periods);
    if (!model) return ineligible(c, "could not be fitted to this history");
    models.set(c.method, model);

    const K = Math.min(baseK, n - H - c.minPoints + 1);
    const outcome = K >= 1 ? rollingOrigin(c, raw, fitValues, periods, H, K) : EMPTY_FOLD;
    outcomes.set(c.method, outcome);
    return {
      method: c.method, label: c.label, params: model.params ?? null,
      mase: outcome.mase, mape: outcome.mape, mae: outcome.mae, origins: outcome.origins,
      eligible: true,
      reason: outcome.origins ? null : `needs ${H + c.minPoints} periods to hold any out, has ${n}`,
      winner: false,
    };
  });

  // Selection. CANDIDATES is ordered by fitted-parameter count ascending, so taking
  // the FIRST entry within tolerance of the best error is exactly "the simplest
  // method that is not meaningfully worse" — and it is what keeps a plainly linear
  // history labelled linear instead of flipping to whichever smoother squeezed out
  // another decimal place.
  const ranked = scoreboard.filter((s) => s.mase !== null);
  const byMae = ranked.length ? [] : scoreboard.filter((s) => s.mae !== null);
  const pool = ranked.length ? ranked : byMae;
  const key = (s: CandidateScore) => (ranked.length ? s.mase! : s.mae!);

  let winner: CandidateScore | undefined;
  if (pool.length) {
    const best = Math.min(...pool.map(key));
    winner = pool.find((s) => key(s) <= best * TOLERANCE) ?? pool[0];
  } else {
    // Nothing could be scored — too little history to hold anything out. Fall through
    // to the simplest candidate that merely fits, and say so via origins: 0.
    winner = scoreboard.find((s) => s.eligible);
  }
  if (!winner) return flatResult(history, horizon);
  winner.winner = true;

  const model = models.get(winner.method)!;
  const outcome = outcomes.get(winner.method) ?? EMPTY_FOLD;

  // Band basis, by how much evidence there actually is. Empirical quantiles need
  // enough folds to have quantiles; below that a normal fit of the same errors; below
  // that the residual formula this engine has always used, so short series are
  // unchanged.
  const bandBasis: ForecastSelection["bandBasis"] =
    outcome.origins >= 8 ? "empirical" : outcome.origins >= 3 ? "normal" : "residual";
  const std = residStd(raw, model.fitted);
  const seB = slopeStdErr(raw, std); // slope uncertainty drives the scenario fan-out

  let last = periods[n - 1];
  const points: ForecastPoint[] = [];
  for (let i = 1; i <= horizon; i++) {
    const x = n - 1 + i;
    last = nextPeriod(last);
    const month = monthOf(last);
    const projected = model.at(x, month);
    const value = Math.max(0, Number.isFinite(projected) ? projected : raw[n - 1]);

    // Past the scored horizon there is no measured error to use, so reuse the last
    // scored step's spread and widen it as a random walk would: variance grows with
    // distance, so the half-width grows with its square root.
    const stepIdx = Math.min(i, outcome.errorsByStep.length) - 1;
    const errs = stepIdx >= 0 ? outcome.errorsByStep[stepIdx] : [];
    const stretch = i > outcome.errorsByStep.length && outcome.errorsByStep.length > 0
      ? Math.sqrt(i / outcome.errorsByStep.length)
      : 1;

    let lo: number, hi: number;
    if (bandBasis === "empirical" && errs.length >= 8) {
      lo = percentile(errs, 2.5) * stretch;
      hi = percentile(errs, 97.5) * stretch;
    } else if (bandBasis === "normal" && errs.length >= 3) {
      const m = mean(errs), s = stdDev(errs);
      lo = (m - Z95 * s) * stretch;
      hi = (m + Z95 * s) * stretch;
    } else {
      const band = Z95 * std * Math.sqrt(1 + i / n); // noise band, widens with horizon
      lo = -band; hi = band;
    }

    // The band brackets the projection by construction. It is NOT forced to widen
    // with the horizon: where the measured error at three steps out is tighter than
    // at two, saying otherwise would be a decorative lie.
    const lower = Math.max(0, Math.min(value, value + lo));
    const upper = Math.max(value, value + hi);

    // Scenarios: sustained steeper / flatter slope, so they fan out over the horizon.
    // Scale by the horizon offset i (distance beyond the last actual), not the absolute
    // time index x, so the fan widens with the forecast rather than the history length.
    const best = Math.max(0, value + seB * i);
    const worst = Math.max(0, value - seB * i);
    points.push({
      period: last, value: round(value),
      lower: round(lower), upper: round(upper),
      best: round(Math.max(best, value)), worst: round(Math.min(worst, value)),
    });
  }

  return {
    method: winner.method,
    history,
    points,
    scoreboard,
    selection: {
      origins: outcome.origins,
      horizonScored: outcome.origins ? H : 0,
      metric: "mase",
      rule: SELECTION_RULE,
      winsorized: clamped,
      bandBasis,
    },
  };
}


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

export { LABELS as FORECAST_METHOD_LABELS };
