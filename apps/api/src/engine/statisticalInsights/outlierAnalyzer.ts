import { outliersByIQR } from "../statistics.js";
import { numericColumns, columnValues } from "./shared.js";
import type { AnalyzerContext, AnalyzerOutput, Analyzer } from "./types.js";

const SAMPLE_CAP = 20;

export interface ColumnOutliers {
  column: string;
  count: number;
  values: number[]; // capped sample — count reflects the true total
}

export const outlierAnalyzer: Analyzer<ColumnOutliers[]> = {
  name: "outliers",
  run(ctx: AnalyzerContext): AnalyzerOutput<ColumnOutliers[]> {
    const data: ColumnOutliers[] = [];

    for (const col of numericColumns(ctx.columns)) {
      const values = columnValues(ctx.rows, col.name);
      if (!values.length) continue;
      const indices = outliersByIQR(values);
      if (!indices.length) continue;
      data.push({ column: col.name, count: indices.length, values: indices.slice(0, SAMPLE_CAP).map((i) => values[i]) });
    }

    return {
      meta: { analyzer: "outliers", algorithm: "Tukey IQR fences (k=1.5)", sampleSize: ctx.rows.length },
      data,
    };
  },
};
