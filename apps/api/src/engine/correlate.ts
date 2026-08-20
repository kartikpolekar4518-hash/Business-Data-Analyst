import type { Row } from "./parse.js";
import type { SchemaMap } from "./schema.js";
import * as A from "./analytics.js";
import { pearsonCorrelation, spearmanCorrelation } from "./statistics.js";

// Correlation between a metric's monthly series and other numeric columns.
// Deterministic; non-causal (the caller must present it as association, not cause).

export interface CorrelatedFactor {
  column: string;
  pearson: number;
  spearman: number;
  // Direction of the association relative to the metric (positive = moves together).
  direction: "positive" | "negative";
  strength: "strong" | "moderate" | "weak";
}

export interface CorrelationResult {
  metric: string;
  factors: CorrelatedFactor[];
}

function strength(r: number): "strong" | "moderate" | "weak" {
  const a = Math.abs(r);
  if (a >= 0.7) return "strong";
  if (a >= 0.4) return "moderate";
  return "weak";
}

/**
 * Correlate a metric's monthly series against every other numeric column's
 * monthly series. Returns factors sorted by |pearson| descending.
 */
export function correlateMetric(
  rows: Row[],
  s: SchemaMap,
  metric: string | { id: string; compute: (rows: Row[], s: SchemaMap) => number },
): CorrelationResult {
  const metricId = typeof metric === "object" ? metric.id : metric;
  if (!s.date) return { metric: metricId, factors: [] };

  // Build monthly series for the metric.
  const metricSeries = A.timeSeries(rows, s, metric as any);
  if (metricSeries.length < 3) return { metric: metricId, factors: [] };
  const metricByMonth = new Map(metricSeries.map((p) => [p.period, p.value]));

  // Candidate numeric columns (exclude the metric's own source columns to avoid self-correlation).
  const exclude = new Set<string>([s.revenue, s.sales, s.profit, s.cost, s.quantity, s.unit_price].filter(Boolean) as string[]);
  const numericCols = rows[0] ? Object.keys(rows[0]).filter((c) => !exclude.has(c)) : [];

  const factors: CorrelatedFactor[] = [];
  for (const col of numericCols) {
    // Build monthly series for this column.
    const colByMonth = new Map<string, number>();
    for (const r of rows) {
      const d = A.parseDate(r[s.date!]);
      if (!d) continue;
      const key = A.monthKey(d);
      const v = A.num(r[col]);
      colByMonth.set(key, (colByMonth.get(key) ?? 0) + v);
    }
    // Align on the metric's months.
    const xs: number[] = [], ys: number[] = [];
    for (const [month, mv] of metricByMonth) {
      const cv = colByMonth.get(month);
      if (cv !== undefined) { xs.push(mv); ys.push(cv); }
    }
    if (xs.length < 3) continue;
    const p = pearsonCorrelation(xs, ys);
    const sp = spearmanCorrelation(xs, ys);
    if (!isFinite(p) || !isFinite(sp)) continue;
    factors.push({
      column: col,
      pearson: Math.round(p * 1000) / 1000,
      spearman: Math.round(sp * 1000) / 1000,
      direction: p >= 0 ? "positive" : "negative",
      strength: strength(p),
    });
  }

  factors.sort((a, b) => Math.abs(b.pearson) - Math.abs(a.pearson));
  return { metric: metricId, factors: factors.slice(0, 10) };
}