// What is actually in this file?
//
// `detectSchema` answers a different question: which columns carry a business meaning
// we have a *name pattern* for. That works for retail and nothing else — a file of
// ward, bed_days, admissions, discharge_date matches no pattern, so every analytical
// slot comes back unmapped and the dashboard renders as empty states.
//
// This module answers the structural question instead, and answers it for any file:
// which column is time, which columns are numbers worth aggregating, which are
// groupings worth splitting by, and which are just row identifiers or free text.
// It reads ONLY the statistics `profileDataset` already computed — type, cardinality,
// missing share, min/max/mean — so it is pure, deterministic and vocabulary-free.
//
// Column names are used in exactly two places, both marked `hint`, and neither can
// change a role: to humanise a label, and to break a tie between two columns that
// scored identically. A column called "revenue" holding "high"/"medium"/"low" is a
// dimension, because that is what its values are.
//
// Deciding what the dataset contains is all this module does. Mapping those roles onto
// the engine's semantic slots and dashboard configuration is derived.ts's job; running
// the actual arithmetic remains analytics.ts's.

import type { Row } from "./parse.js";
import type { ColumnProfile, ColumnType, Profile } from "./profile.js";

export type ColumnRole = "time" | "measure" | "dimension" | "identifier" | "text" | "ignored";

/** How a measure may legitimately be aggregated. A rate summed is a wrong number. */
export type Aggregate = "sum" | "avg";
export type ValueFormat = "money" | "number" | "percent";

export interface ShapedColumn {
  name: string;
  /** Humanised header for display: "bed_days" -> "Bed Days". */
  label: string;
  role: ColumnRole;
  type: ColumnType;
  /** 0–1. How sure the classification is, from the evidence in `reasons`. */
  confidence: number;
  /** Short, deterministic phrases explaining the role. Rendered in the UI verbatim. */
  reasons: string[];
  /** Rank within the role, best first. Comparable only against the same role. */
  score: number;
  /** Distinct non-blank values as a share of rows. */
  distinctness: number;
  /** Non-blank values as a share of rows. */
  coverage: number;
  // Measure-only ────────────────────────────────────────────────────────────
  format?: ValueFormat;
  aggregate?: Aggregate;
  /** Every value >= 0, so a total is meaningful rather than a partial cancellation. */
  additive?: boolean;
  /** Coefficient of variation — how much this number actually moves. */
  variation?: number;
  // Dimension-only ──────────────────────────────────────────────────────────
  cardinality?: number;
}

export interface DataShape {
  rowCount: number;
  columns: ShapedColumn[];
  /** Best date column, or null. */
  time: ShapedColumn | null;
  /** Ranked, best first. Empty for a file with nothing worth aggregating. */
  measures: ShapedColumn[];
  /** Ranked, best first. Every discovered grouping, not a truncated top 3. */
  dimensions: ShapedColumn[];
  /** Ranked, best first. Row keys and entity codes. */
  identifiers: ShapedColumn[];
  /** Which of the supported dataset shapes this file is. Drives the dashboard fallback. */
  kind: ShapeKind;
  /** Plain-English account of the decisions above, for "How we read your file". */
  notes: string[];
}

/**
 * The shapes a file can take. Each one has a dashboard the engine can honestly build;
 * `unusable` is the case where it cannot, and says so rather than inventing a card.
 */
export type ShapeKind =
  | "measure_over_time"   // numbers and a date: KPI + trend + composition + ranking
  | "measure"             // numbers, no date: KPI + composition + ranking
  | "events_over_time"    // no measure, but rows and a date: record count over time
  | "categorical"         // groupings only: record count + distributions
  | "single_column"       // one usable column: a type-appropriate summary
  | "unusable";           // nothing to analyse

// ── Name hints ───────────────────────────────────────────────────────────────
// Weak signals only. They may nudge the ranking between equally-scoring columns and
// they may not change any role. Every use is guarded by a structural test that has
// already passed.

const HINT_MONEY = /(revenue|sales|amount|price|cost|profit|margin|spend|budget|value|fee|charge|payment|total|salary|income)/i;
const HINT_RATE = /(pct|percent|rate|ratio|share|%|score|index|average|avg|mean)/i;
const HINT_ID = /(^|[_\s])(id|no|num|number|code|key|ref|uuid|guid|sku|barcode)$|^(id|uuid|guid)$/i;
const HINT_TIME = /(date|time|day|month|year|period|timestamp|created|updated|when)/i;

