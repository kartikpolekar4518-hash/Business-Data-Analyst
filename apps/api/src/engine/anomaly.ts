// Deterministic anomaly detection on a time series. Pure — no I/O, no randomness.
// A point is flagged when it departs from the fitted trend by more than the normal
// variation, judged two robust ways that a single wild point cannot mask: a
// MAD-based modified z-score (Iglewicz–Hoaglin) on the residuals, and an IQR fence
// on them. Both use medians, so one outlier does not inflate the "normal" spread and
// hide itself. Same input always yields the same anomalies; the model never sees
// anything but the numbers.

import { linearFit } from "./forecast.js";
import { quartiles } from "./quantiles.js";

function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export interface SeriesPoint { period: string; value: number; }

export interface AnomalyPoint {
  period: string;
  value: number;
  expected: number;          // trend-fit value for this period
  lower: number;             // expected "normal" range
  upper: number;
  deviation: number;         // signed z-score (residual / std); 0 when std is 0
  direction: "spike" | "drop";
  severity: "LOW" | "MEDIUM" | "HIGH";
  method: "zscore" | "iqr" | "both";
  reason: string;            // human-readable explanation
}

export interface AnnotatedPoint extends SeriesPoint {
  expected: number;
  lower: number;
  upper: number;
  isAnomaly: boolean;
}

export interface AnomalyResult {
  method: string;
  metric: string;
  anomalies: AnomalyPoint[];
  points: AnnotatedPoint[];  // whole series, annotated — for charting the band
}

// Modified-z thresholds (Iglewicz–Hoaglin): >= FLAG is anomalous, >= SEVERE is severe.
const Z_FLAG = 3.5;
const Z_SEVERE = 5;
const IQR_K = 1.5;
const MAD_SCALE = 1.4826; // makes MAD a consistent estimator of the std-dev for normal data
const MIN_POINTS = 4;     // below this, "normal variation" isn't defined — report nothing.

function round(n: number): number { return Math.round(n * 100) / 100; }
function fmt(n: number): string { return Math.round(n).toLocaleString("en-US"); }

// Detect anomalies in a period/value series. `metric` only shapes the wording.
export function detectAnomalies(series: SeriesPoint[], metric = "value"): AnomalyResult {
  const clean = series.filter((p) => isFinite(p.value));
  const method = "residual_modz+iqr";
  if (clean.length < MIN_POINTS) {
    return {
      method, metric, anomalies: [],
      points: clean.map((p) => ({ ...p, expected: p.value, lower: p.value, upper: p.value, isAnomaly: false })),
    };
  }

  const ys = clean.map((p) => p.value);
  const { a, b } = linearFit(ys);
  const resid = ys.map((y, i) => y - (a + b * i));

  // Robust spread of the residuals — medians, so one outlier can't inflate it.
  const medR = median(resid);
  const rstd = MAD_SCALE * median(resid.map((r) => Math.abs(r - medR)));
  const { q1, q3 } = quartiles(resid);
  const iqr = q3 - q1;
  const iqrLo = q1 - IQR_K * iqr;
  const iqrHi = q3 + IQR_K * iqr;

  // Normal band on residuals = the wider of the modified-z envelope and the IQR fence.
  // Detection uses the same envelope, so a point outside the drawn band is exactly a
  // flagged one.
  const resLo = Math.min(medR - Z_FLAG * rstd, iqrLo);
  const resHi = Math.max(medR + Z_FLAG * rstd, iqrHi);

  const anomalies: AnomalyPoint[] = [];
  const points: AnnotatedPoint[] = clean.map((p, i) => {
    const expected = a + b * i;
    const r = resid[i];
    const modz = rstd > 0 ? (r - medR) / rstd : 0;
    const lower = round(expected + resLo);
    const upper = round(expected + resHi);

    const byZ = rstd > 0 && Math.abs(modz) >= Z_FLAG;
    const byIqr = iqr > 0 && (r < iqrLo || r > iqrHi);
    const isAnomaly = byZ || byIqr;

    if (isAnomaly) {
      const direction: "spike" | "drop" = r >= medR ? "spike" : "drop";
      const severity = Math.abs(modz) >= Z_SEVERE ? "HIGH" : byZ ? "MEDIUM" : "LOW";
      const m: AnomalyPoint["method"] = byZ && byIqr ? "both" : byZ ? "zscore" : "iqr";
      const magnitude = rstd > 0 ? `${round(Math.abs(modz))}× the normal variation` : "well outside the typical range";
      anomalies.push({
        period: p.period, value: round(p.value), expected: round(expected),
        lower, upper, deviation: round(modz), direction, severity, method: m,
        reason: `${metric} was ${fmt(p.value)} in ${p.period} — ${magnitude} ${direction === "spike" ? "above" : "below"} the expected ${fmt(expected)} (normal range ${fmt(lower)}–${fmt(upper)}).`,
      });
    }
    return { period: p.period, value: round(p.value), expected: round(expected), lower, upper, isAnomaly };
  });

  return { method, metric, anomalies, points };
}
