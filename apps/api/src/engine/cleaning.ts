import type { Row } from "./parse.js";
import type { ColumnProfile, QualityIssue } from "./profile.js";

// Replayable cleaning.
//
// A cleaning instruction used to be `{ acceptedTypes: string[] }`, and applying it
// re-read *that dataset's* detected issues to decide which columns to touch. The list
// was therefore only meaningful next to the dataset it was produced from: replaying the
// same "accepted types" against next month's upload produced a different transform,
// because next month's upload has different issues.
//
// A CleaningStep names its column and carries every decision the transform needs, so the
// same step list is the same transform against any rows. That is the whole feature: the
// recipe is the instruction, not a pointer back into one dataset's issue table.
//
// The vocabulary is deliberately the QualityIssue vocabulary — a step's `type` is the
// issue type it fixes — so a step and the provenance entry it produces are the same
// words, and `Explanation.provenance.cleaning` keeps rendering unchanged.

export const CLEANING_STEP_TYPES = [
  "empty_column", "whitespace", "inconsistent_case", "numeric_with_text", "missing_values", "duplicate_rows",
] as const;
export type CleaningStepType = (typeof CLEANING_STEP_TYPES)[number];

export interface CleaningStep {
  type: CleaningStepType;
  /** The column the step operates on. `null` only for `duplicate_rows`, which is whole-row. */
  column: string | null;
  /** `missing_values` only: what a blank cell becomes. Decided when the step is built, so
   *  replay does not depend on the new dataset re-detecting the column as numeric. */
  fill?: number | string;
}

/** One line of cleaning provenance: what a step actually did to these rows. */
export interface AppliedStep { type: CleaningStepType; column: string | null; affectedRows: number }

// The order a recipe is built in, and the order today's cleaning has always run in:
// drop dead columns, normalise the surviving cells, fill what is still blank, then
// de-duplicate whole rows. Steps are applied in array order, so a stored recipe replays
// in the order it was saved rather than in whatever order a caller passes.
const BUILD_ORDER: CleaningStepType[] = [
  "empty_column", "whitespace", "inconsistent_case", "numeric_with_text", "missing_values", "duplicate_rows",
];

// Which types are scoped to the columns that were actually flagged, and which apply to
// every column. This mirrors the pre-recipe behaviour exactly: accepting "whitespace"
// trimmed every string cell in the dataset, not only the flagged columns, and accepting
// "missing_values" filled every blank cell. Making that column-scoped means one step per
// column — bulkier, but it is the honest write-down of what the fix does.
const FLAGGED_COLUMNS_ONLY = new Set<CleaningStepType>(["empty_column", "inconsistent_case", "numeric_with_text"]);

/**
 * Turn the "accepted suggestions" checkbox list into a recipe: the ordered, column-scoped
 * steps that reproduce exactly what accepting those types does to *this* dataset. The
 * result no longer refers to the issue table, so it can be stored and replayed elsewhere.
 */
export function buildSteps(acceptedTypes: string[], issues: QualityIssue[], columns: ColumnProfile[]): CleaningStep[] {
  const accept = new Set(acceptedTypes);
  const steps: CleaningStep[] = [];
  // A column dropped by an earlier step has no cells left for a later one to touch.
  const dropped = new Set<string>();

  for (const type of BUILD_ORDER) {
    if (!accept.has(type)) continue;
    if (type === "duplicate_rows") { steps.push({ type, column: null }); continue; }

    const flagged = new Set(issues.filter((i) => i.type === type && i.column).map((i) => i.column!));
    for (const col of columns) {
      if (dropped.has(col.name)) continue;
      if (FLAGGED_COLUMNS_ONLY.has(type) && !flagged.has(col.name)) continue;
      if (type === "empty_column") { steps.push({ type, column: col.name }); dropped.add(col.name); continue; }
      if (type === "missing_values") {
        steps.push({ type, column: col.name, fill: col.type === "number" || col.type === "currency" ? 0 : "Unknown" });
        continue;
      }
      steps.push({ type, column: col.name });
    }
  }
  return steps;
}