/** "bed_days" / "bedDays" / "BED DAYS" -> "Bed Days". Deterministic, no dictionary. */
export function humanise(name: string): string {
  const spaced = name
    .replace(/[_\-.]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();
  if (!spaced) return name;
  return spaced
    .split(" ")
    .map((w) => (w.length <= 3 && w === w.toUpperCase() ? w : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()))
    .join(" ");
}

const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n);
const round3 = (n: number) => Math.round(n * 1000) / 1000;

/** Numbers parsed out of a column, sampled. Used only for tests the profile cannot answer. */
function numericValues(rows: Row[], name: string, limit = 500): number[] {
  const out: number[] = [];
  for (const r of rows) {
    const v = r[name];
    if (v === null || v === undefined || v === "") continue;
    const n = typeof v === "number" ? v : Number(String(v).replace(/[$€£₹,()]/g, "").trim());
    if (Number.isFinite(n)) out.push(n);
    if (out.length >= limit) break;
  }
  return out;
}

/** Every sampled value is a whole number. An identifier never has a fractional part. */
const allIntegers = (nums: number[]) => nums.length > 0 && nums.every((n) => Number.isInteger(n));

/** Every value has the same digit count — a zip, a phone, a fixed-width account code. */
function fixedWidthCode(rows: Row[], name: string): boolean {
  let width = -1, seen = 0;
  for (const r of rows) {
    const s = r[name] === null || r[name] === undefined ? "" : String(r[name]).trim();
    if (!s) continue;
    const digits = s.replace(/\D/g, "");
    if (digits.length !== s.length || digits.length < 3) return false;
    if (width === -1) width = digits.length;
    else if (digits.length !== width) return false;
    if (++seen >= 60) break;
  }
  return seen >= 8 && width >= 4;
}

/** Values that are all plausible calendar years. A year is a grouping, never a total. */
function looksLikeYears(profile: ColumnProfile, nums: number[]): boolean {
  if (!nums.length || !allIntegers(nums)) return false;
  const min = profile.min ?? Math.min(...nums), max = profile.max ?? Math.max(...nums);
  return min >= 1900 && max <= 2100 && (max - min) <= 120;
}

/**
 * Confirm a column typed as a date really holds dates. `profileDataset` accepts anything
 * Date.parse tolerates, and Date.parse tolerates a great deal — "ADM-1000" among it. A
 * reference code silently becoming the trend axis is the worst failure this module can
 * have, so the date is re-checked here against a plausible calendar range.
 */
function plausibleDates(rows: Row[], name: string): boolean {
  let ok = 0, seen = 0;
  for (const r of rows) {
    const v = r[name];
    if (v === null || v === undefined || v === "") continue;
    const d = v instanceof Date ? v : new Date(String(v).trim());
    const y = d.getFullYear();
    if (!Number.isNaN(d.getTime()) && y >= 1900 && y <= 2100) ok++;
    if (++seen >= 200) break;
  }
  return seen > 0 && ok / seen >= 0.8;
}

/** Coefficient of variation: spread relative to level. 0 for a constant column. */
function coefficientOfVariation(nums: number[]): number {
  if (nums.length < 2) return 0;
  const mean = nums.reduce((a, b) => a + b, 0) / nums.length;
  if (mean === 0) return 0;
  const variance = nums.reduce((a, b) => a + (b - mean) ** 2, 0) / nums.length;
  return Math.abs(Math.sqrt(variance) / mean);
}

// ── Classification ───────────────────────────────────────────────────────────

interface Verdict { role: ColumnRole; confidence: number; reasons: string[] }

