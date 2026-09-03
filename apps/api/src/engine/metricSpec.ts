// User-defined metrics, as data rather than code.
//
// Pack metrics (industries.ts) are JS closures, so they can only ever be written by a
// developer. This module is the storable counterpart: a MetricSpec is a small,
// declarative description of an aggregation that can live in the database, be edited by
// a user, and be compiled back into exactly the same PackMetric/KpiDef shapes the
// engine already consumes — so a custom metric works everywhere a built-in one does
// (dashboard, trends, rankings, forecasts, alerts, natural-language questions).
//
// Deliberately NOT an expression language. There is no parser, no eval, no arbitrary
// code path: a spec picks one of the five aggregation kinds the engine already
// understands, over one or two named fields, with at most one row filter. That keeps
// every custom metric deterministic, cheap to validate at the edge, and — crucially —
// describable, so `explainKpi` can print a real formula for it instead of throwing.

import type { Row } from "./parse.js";
import type { SchemaMap, Semantic } from "./schema.js";
import type { KpiDef, MetricKind, PackMetric } from "./industries.js";
import * as A from "./analytics.js";

export type MetricFormat = "money" | "number" | "percent";

/** Where a metric reads its numbers from: a literal column, or a detected business meaning. */
export interface MetricField {
  kind: "column" | "semantic";
  /** A column name for kind "column"; a Semantic key for kind "semantic". */
  name: string;
}

export type MetricOperator = "eq" | "ne" | "gt" | "gte" | "lt" | "lte";

/** An optional single-condition row filter, e.g. "only rows where region = West". */
export interface MetricFilter {
  field: MetricField;
  operator: MetricOperator;
  value: string | number;
}

export interface MetricSpec {
  /** Stable identifier used in URLs, alert rules and saved artifacts. */
  key: string;
  label: string;
  /** Reuses the engine's existing aggregation vocabulary so evidence works unchanged. */
  kind: MetricKind;
  format: MetricFormat;
  /** The field aggregated. Required for every kind except "count". */
  field?: MetricField;
  /** The divisor. Required for — and only used by — kind "ratio". */
  denominator?: MetricField;
  filter?: MetricFilter;
  /** Extra words that should match this metric in a natural-language question. */
  words?: string[];
}

export const METRIC_KINDS: MetricKind[] = ["sum", "avg", "count", "distinct", "ratio"];
export const METRIC_FORMATS: MetricFormat[] = ["money", "number", "percent"];
export const METRIC_OPERATORS: MetricOperator[] = ["eq", "ne", "gt", "gte", "lt", "lte"];

const KEY_PATTERN = /^[a-z][a-z0-9_]{0,39}$/;

/**
 * Structural validation, independent of any dataset. Returns a list of human-readable
 * problems — empty means valid. Kept here rather than in the route so the engine's own
 * tests can pin the rules, and so every entry point validates identically.
 */
export function validateMetricSpec(spec: MetricSpec): string[] {
  const errors: string[] = [];
  if (!KEY_PATTERN.test(spec.key ?? "")) {
    errors.push("Key must start with a letter and contain only lowercase letters, numbers and underscores.");
  }
  if (!spec.label?.trim()) errors.push("Label is required.");
  if (!METRIC_KINDS.includes(spec.kind)) errors.push(`Kind must be one of: ${METRIC_KINDS.join(", ")}.`);
  if (!METRIC_FORMATS.includes(spec.format)) errors.push(`Format must be one of: ${METRIC_FORMATS.join(", ")}.`);

  if (spec.kind === "count") {
    if (spec.field) errors.push("A count metric counts rows and takes no field.");
  } else if (!spec.field?.name) {
    errors.push(`A ${spec.kind} metric needs a field to aggregate.`);
  }

  if (spec.kind === "ratio") {
    if (!spec.denominator?.name) errors.push("A ratio metric needs a denominator.");
  } else if (spec.denominator) {
    errors.push("Only a ratio metric takes a denominator.");
  }

  if (spec.filter) {
    if (!spec.filter.field?.name) errors.push("A filter needs a field.");
    if (!METRIC_OPERATORS.includes(spec.filter.operator)) errors.push(`Filter operator must be one of: ${METRIC_OPERATORS.join(", ")}.`);
    if (spec.filter.value === undefined || spec.filter.value === null || spec.filter.value === "") {
      errors.push("A filter needs a value.");
    }
  }
  return errors;
}

/** The actual dataset column a field points at, or null when this dataset has no such column. */
export function resolveField(field: MetricField | undefined, s: SchemaMap): string | null {
  if (!field?.name) return null;
  if (field.kind === "semantic") return s[field.name as Semantic] ?? null;
  return field.name;
}

function fieldLabel(field: MetricField | undefined, s: SchemaMap): string {
  const col = resolveField(field, s);
  if (col) return col;
  return field ? `<${field.name} not found>` : "<no field>";
}

function compare(cell: unknown, operator: MetricOperator, value: string | number): boolean {
  // Numeric comparison when both sides look numeric, string equality otherwise. The
  // ordering operators are meaningless on text, so they are false rather than
  // silently comparing lexicographically.
  const rawCell = A.str(cell);
  const numericValue = typeof value === "number" ? value : Number(String(value).trim());
  const bothNumeric = rawCell !== "" && !Number.isNaN(Number(rawCell.replace(/[$€£₹,()]/g, ""))) && !Number.isNaN(numericValue);
  if (bothNumeric) {
    const a = A.num(cell), b = numericValue;
    switch (operator) {
      case "eq": return a === b;
      case "ne": return a !== b;
      case "gt": return a > b;
      case "gte": return a >= b;
      case "lt": return a < b;
      case "lte": return a <= b;
    }
  }
  const a = rawCell.toLowerCase(), b = String(value).trim().toLowerCase();
  if (operator === "eq") return a === b;
  if (operator === "ne") return a !== b;
  return false;
}

