// Production forecast accuracy: what was predicted, against what actually happened.
//
// This is deliberately NOT the same measurement as the bake-off scoreboard in
// forecast.ts. That one grades candidate methods on held-out slices of history while
// choosing between them; this one grades predictions made about the future once the
// future arrives. Presenting either as the other would overstate the product's claim,
// so they never share a number, a label, or a screen.
//
// Pure and deterministic: given the same saved points and the same actuals, the same
// verdict. Nothing here decides anything about the forecast — it only reads the two
// numbers and subtracts.

import { round } from "./analytics.js";

export interface PredictedPoint { period: string; value: number; lower: number; upper: number; }

export interface ScoredPoint {
  period: string;
  horizonStep: number;      // 1 = one period beyond the history the forecast was made from
  predicted: number;
  lower: number;
  upper: number;
  actual: number;
  absError: number;
  pctError: number | null;  // null when the actual was 0
  withinBand: boolean;
}

export interface AccuracySummary {
  predictions: number;
  accuracyPct: number | null;     // 100 - MAPE, floored at 0; null when no percentage exists
  mape: number | null;
  mae: number;
  withinBandRate: number | null;  // share of actuals the 95% band contained
}

/**
 * Grade a saved forecast's points against the actuals now available.
 *
 * Only periods that are COMPLETE are scored: a period counts as complete when a
 * strictly later period exists in the current series. Without that rule, on day 3 of
 * a month the partial actual is compared against a whole month's projection and
 * scores as a catastrophic miss — which would make the headline accuracy figure
 * noise rather than a measurement.
 *
 * Period keys are matched by exact string equality. They are never re-keyed into
 * another calendar: a forecast made under calendar months carries "YYYY-MM" keys, and
 * re-bucketing those into a retail calendar the org has since switched to would
 * silently move the very numbers being graded. A forecast whose keys no longer match
 * is simply not scored.
 */
export function scoreForecastPoints(
  points: PredictedPoint[],
  actuals: Map<string, number>,
  lastCompletePeriod: string | null,
): ScoredPoint[] {
  if (!lastCompletePeriod) return [];
  const out: ScoredPoint[] = [];
  points.forEach((p, i) => {
    // Period keys sort lexicographically in chronological order for both the calendar
    // ("2026-03") and retail ("FY2026-P03") schemes, so this comparison needs no date
    // arithmetic and works identically under either.
    if (p.period >= lastCompletePeriod) return;
    const actual = actuals.get(p.period);
    if (actual === undefined) return;

    const absError = Math.abs(actual - p.value);
    out.push({
      period: p.period,
      horizonStep: i + 1,
      predicted: round(p.value),
      lower: round(p.lower),
      upper: round(p.upper),
      actual: round(actual),
      absError: round(absError),
      pctError: actual === 0 ? null : round((absError / Math.abs(actual)) * 100),
      withinBand: actual >= p.lower && actual <= p.upper,
    });
  });
  return out;
}

/**
 * Aggregate scored predictions into the headline figures.
 *
 * `accuracyPct` is stated as `100 - MAPE`, floored at 0 — "accuracy" has no meaning
 * of its own, so the page prints that definition rather than leaving the reader to
 * guess. It is null, not 0, when every prediction was of a zero actual: no percentage
 * exists to average.
 */
export function summarize(
  scores: Pick<ScoredPoint, "absError" | "pctError" | "withinBand">[],
): AccuracySummary {
  if (!scores.length) {
    return { predictions: 0, accuracyPct: null, mape: null, mae: 0, withinBandRate: null };
  }
  const pct = scores.map((s) => s.pctError).filter((p): p is number => p !== null);
  const mape = pct.length ? pct.reduce((a, b) => a + b, 0) / pct.length : null;
  return {
    predictions: scores.length,
    accuracyPct: mape === null ? null : round(Math.min(100, Math.max(0, 100 - mape))),
    mape: mape === null ? null : round(mape),
    mae: round(scores.reduce((a, s) => a + s.absError, 0) / scores.length),
    withinBandRate: round((scores.filter((s) => s.withinBand).length / scores.length) * 100),
  };
}
