import type { Row } from "./parse.js";
import type { SchemaMap, Semantic } from "./schema.js";
import { str } from "./analytics.js";

// Multi-file joins.
//
// The engine is row-array based: every analytic is `(rows, schema, …) => data`. So a
// join is another pure `Row[] -> Row[]`, and every existing analytic reads a joined
// dataset for free, with no change of its own.
//
// The whole risk of the feature is in one place. A join whose RIGHT key repeats
// duplicates each matching left row — the left row's revenue is then counted once per
// matching right row, and every downstream sum inflates. Nothing about the resulting
// number looks wrong. So `joinRows` refuses to fan out: an unsafe join returns the left
// rows untouched together with a report saying exactly why. There is no flag to override
// it, because there is no reading of an inflated total that is useful.

/** Join keys are compared exactly as `applyFilters` compares dimension values:
 *  trimmed and case-insensitive. A blank is never a key — a blank cell means "unknown",
 *  and two unknowns are not the same customer. */
export function joinKey(v: unknown): string | null {
  const s = str(v).toLowerCase();
  return s === "" ? null : s;
}

export type JoinCardinality = "one_to_one" | "many_to_one" | "one_to_many" | "many_to_many";

export interface JoinReport {
  kind: JoinCardinality;
  /** True only when the right key is unique among its non-blank values. That is the
   *  definition of safety; `fanOut === 1` is the invariant that follows from it. */
  safe: boolean;
  /** Whether `joinRows` actually joined. False whenever `safe` is false. */
  applied: boolean;
  leftRows: number;
  rightRows: number;
  /** Left rows that found a match. */
  matchedLeftRows: number;
  /** Left rows with a key that matched nothing. Kept, with blanks for the right columns. */
  unmatchedLeftRows: number;
  /** Left rows whose own key cell is blank. Kept, and never counted as repetition. */
  blankKeyRows: number;
  /** Right rows no left row reached. Dropped — this is a left join. */
  unmatchedRightRows: number;
  /** Output rows ÷ left rows. Exactly 1 for every join this module will apply. */
  fanOut: number;
  /** Up to five right-key values that repeat, so a refusal names what to fix. */
  duplicateKeys: string[];
  /** Right columns as they appear in the output, `{ source: joined }`. */
  columnRenames: Record<string, string>;
  /** Plain English, so the API and the client keep no second copy of what happened. */
  message: string;
}

export interface JoinSpec {
  leftColumn: string;
  rightColumn: string;
  /** Names the right side in prefixed column names and in the report's wording. */
  rightName: string;
}

