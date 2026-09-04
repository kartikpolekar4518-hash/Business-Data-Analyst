import type { Row } from "./parse.js";
import type { SchemaMap, Semantic } from "./schema.js";
import type { IndustryPack, PackMetric } from "./industries.js";
import { DEFAULT_CALENDAR, grainKey, isCalendarMonths, type CalendarConfig, type Grain } from "./calendar.js";

export interface Filters {
  dateFrom?: string; dateTo?: string;
  region?: string | string[]; state?: string | string[]; city?: string | string[];
  category?: string | string[]; department?: string | string[];
  product?: string | string[]; customer?: string | string[];
}

export function num(v: unknown): number {
  if (typeof v === "number") return isFinite(v) ? v : 0;
  if (typeof v === "string") { const n = Number(v.replace(/[$€£₹,()]/g, "").trim()); return isFinite(n) ? n : 0; }
  return 0;
}
export function str(v: unknown): string { return v == null ? "" : String(v).trim(); }
export function parseDate(v: unknown): Date | null { const d = new Date(str(v)); return isNaN(d.getTime()) ? null : d; }
// Gregorian month bucket. Kept as the calendar-agnostic primitive and as the fixed
// point calendar.test.ts asserts DEFAULT_CALENDAR against; period bucketing itself now
// goes through grainKey(d, cal, grain) so a fiscal or retail calendar can change it.
export function monthKey(d: Date): string { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; }
export function rowRevenue(r: Row, s: SchemaMap): number {
  if (s.revenue) return num(r[s.revenue]); if (s.sales) return num(r[s.sales]);
  if (s.quantity && s.unit_price) return num(r[s.quantity]) * num(r[s.unit_price]); return 0;
}

// Which branch rowRevenue takes, as data, so the evidence layer can state the actual
// formula instead of guessing. Deliberately NOT called from rowRevenue: that runs per
// row over every metric and would allocate an object each time. The branch order here
// mirrors rowRevenue's and analytics.test.ts asserts the two agree for every shape.
export type RevenueSource =
  | { kind: "column"; semantic: "revenue" | "sales"; columns: string[]; expression: string }
  | { kind: "derived"; semantic: "quantity_x_unit_price"; columns: string[]; expression: string }
  | { kind: "unavailable"; semantic: null; columns: []; expression: string };
export function revenueSource(s: SchemaMap): RevenueSource {
  if (s.revenue) return { kind: "column", semantic: "revenue", columns: [s.revenue], expression: `SUM(${s.revenue})` };
  if (s.sales) return { kind: "column", semantic: "sales", columns: [s.sales], expression: `SUM(${s.sales})` };
  if (s.quantity && s.unit_price) return { kind: "derived", semantic: "quantity_x_unit_price", columns: [s.quantity, s.unit_price], expression: `SUM(${s.quantity} × ${s.unit_price})` };
  return { kind: "unavailable", semantic: null, columns: [], expression: "0 (no revenue column detected)" };
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
    return eq("region", f.region) && eq("state", f.state) && eq("city", f.city) && eq("category", f.category) && eq("department", f.department) && eq("product_name", f.product) && eq("customer_name", f.customer);
  });
}

