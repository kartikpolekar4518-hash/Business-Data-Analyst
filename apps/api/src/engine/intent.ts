import type { Row } from "./parse.js";
import type { SchemaMap, Semantic } from "./schema.js";
import * as A from "./analytics.js";
import { forecast } from "./forecast.js";
import { changeByGroup } from "./insights.js";

// "Chat with your data": deterministic NL -> structured intent -> validated result.
// Parsing is split from execution so the intent can come from either the rule-based
// parser here (ruleParse) or an AI parser (ai/provider.ts) — both feed runIntent,
// which computes every number deterministically. The AI never runs SQL/code.

export interface Intent {
  intent: string;
  metrics: string[];
  dimensions: string[];
  filters: Record<string, string>;
  limit: number;
  visualization: "bar" | "line" | "table" | "kpi" | "none";
}

export interface ChatResult {
  intent: Intent;
  explanation: string;
  table?: { columns: string[]; rows: (string | number)[][] };
  chart?: { type: "bar" | "line"; data: { label: string; value: number }[]; xKey: string; yKey: string };
  metrics?: { label: string; value: number }[];
  confidence: number;
}

// Build a word-boundary regex from a word. Ensures "profit" does not match "profitability".
function wordMatch(word: string): RegExp {
  return new RegExp(`\\b${word}\\b`, "i");
}

const METRIC_WORDS: Record<string, string> = {
  revenue: "revenue", sales: "revenue", income: "revenue",
  profit: "profit", margin: "profit",
  order: "orders", orders: "orders",
  quantity: "quantity", units: "quantity", volume: "quantity",
};
const DIM_WORDS: Record<string, Semantic> = {
  customer: "customer_name", customers: "customer_name", client: "customer_name",
  product: "product_name", products: "product_name", item: "product_name",
  region: "region", regions: "region",
  state: "state", states: "state",
  category: "category", categories: "category",
  department: "department", month: "date", monthly: "date", time: "date", trend: "date",
};

type Metric = "revenue" | "profit" | "quantity" | "orders";

function pickMetric(q: string, s: SchemaMap): Metric {
  for (const [w, m] of Object.entries(METRIC_WORDS)) if (wordMatch(w).test(q)) return m as Metric;
  if (s.revenue || s.sales) return "revenue";
  return "orders";
}
function pickDimension(q: string): Semantic | null {
  for (const [w, d] of Object.entries(DIM_WORDS)) if (wordMatch(w).test(q)) return d;
  return null;
}
function pickLimit(q: string, def = 10): number {
  const m = /top\s+(\d+)|(\d+)\s+(customers|products|regions|items)/.exec(q);
  const n = m ? Number(m[1] || m[2]) : def;
  return Math.min(50, Math.max(1, n || def));
}

const METRIC_LABEL: Record<string, string> = { revenue: "Revenue", profit: "Profit", quantity: "Quantity", orders: "Orders" };

// The closed vocabularies the AI parser must also target (see ai/provider.ts).
export const INTENTS = ["top_n", "trend", "max_period", "min_period", "forecast", "explain_change", "growing_groups", "declining_groups", "inventory_risk", "unknown"] as const;
export const METRICS: Metric[] = ["revenue", "profit", "quantity", "orders"];

function metric(intent: Intent): Metric {
  const m = intent.metrics[0];
  return (METRICS as string[]).includes(m) ? (m as Metric) : "revenue";
}
function seriesMetric(m: Metric): "revenue" | "profit" | "orders" {
  return m === "orders" ? "orders" : m === "profit" ? "profit" : "revenue";
}
// Whether a metric can actually be computed from this dataset's columns. The AI
// parser may emit a valid-enum metric (e.g. "quantity") that the dataset has no
// column for; without this the engine would silently substitute revenue and
// return a misleading answer. Orders is always available (one per row).
function metricAvailable(m: Metric, s: SchemaMap): boolean {
  switch (m) {
    case "revenue": return !!(s.revenue || s.sales || (s.quantity && s.unit_price));
    case "profit": return !!(s.profit || s.cost);
    case "quantity": return !!s.quantity;
    case "orders": return true;
  }
}