// Distinct non-blank keys, and which of them repeat. Blank-keyed rows are counted
// separately: a file with three blank customer ids does not have a repeated customer.
function keyStats(rows: Row[], column: string) {
  const counts = new Map<string, number>();
  let blank = 0;
  for (const r of rows) {
    const k = joinKey(r[column]);
    if (k === null) { blank++; continue; }
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const duplicates: string[] = [];
  for (const [k, n] of counts) if (n > 1) duplicates.push(k);
  return { counts, blank, duplicates };
}

const LABEL: Record<JoinCardinality, string> = {
  one_to_one: "one to one",
  many_to_one: "many to one",
  one_to_many: "one to many",
  many_to_many: "many to many",
};

/**
 * Measure what a join would do before doing it. Pure, and the only place cardinality is
 * decided — the route validates with this, the engine refuses with this, and the panel
 * prints this.
 */
export function analyzeJoin(left: Row[], right: Row[], spec: JoinSpec): JoinReport {
  const l = keyStats(left, spec.leftColumn);
  const r = keyStats(right, spec.rightColumn);

  // Cardinality is about repetition among the keys that exist. Unmatched rows do not
  // make a key "many": a customer id that appears once is one customer whether or not
  // an order reached it.
  const leftRepeats = l.duplicates.length > 0;
  const rightRepeats = r.duplicates.length > 0;
  const kind: JoinCardinality = leftRepeats
    ? (rightRepeats ? "many_to_many" : "many_to_one")
    : (rightRepeats ? "one_to_many" : "one_to_one");

  let matched = 0;
  let produced = 0;
  for (const row of left) {
    const k = joinKey(row[spec.leftColumn]);
    const hits = k === null ? 0 : (r.counts.get(k) ?? 0);
    if (hits > 0) matched++;
    produced += Math.max(1, hits); // a left join keeps unmatched rows, one output row each
  }
  let unmatchedRight = 0;
  for (const k of r.counts.keys()) if (!l.counts.has(k)) unmatchedRight += r.counts.get(k)!;

  const safe = !rightRepeats;
  const fanOut = left.length === 0 ? 1 : produced / left.length;

  return {
    kind, safe, applied: false,
    leftRows: left.length,
    rightRows: right.length,
    matchedLeftRows: matched,
    unmatchedLeftRows: left.length - matched - l.blank,
    blankKeyRows: l.blank,
    unmatchedRightRows: unmatchedRight,
    fanOut,
    duplicateKeys: r.duplicates.slice(0, 5),
    columnRenames: {},
    message: safe
      ? `${LABEL[kind]} on ${spec.leftColumn} = ${spec.rightColumn}: ${matched} of ${left.length} rows matched.`
      : `Can't connect on ${spec.leftColumn} = ${spec.rightColumn}: "${spec.rightColumn}" repeats in ${spec.rightName}` +
        ` (${r.duplicates.length} value${r.duplicates.length === 1 ? "" : "s"}, e.g. ${r.duplicates.slice(0, 3).join(", ")}).` +
        ` Each matching row would be counted ${round2(fanOut)} times over, so every total would be too high.` +
        ` Pick a column with one row per value.`,
  };
}

function round2(n: number): number { return Math.round(n * 100) / 100; }

/**
 * Name each right column in the output. A column whose name is already taken in the
 * accumulated column list is prefixed with the right side's name, then suffixed if that
 * still collides — so a chain of joins produces the same names every time, given the
 * same application order. The right join column is dropped: its value is the left key's.
 */
export function renameColumns(taken: string[], rightColumns: string[], spec: JoinSpec): Record<string, string> {
  const used = new Set(taken);
  const renames: Record<string, string> = {};
  for (const col of rightColumns) {
    if (col === spec.rightColumn) continue;
    let name = used.has(col) ? `${spec.rightName}.${col}` : col;
    for (let n = 2; used.has(name); n++) name = `${spec.rightName}.${col}_${n}`;
    used.add(name);
    renames[col] = name;
  }
  return renames;
}

export interface JoinResult { rows: Row[]; columns: string[]; report: JoinReport }

/**
 * Left join `right` onto `left`. Every left row survives — matched or not — carrying all
 * of its own cells unchanged, so no existing measure can move and a lookup miss can
 * never drop revenue.
 *
 * An unsafe join is NOT performed: `rows` is the left array itself (identity, not a
 * copy) and `report.applied` is false. Callers surface the report; nobody gets an
 * inflated number.
 */
export function joinRows(left: Row[], right: Row[], spec: JoinSpec, leftColumns?: string[]): JoinResult {
  const columns = leftColumns?.length ? [...leftColumns] : Object.keys(left[0] ?? {});
  const report = analyzeJoin(left, right, spec);
  if (!report.safe) return { rows: left, columns, report };

  const rightColumns = Object.keys(right[0] ?? {});
  const renames = renameColumns(columns, rightColumns, spec);
  const lookup = new Map<string, Row>();
  for (const row of right) {
    const k = joinKey(row[spec.rightColumn]);
    if (k !== null && !lookup.has(k)) lookup.set(k, row); // safe ⇒ no key repeats anyway
  }

  // An unmatched row gets "" for every added column, matching how the CSV/XLSX parsers
  // already represent an absent cell. A blank never becomes 0: `num("")` is 0 and would
  // read as a measured zero rather than as missing.
  const blanks: Row = {};
  for (const name of Object.values(renames)) blanks[name] = "";

  const rows = left.map((row) => {
    const k = joinKey(row[spec.leftColumn]);
    const match = k === null ? undefined : lookup.get(k);
    if (!match) return { ...row, ...blanks };
    const out: Row = { ...row };
    for (const [src, name] of Object.entries(renames)) out[name] = match[src];
    return out;
  });

  return {
    rows,
    columns: [...columns, ...Object.values(renames)],
    report: { ...report, applied: true, columnRenames: renames },
  };
}

/**
 * The schema of the joined rows: the left's stored map, plus — only for semantics the
 * left does NOT already have — the right's column under its output name.
 *
 * Deliberately not a re-detection. `detectSchema` is first-wins over its column order,
 * so re-running it could rebind an existing semantic to a right-hand column and move a
 * number on a dataset the user only meant to enrich. Starting from the left's map makes
 * that impossible by construction.
 */
export function mergeSchemas(left: SchemaMap, right: SchemaMap, renames: Record<string, string>): SchemaMap {
  const merged: SchemaMap = { ...left };
  for (const [semantic, column] of Object.entries(right) as [Semantic, string][]) {
    if (merged[semantic]) continue;          // the left already answers this question
    const name = renames[column];
    if (!name) continue;                     // the join column itself, or a dropped column
    merged[semantic] = name;
  }
  return merged;
}

// ─── Auto-detection ──────────────────────────────────────────────────────────
// Offered as a suggestion the user confirms, never applied. Two signals, because either
// alone is wrong often enough to matter: matching names with no shared values connect
// unrelated files, and shared values with unrelated names connect a price column to a
// quantity column.

export interface RelationCandidate {
  id: string;
  name: string;
  columns: string[];
  rows: Row[];
}

export interface RelationSuggestion {
  leftDatasetId: string;
  leftDatasetName: string;
  leftColumn: string;
  rightDatasetId: string;
  rightDatasetName: string;
  rightColumn: string;
  kind: JoinCardinality;
  /** Share of the left's non-blank keys found in the right, 0–1. */
  overlap: number;
  /** 0–1, name affinity and value overlap together. Only ≥ 0.5 is suggested. */
  confidence: number;
  reason: string;
}

const SAMPLE = 500;

function normalizeName(c: string): string { return c.toLowerCase().trim().replace(/[\s_-]+/g, ""); }
function stem(c: string): string { return normalizeName(c).replace(/id$/, ""); }

// 1 for the same name, 0.8 for `customer` ↔ `customer_id`, 0.6 for a shared id stem
// (`customer_id` ↔ `cust_id` does NOT match — that is what value overlap is for).
function nameAffinity(leftCol: string, rightCol: string): number {
  const l = normalizeName(leftCol), r = normalizeName(rightCol);
  if (l === r) return 1;
  if (l === `${r}id` || r === `${l}id`) return 0.8;
  const ls = stem(l), rs = stem(r);
  if (ls && ls === rs) return 0.6;
  return 0;
}

/**
 * Candidate relationships across the organization's datasets, scored. Pure and
 * read-only: it proposes, and a separate confirmed write creates the relationship.
 */
export function suggestRelations(datasets: RelationCandidate[]): RelationSuggestion[] {
  const out: RelationSuggestion[] = [];

  for (const left of datasets) {
    for (const right of datasets) {
      if (left.id === right.id) continue;
      for (const leftColumn of left.columns) {
        for (const rightColumn of right.columns) {
          const affinity = nameAffinity(leftColumn, rightColumn);
          if (affinity === 0) continue;

          const spec: JoinSpec = { leftColumn, rightColumn, rightName: right.name };
          const report = analyzeJoin(left.rows.slice(0, SAMPLE), right.rows.slice(0, SAMPLE), spec);
          // A join that would fan out is not offered at all: confirming it would only
          // earn the user a refusal.
          if (!report.safe) continue;
          const keyed = report.matchedLeftRows + report.unmatchedLeftRows;
          if (keyed === 0) continue;
          const overlap = report.matchedLeftRows / keyed;
          if (overlap < 0.5) continue; // half the rows finding nothing is not a relationship

          const confidence = round2(affinity * 0.4 + overlap * 0.6);
          if (confidence < 0.5) continue;
          out.push({
            leftDatasetId: left.id, leftDatasetName: left.name, leftColumn,
            rightDatasetId: right.id, rightDatasetName: right.name, rightColumn,
            kind: report.kind, overlap: round2(overlap), confidence,
            reason: `${Math.round(overlap * 100)}% of ${left.name}'s "${leftColumn}" values appear in ${right.name}'s "${rightColumn}".`,
          });
        }
      }
    }
  }

  // Strongest first, then by name so the list is stable between calls.
  return out.sort((a, b) =>
    b.confidence - a.confidence ||
    a.leftDatasetName.localeCompare(b.leftDatasetName) ||
    a.leftColumn.localeCompare(b.leftColumn) ||
    a.rightDatasetName.localeCompare(b.rightDatasetName) ||
    a.rightColumn.localeCompare(b.rightColumn));
}

// ─── Cycle protection ────────────────────────────────────────────────────────

/**
 * Would adding `left -> right` close a cycle? Relations are applied as a fixed sequence,
 * not a planned traversal, so `Orders -> Customers -> Orders` would re-join a dataset to
 * itself. Refused at configuration time, where it can be explained, rather than at read
 * time, where it would just be a strange column list.
 */
export function createsCycle(edges: { leftDatasetId: string; rightDatasetId: string }[], left: string, right: string): boolean {
  if (left === right) return true;
  const next = new Map<string, string[]>();
  for (const e of [...edges, { leftDatasetId: left, rightDatasetId: right }]) {
    const list = next.get(e.leftDatasetId) ?? [];
    list.push(e.rightDatasetId);
    next.set(e.leftDatasetId, list);
  }
  const seen = new Set<string>();
  const stack = [right];
  while (stack.length) {
    const node = stack.pop()!;
    if (node === left) return true;
    if (seen.has(node)) continue;
    seen.add(node);
    stack.push(...(next.get(node) ?? []));
  }
  return false;
}
