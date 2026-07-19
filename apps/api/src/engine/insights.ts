import type { Row } from "./parse.js";
import type { SchemaMap } from "./schema.js";
import * as A from "./analytics.js";
import { forecast } from "./forecast.js";

export interface Recommendation {
  title: string;
  observation: string;   // observed data
  explanation: string;   // possible explanation (clearly hypothesis)
  action: string;        // recommendation
  impact: "LOW" | "MEDIUM" | "HIGH";
  confidence: number;
}

export interface AlertSeed {
  type: string;
  severity: "LOW" | "MEDIUM" | "HIGH";
  metric: string;
  currentValue: number | null;
  threshold: number | null;
  description: string;
}

// Derive alerts + recommendations from the data. Separates observation from hypothesis.
export function deriveInsights(rows: Row[], s: SchemaMap) {
  const ov = A.overview(rows, s);
  const revSeries = A.timeSeries(rows, s, "revenue");
  const recs: Recommendation[] = [];
  const alerts: AlertSeed[] = [];

  // Revenue trend alert
  if (ov.growth !== null) {
    if (ov.growth <= -5) {
      alerts.push({ type: "revenue_drop", severity: ov.growth <= -15 ? "HIGH" : "MEDIUM", metric: "revenue", currentValue: ov.revenue.value, threshold: ov.revenue.previous, description: `Revenue fell ${Math.abs(ov.growth)}% versus the prior period.` });
      recs.push({
        title: "Revenue is declining",
        observation: `Revenue changed ${ov.growth}% period-over-period (${money(ov.revenue.previous)} → ${money(ov.revenue.value)}).`,
        explanation: "Possible causes include seasonality, reduced marketing, inventory shortages, or weakening demand in specific regions/products. These are hypotheses, not confirmed causes.",
        action: "Review declining products and regions below, check inventory levels, and compare marketing spend across the two periods.",
        impact: "HIGH", confidence: 0.7,
      });
    } else if (ov.growth >= 15) {
      alerts.push({ type: "sales_spike", severity: "LOW", metric: "revenue", currentValue: ov.revenue.value, threshold: ov.revenue.previous, description: `Revenue grew ${ov.growth}% versus the prior period.` });
    }
  }

  // Profit margin alert
  if (ov.profitMargin < 10 && ov.revenue.value > 0) {
    alerts.push({ type: "profit_decline", severity: ov.profitMargin < 0 ? "HIGH" : "MEDIUM", metric: "profit_margin", currentValue: ov.profitMargin, threshold: 10, description: `Profit margin is ${ov.profitMargin}%, below a healthy 10% threshold.` });
    recs.push({
      title: "Thin profit margins",
      observation: `Overall profit margin is ${ov.profitMargin}% on ${money(ov.revenue.value)} revenue.`,
      explanation: "Low margins can stem from high cost of goods, discounting, or an unfavourable product mix.",
      action: "Review pricing on low-margin categories and negotiate supplier costs.",
      impact: "MEDIUM", confidence: 0.65,
    });
  }

  // Declining products (compare first vs second half by product)
  const decliners = decliningGroups(rows, s);
  if (decliners.length) {
    recs.push({
      title: "Products in decline",
      observation: `${decliners.slice(0, 3).map((d) => `${d.label} (${d.changePct}%)`).join(", ")} show falling revenue across periods.`,
      explanation: "Declines may reflect product life-cycle, competition, or stock issues.",
      action: "Investigate these products; consider promotion, repricing, or discontinuation.",
      impact: "MEDIUM", confidence: 0.6,
    });
    alerts.push({ type: "unusual_performance", severity: "MEDIUM", metric: "revenue", currentValue: null, threshold: null, description: `${decliners.length} products show declining revenue.` });
  }

  // Inventory risk
  if (s.inventory) {
    const low = lowInventory(rows, s);
    if (low.length) {
      alerts.push({ type: "inventory_shortage", severity: "MEDIUM", metric: "inventory", currentValue: low.length, threshold: 20, description: `${low.length} products are below 20 units of inventory.` });
      recs.push({
        title: "Inventory shortage risk",
        observation: `${low.length} products have inventory below 20 units (e.g. ${low.slice(0, 3).map((l) => l.label).join(", ")}).`,
        explanation: "Low stock on selling products risks lost revenue from stockouts.",
        action: "Reorder the at-risk products, prioritising high-revenue items.",
        impact: "HIGH", confidence: 0.75,
      });
    }
  }

  // Forecast risk
  if (revSeries.length >= 3) {
    const fc = forecast(revSeries.map((p) => ({ period: p.period, value: p.value })), 1);
    const next = fc.points[0];
    if (next && next.value < revSeries[revSeries.length - 1].value * 0.9) {
      alerts.push({ type: "forecast_risk", severity: "MEDIUM", metric: "revenue", currentValue: next.value, threshold: revSeries[revSeries.length - 1].value, description: `Forecast projects revenue of ${money(next.value)} next period, below the latest ${money(revSeries[revSeries.length - 1].value)}.` });
    }
  }

  // Growth opportunity: fastest growing region
  const risers = growingGroups(rows, s);
  if (risers.length) {
    recs.push({
      title: "Growth opportunity",
      observation: `${risers[0].label} grew ${risers[0].changePct}% — the fastest-growing segment.`,
      explanation: "A concentrated growth area often responds well to increased investment.",
      action: `Consider increasing inventory and marketing for ${risers[0].label}.`,
      impact: "MEDIUM", confidence: 0.6,
    });
  }

  return { recommendations: recs, alerts };
}

