import type { Row } from "./parse.js";
import type { SchemaMap, Semantic } from "./schema.js";
import * as A from "./analytics.js";
import type { PackMetric } from "./industries.js";

// Driver / contribution analysis: attributes a metric change between two periods
// to dimension values (regions, products, customers…) and reconciles to the cent.
// Deterministic; every number is derivable from the same rows.

export interface DriverContribution {
  dimension: Semantic;
  label: string;          // dimension value, e.g. "West"
  delta: number;          // this value's contribution to the total change
  currentValue: number;
  previousValue: number;
  changePct: number | null;
  shareOfDelta: number;   // |delta| / sum(|deltas|), for ranking/evidence
}

export interface DriverResult {
  metric: string;
  dimension: Semantic;
  totalDelta: number;
  currentTotal: number;
  previousTotal: number;
  contributions: DriverContribution[];
}

// Split rows into current vs previous period by the median date (same basis as overview KPIs).
function splitPeriods(rows: Row[], s: SchemaMap): { current: Row[]; previous: Row[] } {
  if (!s.date) return { current: rows, previous: [] };
  const dated = rows.map((r) => ({ r, d: A.parseDate(r[s.date!]) })).filter((x) => x.d) as { r: Row; d: Date }[];
  if (dated.length < 4) return { current: rows, previous: [] };
  dated.sort((a, b) => a.d.getTime() - b.d.getTime());
  const mid = dated[Math.floor(dated.length / 2)].d.getTime();
  const current: Row[] = [], previous: Row[] = [];
  for (const x of dated) { (x.d.getTime() >= mid ? current : previous).push(x.r); }
  return { current, previous };
}

function sumMetric(rows: Row[], s: SchemaMap, metric: PackMetric | string): number {
  // PackMetric objects compute deterministically from rows (mrr, churn, arpu…).
  if (typeof metric === "object") return metric.compute(rows, s);
  // For built-in string metrics use the same resolvers as analytics.ts
  switch (metric) {
    case "revenue": return rows.reduce((a, r) => a + A.rowRevenue(r, s), 0);
    case "profit": return rows.reduce((a, r) => a + A.rowProfit(r, s), 0);
    case "quantity": return rows.reduce((a, r) => a + (s.quantity ? A.num(r[s.quantity]) : 1), 0);
    case "orders": return s.order_id ? new Set(rows.map((r) => A.str(r[s.order_id!]))).size : rows.length;
    default: return 0;
  }
}

function rowMetricValue(r: Row, s: SchemaMap, metric: PackMetric | string): number {
  if (typeof metric === "object") return metric.compute([r], s);
  return sumMetric([r], s, metric);
}

/**
 * Attribute a metric's change between the two half-periods to the values of one
 * dimension. The sum of contributions' deltas equals totalDelta (reconciles to
 * the cent, modulo rounding).
 */
export function analyzeDrivers(
  rows: Row[],
  s: SchemaMap,
  metric: PackMetric | string,
  dimension: Semantic,
  limit = 8,
): DriverResult {
  const { current, previous } = splitPeriods(rows, s);
  const col = s[dimension];
  const result: DriverResult = {
    metric: typeof metric === "object" ? metric.id : metric,
    dimension,
    totalDelta: sumMetric(current, s, metric) - sumMetric(previous, s, metric),
    currentTotal: sumMetric(current, s, metric),
    previousTotal: sumMetric(previous, s, metric),
    contributions: [],
  };
  if (!col || (!current.length && !previous.length)) return result;

  // Bucket by dimension value across both periods.
  const curMap = new Map<string, number>();
  const prevMap = new Map<string, number>();
  for (const r of current) {
    const key = A.str(r[col]) || "Unknown";
    curMap.set(key, (curMap.get(key) ?? 0) + rowMetricValue(r, s, metric));
  }
  for (const r of previous) {
    const key = A.str(r[col]) || "Unknown";
    prevMap.set(key, (prevMap.get(key) ?? 0) + rowMetricValue(r, s, metric));
  }

  const allKeys = new Set([...curMap.keys(), ...prevMap.keys()]);
  const totalAbsDelta = [...allKeys].reduce((sum, k) => sum + Math.abs((curMap.get(k) ?? 0) - (prevMap.get(k) ?? 0)), 0);

  const contributions: DriverContribution[] = [];
  for (const key of allKeys) {
    const cur = curMap.get(key) ?? 0;
    const prev = prevMap.get(key) ?? 0;
    const delta = cur - prev;
    if (delta === 0) continue;
    contributions.push({
      dimension,
      label: key,
      delta,
      currentValue: cur,
      previousValue: prev,
      changePct: prev ? Math.round(((cur - prev) / Math.abs(prev)) * 1000) / 10 : null,
      shareOfDelta: totalAbsDelta === 0 ? 0 : Math.abs(delta) / totalAbsDelta,
    });
  }

  contributions.sort((a, b) => b.shareOfDelta - a.shareOfDelta);
  result.contributions = contributions.slice(0, limit);
  return result;
}

/**
 * Price × Volume × Mix decomposition for revenue between the two half-periods.
 * Reconciles by construction: ΔRevenue = Volume + Price + Mix.
 * - Volume: quantity change at base-period price
 * - Price: quantity-at-current × unit-price change
 * - Mix: residual = everything not explained by volume/price (product mix shift)
 */
export interface Decomposition {
  metric: "revenue";
  volumeDelta: number;
  priceDelta: number;
  mixDelta: number;
  totalDelta: number;
  currentUnits: number;
  previousUnits: number;
  currentAvgPrice: number;
  previousAvgPrice: number;
  canDecompose: boolean;   // false when unit_price/quantity aren't both present
}

export function decomposePriceVolumeMix(rows: Row[], s: SchemaMap): Decomposition {
  const { current, previous } = splitPeriods(rows, s);
  const zero: Decomposition = {
    metric: "revenue",
    volumeDelta: 0, priceDelta: 0, mixDelta: 0, totalDelta: 0,
    currentUnits: 0, previousUnits: 0,
    currentAvgPrice: 0, previousAvgPrice: 0,
    canDecompose: false,
  };
  if (!s.quantity || !s.unit_price) return zero;

  const quant = (rs: Row[]) => rs.reduce((a, r) => a + A.num(r[s.quantity!]), 0);
  const rev = (rs: Row[]) => rs.reduce((a, r) => a + A.rowRevenue(r, s), 0);

  const q2 = quant(current), q1 = quant(previous);
  const r2 = rev(current), r1 = rev(previous);
  if (q1 === 0) return zero;

  const price1 = r1 / q1;
  const price2 = r2 / q2;

  // Volume = ΔQ × P1 ; Price = Q2 × ΔP ; Mix makes it reconcile exactly.
  const volumeDelta = (q2 - q1) * price1;
  const priceDelta = q2 * (price2 - price1);
  const totalDelta = r2 - r1;
  const mixDelta = totalDelta - volumeDelta - priceDelta;

  return {
    metric: "revenue",
    volumeDelta: round(volumeDelta),
    priceDelta: round(priceDelta),
    mixDelta: round(mixDelta),
    totalDelta: round(totalDelta),
    currentUnits: round(q2),
    previousUnits: round(q1),
    currentAvgPrice: round(price2),
    previousAvgPrice: round(price1),
    canDecompose: true,
  };
}

function round(n: number): number { return Math.round(n * 100) / 100; }