// --- classification: question -> structured intent (no data access) ---
export function ruleParse(question: string, s: SchemaMap): Intent {
  const q = question.toLowerCase();
  const m = pickMetric(q, s);
  const mk = (intent: string, o: Partial<Intent> = {}): Intent =>
    ({ intent, metrics: [m], dimensions: [], filters: {}, limit: 10, visualization: "bar", ...o });

  if (/(predict|forecast|next month|next quarter|projection|will be)/.test(q))
    return mk("forecast", { dimensions: ["date"], limit: 3, visualization: "line" });

  if (/(which|what).*(month|period|day).*(highest|most|best|top|lowest|worst|least)/.test(q) || /(highest|lowest|best|worst).*(month|quarter|week|day|period)/.test(q))
    return mk(/lowest|worst|least/.test(q) ? "min_period" : "max_period", { dimensions: ["date"], limit: 1 });

  if (/(why|reason|cause).*(drop|decline|fall|decrease|down|up|rise|increase|change)/.test(q))
    return mk("explain_change", { dimensions: ["date"], limit: 5, visualization: "line" });

  if (/declin|falling|dropping|shrinking|slump|losing ground/.test(q) || /grow(ing)?|rising|fastest|climbing|surging/.test(q)) {
    const isGrowth = /grow(ing)?|rising|fastest|climbing|surging/.test(q);
    const dim = pickDimension(q) ?? (s.product_name ? "product_name" : s.region ? "region" : s.customer_name ? "customer_name" : null);
    return mk(isGrowth ? "growing_groups" : "declining_groups", { metrics: ["revenue"], dimensions: dim ? [dim] : [] });
  }

  if (/(inventory|stock).*(risk|low|short|out)/.test(q) || /low.*(inventory|stock)/.test(q))
    return mk("inventory_risk", { metrics: ["inventory"], dimensions: ["product_name"], visualization: "table" });

  const dim = pickDimension(q) ?? (s.customer_name ? "customer_name" : s.product_name ? "product_name" : "region");
  if (dim === "date") return mk("trend", { dimensions: ["date"], visualization: "line" });
  return mk("top_n", { dimensions: [dim], limit: pickLimit(q) });
}

