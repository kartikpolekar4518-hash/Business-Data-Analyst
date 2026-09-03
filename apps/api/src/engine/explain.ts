import type { Row } from "./parse.js";
import type { SchemaMap, DetectionRules } from "./schema.js";
import * as A from "./analytics.js";
import { analyzeDrivers, type DriverResult } from "./drivers.js";
import type { IndustryPack, KpiDef, MetricKind } from "./industries.js";
import { canonicalJson, sha256 } from "./identity.js";
import { DEFAULT_CALENDAR, describeCalendar, isDefaultCalendar, normalizeCalendar, type CalendarConfig } from "./calendar.js";

// Deterministic evidence for one KPI: what formula ran, over which rows, against
// which comparison window, and under which dataset/engine/configuration identity.
//
// This module is a REPORTER, not a second implementation. The headline number is
// whatever A.computeKpis returned — explain never recomputes a metric itself, so the
// panel cannot drift from the dashboard. Everything else here describes inputs the
// engine already resolves internally but does not return.
//
// No LLM is involved at any point; every string below is templated from structured
// values the engine computed.

export type ExclusionReason =
  | "filter:date" | "filter:region" | "filter:state" | "filter:category"
  | "filter:department" | "filter:product" | "filter:customer"
  | "missing_value" | "non_numeric_value";

export interface Exclusion { reason: ExclusionReason; count: number; }

export interface ExplainInputs {
  kind: MetricKind;
  rowsInDataset: number;
  rowsAfterFilters: number;
  rowsIncluded: number;
  exclusions: Exclusion[];
  note: string;
}

export interface ExplainComparison {
  basis: A.ComparisonBasis;
  reason: A.ComparisonReason | null;
  currentSource: A.CurrentSource | null;
  currentRange: [string, string] | null;
  previousRange: [string, string] | null;
  currentValue: number | null;
  previousValue: number | null;
  changePct: number | null;
  description: string;
}

export interface ExplainProvenance {
  datasetId: string; datasetName: string; fileName: string; rowCount: number;
  datasetHash: string | null; rawFileHash: string | null;
  engineVersion: string | null; industryKey: string;
  cleaning: { type: string; column: string | null; affectedRows: number }[];
  calculationFingerprint: string;
}

// Claim levels NoPS can actually support. Deliberately excludes "verified" and
// "audited": determinism proves repeatability, not business correctness, and no
// independent execution or external verifier exists.
export interface ExplainClaims {
  deterministic: true;
  reconciles: boolean | null;          // null when there is no comparison to reconcile
  reproducibleFromCurrentData: boolean;
  historicallyReproducible: false;
  independentlyVerified: false;
}

export interface Explanation {
  metric: { key: string; label: string; format: "money" | "number" | "percent"; kind: MetricKind; value: number; changePct: number | null };
  formula: { expression: string; sources: { column: string; detectedBy: string | null }[]; derived: boolean };
  inputs: ExplainInputs;
  filters: Record<string, string | string[]>;
  comparison: ExplainComparison;
  drivers: DriverResult | null;
  provenance: ExplainProvenance;
  claims: ExplainClaims;
}

export interface ExplainInput {
  rows: Row[]; schema: SchemaMap; pack: IndustryPack; metricKey: string; filters: A.Filters;
  detectionRules?: DetectionRules;
  dataset: { id: string; name: string; fileName: string; rowCount: number; datasetHash: string | null; rawFileHash: string | null; engineVersion: string | null; cleaning: { type: string; column: string | null; affectedRows: number }[] };
  industryKey: string;
  /** The org's business calendar. Omitted means the Gregorian default. */
  calendar?: CalendarConfig;
}

const BLANK = (v: unknown) => v === null || v === undefined || (typeof v === "string" && v.trim() === "");
const NUMERIC = (v: unknown) => {
  if (typeof v === "number") return isFinite(v);
  if (typeof v !== "string") return false;
  const cleaned = v.replace(/[$€£₹,()]/g, "").trim();
  return cleaned !== "" && /\d/.test(cleaned) && isFinite(Number(cleaned));
};

// Filters applied one at a time, in a fixed order, so the drop at each step
// partitions cleanly instead of double-counting overlapping predicates.
const FILTER_STEPS: { key: keyof A.Filters | "date"; reason: ExclusionReason }[] = [
  { key: "date", reason: "filter:date" },
  { key: "region", reason: "filter:region" }, { key: "state", reason: "filter:state" },
  { key: "category", reason: "filter:category" }, { key: "department", reason: "filter:department" },
  { key: "product", reason: "filter:product" }, { key: "customer", reason: "filter:customer" },
];

