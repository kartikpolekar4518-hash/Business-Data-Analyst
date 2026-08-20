import type { Row } from "./parse.js";
import type { SchemaMap, Semantic } from "./schema.js";
import * as A from "./analytics.js";
import { forecast } from "./forecast.js";
import { changeByGroup } from "./insights.js";
import { detectPack, getPack, resolveMetricFromWords, type IndustryPack, type PackMetric } from "./industries.js";
import { investigate } from "./investigate.js";

// "Chat with your data": deterministic NL -> structured intent -> validated result.
// The AI never runs SQL/code. This function IS the swappable provider (see ai/provider.ts).

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

// Dimension vocabulary — shared across industries (dimensions are schema-driven, not pack-driven).
const DIM_WORDS: Record<string, Semantic> = {
  customer: "customer_name", customers: "customer_name", client: "customer_name",
  product: "product_name", products: "product_name", item: "product_name",
  region: "region", regions: "region",
  state: "state", states: "state",
  category: "category", categories: "category",
  department: "department", month: "date", monthly: "date", time: "date", trend: "date",
};

function pickDimension(q: string): Semantic | null {
  for (const [w, d] of Object.entries(DIM_WORDS)) if (wordMatch(w).test(q)) return d;
  return null;
}
function pickLimit(q: string, def = 10): number {
  const m = /top\s+(\d+)|(\d+)\s+(customers|products|regions|items)/.exec(q);
  const n = m ? Number(m[1] || m[2]) : def;
  return Math.min(50, Math.max(1, n || def));
}

// Resolve the metric from the active pack's vocabulary. Falls back to the built-in
// revenue/orders so retail-style questions keep working on any pack.
function pickMetric(q: string, s: SchemaMap, pack: IndustryPack): PackMetric {
  const fromWords = resolveMetricFromWords(pack, q);
  if (fromWords) return fromWords;
  if (s.revenue || s.sales) return pack.metrics.find((m) => m.id === "revenue")!;
  return pack.metrics.find((m) => m.id === "orders")!;
}

function metricLabel(m: PackMetric): string { return m.label; }

