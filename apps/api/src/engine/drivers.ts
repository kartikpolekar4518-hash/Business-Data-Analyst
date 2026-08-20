import type { Row } from "./parse.js";
import type { SchemaMap, Semantic } from "./schema.js";
import * as A from "./analytics.js";
import type { PackMetric } from "./industries.js";

export interface DriverContribution {
  dimension: Semantic;
  label: string;
  delta: number;
  currentValue: number;
  previousValue: number;
  changePct: number | null;
  shareOfDelta: number;
}

export interface DriverResult {
  metric: string;
  dimension: Semantic;
  totalDelta: number;
  currentTotal: number;
  previousTotal: number;
  contributions: DriverContribution[];
}

function splitPeriods(rows: Row[], s: SchemaMap): { current: Row[]; previous: Row[] } {
  if (!s.date) return { current: rows, previous: [] };
  const dated = rows.map((r) => ({ r, d: A.parseDate(r[s.date!]) })).filter((x) => x.d) as { r: Row; d: Date }[];
  if (dated.length < 4) return { current: rows, previous: [] };
  dated.sort((a, b) => a.d.getTime() - b.d.getTime());
  const mid = dated[Math.floor(dated.length / 2)].d.getTime();
  const current: Row[] = [], previous: Row[] = [];
  for (const x of dated) (x.d.getTime() >= mid ? current : previous).push(x.r);
  return { current, previous };
}

function sumMetric(rows: Row[], s: SchemaMap, metric: PackMetric | string): number {
  if (typeof metric === "object") return metric.compute(rows, s);
  switch (metric) {
    case "revenue": return rows.reduce((a, r) => a + A.rowRevenue(r, s), 0);
    case "profit": return rows.reduce((a, r) => a + A.rowProfit(r, s), 0);
    case "quantity": return rows.reduce((a, r) => a + (s.quantity ? A.num(r[s.quantity]) : 1), 0);
    case "orders": return s.order_id ? new Set(rows.map((r) => A.str(r[s.order_id!]))).size : rows.length;
    default: return 0;
  }
}

/** Attribute a metric change to dimension values while preserving pack reducers that
 * need the whole bucket (ratios, distinct counts, churn, ARPU, etc.). */
export function analyzeDrivers(rows: Row[], s: SchemaMap, metric: PackMetric | string, dimension: Semantic, limit = 8): DriverResult {
  const { current, previous } = splitPeriods(rows, s);
  const result: DriverResult = {
    metric: typeof metric === "object" ? metric.id : metric,
    dimension,
    totalDelta: sumMetric(current, s, metric) - sumMetric(previous, s, metric),
    currentTotal: sumMetric(current, s, metric),
    previousTotal: sumMetric(previous, s, metric),
    contributions: [],
  };
  const col = s[dimension];
  if (!col || (!current.length && !previous.length)) return result;

  if (typeof metric === "object") {
    const bucket = (rs: Row[]) => {
      const map = new Map<string, Row[]>();
      for (const r of rs) {
        const key = A.str(r[col]) || "Unknown";
        const rowsForKey = map.get(key) ?? [];
        rowsForKey.push(r);
        map.set(key, rowsForKey);
      }
      return map;
    };
    const curMap = bucket(current);
    const prevMap = bucket(previous);
    const allKeys = new Set([...curMap.keys(), ...prevMap.keys()]);
    const raw = [...allKeys].map((key) => {
      const cur = metric.compute(curMap.get(key) ?? [], s);
      const prev = metric.compute(prevMap.get(key) ?? [], s);
      return { key, cur, prev, delta: cur - prev };
    }).filter((x) => x.delta !== 0);
    const totalAbsDelta = raw.reduce((sum, x) => sum + Math.abs(x.delta), 0);
    result.contributions = raw.map((x) => ({
      dimension, label: x.key, delta: x.delta,
      currentValue: x.cur, previousValue: x.prev,
      changePct: x.prev ? Math.round((x.delta / Math.abs(x.prev)) * 1000) / 10 : null,
      shareOfDelta: totalAbsDelta === 0 ? 0 : Math.abs(x.delta) / totalAbsDelta,
    })).sort((a, b) => b.shareOfDelta - a.shareOfDelta).slice(0, limit);
    return result;
  }

  const curMap = new Map<string, number>();
  const prevMap = new Map<string, number>();
  for (const r of current) {
    const key = A.str(r[col]) || "Unknown";
    curMap.set(key, (curMap.get(key) ?? 0) + sumMetric([r], s, metric));
  }
  for (const r of previous) {
    const key = A.str(r[col]) || "Unknown";
    prevMap.set(key, (prevMap.get(key) ?? 0) + sumMetric([r], s, metric));
  }
  const allKeys = new Set([...curMap.keys(), ...prevMap.keys()]);
  const totalAbsDelta = [...allKeys].reduce((sum, k) => sum + Math.abs((curMap.get(k) ?? 0) - (prevMap.get(k) ?? 0)), 0);
  result.contributions = [...allKeys].map((key) => {
    const cur = curMap.get(key) ?? 0, prev = prevMap.get(key) ?? 0, delta = cur - prev;
    return { dimension, label: key, delta, currentValue: cur, previousValue: prev,
      changePct: prev ? Math.round((delta / Math.abs(prev)) * 1000) / 10 : null,
      shareOfDelta: totalAbsDelta === 0 ? 0 : Math.abs(delta) / totalAbsDelta };
  }).filter((x) => x.delta !== 0).sort((a, b) => b.shareOfDelta - a.shareOfDelta).slice(0, limit);
  return result;
}

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
  canDecompose: boolean;
}

export function decomposePriceVolumeMix(rows: Row[], s: SchemaMap): Decomposition {
  const { current, previous } = splitPeriods(rows, s);
  const zero: Decomposition = { metric: "revenue", volumeDelta: 0, priceDelta: 0, mixDelta: 0, totalDelta: 0, currentUnits: 0, previousUnits: 0, currentAvgPrice: 0, previousAvgPrice: 0, canDecompose: false };
  if (!s.quantity || !s.unit_price) return zero;
  const quant = (rs: Row[]) => rs.reduce((a, r) => a + A.num(r[s.quantity!]), 0);
  const rev = (rs: Row[]) => rs.reduce((a, r) => a + A.rowRevenue(r, s), 0);
  const q2 = quant(current), q1 = quant(previous);
  const r2 = rev(current), r1 = rev(previous);
  if (q1 === 0 || q2 === 0) return zero;
  const price1 = r1 / q1, price2 = r2 / q2;
  const volumeDelta = (q2 - q1) * price1;
  const priceDelta = q2 * (price2 - price1);
  const totalDelta = r2 - r1;
  const mixDelta = totalDelta - volumeDelta - priceDelta;
  return { metric: "revenue", volumeDelta: round(volumeDelta), priceDelta: round(priceDelta), mixDelta: round(mixDelta), totalDelta: round(totalDelta), currentUnits: round(q2), previousUnits: round(q1), currentAvgPrice: round(price2), previousAvgPrice: round(price1), canDecompose: true };
}

function round(n: number): number { return Math.round(n * 100) / 100; }
