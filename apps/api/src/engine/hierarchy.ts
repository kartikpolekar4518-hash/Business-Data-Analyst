import type { Filters } from "./analytics.js";
import { str } from "./analytics.js";
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