export function answer(question: string, rows: Row[], s: SchemaMap, packId?: string): ChatResult {
  const q = question.toLowerCase();
  const pack = packId ? getPack(packId) : detectPack(s, [], "");
  const metric = pickMetric(q, s, pack);

  // --- forecast / prediction ---
  if (/(predict|forecast|next month|next quarter|projection|will be)/.test(q)) {
    const series = A.timeSeries(rows, s, metric);
    if (series.length < 2) return fallback(question, "Not enough time-based history to forecast.");
    const fc = forecast(series.map((p) => ({ period: p.period, value: p.value })), 3);
    const next = fc.points[0];
    return {
      intent: { intent: "forecast", metrics: [metric.id], dimensions: ["date"], filters: {}, limit: 3, visualization: "line" },
      explanation: `Projected ${metricLabel(metric)} for ${next.period} is ~${fmt(next.value)} (range ${fmt(next.lower)}–${fmt(next.upper)}), based on the recent trend. This is an estimate, not a guarantee.`,
      chart: { type: "line", xKey: "label", yKey: "value",
        data: [...series.map((p) => ({ label: p.period, value: p.value })), ...fc.points.map((p) => ({ label: p.period, value: p.value }))] },
      metrics: fc.points.map((p) => ({ label: p.period, value: p.value })),
      confidence: 0.6,
    };
  }

  // --- highest / lowest period ("which month had the highest sales") ---
  if (/(which|what).*(month|period|day).*(highest|most|best|top|lowest|worst|least)/.test(q) || /(highest|lowest|best|worst).*(month|quarter|week|day|period)/.test(q)) {
    const series = A.timeSeries(rows, s, metric);
    if (!series.length) return fallback(question, "No date column detected to analyse by month.");
    const worst = /lowest|worst|least/.test(q);
    const best = [...series].sort((x, y) => (worst ? x.value - y.value : y.value - x.value))[0];
    return {
      intent: { intent: worst ? "min_period" : "max_period", metrics: [metric.id], dimensions: ["date"], filters: {}, limit: 1, visualization: "bar" },
      explanation: `${best.period} had the ${worst ? "lowest" : "highest"} ${metricLabel(metric)}: ${fmt(best.value)}.`,
      chart: { type: "bar", xKey: "label", yKey: "value", data: series.map((p) => ({ label: p.period, value: p.value })) },
      metrics: [{ label: best.period, value: best.value }],
      confidence: 0.9,
    };
  }

  // --- why did X drop / change (root-cause investigation) ---
  if (/(why|reason|cause).*(drop|decline|fall|decrease|down|up|rise|increase|change)/.test(q)) {
    const inv = investigate(rows, s, metric.id, pack.id);
    const series = A.timeSeries(rows, s, metric);
    return {
      intent: { intent: "explain_change", metrics: [metric.id], dimensions: ["date"], filters: {}, limit: 5, visualization: "line" },
      explanation: inv.narrative,
      chart: series.length ? { type: "line", xKey: "label", yKey: "value", data: series.map((p) => ({ label: p.period, value: p.value })) } : undefined,
      metrics: inv.claims.slice(0, 5).map((c) => ({ label: c.detail, value: c.value })),
      confidence: 0.6,
    };
  }

  // --- declining / growing by dimension (first half of the date range vs. second half) ---
  if (/declin|falling|dropping|shrinking|slump|losing ground/.test(q) || /grow(ing)?|rising|fastest|climbing|surging/.test(q)) {
    const isGrowth = /grow(ing)?|rising|fastest|climbing|surging/.test(q);
    const dim = pickDimension(q) ?? (s.product_name ? "product_name" : s.region ? "region" : s.customer_name ? "customer_name" : null);
    if (!dim || dim === "date" || !s.date) return fallback(question, "Need a date column plus a product/region/customer/category column to compare periods.");
    const changes = changeByGroup(rows, s, dim).sort((a, b) => isGrowth ? b.changePct - a.changePct : a.changePct - b.changePct);
    const picked = (isGrowth ? changes.filter((c) => c.changePct > 0) : changes.filter((c) => c.changePct < 0)).slice(0, 10);
    const dimLabel = dim.replace("_name", "").replace("_", " ");
    if (!picked.length) {
      return { intent: { intent: isGrowth ? "growing_groups" : "declining_groups", metrics: ["revenue"], dimensions: [dim], filters: {}, limit: 0, visualization: "none" },
        explanation: `No ${dimLabel}s are clearly ${isGrowth ? "growing" : "declining"} between the first and second half of the available date range.`, confidence: 0.6 };
    }
    return {
      intent: { intent: isGrowth ? "growing_groups" : "declining_groups", metrics: ["revenue"], dimensions: [dim], filters: {}, limit: picked.length, visualization: "bar" },
      explanation: `${picked.length} ${dimLabel}${picked.length === 1 ? "" : "s"} ${isGrowth ? "grew" : "declined"} between the first and second half of the period. ${isGrowth ? "Fastest" : "Steepest drop"}: ${picked[0].label} (${picked[0].changePct >= 0 ? "+" : ""}${picked[0].changePct}%).`,
      chart: { type: "bar", xKey: "label", yKey: "value", data: picked.map((p) => ({ label: p.label, value: p.changePct })) },
      table: { columns: [cap(dimLabel), "Change %"], rows: picked.map((p) => [p.label, p.changePct]) },
      confidence: 0.65,
    };
  }

  // --- inventory risk ---
  if (/(inventory|stock).*(risk|low|short|out)/.test(q) || /low.*(inventory|stock)/.test(q)) {
    if (!s.inventory) return fallback(question, "No inventory column detected in this dataset.");
    const rank = A.groupBy(rows, s, s.product_name ? "product_name" : "category", "quantity", {}, 100);
    // lowest inventory products
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

  // --- top N by dimension (default) ---
  const dim = pickDimension(q) ?? (s.customer_name ? "customer_name" : s.product_name ? "product_name" : "region");
  if (dim === "date") {
    const series = A.timeSeries(rows, s, metric);
    return {
      intent: { intent: "trend", metrics: [metric.id], dimensions: ["date"], filters: {}, limit: series.length, visualization: "line" },
      explanation: `${metricLabel(metric)} over time, by month.`,
      chart: { type: "line", xKey: "label", yKey: "value", data: series.map((p) => ({ label: p.period, value: p.value })) },
      confidence: 0.85,
    };
  }
  const limit = pickLimit(q);
  const ranked = A.groupBy(rows, s, dim, metric, {}, limit);
  if (!ranked.length) return fallback(question, "I couldn't map that question to the columns in this dataset.");
  const dimLabel = dim.replace("_name", "").replace("_", " ");
  return {
    intent: { intent: "top_n", metrics: [metric.id], dimensions: [dim], filters: {}, limit, visualization: "bar" },
    explanation: `Top ${ranked.length} ${dimLabel}s by ${metricLabel(metric)}. Leader: ${ranked[0].label} (${fmt(ranked[0].value)}).`,
    chart: { type: "bar", xKey: "label", yKey: "value", data: ranked },
    table: { columns: [cap(dimLabel), metricLabel(metric)], rows: ranked.map((r) => [r.label, r.value]) },
    confidence: 0.8,
  };
}

function fallback(question: string, msg: string): ChatResult {
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