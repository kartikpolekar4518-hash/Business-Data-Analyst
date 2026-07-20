import { STATISTICAL_ENGINE_VERSION } from "./types.js";
import type { Analyzer, AnalyzerContext, AnalyzerResult } from "./types.js";
import { summaryAnalyzer } from "./summaryAnalyzer.js";
import { distributionAnalyzer } from "./distributionAnalyzer.js";
import { correlationAnalyzer } from "./correlationAnalyzer.js";
import { outlierAnalyzer } from "./outlierAnalyzer.js";
import { trendAnalyzer } from "./trendAnalyzer.js";

// The only file touched to register a new analyzer (forecasting, anomaly
// detection, seasonality, segmentation, Pareto, ...): add the import above
// and one entry below. Nothing else in this directory changes.
export const ANALYZERS: Analyzer[] = [summaryAnalyzer, distributionAnalyzer, correlationAnalyzer, outlierAnalyzer, trendAnalyzer];

function round(n: number): number { return Math.round(n * 1000) / 1000; }

// Runs every registered analyzer against the same context and merges their
// outputs keyed by name. One analyzer throwing never breaks the others — it
// surfaces as `error` on its own entry only. `analyzers` defaults to the
// real registry; selfcheck.ts overrides it to test the isolation contract
// with a throwaway fake analyzer without touching ANALYZERS itself.
export function runAnalyzers(ctx: AnalyzerContext, analyzers: Analyzer[] = ANALYZERS): Record<string, AnalyzerResult<unknown>> {
  const out: Record<string, AnalyzerResult<unknown>> = {};
  for (const analyzer of analyzers) {
    const start = performance.now();
    try {
      const { meta, data } = analyzer.run(ctx);
      out[analyzer.name] = { meta: { ...meta, engineVersion: STATISTICAL_ENGINE_VERSION, executionTimeMs: round(performance.now() - start) }, data };
    } catch (e) {
      out[analyzer.name] = {
        meta: { analyzer: analyzer.name, algorithm: "n/a", sampleSize: 0, engineVersion: STATISTICAL_ENGINE_VERSION, executionTimeMs: round(performance.now() - start) },
        data: null,
        error: e instanceof Error ? e.message : "Analyzer failed",
      };
    }
  }
  return out;
}
