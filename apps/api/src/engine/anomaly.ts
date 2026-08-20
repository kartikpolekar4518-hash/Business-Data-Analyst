import type { Row } from "./parse.js";
import type { SchemaMap } from "./schema.js";
import * as A from "./analytics.js";
import { outliersByIQR, outliersByZScore, mean, stdDev } from "./statistics.js";

// Anomaly detection on a metric's monthly series. Deterministic; uses the
// statistics.ts primitives (IQR fences + z-score) — no ML, no randomness.

export interface AnomalyPoint {
  period: string;
  value: number;
  expected: number;      // median of the series (robust baseline)
  deviation: number;     // value - expected
  zScore: number | null;
  method: "iqr" | "zscore";
}

export interface AnomalyResult {
  metric: string;
  points: AnomalyPoint[];
}

/**
 * Detect anomalous months in a metric's time series. Uses IQR fences primarily
 * (robust to the outliers' own effect); z-score as a secondary signal.
 */
export function detectAnomalies(
  rows: Row[],
  s: SchemaMap,
  metric: string | { id: string; compute: (rows: Row[], s: SchemaMap) => number },
): AnomalyResult {
  const metricId = typeof metric === "object" ? metric.id : metric;
  const series = A.timeSeries(rows, s, metric as any);
  if (series.length < 4) return { metric: metricId, points: [] };

  const values = series.map((p) => p.value);
  const iqrIdx = new Set(outliersByIQR(values, 1.5));
  const zIdx = new Set(outliersByZScore(values, 2.5));
  const median = values.slice().sort((a, b) => a - b)[Math.floor(values.length / 2)];

  const points: AnomalyPoint[] = [];
  for (let i = 0; i < series.length; i++) {
    const p = series[i];
    const isIqr = iqrIdx.has(i);
    const isZ = zIdx.has(i);
    if (!isIqr && !isZ) continue;
    points.push({
      period: p.period,
      value: p.value,
      expected: median,
      deviation: Math.round((p.value - median) * 100) / 100,
      zScore: isZ ? Math.round(((p.value - mean(values)) / stdDev(values)) * 100) / 100 : null,
      method: isIqr ? "iqr" : "zscore",
    });
  }
  return { metric: metricId, points };
}