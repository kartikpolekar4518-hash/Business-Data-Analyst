// Industry packs — the single place a business type is defined.
// A pack is data, not code paths: it declares the extra vocabulary to recognise,
// which KPIs matter (and how to compute them from detected columns), and how the
// dashboard should be labelled. Adding a new industry = adding one entry here.
import type { Row } from "./parse.js";
import type { ColumnProfile } from "./profile.js";
import { detectSchema, type SchemaMap, type Semantic, type SemanticRule } from "./schema.js";
import { rowRevenue, rowProfit, str } from "./analytics.js";

export interface KpiDef {
  key: string;
  label: string;
  icon: string; // frontend icon key (mapped to a lucide icon in the dashboard)
  format: "money" | "number" | "percent";
  tooltip?: string;
  noChange?: boolean; // derived ratios (margin, ARPU) have no meaningful period-over-period pill
  value: (rows: Row[], s: SchemaMap) => number;
}

export interface RankSectionDef {
  dimension: Semantic;
  metric: "revenue" | "profit" | "quantity" | "orders";
  title: string;
  subtitle: string;
  emptyText: string;
  format: "money" | "number";
  limit: number;
}

export interface CompositionDef {
  dimension: Semantic;
  fallback?: Semantic;
  title: string;
  subtitle: string;
  centerLabel: string;
}

export interface IndustryPack {
  key: string;
  label: string;
  rules: SemanticRule[]; // extra detection vocabulary, runs before the base retail rules
  signals: Semantic[]; // distinctive semantics used to auto-suggest this industry
  kpis: KpiDef[];
  trend: { title: string; subtitle: string };
  composition: CompositionDef;
  ranking: RankSectionDef;
  secondary: RankSectionDef;
}

// ── KPI value helpers (all reuse the deterministic analytics primitives) ──
const sumRevenue = (rows: Row[], s: SchemaMap) => rows.reduce((a, r) => a + rowRevenue(r, s), 0);
const sumProfit = (rows: Row[], s: SchemaMap) => rows.reduce((a, r) => a + rowProfit(r, s), 0);
const distinct = (sem: Semantic) => (rows: Row[], s: SchemaMap) =>
  s[sem] ? new Set(rows.map((r) => str(r[s[sem]!])).filter(Boolean)).size : 0;
const distinctOrCount = (sem: Semantic) => (rows: Row[], s: SchemaMap) =>
  s[sem] ? new Set(rows.map((r) => str(r[s[sem]!])).filter(Boolean)).size : rows.length;
const distinctCustomers = (rows: Row[], s: SchemaMap) =>
  (s.customer_id ? distinct("customer_id") : distinct("customer_name"))(rows, s);
const marginPct = (rows: Row[], s: SchemaMap) => {
  const rev = sumRevenue(rows, s);
  return rev ? (sumProfit(rows, s) / rev) * 100 : 0;
};
const ratio = (top: (r: Row[], s: SchemaMap) => number, bottom: (r: Row[], s: SchemaMap) => number) =>
  (rows: Row[], s: SchemaMap) => { const d = bottom(rows, s); return d ? top(rows, s) / d : 0; };

const RETAIL: IndustryPack = {
  key: "retail",
  label: "Retail / Sales",
  rules: [],
  signals: ["order_id", "product_name", "region", "category"],
  kpis: [
    { key: "revenue", label: "Revenue", icon: "revenue", format: "money", value: sumRevenue, tooltip: "Sum of revenue (or quantity × unit price) across all rows." },
    { key: "profit", label: "Profit", icon: "profit", format: "money", value: sumProfit, tooltip: "Revenue minus cost." },
    { key: "orders", label: "Orders", icon: "orders", format: "number", value: distinctOrCount("order_id"), tooltip: "Distinct order IDs (or row count if no order ID column)." },
    { key: "customers", label: "Customers", icon: "customers", format: "number", value: distinctCustomers, tooltip: "Distinct customers detected in the dataset." },
    { key: "margin", label: "Margin", icon: "margin", format: "percent", noChange: true, value: marginPct, tooltip: "Profit as a share of revenue." },
  ],
  trend: { title: "Performance Overview", subtitle: "Revenue & profit over time" },
  composition: { dimension: "category", fallback: "region", title: "Revenue Composition", subtitle: "Share by category", centerLabel: "Revenue" },
  ranking: { dimension: "product_name", metric: "revenue", title: "Top Products", subtitle: "Ranked by revenue", emptyText: "No product column detected", format: "money", limit: 8 },
  secondary: { dimension: "region", metric: "revenue", title: "Region Performance", subtitle: "By revenue", emptyText: "No region column detected", format: "money", limit: 10 },
};