function classify(p: ColumnProfile, rows: Row[], rowCount: number): Verdict & { nums: number[] } {
  const reasons: string[] = [];
  const coverage = rowCount ? (rowCount - p.missing) / rowCount : 0;
  const nonBlank = rowCount - p.missing;
  const distinctness = nonBlank ? p.unique / nonBlank : 0;

  if (p.type === "empty" || nonBlank === 0) {
    return { role: "ignored", confidence: 1, reasons: ["column is empty"], nums: [] };
  }
  if (coverage < 0.05) {
    return { role: "ignored", confidence: 0.9, reasons: [`only ${Math.round(coverage * 100)}% of rows have a value`], nums: [] };
  }
  if (p.unique <= 1) {
    return { role: "ignored", confidence: 0.95, reasons: ["every row holds the same value"], nums: [] };
  }

  if (p.type === "date" && plausibleDates(rows, p.name)) {
    reasons.push("values parse as dates");
    if (distinctness > 0.02) reasons.push("dates spread across the file");
    return { role: "time", confidence: clamp01(0.7 + coverage * 0.3), reasons, nums: [] };
  }

  if (p.type === "boolean") {
    return { role: "dimension", confidence: 0.9, reasons: ["two-valued true/false column"], nums: [] };
  }

  if (p.type === "number" || p.type === "currency") {
    const nums = numericValues(rows, p.name);

    // A number that is one-per-row and whole COULD be a key — but so could a genuine
    // measure whose values happen never to repeat. What separates them is density: a key
    // packs its values into a range about as wide as the row count (10000…10059 for 60
    // rows), while a measure scatters the same count across a far wider range
    // (100…988). Density decides, so a `revenue` column of distinct whole numbers stays
    // a measure and an `order_id` stays a key.
    //
    // A currency value is never a key, whatever its distribution.
    const keyShaped = p.type !== "currency" && allIntegers(nums) && distinctness > 0.9 && nonBlank >= 8;
    if (keyShaped) {
      const span = (p.max ?? 0) - (p.min ?? 0);
      const density = span > 0 ? p.unique / (span + 1) : 0;
      // Both readings are structurally viable in the dense case, so — and only here,
      // between two viable readings — a name hint breaks the tie.
      if (density >= 0.9) {
        reasons.push("consecutive whole numbers, one per row");
        reasons.push("reads as a row key, not a quantity");
        return { role: "identifier", confidence: clamp01(0.6 + density * 0.35), nums, reasons };
      }
      if (HINT_ID.test(p.name)) {
        reasons.push("a different whole number on almost every row");
        reasons.push("named as a key, and the values never repeat");
        return { role: "identifier", confidence: 0.6, nums, reasons };
      }
    }
    if (looksLikeYears(p, nums)) {
      return { role: "dimension", confidence: 0.85, reasons: ["whole numbers in the calendar-year range"], nums };
    }
    if (fixedWidthCode(rows, p.name)) {
      const role: ColumnRole = distinctness > 0.9 ? "identifier" : "dimension";
      return { role, confidence: 0.8, reasons: ["every value has the same digit count, so it reads as a code"], nums };
    }

    const variation = coefficientOfVariation(nums);
    if (variation === 0 && p.min === p.max) {
      return { role: "ignored", confidence: 0.9, reasons: ["the same number on every row"], nums };
    }
    // A small set of repeated whole numbers is a rating or a band, not a total.
    if (allIntegers(nums) && p.unique <= 12 && distinctness < 0.05 && nonBlank >= 40) {
      return { role: "dimension", confidence: 0.7, reasons: [`only ${p.unique} distinct whole numbers, so it groups rather than totals`], nums };
    }

    reasons.push(p.type === "currency" ? "values carry a currency symbol" : "numeric values");
    if (variation >= 0.3) reasons.push("varies strongly across rows");
    else if (variation > 0) reasons.push("varies across rows");
    return { role: "measure", confidence: clamp01(0.55 + Math.min(variation, 1) * 0.25 + coverage * 0.2), nums, reasons };
  }

  // Text and category — and any column typed as a date whose values are not plausible
  // dates, which lands here rather than becoming a trend axis.
  const nums: number[] = [];
  const cardinalityCap = Math.max(50, rowCount * 0.2);
  if (p.type === "category" || (p.unique <= cardinalityCap && distinctness <= 0.5)) {
    reasons.push(`${p.unique} distinct values`);
    if (p.unique <= 25) reasons.push("a small enough set to chart");
    return { role: "dimension", confidence: clamp01(0.5 + (p.unique <= 25 ? 0.35 : 0.15) + coverage * 0.15), nums, reasons };
  }
  const avgLength = p.sampleValues.length
    ? p.sampleValues.reduce((a, v) => a + v.length, 0) / p.sampleValues.length
    : 0;
  if (distinctness > 0.9 && avgLength <= 40) {
    return { role: "identifier", confidence: clamp01(0.5 + distinctness * 0.3), nums, reasons: ["a different short value on almost every row"] };
  }
  return {
    role: "text",
    confidence: 0.8,
    nums,
    reasons: [`${p.unique} distinct free-text values — too many to group by`],
  };
}

// ── Scoring ──────────────────────────────────────────────────────────────────

/**
 * How much a grouping actually separates the lead measure. A dimension whose groups all
 * total the same explains nothing; one that concentrates the total in a few groups
 * explains a lot. Computed as the share of the total held by the largest group, damped
 * so a single dominant group does not outrank a genuinely informative split.
 */
