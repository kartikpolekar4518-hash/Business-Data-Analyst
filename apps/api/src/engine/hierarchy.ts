import type { Filters } from "./analytics.js";
import { str } from "./analytics.js";
import {
  childGrain, grainKey, grainOf, parentGrain, periodLabel, periodRange,
  type CalendarConfig, type Grain,
} from "./calendar.js";
import type { SchemaMap, Semantic } from "./schema.js";

// Drill-down hierarchies. Pure data plus pure Filters -> Filters transforms: drilling
// is "set a filter, move to the child dimension", so applyFilters and groupBy do all
// the actual work and no aggregation code lives here.

// The dimension filter keys, i.e. everything on Filters that is not a date bound.
export type DimensionFilterKey = Exclude<keyof Filters, "dateFrom" | "dateTo">;

// semantic and filterKey are carried separately on purpose: the two already disagree
// (product_name -> product, customer_name -> customer), so deriving one from the other
// would be a lookup table pretending to be a rule. This is the single place the mapping
// is written down — it travels to the web app in the /analytics/overview response rather
// than being restated there.
export interface HierarchyLevel { semantic: Semantic; filterKey: DimensionFilterKey; label: string }
export interface Hierarchy { id: string; label: string; levels: HierarchyLevel[] }

export const DEFAULT_HIERARCHIES: Hierarchy[] = [
  {
    id: "geography", label: "Geography",
    levels: [
      { semantic: "region", filterKey: "region", label: "Region" },
      { semantic: "state", filterKey: "state", label: "State" },
      { semantic: "city", filterKey: "city", label: "City" },
    ],
  },
  {
    id: "product", label: "Product",
    levels: [
      { semantic: "category", filterKey: "category", label: "Category" },
      { semantic: "product_name", filterKey: "product", label: "Product" },
    ],
  },
];

// A level the upload has no column for cannot be drilled, so it is dropped rather than
// offered and then silently matching nothing. A hierarchy left with one level is not a
// hierarchy — there is nothing to drill into — so it is dropped too.
export function availableHierarchies(s: SchemaMap, all: Hierarchy[] = DEFAULT_HIERARCHIES): Hierarchy[] {
  return all
    .map((h) => ({ ...h, levels: h.levels.filter((l) => !!s[l.semantic]) }))
    .filter((h) => h.levels.length >= 2);
}

// A filter counts as set only if it carries at least one non-blank value, matching what
// applyFilters actually does with it: `?region=` filters nothing and must not read as a
// drill position.
function hasValue(f: Filters, key: DimensionFilterKey): boolean {
  return valuesOf(f, key).length > 0;
}
function valuesOf(f: Filters, key: DimensionFilterKey): string[] {
  const v = f[key];
  const vals = v == null ? [] : Array.isArray(v) ? v : [v];
  return vals.map(str).filter((x) => x !== "");
}

// Filters live in the URL, so a hand-edited one can be non-contiguous — ?city=Fresno with
// no region or state. currentLevel answers "how deep are we" by the DEEPEST level that is
// actually set, regardless of whether its ancestors are. The filter is honoured as
// written; a parent value is never invented.
export function currentLevel(h: Hierarchy, f: Filters): HierarchyLevel | null {
  for (let i = h.levels.length - 1; i >= 0; i--) if (hasValue(f, h.levels[i].filterKey)) return h.levels[i];
  return null;
}

// The level a click drills INTO: the first level with no value below the current
// position, i.e. the dimension the charts should be showing. null at the leaf, where
// there is nothing further to drill.
export function nextLevel(h: Hierarchy, f: Filters): HierarchyLevel | null {
  const cur = currentLevel(h, f);
  if (!cur) return h.levels[0] ?? null;
  return h.levels[h.levels.indexOf(cur) + 1] ?? null;
}

// The breadcrumb trail, as data. Only levels that actually carry a value appear, so a
// non-contiguous ?city=Fresno renders one crumb rather than two empty ones.
export function drillPath(h: Hierarchy, f: Filters): { level: HierarchyLevel; values: string[] }[] {
  return h.levels
    .map((level) => ({ level, values: valuesOf(f, level.filterKey) }))
    .filter((c) => c.values.length > 0);
}

// Clearing a level always clears everything below it. Dropping "state" while leaving
// "city" set would leave a filter with no reachable path to it — the exact stale state a
// hand-edited URL produces — so every transform below restores contiguity rather than
// preserving whatever it found.
function clearBelow(f: Filters, h: Hierarchy, index: number): Filters {
  const out: Filters = { ...f };
  for (const l of h.levels.slice(index + 1)) delete out[l.filterKey];
  return out;
}

// Drill into `level` at `value`: set that level and clear its descendants. Pure — the
// input Filters is not mutated.
export function drillTo(f: Filters, h: Hierarchy, level: HierarchyLevel, value: string): Filters {
  const i = h.levels.indexOf(level);
  if (i < 0) return { ...f };
  return { ...clearBelow(f, h, i), [level.filterKey]: [value] };
}

