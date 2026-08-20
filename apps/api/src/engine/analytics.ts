import type { Row } from "./parse.js";
import type { SchemaMap, Semantic } from "./schema.js";
import type { IndustryPack, PackMetric } from "./industries.js";

export interface Filters {
  dateFrom?: string; dateTo?: string;
  region?: string | string[]; state?: string | string[]; category?: string | string[];
  department?: string | string[]; product?: string | string[]; customer?: string | string[];
}

export function num(v: unknown): number {
  if (typeof v === "number") return isFinite(v) ? v : 0;
  if (typeof v === "string") { const n = Number(v.replace(/[$€£₹,()]/g, "").trim()); return isFinite(n) ? n : 0; }
  return 0;
}
export function str(v: unknown): string { return v == null ? "" : String(v).trim(); }
export function parseDate(v: unknown): Date | null { const d = new Date(str(v)); return isNaN(d.getTime()) ? null : d; }
export function monthKey(d: Date): string { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; }
export function rowRevenue(r: Row, s: SchemaMap): number {
  if (s.revenue) return num(r[s.revenue]); if (s.sales) return num(r[s.sales]);
  if (s.quantity && s.unit_price) return num(r[s.quantity]) * num(r[s.unit_price]); return 0;
}
export function rowProfit(r: Row, s: SchemaMap): number { if (s.profit) return num(r[s.profit]); if (s.cost) return rowRevenue(r, s) - num(r[s.cost]); return 0; }

export function applyFilters(rows: Row[], s: SchemaMap, f: Filters): Row[] {
  const dateOnly = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v);
  const from = f.dateFrom ? new Date(f.dateFrom) : null;
  const to = f.dateTo ? new Date(new Date(f.dateTo).getTime() + (dateOnly(f.dateTo) ? 86_399_999 : 0)) : null;
  return rows.filter((r) => {
    if (s.date && (from || to)) { const d = parseDate(r[s.date]); if (d) { if (from && d < from) return false; if (to && d > to) return false; } }
    const eq = (sem: Semantic, val?: string | string[]) => {
      const vals = (val == null ? [] : Array.isArray(val) ? val : [val]).filter((v) => str(v) !== "");
      if (!vals.length) return true; if (!s[sem]) return false;
      const cell = str(r[s[sem]!]).toLowerCase(); return vals.some((v) => cell === str(v).toLowerCase());
    };
    return eq("region", f.region) && eq("state", f.state) && eq("category", f.category) && eq("department", f.department) && eq("product_name", f.product) && eq("customer_name", f.customer);
  });
}

export interface Kpi { value: number; previous: number; changePct: number | null; }
function pctChange(cur: number, prev: number): number | null { if (!prev) return null; return Math.round(((cur - prev) / Math.abs(prev)) * 1000) / 10; }
export function splitPeriods(rows: Row[], s: SchemaMap): { current: Row[]; previous: Row[] } {
  if (!s.date) return { current: rows, previous: [] };
  const dated = rows.map((r) => ({ r, d: parseDate(r[s.date!]) })).filter((x) => x.d) as { r: Row; d: Date }[];
  if (dated.length < 4) return { current: rows, previous: [] };
  dated.sort((a, b) => a.d.getTime() - b.d.getTime()); const mid = dated[Math.floor(dated.length / 2)].d.getTime();
  const current: Row[] = [], previous: Row[] = []; for (const x of dated) (x.d.getTime() >= mid ? current : previous).push(x.r); return { current, previous };
}

export function overview(rows: Row[], s: SchemaMap, f: Filters = {}) {
  const filtered = applyFilters(rows, s, f); const { current, previous } = splitPeriods(filtered, s);
  const sum = (rs: Row[], fn: (r: Row) => number) => rs.reduce((a, r) => a + fn(r), 0);
  const orderCount = (rs: Row[]) => s.order_id ? new Set(rs.map((r) => str(r[s.order_id!]))).size : rs.length;
  const customerCount = (rs: Row[]) => s.customer_id ? new Set(rs.map((r) => str(r[s.customer_id!]))).size : s.customer_name ? new Set(rs.map((r) => str(r[s.customer_name!]))).size : 0;
  const revenue = sum(filtered, (r) => rowRevenue(r, s)); const profit = sum(filtered, (r) => rowProfit(r, s));
  const curRev = sum(current, (r) => rowRevenue(r, s)); const prevRev = sum(previous, (r) => rowRevenue(r, s));
  const kpi = (value: number, cur: number, prev: number): Kpi => ({ value, previous: prev, changePct: pctChange(cur, prev) });
  return { revenue: kpi(revenue, curRev, prevRev), profit: kpi(profit, sum(current, (r) => rowProfit(r, s)), sum(previous, (r) => rowProfit(r, s))), orders: kpi(orderCount(filtered), orderCount(current), orderCount(previous)), customers: kpi(customerCount(filtered), customerCount(current), customerCount(previous)), growth: pctChange(curRev, prevRev), profitMargin: revenue ? Math.round((profit / revenue) * 1000) / 10 : 0 };
}