const PHARMACY: IndustryPack = {
  key: "pharmacy",
  label: "Pharmacy",
  rules: [
    { semantic: "prescription_id", patterns: [/prescription/, /rx[_ ]?(no|id)/, /^rx$/] },
    { semantic: "medicine_name", patterns: [/medicine/, /drug/, /^med(icine)?[_ ]?name$/, /^med$/] },
    { semantic: "patient_id", patterns: [/patient/, /^mrn$/] },
    { semantic: "revenue", patterns: [/bill[_ ]?amount/, /total[_ ]?price/, /net[_ ]?amount/, /amount/] },
  ],
  signals: ["prescription_id", "medicine_name", "patient_id"],
  kpis: [
    { key: "prescriptions", label: "Prescriptions", icon: "prescriptions", format: "number", value: distinctOrCount("prescription_id"), tooltip: "Distinct prescriptions filled (or row count)." },
    { key: "revenue", label: "Revenue", icon: "revenue", format: "money", value: sumRevenue, tooltip: "Total sales value across all rows." },
    { key: "patients", label: "Patients", icon: "patients", format: "number", value: distinct("patient_id"), tooltip: "Distinct patients served." },
    { key: "medicines", label: "Medicines", icon: "medicines", format: "number", value: distinct("medicine_name"), tooltip: "Distinct medicines dispensed." },
    { key: "avg_patient", label: "Avg / Patient", icon: "revenue", format: "money", noChange: true, value: ratio(sumRevenue, distinct("patient_id")), tooltip: "Average revenue per patient." },
  ],
  trend: { title: "Sales Overview", subtitle: "Revenue over time" },
  composition: { dimension: "category", fallback: "medicine_name", title: "Sales by Category", subtitle: "Share by drug category", centerLabel: "Revenue" },
  ranking: { dimension: "medicine_name", metric: "revenue", title: "Top Medicines", subtitle: "Ranked by revenue", emptyText: "No medicine column detected", format: "money", limit: 8 },
  secondary: { dimension: "medicine_name", metric: "quantity", title: "Most Dispensed", subtitle: "By units dispensed", emptyText: "No medicine column detected", format: "number", limit: 10 },
};

const SAAS: IndustryPack = {
  key: "saas",
  label: "Tech / SaaS",
  rules: [
    { semantic: "subscription_id", patterns: [/subscription/, /^sub[_ ]?id/] },
    { semantic: "plan", patterns: [/plan/, /tier/, /^package$/] },
    { semantic: "revenue", patterns: [/mrr/, /arr/, /monthly[_ ]?recurring/, /recurring[_ ]?revenue/, /amount/] },
    { semantic: "customer_name", patterns: [/account[_ ]?name/, /^account$/, /company/, /^org(anization)?$/] },
    { semantic: "customer_id", patterns: [/account[_ ]?id/, /^user[_ ]?id$/] },
  ],
  signals: ["subscription_id", "plan"],
  kpis: [
    { key: "revenue", label: "MRR", icon: "revenue", format: "money", value: sumRevenue, tooltip: "Monthly recurring revenue (sum of subscription amounts)." },
    { key: "subscriptions", label: "Subscriptions", icon: "subscriptions", format: "number", value: distinctOrCount("subscription_id"), tooltip: "Distinct subscriptions (or row count)." },
    { key: "customers", label: "Accounts", icon: "customers", format: "number", value: distinctCustomers, tooltip: "Distinct customer accounts." },
    { key: "arpu", label: "ARPU", icon: "revenue", format: "money", noChange: true, value: ratio(sumRevenue, distinctCustomers), tooltip: "Average revenue per account." },
    { key: "plans", label: "Plans", icon: "plan", format: "number", value: distinct("plan"), tooltip: "Distinct plans / tiers." },
  ],
  trend: { title: "Recurring Revenue", subtitle: "MRR over time" },
  composition: { dimension: "plan", fallback: "category", title: "Revenue by Plan", subtitle: "Share by plan", centerLabel: "MRR" },
  ranking: { dimension: "plan", metric: "revenue", title: "Top Plans", subtitle: "Ranked by revenue", emptyText: "No plan column detected", format: "money", limit: 8 },
  secondary: { dimension: "customer_name", metric: "revenue", title: "Top Accounts", subtitle: "By revenue", emptyText: "No account column detected", format: "money", limit: 10 },
};

const GENERIC: IndustryPack = {
  key: "generic",
  label: "Other / General",
  rules: [],
  signals: [],
  kpis: [
    { key: "records", label: "Records", icon: "records", format: "number", value: (rows) => rows.length, tooltip: "Total rows in your dataset." },
    { key: "revenue", label: "Revenue", icon: "revenue", format: "money", value: sumRevenue, tooltip: "Total revenue detected (0 if none)." },
    { key: "customers", label: "Customers", icon: "customers", format: "number", value: distinctCustomers, tooltip: "Distinct customers detected." },
  ],
  trend: { title: "Overview", subtitle: "Revenue over time" },
  composition: { dimension: "category", fallback: "region", title: "Breakdown by Category", subtitle: "Share by category", centerLabel: "Total" },
  ranking: { dimension: "product_name", metric: "revenue", title: "Top Items", subtitle: "Ranked by revenue", emptyText: "No item column detected", format: "money", limit: 8 },
  secondary: { dimension: "region", metric: "revenue", title: "By Group", subtitle: "By revenue", emptyText: "No group column detected", format: "money", limit: 10 },
};

export const PACKS: Record<string, IndustryPack> = { retail: RETAIL, pharmacy: PHARMACY, saas: SAAS, generic: GENERIC };
export const INDUSTRIES = Object.values(PACKS).map((p) => ({ key: p.key, label: p.label }));

export function getPack(key?: string | null): IndustryPack {
  return (key && PACKS[key]) || GENERIC;
}

// Suggest an industry from a dataset's columns, independent of what pack detected
// it: each pack's own rules are run and scored by how many of its signature
// semantics appear. Specialised packs win with 2 distinctive signals; retail is
// the fallback for generic sales data; otherwise stay generic.
export function suggestIndustry(columns: ColumnProfile[]): string {
  const score = (p: IndustryPack) => {
    const { map } = detectSchema(columns, p.rules);
    return p.signals.filter((s) => map[s]).length;
  };
  for (const key of ["pharmacy", "saas"] as const) {
    if (score(PACKS[key]) >= 2) return key;
  }
  if (score(RETAIL) >= 3) return "retail";
  return "generic";
}