export interface Kpi { value: number; previous: number; changePct: number | null; }
function pctChange(cur: number, prev: number): number | null { if (!prev) return null; return Math.round(((cur - prev) / Math.abs(prev)) * 1000) / 10; }
// ─── Comparison period ───────────────────────────────────────────────────────
// V1 policy, deliberately narrow and calendar-agnostic:
//
//   previous = the interval of EQUAL DURATION immediately preceding the current one.
//
// No calendar-month/fiscal-year/retail-week inference, no seasonality adjustment,
// no hidden fallback. When the data cannot support that comparison the basis is
// "unavailable" and callers must show "comparison unavailable" rather than a
// manufactured percentage.
//
// `rows` must be the un-date-filtered set: the previous window lies OUTSIDE any
// date filter, so date bounds are applied here rather than by the caller. Dimension
// filters bound the whole comparison universe; date filters bound only `current`.
//
// V2 adds ONE alternative, chosen by the caller and never inferred:
//
//   previous_year = the same window shifted back a year.
//
// Everything else about the policy is unchanged, and `previous_period` remains the
// default, so every existing call site returns exactly the numbers it always did.
export type Comparison = "previous_period" | "previous_year";
export type ComparisonBasis = "trailing_equal_period" | "same_period_last_year" | "unavailable";
export type ComparisonReason = "no_date_column" | "insufficient_history" | "no_prior_data";
// Any basis other than "unavailable" carries a real prior window, so drivers,
// attribution and "Why this number" are all valid against it.
export const isComparable = (b: ComparisonBasis): boolean => b !== "unavailable";
// How `current` was chosen: from an explicit date filter, or — with no date filter —
// the trailing half of the available span (by duration, never by row count).
export type CurrentSource = "filter" | "trailing_half";
export interface PeriodSplit {
  current: Row[]; previous: Row[];
  basis: ComparisonBasis; reason: ComparisonReason | null; currentSource: CurrentSource | null;
  currentRange: [string, string] | null;   // inclusive ISO dates
  previousRange: [string, string] | null;
}
const DAY = 86_400_000;
const MIN_DATED_ROWS = 4;
const floorDay = (t: number) => Math.floor(t / DAY) * DAY;
const isoDay = (t: number) => new Date(t).toISOString().slice(0, 10);

// A retail year is 52 whole weeks. Shifting a 4-4-5 window by calendar dates would land
// it on different weekdays and so on a different retail period, which is the one thing a
// retail calendar exists to prevent — 364 days keeps weekday and period alignment.
const RETAIL_YEAR = 364 * DAY;
// Same calendar date one year earlier. Feb 29 has no counterpart in a common year;
// clamping to Feb 28 keeps the window inside the month the user asked about instead of
// sliding it into March.
function sameDateLastYear(t: number): number {
  const d = new Date(t);
  const y = d.getUTCFullYear() - 1, m = d.getUTCMonth();
  const lastOfMonth = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return Date.UTC(y, m, Math.min(d.getUTCDate(), lastOfMonth));
}