function cascadeFilters(rows: Row[], s: SchemaMap, f: A.Filters): { rows: Row[]; exclusions: Exclusion[] } {
  const exclusions: Exclusion[] = [];
  let cur = rows;
  for (const step of FILTER_STEPS) {
    const only: A.Filters = {};
    if (step.key === "date") { if (!f.dateFrom && !f.dateTo) continue; only.dateFrom = f.dateFrom; only.dateTo = f.dateTo; }
    else { const v = f[step.key as keyof A.Filters]; if (v === undefined) continue; (only as Record<string, unknown>)[step.key] = v; }
    const after = A.applyFilters(cur, s, only);
    const dropped = cur.length - after.length;
    if (dropped > 0) exclusions.push({ reason: step.reason, count: dropped });
    cur = after;
  }
  return { rows: cur, exclusions };
}

// Value-level inclusion, shaped by what the metric actually does. A SUM reports
// rows whose source values are usable; a DISTINCT reports rows carrying a value.
// Neither is described as "rows contributing a non-zero value" — a legitimate 0 is
// included data, not an exclusion.
function valueInputs(kind: MetricKind, rows: Row[], sources: string[], countsRowsWhenUnmapped: boolean): { included: number; exclusions: Exclusion[]; note: string } {
  if (!sources.length) {
    return countsRowsWhenUnmapped
      ? { included: rows.length, exclusions: [], note: `No distinct key column detected, so every row counts as one: ${rows.length.toLocaleString()} rows.` }
      : { included: 0, exclusions: [], note: "No source column detected for this metric, so it evaluates to 0." };
  }
  let missing = 0, nonNumeric = 0;
  if (kind === "sum" || kind === "avg" || kind === "ratio") {
    for (const r of rows) {
      const vals = sources.map((c) => r[c]);
      if (vals.every(BLANK)) { missing++; continue; }
      if (vals.some((v) => !BLANK(v) && !NUMERIC(v))) nonNumeric++;
    }
    const included = rows.length - missing - nonNumeric;
    const exclusions: Exclusion[] = [];
    if (missing) exclusions.push({ reason: "missing_value", count: missing });
    if (nonNumeric) exclusions.push({ reason: "non_numeric_value", count: nonNumeric });
    const note = kind === "ratio"
      ? `Ratio of two totals over ${rows.length.toLocaleString()} rows; a row counts toward both components.`
      : `${included.toLocaleString()} rows carried a usable numeric value in ${sources.join(", ")}. Rows valued 0 are included.`;
    return { included, exclusions, note };
  }
  // distinct / count
  for (const r of rows) if (sources.every((c) => BLANK(r[c]))) missing++;
  const included = rows.length - missing;
  const uniq = new Set<string>();
  for (const r of rows) { const v = A.str(r[sources[0]]); if (v) uniq.add(v); }
  return {
    included,
    exclusions: missing ? [{ reason: "missing_value", count: missing }] : [],
    note: kind === "distinct"
      ? `${uniq.size.toLocaleString()} distinct values of ${sources[0]} across ${included.toLocaleString()} rows.`
      : `${included.toLocaleString()} rows counted.`,
  };
}

function describeComparison(split: A.PeriodSplit, calendar: CalendarConfig): string {
  // The comparison window itself is still duration-based and calendar-agnostic (see the
  // policy comment in analytics.splitPeriods). The calendar governs how rows are
  // bucketed into the periods a trend is drawn from, so it is stated separately rather
  // than implied — claiming the comparison is fiscal-aware would be false.
  const calendarNote = isDefaultCalendar(calendar) ? "" : ` Periods are bucketed by: ${describeCalendar(calendar)}`;
  if (split.basis === "unavailable") {
    const why = split.reason === "no_date_column" ? "No date column detected — no comparison period."
      : split.reason === "no_prior_data" ? "No data exists for the preceding period of equal length."
      : "Not enough dated history for a comparison.";
    return why + calendarNote;
  }
  const [cs, ce] = split.currentRange!, [ps, pe] = split.previousRange!;
  const how = split.currentSource === "filter" ? "your selected range" : "the most recent half of the available data";
  return `${cs} to ${ce} (${how}) compared with ${ps} to ${pe}, the interval of equal length immediately before it.` + calendarNote;
}

// The fingerprint identifies the CALCULATION, not the request: filters are
// normalised (empties dropped, multi-values sorted) so two different UI routes that
// resolve to the same effective calculation fingerprint identically, and anything
// UI-only (chart type, pagination, sort, formatting) is excluded by construction.
const ANALYTICAL_FILTER_KEYS = ["dateFrom", "dateTo", "region", "state", "category", "department", "product", "customer"] as const;

export function normalizeFilters(f: A.Filters): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  // Allowlist: anything not an analytical filter (chart type, pagination, sort,
  // formatting) cannot reach the fingerprint even if a caller passes it through.
  for (const k of ANALYTICAL_FILTER_KEYS) {
    const v = (f as Record<string, unknown>)[k] as string | string[] | undefined;
    if (v === undefined || v === null || v === "") continue;
    if (Array.isArray(v)) { const vals = v.filter((x) => x !== "").slice().sort(); if (vals.length) out[k] = vals; }
    else out[k] = v;
  }
  return out;
}

