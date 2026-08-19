// Driver / contribution analysis. Pure, deterministic. Decomposes the change in a
// metric between the previous and current period into which dimension members
// (products, regions, categories, …) drove it. Every member's contribution is
// current − previous, so the contributions sum EXACTLY to the overall change — the
// numbers reconcile with the dashboard's period-over-period KPI by construction.

import type { Row } from "./parse.js";
import type { SchemaMap, Semantic } from "./schema.js";
import * as A from "./analytics.js";

export type DriverMetric = "revenue" | "profit";

export interface DriverContribution {
  label: string;
  current: number;
  previous: number;
  contribution: number;            // current − previous (absolute, in metric units)
  shareOfChange: number | null;    // % of the net change this member explains (can be <0 or >100)
  direction: "up" | "down" | "flat";
  explanation: string;
}

export interface DriverResult {
  metric: DriverMetric;
  dimension: Semantic | null;
  totalPrevious: number;
  totalCurrent: number;
  totalChange: number;
  totalChangePct: number | null;
  drivers: DriverContribution[];   // top movers by absolute impact (truncated to `limit`)
  otherCount: number;              // members beyond the top movers
  otherContribution: number;       // their summed contribution, so shown + other == totalChange
  reconciled: boolean;             // true when Σ (all) contributions == totalChange (to cents)
}

function round(n: number): number { return Math.round(n * 100) / 100; }

// Pick the most useful dimension to attribute the change to, unless the caller names one.
function pickDimension(s: SchemaMap, override?: Semantic): Semantic | null {
  if (override) return s[override] ? override : null;
  for (const dim of ["product_name", "category", "region", "customer_name", "department"] as Semantic[]) {
    if (s[dim]) return dim;
  }
  return null;
}

export function analyzeDrivers(
  rows: Row[], s: SchemaMap, metric: DriverMetric = "revenue",
  dimension?: Semantic, f: A.Filters = {}, limit = 10,
): DriverResult {
  const dim = pickDimension(s, dimension);
  const filtered = A.applyFilters(rows, s, f);
  const { current, previous } = A.splitPeriods(filtered, s);

  if (!dim) return {
    metric, dimension: null, totalPrevious: 0, totalCurrent: 0, totalChange: 0,
    totalChangePct: null, drivers: [], otherCount: 0, otherContribution: 0, reconciled: true,
  };

  // Grouped metric totals per member, current vs previous. A big limit so every
  // member is counted — reconciliation depends on nothing being truncated.
  const cur = new Map(A.groupBy(current, s, dim, metric, {}, 100_000).map((x) => [x.label, x.value]));
  const prev = new Map(A.groupBy(previous, s, dim, metric, {}, 100_000).map((x) => [x.label, x.value]));

  const totalCurrent = round([...cur.values()].reduce((a, b) => a + b, 0));
  const totalPrevious = round([...prev.values()].reduce((a, b) => a + b, 0));
  const totalChange = round(totalCurrent - totalPrevious);
  const totalChangePct = totalPrevious !== 0 ? round((totalChange / Math.abs(totalPrevious)) * 100) : null;

  const labels = new Set([...cur.keys(), ...prev.keys()]);
  const all: DriverContribution[] = [];
  for (const label of labels) {
    const c = cur.get(label) ?? 0;
    const p = prev.get(label) ?? 0;
    const contribution = round(c - p);
    if (contribution === 0) continue;
    const shareOfChange = totalChange !== 0 ? round((contribution / totalChange) * 100) : null;
    const direction: DriverContribution["direction"] = contribution > 0 ? "up" : contribution < 0 ? "down" : "flat";
    all.push({
      label, current: round(c), previous: round(p), contribution, shareOfChange, direction,
      explanation: `${label} ${direction === "up" ? "added" : "lost"} ${A.fmtMoney(Math.abs(contribution))}` +
        (shareOfChange !== null ? ` (${shareOfChange >= 0 ? "+" : ""}${shareOfChange}% of the net change)` : "") + ".",
    });
  }

  // Reconciliation is checked against the FULL set before truncating for display.
  const sumAll = round(all.reduce((a, d) => a + d.contribution, 0));
  const reconciled = Math.abs(sumAll - totalChange) < 0.01;

  // Rank by absolute impact; keep the biggest movers and roll the rest into "other"
  // so the displayed drivers plus the remainder still sum to the total change.
  all.sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));
  const top = all.slice(0, limit);
  const rest = all.slice(limit);
  const otherContribution = round(rest.reduce((a, d) => a + d.contribution, 0));

  return {
    metric, dimension: dim, totalPrevious, totalCurrent, totalChange, totalChangePct,
    drivers: top, otherCount: rest.length, otherContribution, reconciled,
  };
}
