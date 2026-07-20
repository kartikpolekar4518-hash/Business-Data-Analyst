import type { Row } from "../parse.js";
import type { ColumnProfile } from "../profile.js";
import type { SchemaMap } from "../schema.js";

// Bump when an analyzer's math/behavior changes meaningfully — lets a stored
// or logged result be traced back to the engine version that produced it.
export const STATISTICAL_ENGINE_VERSION = "1.0.0";

export interface AnalyzerContext {
  rows: Row[];
  columns: ColumnProfile[];
  schema: SchemaMap;
}

// What an analyzer author returns — domain knowledge only (what ran, on how
// much data). Timing and engine version are cross-cutting and added once by
// the orchestrator, not duplicated in every analyzer.
export interface AnalyzerMeta {
  analyzer: string;
  algorithm: string;
  sampleSize: number;
}

export interface AnalyzerOutput<T> {
  meta: AnalyzerMeta;
  data: T;
}

export interface Analyzer<T = unknown> {
  name: string;
  run(ctx: AnalyzerContext): AnalyzerOutput<T>;
}

// What callers of the pipeline get back for each analyzer — the analyzer's
// own meta plus infra meta, and `error` set (data: null) if the analyzer
// threw, so one broken/future analyzer can never take down the others.
export interface AnalyzerResult<T> {
  meta: AnalyzerMeta & { engineVersion: string; executionTimeMs: number };
  data: T | null;
  error?: string;
}