// `compare` and `cal` are optional trailing arguments: omitting them reproduces the V1
// behaviour exactly. `cal` is consulted only for previous_year, and only to decide
// between calendar-date and 52-week alignment.
export function splitPeriods(
  rows: Row[], s: SchemaMap, f: Filters = {},
  compare: Comparison = "previous_period", cal: CalendarConfig = DEFAULT_CALENDAR,
): PeriodSplit {
  const none = (reason: ComparisonReason, current: Row[]): PeriodSplit =>
    ({ current, previous: [], basis: "unavailable", reason, currentSource: null, currentRange: null, previousRange: null });
  if (!s.date) return none("no_date_column", applyFilters(rows, s, f));

  const { dateFrom, dateTo, ...dims } = f;
  const scope = applyFilters(rows, s, dims);      // comparison universe
  const filtered = applyFilters(scope, s, f);     // caller's current view
  const times: number[] = [];
  for (const r of filtered) { const d = parseDate(r[s.date!]); if (d) times.push(d.getTime()); }

  let startMs: number, endExclMs: number, currentSource: CurrentSource;
  if (dateFrom || dateTo) {
    // Any date bound defines the current window; the missing side comes from the data.
    // A partial bound must NOT fall through to the trailing-half path — that would
    // derive a window from the filtered rows and then draw `previous` from outside the
    // user's own filter.
    if ((!dateFrom || !dateTo) && !times.length) return none("insufficient_history", filtered);
    let dataMin = times[0], dataMax = times[0];
    for (const t of times) { if (t < dataMin) dataMin = t; if (t > dataMax) dataMax = t; }
    startMs = floorDay(dateFrom ? new Date(dateFrom).getTime() : dataMin);
    endExclMs = floorDay(dateTo ? new Date(dateTo).getTime() : dataMax) + DAY;
    currentSource = "filter";
    // The window is the caller's; row count is not a precondition for comparing
    // against it. One day of current data against a populated prior day is valid.
  } else {
    if (times.length < MIN_DATED_ROWS) return none("insufficient_history", filtered);
    let min = times[0], max = times[0];
    for (const t of times) { if (t < min) min = t; if (t > max) max = t; }
    min = floorDay(min); max = floorDay(max) + DAY;
    // Halve the span in WHOLE DAYS. Rounding up here would make `previous` reach past
    // the first row and cover one more day than `current`, which reports growth on
    // perfectly flat data. An odd leftover day is dropped from the oldest end instead,
    // so both windows cover exactly the same duration and both sit inside the data.
    const half = Math.floor((max - min) / DAY / 2) * DAY;
    if (half <= 0) return none("insufficient_history", filtered);
    endExclMs = max; startMs = max - half;
    currentSource = "trailing_half";
  }
  // filterSchema accepts YYYY-MM-DD *shapes* that are not real dates ("2026-13-45"),
  // which parse to NaN. NaN comparisons are all false, so this would otherwise reach a
  // safe answer by accident and report the wrong reason for it.
  if (!isFinite(startMs) || !isFinite(endExclMs)) return none("insufficient_history", filtered);
  const duration = endExclMs - startMs;
  if (duration <= 0) return none("insufficient_history", filtered);

  const inWindow = (from: number, toExcl: number) => (r: Row) => {
    const d = parseDate(r[s.date!]); if (!d) return false;
    const t = d.getTime(); return t >= from && t < toExcl;
  };
  const current = filtered.filter(inWindow(startMs, endExclMs));

  // The prior window. previous_period abuts the current one; previous_year lands a year
  // back and so may cover a different number of days (a leap February against a common
  // one). That is what "the same dates last year" means, and both ranges are reported
  // below so the difference is visible rather than hidden inside a percentage.
  let prevStartMs: number, prevEndExclMs: number, basis: ComparisonBasis;
  if (compare === "previous_year") {
    const shift = isCalendarMonths(cal)
      ? (t: number) => sameDateLastYear(t)
      : (t: number) => t - RETAIL_YEAR;
    prevStartMs = shift(startMs); prevEndExclMs = shift(endExclMs);
    basis = "same_period_last_year";
  } else {
    prevStartMs = startMs - duration; prevEndExclMs = startMs;
    basis = "trailing_equal_period";
  }
  if (prevEndExclMs <= prevStartMs) return none("insufficient_history", current.length ? current : filtered);

  const previous = scope.filter(inWindow(prevStartMs, prevEndExclMs));
  if (!previous.length) return none("no_prior_data", current.length ? current : filtered);

  return {
    current, previous, basis, reason: null, currentSource,
    currentRange: [isoDay(startMs), isoDay(endExclMs - DAY)],
    previousRange: [isoDay(prevStartMs), isoDay(prevEndExclMs - DAY)],
  };
}

