import { mean, stdDev, variance, quartiles, confidenceInterval } from "../statistics.js";
import { numericColumns, columnValues } from "./shared.js";
import type { AnalyzerContext, AnalyzerOutput, Analyzer } from "./types.js";

export interface ColumnSummary {
  column: string;
  count: number;
  mean: number;
  median: number;
  stdDev: number;
  variance: number;
  min: number;
  max: number;
  q1: number;
  q3: number;
  confidenceInterval95: { lower: number; upper: number; marginOfError: number };
}

function round(n: number): number { return Math.round(n * 1000) / 1000; }

// Manual loop, not Math.min(...values)/Math.max(...values) — spreading a
// large array as call arguments risks a call-stack overflow well before a
// large dataset does (same rationale documented in statistics.ts's own
// arrMin/arrMax, which aren't exported for reuse here).
function minMax(values: number[]): { min: number; max: number } {
  let min = values[0], max = values[0];
  for (let i = 1; i < values.length; i++) { if (values[i] < min) min = values[i]; if (values[i] > max) max = values[i]; }
  return { min, max };
}

export const summaryAnalyzer: Analyzer<ColumnSummary[]> = {
  name: "summary",
  run(ctx: AnalyzerContext): AnalyzerOutput<ColumnSummary[]> {
    const data: ColumnSummary[] = [];

    for (const col of numericColumns(ctx.columns)) {
      const values = columnValues(ctx.rows, col.name);
      if (!values.length) continue;
      const { q1, median, q3 } = quartiles(values);
      const ci = confidenceInterval(values, 0.95);
      const { min, max } = minMax(values);
      data.push({
        column: col.name,
        count: values.length,
        mean: round(mean(values)),
        median: round(median),
        stdDev: round(stdDev(values)),
        variance: round(variance(values)),
        min,
        max,
        q1: round(q1),
        q3: round(q3),
        confidenceInterval95: { lower: round(ci.lower), upper: round(ci.upper), marginOfError: round(ci.marginOfError) },
      });
    }

    return {
      meta: { analyzer: "summary", algorithm: "mean/median/stdDev/quartiles + 95% t-based CI", sampleSize: ctx.rows.length },
      data,
    };
  },
};