// Step back up. `level` is kept and everything below it cleared; passing null is the
// breadcrumb root ("All") and clears every level in the hierarchy.
export function drillUp(f: Filters, h: Hierarchy, level: HierarchyLevel | null): Filters {
  if (!level) return clearBelow(f, h, -1);
  const i = h.levels.indexOf(level);
  return i < 0 ? { ...f } : clearBelow(f, h, i);
}

// Resolve a chart's dimension to the hierarchy level it belongs to, so a caller holding
// only a Semantic (which is all the overview response's chart sections carry) can drill
// without restating the semantic -> filterKey mapping. A dimension in no hierarchy is
// simply not drillable.
export function findLevel(hs: Hierarchy[], semantic: Semantic): { hierarchy: Hierarchy; level: HierarchyLevel } | null {
  for (const hierarchy of hs) {
    const level = hierarchy.levels.find((l) => l.semantic === semantic);
    if (level) return { hierarchy, level };
  }
  return null;
}

// ---------------------------------------------------------------------------
// The date axis, drilled the same way: year > quarter > period.
//
// A dimension drill sets a dimension filter; a date drill sets dateFrom/dateTo. Both are
// Filters -> Filters, both compose with each other, and neither touches aggregation —
// applyFilters was already date-aware. What makes this one calendar-shaped is that the
// window it writes comes from calendar.periodRange, so a retail 4-4-5 period narrows to
// the exact days that periodKey buckets into that period and not to a Gregorian month.

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

function localDay(iso: string): Date | null {
  const m = DATE_ONLY.exec(iso);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
}

/**
 * The key whose range the current window is EXACTLY, or null when there is no window,
 * only one bound, or a span the user typed by hand.
 *
 * Exactness is the whole test. "1 Mar - 31 Mar" is March; "3 Mar - 28 Mar" is a
 * hand-typed window, and treating it as March would let the breadcrumb claim a period
 * the numbers underneath do not cover. Checked finest grain first so the answer is
 * deterministic whatever the calendar.
 */
export function dateWindowKey(f: Filters, c: CalendarConfig): string | null {
  const from = f.dateFrom;
  const start = from && f.dateTo ? localDay(from) : null;
  if (!start) return null;
  for (const grain of ["period", "quarter", "year"] as Grain[]) {
    const key = grainKey(start, c, grain);
    const range = periodRange(key, c);
    if (range && range.from === from && range.to === f.dateTo) return key;
  }
  return null;
}

/**
 * The grain the trend should bucket at: the children of wherever the window sits.
 *
 * With no window — the default view — that is periods, which is exactly what the trend
 * showed before this feature existed, so an untouched dashboard keeps every number it
 * had. A window that is already one period has no finer grain to offer and stays at
 * period, showing the single bucket it covers.
 */
export function trendGrain(f: Filters, c: CalendarConfig): Grain {
  const key = dateWindowKey(f, c);
  const grain = key ? grainOf(key) : null;
  return (grain ? childGrain(grain) : null) ?? "period";
}

export interface DateCrumb { key: string | null; label: string; from?: string; to?: string }

function parentKey(key: string, c: CalendarConfig): string | null {
  const grain = grainOf(key);
  const parent = grain ? parentGrain(grain) : null;
  const range = parent ? periodRange(key, c) : null;
  const start = range ? localDay(range.from) : null;
  return parent && start ? grainKey(start, c, parent) : null;
}

/**
 * The date breadcrumb, root first: All dates > FY2026 > FY2026 Q1 > FY2026 P02. Empty
 * when the window is not a calendar unit — a hand-typed range has no trail to draw, and
 * inventing one would offer a way "back up" to a year the user never drilled through.
 */
export function dateDrillPath(f: Filters, c: CalendarConfig): DateCrumb[] {
  const key = dateWindowKey(f, c);
  if (!key) return [];
  const crumbs: DateCrumb[] = [];
  for (let k: string | null = key; k; k = parentKey(k, c)) {
    const range = periodRange(k, c)!;
    crumbs.unshift({ key: k, label: periodLabel(k, c), from: range.from, to: range.to });
  }
  return [{ key: null, label: "All dates" }, ...crumbs];
}

/**
 * Drill the date axis: the window becomes exactly the clicked bucket, or clears entirely
 * at the "All dates" root. Dimension filters are left alone, so a date drill and a
 * geography drill compose. A key with no range is not drillable and changes nothing
 * rather than silently clearing the window.
 */
export function drillToDate(f: Filters, key: string | null, c: CalendarConfig): Filters {
  const out: Filters = { ...f };
  delete out.dateFrom;
  delete out.dateTo;
  if (!key) return out;
  const range = periodRange(key, c);
  return range ? { ...out, dateFrom: range.from, dateTo: range.to } : { ...f };
}
