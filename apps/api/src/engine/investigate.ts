import type { Row } from "./parse.js";
import type { SchemaMap, Semantic } from "./schema.js";
import * as A from "./analytics.js";
import { analyzeDrivers, decomposePriceVolumeMix, type DriverResult, type Decomposition } from "./drivers.js";
import { correlateMetric, type CorrelationResult } from "./correlate.js";
import { detectAnomalies, type AnomalyResult } from "./anomaly.js";
import { detectPack, getPack, packMetric, type IndustryPack, type PackMetric } from "./industries.js";

// The "Why" investigator: chains the existing deterministic tools into a single
// evidence-backed causal narrative. Separates observation → evidence → hypothesis
// (matching insights.ts discipline and correlate.ts non-causal caveats).
// Every claim cites metric / period / dimension / rows.

export interface EvidenceClaim {
  kind: "driver" | "decomposition" | "correlation" | "anomaly";
  metric: string;
  period: string;          // "current vs previous half"
  dimension?: string;
  detail: string;
  rows: number;            // number of rows contributing to this claim
  value: number;
}

export interface Investigation {
  metric: string;
  metricLabel: string;
  pack: string;
  totalDelta: number;
  currentTotal: number;
  previousTotal: number;
  changePct: number | null;
  drivers: DriverResult[];
  decomposition: Decomposition | null;
  correlation: CorrelationResult | null;
  anomalies: AnomalyResult | null;
  claims: EvidenceClaim[];
  narrative: string;
}

const CANDIDATE_DIMENSIONS: Semantic[] = ["product_name", "customer_name", "region", "category", "state", "department"];

/**
 * Investigate "why did <metric> change between periods".
 * Runs drivers across several candidate dimensions, adds price×volume×mix,
 * pulls correlated movers and coincident anomalies, and emits a ranked,
 * evidence-linked explanation.
 */
export function investigate(
  rows: Row[],
  s: SchemaMap,
  metricId: string,
  packId?: string,
): Investigation {
  const pack = packId ? getPack(packId) : detectPack(s, [], "");
  const metric = packMetric(pack, metricId) ?? packMetric(pack, "revenue")!;
  const series = A.timeSeries(rows, s, metric);
  const prev = series.length >= 2 ? series[series.length - 2].value : 0;
  const cur = series.length >= 1 ? series[series.length - 1].value : 0;
  const totalDelta = cur - prev;
  const changePct = prev ? Math.round((totalDelta / Math.abs(prev)) * 1000) / 10 : null;

  // 1. Drivers across several candidate dimensions.
  const drivers: DriverResult[] = [];
  for (const dim of CANDIDATE_DIMENSIONS) {
    if (!s[dim]) continue;
    const d = analyzeDrivers(rows, s, metric, dim, 5);
    if (d.contributions.length) drivers.push(d);
  }
  drivers.sort((a, b) => Math.abs(b.totalDelta) - Math.abs(a.totalDelta));

  // 2. Price × Volume × Mix decomposition.
  const decomposition = decomposePriceVolumeMix(rows, s);

  // 3. Correlated movers + coincident anomalies.
  const correlation = correlateMetric(rows, s, metric);
  const anomalies = detectAnomalies(rows, s, metric);

  // 4. Build evidence claims.
  const claims: EvidenceClaim[] = [];
  const rowCount = rows.length;

  // Driver claims (top contributor per dimension).
  for (const d of drivers.slice(0, 3)) {
    const top = d.contributions[0];
    if (!top) continue;
    claims.push({
      kind: "driver",
      metric: metric.id,
      period: "current vs previous half",
      dimension: d.dimension,
      detail: `${top.label} drove ${fmt(top.delta)} (${Math.round(top.shareOfDelta * 100)}% of the change) in ${d.dimension}.`,
      rows: rowCount,
      value: top.delta,
    });
  }

  // Decomposition claim.
  if (decomposition?.canDecompose) {
    const parts: string[] = [];
    if (Math.abs(decomposition.volumeDelta) > 0.01) parts.push(`volume ${fmt(decomposition.volumeDelta)}`);
    if (Math.abs(decomposition.priceDelta) > 0.01) parts.push(`price ${fmt(decomposition.priceDelta)}`);
    if (Math.abs(decomposition.mixDelta) > 0.01) parts.push(`mix ${fmt(decomposition.mixDelta)}`);
    if (parts.length) {
      claims.push({
        kind: "decomposition",
        metric: metric.id,
        period: "current vs previous half",
        detail: `Revenue change decomposes into ${parts.join(", ")}.`,
        rows: rowCount,
        value: decomposition.totalDelta,
      });
    }
  }

  // Correlation claims (strongest factors).
  for (const f of (correlation?.factors ?? []).slice(0, 3)) {
    if (f.strength === "weak") continue;
    claims.push({
      kind: "correlation",
      metric: metric.id,
      period: "monthly",
      dimension: f.column,
      detail: `${f.column} moves ${f.direction === "positive" ? "with" : "against"} ${metric.label} (Pearson ${f.pearson}). Association, not cause.`,
      rows: rowCount,
      value: f.pearson,
    });
  }

  // Anomaly claims.
  for (const a of (anomalies?.points ?? []).slice(0, 2)) {
    claims.push({
      kind: "anomaly",
      metric: metric.id,
      period: a.period,
      detail: `${a.period} was anomalous (${fmt(a.deviation)} vs median ${fmt(a.expected)}).`,
      rows: rowCount,
      value: a.deviation,
    });
  }

  // 5. Narrative — ranked, evidence-backed, non-causal.
  const narrative = buildNarrative(metric, totalDelta, changePct, drivers, decomposition, correlation, anomalies);

  return {
    metric: metric.id,
    metricLabel: metric.label,
    pack: pack.id,
    totalDelta,
    currentTotal: cur,
    previousTotal: prev,
    changePct,
    drivers,
    decomposition: decomposition?.canDecompose ? decomposition : null,
    correlation,
    anomalies,
    claims,
    narrative,
  };
}