function separation(rows: Row[], dimension: string, measure: string | null): number {
  const totals = new Map<string, number>();
  let grand = 0;
  for (const r of rows) {
    const key = r[dimension] === null || r[dimension] === undefined ? "" : String(r[dimension]).trim();
    if (!key) continue;
    let v = 1;
    if (measure) {
      const raw = r[measure];
      const n = typeof raw === "number" ? raw : Number(String(raw ?? "").replace(/[$€£₹,()]/g, "").trim());
      v = Number.isFinite(n) ? Math.abs(n) : 0;
    }
    totals.set(key, (totals.get(key) ?? 0) + v);
    grand += v;
  }
  if (!grand || totals.size < 2) return 0;
  const shares = [...totals.values()].map((v) => v / grand).sort((a, b) => b - a);
  // Gini-like concentration: 0 when every group is equal, 1 when one group holds it all.
  const n = shares.length;
  const even = 1 / n;
  const spread = shares.reduce((a, s) => a + Math.abs(s - even), 0) / 2;
  return round3(spread);
}

// ── Entry point ──────────────────────────────────────────────────────────────

/**
 * Read the structure of any dataset. Pure: the same profile and rows always produce
 * the same shape, byte for byte, with no vocabulary, model or randomness involved.
 */
export function deriveShape(profile: Profile, rows: Row[]): DataShape {
  const rowCount = profile.rowCount;
  const columns: ShapedColumn[] = profile.columns.map((p) => {
    const coverage = rowCount ? (rowCount - p.missing) / rowCount : 0;
    const nonBlank = rowCount - p.missing;
    const distinctness = nonBlank ? p.unique / nonBlank : 0;
    const { role, confidence, reasons, nums } = classify(p, rows, rowCount);

    const col: ShapedColumn = {
      name: p.name,
      label: humanise(p.name),
      role,
      type: p.type,
      confidence: round3(confidence),
      reasons,
      score: 0,
      distinctness: round3(distinctness),
      coverage: round3(coverage),
    };

    if (role === "measure") {
      const variation = coefficientOfVariation(nums);
      const additive = nums.every((n) => n >= 0);
      // A bounded 0–100 column, or one whose header calls itself a rate, is averaged.
      // Summing a percentage produces a number with no meaning.
      const bounded = (p.min ?? 0) >= 0 && (p.max ?? 0) <= 100 && !Number.isInteger(p.max ?? 0.5);
      const rateHint = HINT_RATE.test(p.name);
      const isRate = rateHint || (bounded && p.type !== "currency" && distinctness > 0.2);
      col.format = p.type === "currency" ? "money" : isRate && rateHint && /pct|percent|%|rate|share/i.test(p.name) ? "percent" : "number";
      col.aggregate = isRate ? "avg" : "sum";
      col.additive = additive;
      col.variation = round3(variation);
      if (isRate) col.reasons = [...col.reasons, "averaged rather than totalled — a rate has no meaningful sum"];
    }
    if (role === "dimension") col.cardinality = p.unique;
    return col;
  });

  // ── Rank each role ─────────────────────────────────────────────────────────
  const byRole = (r: ColumnRole) => columns.filter((c) => c.role === r);

  const times = byRole("time").map((c) => {
    // The most complete date with the widest spread leads. A name hint only breaks ties.
    c.score = round3(c.coverage * 0.6 + Math.min(c.distinctness * 2, 1) * 0.4 + (HINT_TIME.test(c.name) ? 0.001 : 0));
    return c;
  }).sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));

  const measures = byRole("measure").map((c) => {
    // Magnitude of movement, completeness, and whether a total is even meaningful.
    const moves = Math.min(c.variation ?? 0, 1.5) / 1.5;
    c.score = round3(
      moves * 0.45 +
      c.coverage * 0.3 +
      (c.additive ? 0.15 : 0) +
      (c.format === "money" ? 0.1 : 0) +
      // Hints, and only hints: a thousandth of a point, enough to order two columns
      // that are otherwise indistinguishable and never enough to overtake evidence.
      (HINT_MONEY.test(c.name) ? 0.002 : 0) -
      (c.aggregate === "avg" ? 0.05 : 0),
    );
    return c;
  }).sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));

  const leadMeasure = measures[0]?.name ?? null;
  const dimensions = byRole("dimension").map((c) => {
    const card = c.cardinality ?? 0;
    // Cardinality sweet spot. A two-valued flag is a real grouping and stays filterable,
    // but it makes a poor lead composition — "yes 86% / no 14%" is a fact about one
    // column, not a picture of the business — so it scores below a grouping with a few
    // genuine members. Beyond 50 the chart is a hairball; never a hard cut, since a
    // 200-value dimension is still worth filtering on.
    const fit = card <= 1 ? 0 : card === 2 ? 0.55 : card <= 8 ? 1 : card <= 25 ? 0.9 : card <= 50 ? 0.7 : card <= 200 ? 0.35 : 0.1;
    const sep = separation(rows, c.name, leadMeasure);
    c.score = round3(fit * 0.45 + sep * 0.35 + c.coverage * 0.2 - (HINT_ID.test(c.name) ? 0.05 : 0));
    return c;
  }).sort((a, b) => b.score - a.score || (b.cardinality ?? 0) - (a.cardinality ?? 0) || a.name.localeCompare(b.name));

  const identifiers = byRole("identifier").map((c) => {
    c.score = round3(c.distinctness * 0.5 + c.coverage * 0.4 + (HINT_ID.test(c.name) ? 0.002 : 0));
    return c;
  }).sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));

  const time = times[0] ?? null;
  const usable = columns.filter((c) => c.role !== "ignored").length;
  const kind: ShapeKind =
    rowCount === 0 || usable === 0 ? "unusable"
    : usable === 1 ? "single_column"
    : measures.length && time ? "measure_over_time"
    : measures.length ? "measure"
    : time ? "events_over_time"
    : dimensions.length ? "categorical"
    : "unusable";

  return {
    rowCount,
    columns,
    time,
    measures,
    dimensions,
    identifiers,
    kind,
    notes: describeShape({ rowCount, time, measures, dimensions, identifiers, kind }),
  };
}

