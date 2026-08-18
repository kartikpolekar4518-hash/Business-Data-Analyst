import type { Row } from "./parse.js";
import type { SchemaMap, Semantic } from "./schema.js";
import type { IndustryPack } from "./industries.js";

// The controlled analytics query layer. Everything the "AI" and dashboards can
// compute goes through these deterministic functions — no arbitrary SQL/code.

// Dimension filters accept a single value or a set (OR-matched). A single string
// stays valid, so existing callers are unaffected.
type Dim = string | string[];
export interface Filters {
  dateFrom?: string;
  dateTo?: string;
  region?: Dim;
  state?: Dim;
  category?: Dim;
  department?: Dim;
  product?: Dim;
  customer?: Dim;
}

function num(v: unknown): number {
  if (typeof v === "number") return isFinite(v) ? v : 0;
  if (typeof v === "string") { const n = Number(v.replace(/[$€£₹,()]/g, "").trim()); return isFinite(n) ? n : 0; }
  return 0;
}
function str(v: unknown): string { return v == null ? "" : String(v).trim(); }
function parseDate(v: unknown): Date | null { const d = new Date(str(v)); return isNaN(d.getTime()) ? null : d; }
function monthKey(d: Date): string { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; }

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
  // "YYYY-MM-DD" parses to midnight, so an inclusive dateTo must cover the whole end day.
  const from = f.dateFrom ? new Date(f.dateFrom) : null;
  const to = f.dateTo ? new Date(new Date(f.dateTo).getTime() + 86_399_999) : null;
  return rows.filter((r) => {
    if (s.date && (from || to)) {
      const d = parseDate(r[s.date]);
      if (d) {
        if (from && d < from) return false;
        if (to && d > to) return false;
      }
    }
    const eq = (sem: Semantic, val?: Dim) => {
      // Empty/blank values mean "no filter" (a bare `?region=` shouldn't narrow to blank cells).
      const vals = (val == null ? [] : Array.isArray(val) ? val : [val]).filter((v) => str(v) !== "");
      if (vals.length === 0) return true;
      if (!s[sem]) return false; // filtering on an absent column excludes everything (unchanged)
      const cell = str(r[s[sem]!]).toLowerCase();
      return vals.some((v) => cell === str(v).toLowerCase());
    };
    return eq("region", f.region) && eq("state", f.state) && eq("category", f.category) &&
      eq("department", f.department) && eq("product_name", f.product) && eq("customer_name", f.customer);
  });
}

export interface Kpi { value: number; previous: number; changePct: number | null; }

function pctChange(cur: number, prev: number): number | null {
  if (!prev) return null;
  return Math.round(((cur - prev) / Math.abs(prev)) * 1000) / 10;
}

// Split rows into current vs previous period by the median date, for period-over-period KPIs.
function splitPeriods(rows: Row[], s: SchemaMap): { current: Row[]; previous: Row[] } {
  if (!s.date) return { current: rows, previous: [] };
  const dated = rows.map((r) => ({ r, d: parseDate(r[s.date!]) })).filter((x) => x.d) as { r: Row; d: Date }[];
  if (dated.length < 4) return { current: rows, previous: [] };
  dated.sort((a, b) => a.d.getTime() - b.d.getTime());
  const mid = dated[Math.floor(dated.length / 2)].d.getTime();
  const current: Row[] = [], previous: Row[] = [];
  for (const x of dated) {
    (x.d.getTime() >= mid ? current : previous).push(x.r);
  }
  return { current, previous };
}

export function overview(rows: Row[], s: SchemaMap, f: Filters = {}) {
  const filtered = applyFilters(rows, s, f);
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

// Config-driven KPIs. Each industry pack supplies KPI definitions; this evaluates
// them against the same filtered/current/previous split the retail overview uses,
// so pharmacy, SaaS, etc. get period-over-period change for free.
export interface KpiResult {
  key: string; label: string; icon: string;
  format: "money" | "number" | "percent";
  value: number; changePct: number | null; tooltip?: string;
  spark?: number[];
}

export function computeKpis(rows: Row[], s: SchemaMap, pack: IndustryPack, f: Filters = {}): KpiResult[] {
  const filtered = applyFilters(rows, s, f);
  const { current, previous } = splitPeriods(filtered, s);
  return pack.kpis.map((def) => ({
    key: def.key, label: def.label, icon: def.icon, format: def.format, tooltip: def.tooltip,
    value: round(def.value(filtered, s)),
    changePct: def.noChange ? null : pctChange(def.value(current, s), def.value(previous, s)),
  }));
}

export function timeSeries(rows: Row[], s: SchemaMap, metric: "revenue" | "profit" | "orders", f: Filters = {}) {
  const filtered = applyFilters(rows, s, f);
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

// Generic group-by ranking. dimension is a semantic; metric is revenue/profit/quantity/orders.
export function groupBy(rows: Row[], s: SchemaMap, dimension: Semantic, metric: "revenue" | "profit" | "quantity" | "orders", f: Filters = {}, limit = 10) {
  const col = s[dimension];
  const filtered = applyFilters(rows, s, f);
  if (!col) return [];
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

// Distinct values for a dimension — powers filter dropdowns.
export function distinctValues(rows: Row[], s: SchemaMap, dimension: Semantic): string[] {
  const col = s[dimension];
  if (!col) return [];
  const set = new Set<string>();
  for (const r of rows) { const v = str(r[col]); if (v) set.add(v); }
  return [...set].sort().slice(0, 100);
}

function round(n: number): number { return Math.round(n * 100) / 100; }
// Shared money formatter so reports, insights, and PDFs all render the same figure the same way.
export function fmtMoney(n: unknown): string {
  return "$" + Math.round(num(n)).toLocaleString("en-US");
}

export { rowRevenue, rowProfit, num, str, parseDate, monthKey, applyFilters };
