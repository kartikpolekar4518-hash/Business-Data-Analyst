import { distributionSummary } from "../statistics.js";
import { numericColumns, columnValues } from "./shared.js";
import type { AnalyzerContext, AnalyzerOutput, Analyzer } from "./types.js";

export interface ColumnDistribution {
  column: string;
  count: number;
  skewness: number;
  kurtosis: number;
  shape: string;
}

function round(n: number): number { return Math.round(n * 1000) / 1000; }

// Also serves as the "Normality Summary" — distributionSummary's skewness/
// kurtosis-derived `shape` already classifies symmetric vs. skewed vs.
// heavy/light-tailed, which is what a normality summary is for here; no
// separate normality test needs implementing.
export const distributionAnalyzer: Analyzer<ColumnDistribution[]> = {
  name: "distribution",
  run(ctx: AnalyzerContext): AnalyzerOutput<ColumnDistribution[]> {
    const data: ColumnDistribution[] = [];

    for (const col of numericColumns(ctx.columns)) {
      const values = columnValues(ctx.rows, col.name);
      if (!values.length) continue;
      const d = distributionSummary(values);
      data.push({ column: col.name, count: values.length, skewness: round(d.skewness), kurtosis: round(d.kurtosis), shape: d.shape });
    }

    return {
      meta: { analyzer: "distribution", algorithm: "skewness/kurtosis shape classification", sampleSize: ctx.rows.length },
      data,
    };
  },
};
