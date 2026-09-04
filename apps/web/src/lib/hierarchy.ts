import type { Hierarchy, HierarchyLevel } from "./types";

// Drill navigation over the URL, which is the client's source of truth for filters.
//
// The engine (apps/api/src/engine/hierarchy.ts) is authoritative for what drilling MEANS
// — its selfcheck pins that a drilled view equals the identical hand-set filter. What
// lives here is only the URLSearchParams equivalent of "set this param, drop the ones
// below it", computed locally so the breadcrumb updates on click instead of lagging a
// refetch. The level list and its filterKeys always come from the API response; this file
// must never contain a semantic -> filterKey mapping of its own.

const valuesAt = (params: URLSearchParams, level: HierarchyLevel): string[] =>
  params.getAll(level.filterKey).map((v) => v.trim()).filter(Boolean);

// The deepest level actually set, ancestors set or not — a hand-edited ?city=Fresno is
// honoured as written rather than having a region invented for it.
export function currentLevel(h: Hierarchy, params: URLSearchParams): HierarchyLevel | null {
  for (let i = h.levels.length - 1; i >= 0; i--) if (valuesAt(params, h.levels[i]).length) return h.levels[i];
  return null;
}

// The level a click drills into; null at the leaf.
export function nextLevel(h: Hierarchy, params: URLSearchParams): HierarchyLevel | null {
  const cur = currentLevel(h, params);
  if (!cur) return h.levels[0] ?? null;
  return h.levels[h.levels.indexOf(cur) + 1] ?? null;
}

// The breadcrumb trail: only levels carrying a value, in hierarchy order.
export function drillPath(h: Hierarchy, params: URLSearchParams): { level: HierarchyLevel; values: string[] }[] {
  return h.levels
    .map((level) => ({ level, values: valuesAt(params, level) }))
    .filter((c) => c.values.length > 0);
}

// Clearing a level clears every level below it, so no drill can strand a filter with no
// reachable path back to it.
function clearBelow(params: URLSearchParams, h: Hierarchy, index: number): URLSearchParams {
  const next = new URLSearchParams(params);
  for (const l of h.levels.slice(index + 1)) next.delete(l.filterKey);
  return next;
}

export function drillTo(params: URLSearchParams, h: Hierarchy, level: HierarchyLevel, value: string): URLSearchParams {
  const i = h.levels.indexOf(level);
  if (i < 0) return new URLSearchParams(params);
  const next = clearBelow(params, h, i);
  next.delete(level.filterKey);
  next.append(level.filterKey, value);
  return next;
}

// `level` is kept and everything below it cleared; null is the breadcrumb root ("All")
// and clears every level in this hierarchy, leaving other filters alone.
export function drillUp(params: URLSearchParams, h: Hierarchy, level: HierarchyLevel | null): URLSearchParams {
  if (!level) return clearBelow(params, h, -1);
  const i = h.levels.indexOf(level);
  return i < 0 ? new URLSearchParams(params) : clearBelow(params, h, i);
}

// Resolve a chart's dimension to its level. A dimension in no hierarchy is not drillable.
export function findLevel(hs: Hierarchy[], semantic?: string | null): { hierarchy: Hierarchy; level: HierarchyLevel } | null {
  if (!semantic) return null;
  for (const hierarchy of hs) {
    const level = hierarchy.levels.find((l) => l.semantic === semantic);
    if (level) return { hierarchy, level };
  }
  return null;
}