// --- execution: structured intent -> validated, deterministic result ---
export function runIntent(intent: Intent, rows: Row[], s: SchemaMap): ChatResult {
  const m = metric(intent);
  const dim = (intent.dimensions[0] ?? null) as Semantic | null;

  // Reject a metric the dataset can't support instead of silently answering with
  // a different one. Intents that don't consume `m` (inventory/unknown) are exempt.
  if (intent.intent !== "inventory_risk" && intent.intent !== "unknown" && !metricAvailable(m, s)) {
    return fallback(`This dataset has no ${METRIC_LABEL[m].toLowerCase()} column, so I can't answer that. Try a metric your data contains.`);
  }

  switch (intent.intent) {
    case "forecast": {
      const series = A.timeSeries(rows, s, seriesMetric(m));
      if (series.length < 2) return fallback("Not enough time-based history to forecast.");
      const fc = forecast(series.map((p) => ({ period: p.period, value: p.value })), 3);
      const next = fc.points[0];
      return {
        intent: { intent: "forecast", metrics: [m], dimensions: ["date"], filters: {}, limit: 3, visualization: "line" },
        explanation: `Projected ${METRIC_LABEL[m]} for ${next.period} is ~${fmt(next.value)} (range ${fmt(next.lower)}–${fmt(next.upper)}), based on the recent trend. This is an estimate, not a guarantee.`,
        chart: { type: "line", xKey: "label", yKey: "value",
          data: [...series.map((p) => ({ label: p.period, value: p.value })), ...fc.points.map((p) => ({ label: p.period, value: p.value }))] },
        metrics: fc.points.map((p) => ({ label: p.period, value: p.value })),
        confidence: 0.6,
      };
    }

    case "max_period":
    case "min_period": {
      const series = A.timeSeries(rows, s, seriesMetric(m));
      if (!series.length) return fallback("No date column detected to analyse by month.");
      const worst = intent.intent === "min_period";
      const best = [...series].sort((x, y) => (worst ? x.value - y.value : y.value - x.value))[0];
      return {
        intent: { intent: intent.intent, metrics: [m], dimensions: ["date"], filters: {}, limit: 1, visualization: "bar" },
        explanation: `${best.period} had the ${worst ? "lowest" : "highest"} ${METRIC_LABEL[m]}: ${fmt(best.value)}.`,
        chart: { type: "bar", xKey: "label", yKey: "value", data: series.map((p) => ({ label: p.period, value: p.value })) },
        metrics: [{ label: best.period, value: best.value }],
        confidence: 0.9,
      };
    }

    case "explain_change": {
      const series = A.timeSeries(rows, s, m === "profit" ? "profit" : "revenue");
      const groups = A.groupBy(rows, s, "category" in s ? "category" : "region", m === "profit" ? "profit" : "revenue", {}, 5);
      let expl = `I can't infer causation from the data alone, but here's what the numbers show. `;
      if (series.length >= 2) {
        const a = series[series.length - 2].value, b = series[series.length - 1].value;
        const change = A.num(b) - A.num(a);
        expl += `${METRIC_LABEL[m]} went from ${fmt(a)} to ${fmt(b)} (${change >= 0 ? "+" : ""}${fmt(change)}) in the latest period. `;
      }
      if (groups.length) expl += `The largest contributors were ${groups.slice(0, 3).map((d) => d.label).join(", ")}. Possible factors to investigate: seasonality, pricing, inventory, or regional weakness.`;
      return {
        intent: { intent: "explain_change", metrics: [m], dimensions: ["date"], filters: {}, limit: 5, visualization: "line" },
        explanation: expl,
        chart: series.length ? { type: "line", xKey: "label", yKey: "value", data: series.map((p) => ({ label: p.period, value: p.value })) } : undefined,
        confidence: 0.45,
      };
    }

    case "growing_groups":
    case "declining_groups": {
      const isGrowth = intent.intent === "growing_groups";
      if (!dim || dim === "date" || !s.date) return fallback("Need a date column plus a product/region/customer/category column to compare periods.");
      const changes = changeByGroup(rows, s, dim).sort((a, b) => isGrowth ? b.changePct - a.changePct : a.changePct - b.changePct);
      const picked = (isGrowth ? changes.filter((c) => c.changePct > 0) : changes.filter((c) => c.changePct < 0)).slice(0, 10);
      const dimLabel = dim.replace("_name", "").replace("_", " ");
      if (!picked.length) {
        return { intent: { intent: intent.intent, metrics: ["revenue"], dimensions: [dim], filters: {}, limit: 0, visualization: "none" },
          explanation: `No ${dimLabel}s are clearly ${isGrowth ? "growing" : "declining"} between the first and second half of the available date range.`, confidence: 0.6 };
      }
      return {
        intent: { intent: intent.intent, metrics: ["revenue"], dimensions: [dim], filters: {}, limit: picked.length, visualization: "bar" },
        explanation: `${picked.length} ${dimLabel}${picked.length === 1 ? "" : "s"} ${isGrowth ? "grew" : "declined"} between the first and second half of the period. ${isGrowth ? "Fastest" : "Steepest drop"}: ${picked[0].label} (${picked[0].changePct >= 0 ? "+" : ""}${picked[0].changePct}%).`,
        chart: { type: "bar", xKey: "label", yKey: "value", data: picked.map((p) => ({ label: p.label, value: p.changePct })) },
        table: { columns: [cap(dimLabel), "Change %"], rows: picked.map((p) => [p.label, p.changePct]) },
        confidence: 0.65,
      };
    }

    case "inventory_risk": {
      if (!s.inventory) return fallback("No inventory column detected in this dataset.");
      const inv = new Map<string, number>();
      for (const r of rows) { const p = A.str(s.product_name ? r[s.product_name] : r[s.category!]); inv.set(p, Math.min(inv.get(p) ?? Infinity, A.num(r[s.inventory!]))); }
      const low = [...inv.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => a.value - b.value).slice(0, 10);
      return {
        intent: { intent: "inventory_risk", metrics: ["inventory"], dimensions: ["product_name"], filters: {}, limit: 10, visualization: "table" },
        explanation: `${low.filter((l) => l.value < 20).length} products are below an inventory level of 20 units and may be at stockout risk.`,
        table: { columns: ["Product", "Min inventory"], rows: low.map((l) => [l.label, l.value]) },
        confidence: 0.75,
      };
    }

    case "trend": {
      const series = A.timeSeries(rows, s, seriesMetric(m));
      return {
        intent: { intent: "trend", metrics: [m], dimensions: ["date"], filters: {}, limit: series.length, visualization: "line" },
        explanation: `${METRIC_LABEL[m]} over time, by month.`,
        chart: { type: "line", xKey: "label", yKey: "value", data: series.map((p) => ({ label: p.period, value: p.value })) },
        confidence: 0.85,
      };
    }

    case "top_n": {
      const d = (dim && dim !== "date" ? dim : (s.customer_name ? "customer_name" : s.product_name ? "product_name" : "region")) as Semantic;
      const limit = Math.min(50, Math.max(1, intent.limit || 10));
      const ranked = A.groupBy(rows, s, d, m, {}, limit);
      if (!ranked.length) return fallback("I couldn't map that question to the columns in this dataset.");
      const dimLabel = d.replace("_name", "").replace("_", " ");
      return {
        intent: { intent: "top_n", metrics: [m], dimensions: [d], filters: {}, limit, visualization: "bar" },
        explanation: `Top ${ranked.length} ${dimLabel}s by ${METRIC_LABEL[m]}. Leader: ${ranked[0].label} (${fmt(ranked[0].value)}).`,
        chart: { type: "bar", xKey: "label", yKey: "value", data: ranked },
        table: { columns: [cap(dimLabel), METRIC_LABEL[m]], rows: ranked.map((r) => [r.label, r.value]) },
        confidence: 0.8,
      };
    }

    default:
      return fallback("I couldn't map that question to the columns in this dataset.");
  }
}

// Rule-based question -> deterministic answer (the offline path and the fallback
// whenever the AI parser is unconfigured or fails).
export function answer(question: string, rows: Row[], s: SchemaMap): ChatResult {
  return runIntent(ruleParse(question, s), rows, s);
}

function fallback(msg: string): ChatResult {
  return {
    intent: { intent: "unknown", metrics: [], dimensions: [], filters: {}, limit: 0, visualization: "none" },
    explanation: `${msg} Try questions like "top 10 customers", "which month had the highest sales", or "predict next month's revenue".`,
    confidence: 0.2,
  };
}

function fmt(n: number): string {
  const v = A.num(n);
  if (Math.abs(v) >= 1000) return v.toLocaleString(undefined, { maximumFractionDigits: 0 });
  return String(Math.round(v * 100) / 100);
}
function cap(s: string): string { return s.charAt(0).toUpperCase() + s.slice(1); }