export interface KpiResult { key: string; label: string; icon: string; format: "money" | "number" | "percent"; value: number; changePct: number | null; tooltip?: string; spark?: number[]; }
export function computeKpis(rows: Row[], s: SchemaMap, pack: IndustryPack, f: Filters = {}): KpiResult[] {
  const filtered = applyFilters(rows, s, f); const { current, previous } = splitPeriods(filtered, s);
  return pack.kpis.map((def) => ({ key: def.key, label: def.label, icon: def.icon, format: def.format, tooltip: def.tooltip, value: round(def.value(filtered, s)), changePct: def.noChange ? null : pctChange(def.value(current, s), def.value(previous, s)) }));
}

export type MetricRef = "revenue" | "profit" | "quantity" | "orders" | PackMetric;
function metricValue(metric: MetricRef, r: Row, s: SchemaMap): number {
  if (typeof metric === "object") return metric.compute([r], s);
  switch (metric) { case "revenue": return rowRevenue(r, s); case "profit": return rowProfit(r, s); case "quantity": return s.quantity ? num(r[s.quantity]) : 1; case "orders": return 1; }
}
export function timeSeries(rows: Row[], s: SchemaMap, metric: MetricRef, f: Filters = {}) {
  const filtered = applyFilters(rows, s, f); if (!s.date) return [];
  if (typeof metric === "object") {
    const buckets = new Map<string, Row[]>(); for (const r of filtered) { const d = parseDate(r[s.date!]); if (!d) continue; const key = monthKey(d); const bucket = buckets.get(key) ?? []; bucket.push(r); buckets.set(key, bucket); }
    return [...buckets.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([period, bucket]) => ({ period, value: round(metric.compute(bucket, s)) }));
  }
  const buckets = new Map<string, number>(); for (const r of filtered) { const d = parseDate(r[s.date!]); if (!d) continue; const key = monthKey(d); buckets.set(key, (buckets.get(key) || 0) + metricValue(metric, r, s)); }
  return [...buckets.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([period, value]) => ({ period, value: round(value) }));
}
export function groupBy(rows: Row[], s: SchemaMap, dimension: Semantic, metric: MetricRef, f: Filters = {}, limit = 10) {
  const col = s[dimension]; const filtered = applyFilters(rows, s, f); if (!col) return [];
  if (typeof metric === "object") {
    const buckets = new Map<string, Row[]>(); for (const r of filtered) { const key = str(r[col]) || "Unknown"; const bucket = buckets.get(key) ?? []; bucket.push(r); buckets.set(key, bucket); }
    return [...buckets.entries()].map(([label, bucket]) => ({ label, value: round(metric.compute(bucket, s)) })).sort((a, b) => b.value - a.value).slice(0, limit);
  }
  const buckets = new Map<string, number>(); for (const r of filtered) { const key = str(r[col]) || "Unknown"; buckets.set(key, (buckets.get(key) || 0) + metricValue(metric, r, s)); }
  return [...buckets.entries()].map(([label, value]) => ({ label, value: round(value) })).sort((a, b) => b.value - a.value).slice(0, limit);
}
export function distinctValues(rows: Row[], s: SchemaMap, dimension: Semantic): string[] { const col = s[dimension]; if (!col) return []; const set = new Set<string>(); for (const r of rows) { const v = str(r[col]); if (v) set.add(v); } return [...set].sort().slice(0, 100); }
function round(n: number): number { return Math.round(n * 100) / 100; }
export function fmtMoney(n: unknown): string { return "$" + Math.round(num(n)).toLocaleString("en-US"); }