export function calculationFingerprint(input: {
  datasetHash: string | null; engineVersion: string | null; industryKey: string;
  metricKey: string; filters: A.Filters; comparisonBasis: A.ComparisonBasis;
  currentRange: [string, string] | null; previousRange: [string, string] | null;
  schemaSources: string[]; calendar?: CalendarConfig;
}): string {
  const calendar = normalizeCalendar(input.calendar);
  return sha256(canonicalJson({
    datasetHash: input.datasetHash,
    engineVersion: input.engineVersion,
    industryKey: input.industryKey,
    // Placeholder: industry packs are code-defined today, so engineVersion already
    // pins them. This becomes a real hash the day pack thresholds/KPI definitions
    // are database-editable per organization.
    industryConfigHash: null,
    // The business calendar IS database-editable per organization and changes which
    // rows land in which period, so it must be part of the identity of a number.
    // The default is emitted as null so fingerprints computed before business
    // calendars existed stay stable for orgs that never set one.
    calendar: isDefaultCalendar(calendar) ? null : calendar,
    metric: input.metricKey,
    schemaSources: input.schemaSources,
    filters: normalizeFilters(input.filters),
    comparison: { basis: input.comparisonBasis, current: input.currentRange, previous: input.previousRange },
  }));
}

export function explainKpi(input: ExplainInput): Explanation {
  const { rows, schema: s, pack, metricKey, filters, dataset, industryKey } = input;
  const calendar = normalizeCalendar(input.calendar ?? DEFAULT_CALENDAR);
  const def: KpiDef | undefined = pack.kpis.find((k) => k.key === metricKey);
  if (!def) throw new RangeError(`Unsupported metric: ${metricKey}`);

  // Single source of truth: the headline number IS the dashboard's number, taken
  // from the same function the dashboard calls, with the same arguments.
  const kpi = A.computeKpis(rows, s, pack, filters).find((k) => k.key === metricKey)!;

  const sources = def.sources(s);
  const split = A.splitPeriods(rows, s, filters);
  const { rows: filtered, exclusions: filterExclusions } = cascadeFilters(rows, s, filters);
  const value = valueInputs(def.kind, filtered, sources, def.countsRowsWhenUnmapped === true);

  const comparable = split.basis === "trailing_equal_period";
  const currentValue = comparable ? round(def.value(split.current, s)) : null;
  const previousValue = comparable ? round(def.value(split.previous, s)) : null;

  // Attribution only makes sense for additive metrics; a ratio or distinct count
  // cannot be summed across dimension members.
  const drivers = comparable && def.kind === "sum" ? analyzeDrivers(rows, s, metricKey, undefined, filters) : null;

  return {
    metric: { key: def.key, label: def.label, format: def.format, kind: def.kind, value: kpi.value, changePct: kpi.changePct },
    formula: {
      expression: def.describe(s),
      sources: sources.map((c) => ({ column: c, detectedBy: input.detectionRules?.[c] ?? null })),
      derived: sources.length > 1,
    },
    inputs: {
      kind: def.kind,
      rowsInDataset: rows.length,
      rowsAfterFilters: filtered.length,
      rowsIncluded: value.included,
      exclusions: [...filterExclusions, ...value.exclusions],
      note: value.note,
    },
    filters: normalizeFilters(filters),
    comparison: {
      basis: split.basis, reason: split.reason, currentSource: split.currentSource,
      currentRange: split.currentRange, previousRange: split.previousRange,
      currentValue, previousValue,
      changePct: def.noChange ? null : kpi.changePct,
      description: describeComparison(split, calendar),
    },
    drivers,
    provenance: {
      datasetId: dataset.id, datasetName: dataset.name, fileName: dataset.fileName, rowCount: dataset.rowCount,
      datasetHash: dataset.datasetHash, rawFileHash: dataset.rawFileHash,
      engineVersion: dataset.engineVersion, industryKey,
      cleaning: dataset.cleaning,
      calculationFingerprint: calculationFingerprint({
        datasetHash: dataset.datasetHash, engineVersion: dataset.engineVersion, industryKey,
        metricKey, filters, comparisonBasis: split.basis,
        currentRange: split.currentRange, previousRange: split.previousRange,
        schemaSources: sources, calendar,
      }),
    },
    claims: {
      deterministic: true,
      reconciles: drivers ? drivers.reconciled : null,
      reproducibleFromCurrentData: dataset.datasetHash !== null,
      historicallyReproducible: false,
      independentlyVerified: false,
    },
  };
}

function round(n: number): number { return Math.round(n * 100) / 100; }