function applySpecFilter(rows: Row[], spec: MetricSpec, s: SchemaMap): Row[] {
  if (!spec.filter) return rows;
  const col = resolveField(spec.filter.field, s);
  // Fail closed, exactly as A.applyFilters does for an unmapped dimension: a filter
  // that cannot be resolved must exclude everything rather than silently widen the
  // metric to the whole dataset.
  if (!col) return [];
  return rows.filter((r) => compare(r[col], spec.filter!.operator, spec.filter!.value));
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const round1 = (n: number) => Math.round(n * 10) / 10;

const BLANK = (v: unknown) => v === null || v === undefined || (typeof v === "string" && v.trim() === "");

/** Evaluate a spec over rows. Pure, and never throws: a missing column yields 0. */
export function computeSpec(spec: MetricSpec, rows: Row[], s: SchemaMap): number {
  const scoped = applySpecFilter(rows, spec, s);
  if (spec.kind === "count") return scoped.length;

  const col = resolveField(spec.field, s);
  if (!col) return 0;

  if (spec.kind === "distinct") {
    const seen = new Set<string>();
    for (const r of scoped) { const v = A.str(r[col]); if (v) seen.add(v.toLowerCase()); }
    return seen.size;
  }

  if (spec.kind === "sum") {
    return round2(scoped.reduce((acc, r) => acc + A.num(r[col]), 0));
  }

  if (spec.kind === "avg") {
    // Blanks are excluded from the denominator rather than counted as zero, which
    // would drag the average toward 0 for every missing cell.
    let total = 0, n = 0;
    for (const r of scoped) { if (BLANK(r[col])) continue; total += A.num(r[col]); n++; }
    return n === 0 ? 0 : round2(total / n);
  }

  // ratio
  const denomCol = resolveField(spec.denominator, s);
  if (!denomCol) return 0;
  const numerator = scoped.reduce((acc, r) => acc + A.num(r[col]), 0);
  const denominator = scoped.reduce((acc, r) => acc + A.num(r[denomCol]), 0);
  if (denominator === 0) return 0;
  const ratio = numerator / denominator;
  return spec.format === "percent" ? round1(ratio * 100) : round2(ratio);
}

/** The formula string printed in the evidence panel. */
export function describeSpec(spec: MetricSpec, s: SchemaMap): string {
  const where = spec.filter
    ? ` WHERE ${fieldLabel(spec.filter.field, s)} ${spec.filter.operator.toUpperCase()} ${JSON.stringify(spec.filter.value)}`
    : "";
  const base =
    spec.kind === "count" ? "COUNT(rows)"
    : spec.kind === "distinct" ? `COUNT(DISTINCT ${fieldLabel(spec.field, s)})`
    : spec.kind === "sum" ? `SUM(${fieldLabel(spec.field, s)})`
    : spec.kind === "avg" ? `AVG(${fieldLabel(spec.field, s)})`
    : `SUM(${fieldLabel(spec.field, s)}) / SUM(${fieldLabel(spec.denominator, s)})${spec.format === "percent" ? " x 100" : ""}`;
  return base + where;
}

/** The dataset columns a spec reads, for the evidence panel's source list. */
export function specSources(spec: MetricSpec, s: SchemaMap): string[] {
  const cols = [resolveField(spec.field, s), resolveField(spec.denominator, s)];
  if (spec.filter) cols.push(resolveField(spec.filter.field, s));
  return [...new Set(cols.filter((c): c is string => !!c))];
}

/**
 * Compile to the analysis-metric shape used by trends, rankings, forecasts, drivers,
 * anomalies, correlations and the natural-language resolver.
 */
export function compileMetric(spec: MetricSpec): PackMetric {
  return {
    id: spec.key,
    label: spec.label,
    kind: spec.kind,
    format: spec.format,
    // The label's own words are always matchable, so "show me cost per order" finds a
    // metric called "Cost per order" without the user configuring synonyms.
    words: [...new Set([...(spec.words ?? []), ...spec.label.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2)])],
    compute: (rows, s) => computeSpec(spec, rows, s),
  };
}

/**
 * Compile to the dashboard-tile shape. Unlike a PackMetric this carries describe/sources,
 * which is what allows explainKpi to accept a custom metric — today it throws for
 * anything that is not one of the five built-in KpiDefs.
 */
export function compileKpiDef(spec: MetricSpec): KpiDef {
  return {
    key: spec.key,
    label: spec.label,
    icon: "custom",
    format: spec.format,
    kind: spec.kind,
    tooltip: `Custom metric defined by your organization.`,
    // A ratio has no meaningful period-over-period delta in this engine's KPI model
    // (the built-in margin KPI sets the same flag for the same reason).
    noChange: spec.kind === "ratio",
    countsRowsWhenUnmapped: spec.kind === "count",
    describe: (s) => describeSpec(spec, s),
    sources: (s) => specSources(spec, s),
    value: (rows, s) => computeSpec(spec, rows, s),
  };
}
