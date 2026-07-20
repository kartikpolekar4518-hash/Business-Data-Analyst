import { timeSeries } from "../analytics.js";
import { pearsonCorrelation } from "../statistics.js";
import type { AnalyzerContext, AnalyzerOutput, Analyzer } from "./types.js";

export type TrendDirection = "increasing" | "decreasing" | "flat";

export interface TrendInsight {
  metric: "revenue" | "profit" | "orders";
  periods: number;
  correlation: number; // pearson r between period index and value
  direction: TrendDirection;
}

const ALGORITHM = "pearson correlation of period index vs. value";

function round(n: number): number { return Math.round(n * 1000) / 1000; }

function directionOf(r: number): TrendDirection {
  if (r > 0.2) return "increasing";
  if (r < -0.2) return "decreasing";
  return "flat";
}

// "not applicable to this dataset" (no date column, or too few periods) is a
// valid outcome — data: null, no error. Reuses the existing timeSeries
// bucketing (engine/analytics.ts) rather than re-deriving periods, and
// pearsonCorrelation for direction/strength rather than forecast.ts's
// regression (which solves a different problem — projecting future values,
// not summarizing historical direction).
export const trendAnalyzer: Analyzer<TrendInsight | null> = {
  name: "trend",
  run(ctx: AnalyzerContext): AnalyzerOutput<TrendInsight | null> {
    if (!ctx.schema.date) {
      return { meta: { analyzer: "trend", algorithm: ALGORITHM, sampleSize: 0 }, data: null };
    }

    const metric: TrendInsight["metric"] = ctx.schema.revenue || ctx.schema.sales ? "revenue" : ctx.schema.profit ? "profit" : "orders";
    const series = timeSeries(ctx.rows, ctx.schema, metric);
    if (series.length < 2) {
      return { meta: { analyzer: "trend", algorithm: ALGORITHM, sampleSize: series.length }, data: null };
    }

    const periodIndex = series.map((_, i) => i);
    const values = series.map((p) => p.value);
    const r = pearsonCorrelation(periodIndex, values);

    return {
      meta: { analyzer: "trend", algorithm: ALGORITHM, sampleSize: series.length },
      data: { metric, periods: series.length, correlation: round(r), direction: directionOf(r) },
    };
  },
};