function buildNarrative(
  metric: PackMetric,
  totalDelta: number,
  changePct: number | null,
  drivers: DriverResult[],
  decomposition: Decomposition | null,
  correlation: CorrelationResult | null,
  anomalies: AnomalyResult | null,
): string {
  const dir = totalDelta >= 0 ? "rose" : "fell";
  const pct = changePct === null ? "" : ` (${changePct >= 0 ? "+" : ""}${changePct}%)`;
  let n = `${metric.label} ${dir} by ${fmt(Math.abs(totalDelta))}${pct} between the two half-periods. `;

  // Driver evidence.
  if (drivers.length) {
    const top = drivers[0].contributions[0];
    if (top) {
      n += `The change concentrates in ${top.label} (${drivers[0].dimension.replace("_name", "").replace("_", " ")}), which accounts for ${Math.round(top.shareOfDelta * 100)}% of the movement. `;
    }
  }

  // Decomposition evidence.
  if (decomposition?.canDecompose) {
    const parts: string[] = [];
    if (Math.abs(decomposition.volumeDelta) > 0.01) parts.push(`volume ${fmt(decomposition.volumeDelta)}`);
    if (Math.abs(decomposition.priceDelta) > 0.01) parts.push(`price ${fmt(decomposition.priceDelta)}`);
    if (Math.abs(decomposition.mixDelta) > 0.01) parts.push(`mix ${fmt(decomposition.mixDelta)}`);
    if (parts.length) n += `Decomposing revenue: ${parts.join(", ")}. `;
  }

  // Correlation evidence (non-causal).
  const strong = (correlation?.factors ?? []).filter((f) => f.strength !== "weak").slice(0, 2);
  if (strong.length) {
    n += `Correlated factors: ${strong.map((f) => `${f.column} (${f.direction === "positive" ? "+" : "−"}${Math.abs(f.pearson)})`).join(", ")} — association only, not cause. `;
  }

  // Anomaly evidence.
  if (anomalies?.points.length) {
    n += `Anomalous periods: ${anomalies.points.slice(0, 2).map((a) => a.period).join(", ")}. `;
  }

  n += "These are evidence-backed observations; causation requires controlled experiments.";
  return n;
}

function fmt(n: number): string {
  const v = A.num(n);
  if (Math.abs(v) >= 1000) return v.toLocaleString(undefined, { maximumFractionDigits: 0 });
  return String(Math.round(v * 100) / 100);
}