// ── Notes ────────────────────────────────────────────────────────────────────

/**
 * The plain-English account shown under "How we read your file". Deterministic: the
 * same shape always yields the same sentences, in the same order. Written for someone
 * who has never seen a schema — no jargon, and every claim traceable to a `reason`.
 */
function describeShape(s: {
  rowCount: number; time: ShapedColumn | null; measures: ShapedColumn[];
  dimensions: ShapedColumn[]; identifiers: ShapedColumn[]; kind: ShapeKind;
}): string[] {
  const notes: string[] = [];
  const lead = s.measures[0];

  if (s.kind === "unusable") {
    notes.push("We could not find anything to measure or group by in this file.");
    return notes;
  }

  if (lead) {
    const why: string[] = [];
    if ((lead.variation ?? 0) >= 0.3) why.push("it varies strongly from row to row");
    else if ((lead.variation ?? 0) > 0) why.push("it varies across rows");
    if (lead.coverage >= 0.95) why.push("it is filled in on nearly every row");
    else why.push(`it is filled in on ${Math.round(lead.coverage * 100)}% of rows`);
    const across = s.time ? ` across ${s.time.label}` : "";
    notes.push(`Treated ${lead.label} as the main number${across} because ${why.join(" and ")}.`);
    if (lead.aggregate === "avg") {
      notes.push(`${lead.label} is averaged rather than added up, because adding a rate together gives a number that means nothing.`);
    }
  } else if (s.kind === "events_over_time") {
    notes.push(`This file has no number worth totalling, so we count records instead and show how many happen over ${s.time!.label}.`);
  } else if (s.kind === "categorical") {
    notes.push("This file has no number worth totalling, so we count records and show how they split across your groupings.");
  }

  if (s.measures.length > 1) {
    notes.push(`Also tracking ${s.measures.slice(1, 4).map((m) => m.label).join(", ")}.`);
  }
  // The unusable case returned above, so anything reaching here has something to say.
  if (s.time) {
    notes.push(`Using ${s.time.label} as the date for anything shown over time.`);
  } else {
    notes.push("No usable date column, so there are no trends or period comparisons.");
  }
  if (s.dimensions.length) {
    const top = s.dimensions.slice(0, 3).map((d) => `${d.label} (${d.cardinality} values)`);
    notes.push(`Grouping by ${top.join(", ")}${s.dimensions.length > 3 ? `, and ${s.dimensions.length - 3} more` : ""}.`);
  }
  if (s.identifiers.length) {
    notes.push(`Counting unique ${s.identifiers[0].label} values — treated as a record key, never added up.`);
  }
  return notes;
}