function halfSplit(rows: Row[], s: SchemaMap): { first: Row[]; second: Row[] } {
  if (!s.date) return { first: [], second: [] };
  const dated = rows.map((r) => ({ r, d: A.parseDate(r[s.date!]) })).filter((x) => x.d) as { r: Row; d: Date }[];
  dated.sort((a, b) => a.d.getTime() - b.d.getTime());
  const mid = Math.floor(dated.length / 2);
  return { first: dated.slice(0, mid).map((x) => x.r), second: dated.slice(mid).map((x) => x.r) };
}

function changeByGroup(rows: Row[], s: SchemaMap): { label: string; changePct: number }[] {
  const dim = s.product_name ? "product_name" : s.category ? "category" : s.region ? "region" : null;
  if (!dim) return [];
  const { first, second } = halfSplit(rows, s);
  if (!first.length || !second.length) return [];
  const a = new Map(A.groupBy(first, s, dim, "revenue", {}, 100).map((x) => [x.label, x.value]));
  const b = new Map(A.groupBy(second, s, dim, "revenue", {}, 100).map((x) => [x.label, x.value]));
  const out: { label: string; changePct: number }[] = [];
  for (const [label, bv] of b) {
    const av = a.get(label) ?? 0;
    if (av <= 0) continue;
    out.push({ label, changePct: Math.round(((bv - av) / av) * 1000) / 10 });
  }
  return out;
}

function decliningGroups(rows: Row[], s: SchemaMap) {
  return changeByGroup(rows, s).filter((x) => x.changePct <= -10).sort((a, b) => a.changePct - b.changePct);
}
function growingGroups(rows: Row[], s: SchemaMap) {
  return changeByGroup(rows, s).filter((x) => x.changePct >= 10).sort((a, b) => b.changePct - a.changePct);
}

function lowInventory(rows: Row[], s: SchemaMap): { label: string; value: number }[] {
  const inv = new Map<string, number>();
  const key = s.product_name || s.category;
  if (!key || !s.inventory) return [];
  for (const r of rows) { const p = A.str(r[key]); inv.set(p, Math.min(inv.get(p) ?? Infinity, A.num(r[s.inventory!]))); }
  return [...inv.entries()].map(([label, value]) => ({ label, value })).filter((x) => x.value < 20).sort((a, b) => a.value - b.value);
}

const money = A.fmtMoney;