/** Cross-field rules the API and the engine must not be able to disagree about. */
export function validateSteps(steps: CleaningStep[]): string[] {
  const errors: string[] = [];
  steps.forEach((s, i) => {
    const at = `Step ${i + 1}`;
    if (!(CLEANING_STEP_TYPES as readonly string[]).includes(s.type)) { errors.push(`${at}: '${s.type}' is not a cleaning step.`); return; }
    if (s.type === "duplicate_rows") {
      if (s.column !== null) errors.push(`${at}: removing duplicate rows is whole-row, so it takes no column.`);
    } else if (!s.column) {
      errors.push(`${at}: '${s.type}' must name a column.`);
    }
    if (s.type === "missing_values") {
      if (typeof s.fill !== "number" && typeof s.fill !== "string") errors.push(`${at}: filling missing values needs a fill value.`);
    } else if (s.fill !== undefined) {
      errors.push(`${at}: '${s.type}' takes no fill value.`);
    }
  });
  return errors;
}

/** Plain-English label for a step, so the UI never keeps a second copy of these rules. */
export function describeStep(s: CleaningStep): string {
  switch (s.type) {
    case "empty_column": return `Drop the empty column "${s.column}"`;
    case "whitespace": return `Trim spaces around values in "${s.column}"`;
    case "inconsistent_case": return `Normalise capitalisation in "${s.column}"`;
    case "numeric_with_text": return `Read "${s.column}" as numbers, stripping stray text`;
    case "missing_values": return `Fill blanks in "${s.column}" with ${typeof s.fill === "string" ? `"${s.fill}"` : s.fill}`;
    case "duplicate_rows": return "Remove exactly duplicated rows";
  }
}

/**
 * Apply an ordered recipe to rows. Pure: the input array and its rows are never mutated.
 *
 * `applied` counts what each step actually changed *in these rows*, rather than copying
 * counts out of the dataset's issue table — a recipe replayed against a different upload
 * has to report that upload's numbers. Steps that changed nothing are left out.
 *
 * With no steps the ORIGINAL array is returned, not a copy: a dataset nobody has cleaned
 * must be able to prove it was not touched.
 */
export function cleanRows(rows: Row[], steps: CleaningStep[]): { rows: Row[]; applied: AppliedStep[] } {
  if (!steps.length) return { rows, applied: [] };

  let out = rows.map((r) => ({ ...r }));
  const applied: AppliedStep[] = [];
  const record = (s: CleaningStep, affectedRows: number) => { if (affectedRows > 0) applied.push({ type: s.type, column: s.column, affectedRows }); };

  for (const step of steps) {
    if (step.type === "duplicate_rows") {
      const seen = new Set<string>();
      const kept = out.filter((r) => { const k = JSON.stringify(r); if (seen.has(k)) return false; seen.add(k); return true; });
      record(step, out.length - kept.length);
      out = kept;
      continue;
    }

    const col = step.column!;
    let affected = 0;
    for (const r of out) {
      if (step.type === "empty_column") { if (col in r) { delete r[col]; affected++; } continue; }
      if (!(col in r)) continue;
      const before = r[col];
      let v = before;
      switch (step.type) {
        case "whitespace": if (typeof v === "string") v = v.trim(); break;
        case "inconsistent_case": if (typeof v === "string") v = titleCase(v); break;
        case "numeric_with_text": {
          if (typeof v === "string") { const cleaned = v.replace(/[^0-9.\-]/g, ""); if (cleaned && !isNaN(Number(cleaned))) v = Number(cleaned); }
          break;
        }
        case "missing_values": if (v === null || v === undefined || v === "") v = step.fill!; break;
      }
      if (v !== before) { r[col] = v; affected++; }
    }
    record(step, affected);
  }
  return { rows: out, applied };
}

function titleCase(s: string): string {
  const words = s.toLowerCase().split(/(\s+)/);
  const result = words.map((w) => /^\s+$/.test(w) ? w : !w ? w : w.charAt(0).toUpperCase() + w.slice(1)).join("");
  return result.replace(/\bMc([a-z])/g, (_, c) => `Mc${c.toUpperCase()}`);
}
