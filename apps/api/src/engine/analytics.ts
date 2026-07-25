import { type Row, num, str } from "./parse.js";
import type { SchemaMap, Semantic } from "./schema.js";

// The controlled analytics query layer. Everything the "AI" and dashboards can
// compute goes through these deterministic functions — no arbitrary SQL/code.

export interface Filters {
  dateFrom?: string;
  dateTo?: string;
  region?: string;
  state?: string;
  category?: string;
  department?: string;
  product?: string;
  customer?: string;
}

// Parse a value to a Date, anchoring date-only strings at UTC midnight so that
// month bucketing is timezone-independent (getUTC* used consistently below).
function parseDate(v: unknown): Date | null {
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
  const s = str(v);
  if (!s) return null;
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (iso) return new Date(Date.UTC(+iso[1], +iso[2] - 1, +iso[3]));
  const us = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(s); // MM/DD/YYYY
  if (us) return new Date(Date.UTC(+us[3], +us[1] - 1, +us[2]));
  const d = new Date(s); // datetimes with explicit time/offset
  return isNaN(d.getTime()) ? null : d;
}
function monthKey(d: Date): string { return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`; }

// Compute revenue for a row: explicit revenue col, else quantity*unit_price.
function rowRevenue(r: Row, s: SchemaMap): number {
  if (s.revenue) return num(r[s.revenue]);
  if (s.sales) return num(r[s.sales]);
  if (s.quantity && s.unit_price) return num(r[s.quantity]) * num(r[s.unit_price]);
  return 0;
}
function rowProfit(r: Row, s: SchemaMap): number {
  if (s.profit) return num(r[s.profit]);
  if (s.cost) return rowRevenue(r, s) - num(r[s.cost]);
  return 0;
}

function applyFilters(rows: Row[], s: SchemaMap, f: Filters): Row[] {
  // "YYYY-MM-DD" parses to UTC midnight, so an inclusive dateTo must cover the whole end day.
  const from = f.dateFrom ? new Date(f.dateFrom) : null;
  const to = f.dateTo ? new Date(new Date(f.dateTo).getTime() + 86_399_999) : null;
  if (!from && !to && !f.region && !f.state && !f.category && !f.department && !f.product && !f.customer) return rows;
  return rows.filter((r) => {
    if (s.date && (from || to)) {
      const d = parseDate(r[s.date]);
      if (d) {
        if (from && d < from) return false;
        if (to && d > to) return false;
      }
    }
    const eq = (sem: Semantic, val?: string) => !val || (s[sem] && str(r[s[sem]!]).toLowerCase() === val.toLowerCase());
    return eq("region", f.region) && eq("state", f.state) && eq("category", f.category) &&
      eq("department", f.department) && eq("product_name", f.product) && eq("customer_name", f.customer);
  });
}

export interface Kpi { value: number; previous: number; changePct: number | null; }

function pctChange(cur: number, prev: number): number | null {
  if (!prev) return null;
  return Math.round(((cur - prev) / Math.abs(prev)) * 1000) / 10;
}

// Split already-filtered rows into first/second half by the median date.
// Shared by overview's period-over-period KPIs and insights' half-vs-half analysis.
export function splitByMedianDate(rows: Row[], s: SchemaMap): { first: Row[]; second: Row[] } {
  if (!s.date) return { first: [], second: [] };
  const dated = rows.map((r) => ({ r, d: parseDate(r[s.date!]) })).filter((x) => x.d) as { r: Row; d: Date }[];
  if (!dated.length) return { first: [], second: [] };
  dated.sort((a, b) => a.d.getTime() - b.d.getTime());
  const mid = dated[Math.floor(dated.length / 2)].d.getTime();
  const first: Row[] = [], second: Row[] = [];
  for (const x of dated) (x.d.getTime() >= mid ? second : first).push(x.r);
  return { first, second };
}

// Current vs previous period for KPIs. Needs at least 4 dated rows to be meaningful.
function splitPeriods(rows: Row[], s: SchemaMap): { current: Row[]; previous: Row[] } {
  if (!s.date) return { current: rows, previous: [] };
  const { first, second } = splitByMedianDate(rows, s);
  if (first.length + second.length < 4) return { current: rows, previous: [] };
  return { current: second, previous: first };
}

function overviewOn(filtered: Row[], s: SchemaMap) {
  const { current, previous } = splitPeriods(filtered, s);
  const sum = (rs: Row[], fn: (r: Row) => number) => rs.reduce((a, r) => a + fn(r), 0);

  // Distinct-count helpers, applied consistently to filtered/current/previous so the
  // KPI value and its period-over-period change are measured on the same basis.
  const orderCount = (rs: Row[]) => s.order_id ? new Set(rs.map((r) => str(r[s.order_id!]))).size : rs.length;
  const customerCount = (rs: Row[]) => s.customer_id ? new Set(rs.map((r) => str(r[s.customer_id!]))).size
    : s.customer_name ? new Set(rs.map((r) => str(r[s.customer_name!]))).size : 0;

  const revenue = sum(filtered, (r) => rowRevenue(r, s));
  const profit = sum(filtered, (r) => rowProfit(r, s));

  const curRev = sum(current, (r) => rowRevenue(r, s));
  const prevRev = sum(previous, (r) => rowRevenue(r, s));

  const kpi = (value: number, cur: number, prev: number): Kpi => ({ value, previous: prev, changePct: pctChange(cur, prev) });

  return {
    revenue: kpi(revenue, curRev, prevRev),
    profit: kpi(profit, sum(current, (r) => rowProfit(r, s)), sum(previous, (r) => rowProfit(r, s))),
    orders: kpi(orderCount(filtered), orderCount(current), orderCount(previous)),
    customers: kpi(customerCount(filtered), customerCount(current), customerCount(previous)),
    growth: pctChange(curRev, prevRev),
    profitMargin: revenue ? Math.round((profit / revenue) * 1000) / 10 : 0,
  };
}

export function overview(rows: Row[], s: SchemaMap, f: Filters = {}) {
  return overviewOn(applyFilters(rows, s, f), s);
}

function timeSeriesOn(filtered: Row[], s: SchemaMap, metric: "revenue" | "profit" | "orders") {
  if (!s.date) return [];
  const buckets = new Map<string, number>();
  for (const r of filtered) {
    const d = parseDate(r[s.date!]);
    if (!d) continue;
    const key = monthKey(d);
    const val = metric === "revenue" ? rowRevenue(r, s) : metric === "profit" ? rowProfit(r, s) : 1;
    buckets.set(key, (buckets.get(key) || 0) + val);
  }
  return [...buckets.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([period, value]) => ({ period, value: round(value) }));
}

export function timeSeries(rows: Row[], s: SchemaMap, metric: "revenue" | "profit" | "orders", f: Filters = {}) {
  return timeSeriesOn(applyFilters(rows, s, f), s, metric);
}

// Generic group-by ranking on already-filtered rows.
function groupByOn(filtered: Row[], s: SchemaMap, dimension: Semantic, metric: "revenue" | "profit" | "quantity" | "orders", limit: number) {
  const col = s[dimension];
  if (!col) return [];

  // "orders" counts distinct order IDs per group (consistent with the orders KPI),
  // falling back to row count when there is no order-id column.
  if (metric === "orders" && s.order_id) {
    const sets = new Map<string, Set<string>>();
    for (const r of filtered) {
      const key = str(r[col]) || "Unknown";
      let set = sets.get(key);
      if (!set) { set = new Set(); sets.set(key, set); }
      set.add(str(r[s.order_id!]));
    }
    return [...sets.entries()].map(([label, set]) => ({ label, value: set.size })).sort((a, b) => b.value - a.value).slice(0, limit);
  }

  const buckets = new Map<string, number>();
  for (const r of filtered) {
    const key = str(r[col]) || "Unknown";
    const val = metric === "revenue" ? rowRevenue(r, s) : metric === "profit" ? rowProfit(r, s)
      : metric === "quantity" ? num(s.quantity ? r[s.quantity] : 1) : 1;
    buckets.set(key, (buckets.get(key) || 0) + val);
  }
  return [...buckets.entries()]
    .map(([label, value]) => ({ label, value: round(value) }))
    .sort((a, b) => b.value - a.value)
    .slice(0, limit);
}

export function groupBy(rows: Row[], s: SchemaMap, dimension: Semantic, metric: "revenue" | "profit" | "quantity" | "orders", f: Filters = {}, limit = 10) {
  return groupByOn(applyFilters(rows, s, f), s, dimension, metric, limit);
}

// Distinct values for a dimension — powers filter dropdowns.
export function distinctValues(rows: Row[], s: SchemaMap, dimension: Semantic): string[] {
  const col = s[dimension];
  if (!col) return [];
  const set = new Set<string>();
  for (const r of rows) { const v = str(r[col]); if (v) set.add(v); }
  return [...set].sort().slice(0, 100);
}

// Everything the dashboard's /overview endpoint needs, applying filters ONCE
// (previously each of ~13 sub-calls re-scanned the full dataset). Filter options
// are computed from the unfiltered rows so the dropdowns don't collapse as you filter.
export function dashboardBundle(rows: Row[], s: SchemaMap, f: Filters = {}) {
  const filtered = applyFilters(rows, s, f);
  return {
    overview: overviewOn(filtered, s),
    revenueTrend: timeSeriesOn(filtered, s, "revenue"),
    profitTrend: timeSeriesOn(filtered, s, "profit"),
    topProducts: groupByOn(filtered, s, "product_name", "revenue", 8),
    topCustomers: groupByOn(filtered, s, "customer_name", "revenue", 8),
    regions: groupByOn(filtered, s, "region", "revenue", 10),
    categories: groupByOn(filtered, s, "category", "revenue", 10),
    filterOptions: {
      region: distinctValues(rows, s, "region"),
      state: distinctValues(rows, s, "state"),
      category: distinctValues(rows, s, "category"),
      department: distinctValues(rows, s, "department"),
      product: distinctValues(rows, s, "product_name"),
      customer: distinctValues(rows, s, "customer_name"),
    },
  };
}

function round(n: number): number { return Math.round(n * 100) / 100; }
// Shared money formatter so reports, insights, and PDFs all render the same figure the same way.
export function fmtMoney(n: unknown): string {
  return "$" + Math.round(num(n)).toLocaleString("en-US");
}

export { rowRevenue, rowProfit, num, str, parseDate, monthKey, applyFilters };
