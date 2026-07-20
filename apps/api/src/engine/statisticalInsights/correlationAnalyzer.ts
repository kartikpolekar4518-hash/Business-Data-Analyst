import { correlationMatrix, studentTCDF } from "../statistics.js";
import { numericColumns } from "./shared.js";
import { num, str } from "../analytics.js";
import type { AnalyzerContext, AnalyzerOutput, Analyzer } from "./types.js";

export type CorrelationStrength = "negligible" | "weak" | "moderate" | "strong" | "very strong";

export interface CorrelationPair {
  columnA: string;
  columnB: string;
  r: number;
  strength: CorrelationStrength;
  n: number;
  pValue: number | null;
  significant: boolean;
}

function strengthOf(r: number): CorrelationStrength {
  const abs = Math.abs(r);
  if (abs < 0.1) return "negligible";
  if (abs < 0.3) return "weak";
  if (abs < 0.5) return "moderate";
  if (abs < 0.7) return "strong";
  return "very strong";
}

function round(n: number): number { return Math.round(n * 1000) / 1000; }

// r -> t -> p, using the already-exported Student-t CDF (df = n-2). Standard
// textbook transform for testing significance of a Pearson correlation —
// composes an existing primitive, not new statistical math.
function significanceOf(r: number, n: number): { pValue: number | null; significant: boolean } {
  if (n <= 2) return { pValue: null, significant: false };
  if (Math.abs(r) >= 1) return { pValue: 0, significant: true }; // perfect correlation: definitionally significant, t is undefined
  const t = r * Math.sqrt((n - 2) / (1 - r * r));
  const pValue = round(2 * (1 - studentTCDF(Math.abs(t), n - 2)));
  return { pValue, significant: pValue < 0.05 };
}

export const correlationAnalyzer: Analyzer<CorrelationPair[]> = {
  name: "correlation",
  run(ctx: AnalyzerContext): AnalyzerOutput<CorrelationPair[]> {
    const cols = numericColumns(ctx.columns).map((c) => c.name);
    if (cols.length < 2) {
      return { meta: { analyzer: "correlation", algorithm: "pearson correlation matrix", sampleSize: 0 }, data: [] };
    }

    // Listwise deletion: only rows where every numeric column has a value,
    // so the per-column vectors stay row-aligned. correlationMatrix assumes
    // vectors[c][i] is the same row across every column — independently
    // dropping blanks per column would silently break that assumption.
    const complete = ctx.rows.filter((r) => cols.every((c) => str(r[c]) !== ""));
    const vectors: Record<string, number[]> = {};
    for (const c of cols) vectors[c] = complete.map((r) => num(r[c]));

    const { labels, matrix } = correlationMatrix(vectors);
    const n = complete.length;
    const data: CorrelationPair[] = [];
    for (let i = 0; i < labels.length; i++) {
      for (let j = i + 1; j < labels.length; j++) {
        const r = matrix[i][j];
        const { pValue, significant } = significanceOf(r, n);
        data.push({ columnA: labels[i], columnB: labels[j], r: round(r), strength: strengthOf(r), n, pValue, significant });
      }
    }

    return {
      meta: { analyzer: "correlation", algorithm: "pearson correlation matrix + t-test significance", sampleSize: n },
      data,
    };
  },
};
