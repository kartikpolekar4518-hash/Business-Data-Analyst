import type { Row } from "./parse.js";
import type { SchemaMap, Semantic } from "./schema.js";
import * as A from "./analytics.js";
import { forecast } from "./forecast.js";
import { detectPack, packMetric, type IndustryPack } from "./industries.js";
import { investigate } from "./investigate.js";

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
export function deriveInsights(rows: Row[], s: SchemaMap, packId?: string) {
  const pack = detectPack(s, [], packId ?? "");
  const ov = A.overview(rows, s);
  const recs: Recommendation[] = [];
  const alerts: AlertSeed[] = [];

  // Iterate the pack's key metrics (not just revenue) so SaaS/pharmacy/service
  // analytics produce alerts on their own metrics (MRR drop, churn, expiry risk…).
  for (const metricId of pack.keyMetrics) {
    const metric = packMetric(pack, metricId);
    if (!metric) continue;

    // Build a period-over-period series for this metric and check the last change.
    const series = A.timeSeries(rows, s, metric);
    if (series.length >= 2) {
      const prev = series[series.length - 2].value;
      const cur = series[series.length - 1].value;
      if (prev > 0) {
        const changePct = Math.round(((cur - prev) / Math.abs(prev)) * 1000) / 10;
        const thresh = pack.thresholds?.[metricId] ?? -10; // negative threshold => drop alert
        if (changePct <= thresh) {
          const severity = changePct <= thresh * 2 ? "HIGH" : "MEDIUM";
          alerts.push({
            type: `${metricId}_drop`,
            severity,
            metric: metricId,
            currentValue: cur,
            threshold: prev,
            description: `${metric.label} fell ${Math.abs(changePct)}% in the latest period.`,
          });
          recs.push({
            title: `${metric.label} is declining`,
            observation: `${metric.label} changed ${changePct}% period-over-period (${money(prev)} → ${money(cur)}).`,
            explanation: "Possible causes include demand shifts, pricing, inventory, or segment weakness. These are hypotheses, not confirmed causes.",
            action: `Investigate the largest ${metric.label.toLowerCase()} contributors by the pack's key dimensions (see the 'why' investigation).`,
            impact: severity === "HIGH" ? "HIGH" : "MEDIUM",
            confidence: 0.7,
          });
        } else if (changePct >= 15) {
          alerts.push({ type: `${metricId}_spike`, severity: "LOW", metric: metricId, currentValue: cur, threshold: prev, description: `${metric.label} grew ${changePct}% in the latest period.` });
        }
      }
    }
  }

  // Root-cause investigation surfaced as a recommendation when a key metric drops.
  const droppedMetric = pack.keyMetrics
    .map((id) => ({ id, metric: packMetric(pack, id) }))
    .find(({ id, metric }) => {
      if (!metric) return false;
      const series = A.timeSeries(rows, s, metric);
      if (series.length < 2) return false;
      const prev = series[series.length - 2].value;
      const cur = series[series.length - 1].value;
      if (prev <= 0) return false;
      const changePct = Math.round(((cur - prev) / Math.abs(prev)) * 1000) / 10;
      return changePct <= (pack.thresholds?.[id] ?? -10);
    });
  if (droppedMetric?.metric) {
    const inv = investigate(rows, s, droppedMetric.id, pack.id);
    recs.push({
      title: `Why is ${droppedMetric.metric.label} changing?`,
      observation: inv.narrative,
      explanation: "This is an evidence-backed investigation: driver concentration, price/volume/mix decomposition, correlated factors, and anomalous periods. Correlation is association, not cause.",
      action: "Review the cited dimensions and factors above; validate with a controlled experiment before acting.",
      impact: "HIGH", confidence: 0.65,
    });
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

  // Forecast risk (on the pack's primary revenue-like metric)
  const primary = packMetric(pack, pack.keyMetrics[0] ?? "revenue") ?? packMetric(pack, "revenue");
  if (primary) {
    const revSeries = A.timeSeries(rows, s, primary);
    if (revSeries.length >= 3) {
      const fc = forecast(revSeries.map((p) => ({ period: p.period, value: p.value })), 1);
      const next = fc.points[0];
      if (next && next.value < revSeries[revSeries.length - 1].value * 0.9) {
        alerts.push({ type: "forecast_risk", severity: "MEDIUM", metric: primary.id, currentValue: next.value, threshold: revSeries[revSeries.length - 1].value, description: `Forecast projects ${primary.label} of ${money(next.value)} next period, below the latest ${money(revSeries[revSeries.length - 1].value)}.` });
      }
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
  // Find the midpoint date (median date) and split on that boundary
  const midDate = dated[Math.floor(dated.length / 2)].d;
  const first: Row[] = [], second: Row[] = [];
  for (const item of dated) {
    if (item.d < midDate) first.push(item.r);
    else second.push(item.r);
  }
  return { first, second };
}

// Exported so the chat intent parser can answer "which X are declining/growing" for a
// caller-specified dimension, instead of only the fixed product->category->region priority below.
export function changeByGroup(rows: Row[], s: SchemaMap, dimOverride?: Semantic): { label: string; changePct: number }[] {
  const dim = dimOverride ?? (s.product_name ? "product_name" : s.category ? "category" : s.region ? "region" : null);
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