export function overview(rows: Row[], s: SchemaMap, f: Filters = {}, compare: Comparison = "previous_period", cal: CalendarConfig = DEFAULT_CALENDAR) {
  const filtered = applyFilters(rows, s, f); const { current, previous } = splitPeriods(rows, s, f, compare, cal);
  const sum = (rs: Row[], fn: (r: Row) => number) => rs.reduce((a, r) => a + fn(r), 0);
  const orderCount = (rs: Row[]) => s.order_id ? new Set(rs.map((r) => str(r[s.order_id!]))).size : rs.length;
  const customerCount = (rs: Row[]) => s.customer_id ? new Set(rs.map((r) => str(r[s.customer_id!]))).size : s.customer_name ? new Set(rs.map((r) => str(r[s.customer_name!]))).size : 0;
  const revenue = sum(filtered, (r) => rowRevenue(r, s)); const profit = sum(filtered, (r) => rowProfit(r, s));
  const curRev = sum(current, (r) => rowRevenue(r, s)); const prevRev = sum(previous, (r) => rowRevenue(r, s));
  const kpi = (value: number, cur: number, prev: number): Kpi => ({ value, previous: prev, changePct: pctChange(cur, prev) });
  return { revenue: kpi(revenue, curRev, prevRev), profit: kpi(profit, sum(current, (r) => rowProfit(r, s)), sum(previous, (r) => rowProfit(r, s))), orders: kpi(orderCount(filtered), orderCount(current), orderCount(previous)), customers: kpi(customerCount(filtered), customerCount(current), customerCount(previous)), growth: pctChange(curRev, prevRev), profitMargin: revenue ? Math.round((profit / revenue) * 1000) / 10 : 0 };
}

export interface KpiResult { key: string; label: string; icon: string; format: "money" | "number" | "percent"; value: number; changePct: number | null; tooltip?: string; spark?: number[]; }
export function computeKpis(rows: Row[], s: SchemaMap, pack: IndustryPack, f: Filters = {}, compare: Comparison = "previous_period", cal: CalendarConfig = DEFAULT_CALENDAR): KpiResult[] {
  const filtered = applyFilters(rows, s, f); const { current, previous } = splitPeriods(rows, s, f, compare, cal);
  return pack.kpis.map((def) => ({ key: def.key, label: def.label, icon: def.icon, format: def.format, tooltip: def.tooltip, value: round(def.value(filtered, s)), changePct: def.noChange ? null : pctChange(def.value(current, s), def.value(previous, s)) }));
}

export type MetricRef = "revenue" | "profit" | "quantity" | "orders" | PackMetric;
function metricValue(metric: MetricRef, r: Row, s: SchemaMap): number {
  if (typeof metric === "object") return metric.compute([r], s);
  switch (metric) { case "revenue": return rowRevenue(r, s); case "profit": return rowProfit(r, s); case "quantity": return s.quantity ? num(r[s.quantity]) : 1; case "orders": return 1; }
}
// `cal` defaults to DEFAULT_CALENDAR, which buckets exactly as monthKey always did, so
// an organization that has never set a business calendar sees identical numbers.
// `grain` is the date-drill position: "period" is the historic behaviour and the default,
// so no existing call site changes and no existing series re-buckets. A coarser grain is
// only ever passed once the caller has narrowed to a year or a quarter.
export function timeSeries(rows: Row[], s: SchemaMap, metric: MetricRef, f: Filters = {}, cal: CalendarConfig = DEFAULT_CALENDAR, grain: Grain = "period") {
  const filtered = applyFilters(rows, s, f); if (!s.date) return [];
  if (typeof metric === "object") {
    const buckets = new Map<string, Row[]>(); for (const r of filtered) { const d = parseDate(r[s.date!]); if (!d) continue; const key = grainKey(d, cal, grain); const bucket = buckets.get(key) ?? []; bucket.push(r); buckets.set(key, bucket); }
    return [...buckets.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([period, bucket]) => ({ period, value: round(metric.compute(bucket, s)) }));
  }
  const buckets = new Map<string, number>(); for (const r of filtered) { const d = parseDate(r[s.date!]); if (!d) continue; const key = grainKey(d, cal, grain); buckets.set(key, (buckets.get(key) || 0) + metricValue(metric, r, s)); }
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
export function round(n: number): number { return Math.round(n * 100) / 100; }
export function fmt(n: number): string {
  const v = num(n);
  return Math.abs(v) >= 1000 ? v.toLocaleString(undefined, { maximumFractionDigits: 0 }) : String(round(v));
}
export function fmtMoney(n: unknown): string { return "$" + Math.round(num(n)).toLocaleString("en-US"); }
