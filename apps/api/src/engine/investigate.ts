import type { Row } from "./parse.js";
import type { SchemaMap, Semantic } from "./schema.js";
import * as A from "./analytics.js";
import { analyzeDrivers, decomposePriceVolumeMix, type DriverResult } from "./drivers.js";
import { correlateMetric, type CorrelationResult } from "./correlate.js";
import { detectAnomalies, type AnomalyResult } from "./anomaly.js";
import { detectPack, getPack, packMetric, type PackMetric } from "./industries.js";

export interface EvidenceClaim {
  kind: "driver" | "decomposition" | "correlation" | "anomaly";
  metric: string;
  period: string;
  dimension?: string;
  detail: string;
  rows: number;
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
  decomposition: ReturnType<typeof decomposePriceVolumeMix> | null;
  correlation: CorrelationResult | null;
  anomalies: AnomalyResult | null;
  claims: EvidenceClaim[];
  narrative: string;
}

const CANDIDATE_DIMENSIONS: Semantic[] = ["product_name", "customer_name", "region", "category", "state", "department"];

export function investigate(rows: Row[], s: SchemaMap, metricId: string, packId?: string): Investigation {
  const pack = packId ? getPack(packId) : detectPack(s, [], "");
  const metric = packMetric(pack, metricId) ?? packMetric(pack, "revenue")!;
  const drivers: DriverResult[] = [];

  for (const dim of CANDIDATE_DIMENSIONS) {
    if (!s[dim]) continue;
    const d = analyzeDrivers(rows, s, metric, dim, {}, 5);
    if (d.contributions.length) drivers.push(d);
  }
  drivers.sort((a, b) => Math.abs(b.totalDelta) - Math.abs(a.totalDelta));

  const series = A.timeSeries(rows, s, metric);
  const previousTotal = series.length >= 2 ? series[series.length - 2]!.value : 0;
  const currentTotal = series.length >= 1 ? series[series.length - 1]!.value : 0;
  const totalDelta = currentTotal - previousTotal;
  const changePct = previousTotal !== 0 ? (totalDelta / Math.abs(previousTotal)) * 100 : null;
  const decomposition = metric.id === "revenue" ? decomposePriceVolumeMix(rows, s) : null;
  const correlation = correlateMetric(rows, s, metric);
  const anomalies = detectAnomalies(rows, s, metric);
  const claims: EvidenceClaim[] = [];

  for (const d of drivers.slice(0, 3)) {
    const top = d.contributions[0];
    if (!top) continue;
    claims.push({
      kind: "driver",
      metric: metric.id,
      period: "current vs previous half",
      dimension: d.dimension ? String(d.dimension) : undefined,
      detail: `${top.label} contribution ${fmt(top.delta)}`,
      rows: rows.length,
      value: top.delta,
    });
  }

  if (decomposition?.canDecompose) {
    const parts: string[] = [];
    if (Math.abs(decomposition.volumeDelta) > 0.01) parts.push(`volume ${fmt(decomposition.volumeDelta)}`);
    if (Math.abs(decomposition.priceDelta) > 0.01) parts.push(`price ${fmt(decomposition.priceDelta)}`);
    if (parts.length) {
      claims.push({
        kind: "decomposition",
        metric: metric.id,
        period: "current vs previous half",
        detail: `Revenue change: ${parts.join(", ")}`,
        rows: rows.length,
        value: totalDelta,
      });
    }
  }

  for (const f of (correlation?.factors ?? []).slice(0, 3)) {
    if (f.strength === "weak") continue;
    claims.push({
      kind: "correlation",
      metric: metric.id,
      period: "monthly",
      dimension: f.column,
      detail: `${f.column} moves with ${metric.id} (r=${f.pearson.toFixed(2)})`,
      rows: rows.length,
      value: f.pearson,
    });
  }

  for (const a of (anomalies?.points ?? []).slice(0, 2)) {
    if (!a.isAnomaly) continue;
    claims.push({
      kind: "anomaly",
      metric: metric.id,
      period: a.period,
      detail: `${a.period} was anomalous (${fmt(a.deviation)} vs median ${fmt(a.expected)})`,
      rows: rows.length,
      value: a.deviation,
    });
  }

  const narrative = buildNarrative(metric, totalDelta, changePct, drivers, decomposition, correlation, anomalies);
  return { metric: metric.id, metricLabel: metric.label, pack: pack.id, totalDelta, currentTotal, previousTotal, changePct, drivers, decomposition, correlation, anomalies, claims, narrative };
}

function buildNarrative(
  metric: PackMetric,
  totalDelta: number,
  changePct: number | null,
  drivers: DriverResult[],
  decomposition: ReturnType<typeof decomposePriceVolumeMix> | null,
  correlation: CorrelationResult | null,
  anomalies: AnomalyResult | null,
): string {
  const direction = totalDelta > 0 ? "increased" : totalDelta < 0 ? "decreased" : "was flat";
  const pct = changePct === null ? "with no comparable prior-period baseline" : `by ${Math.abs(changePct).toFixed(1)}%`;
  const parts = [`${metric.label} ${direction} ${pct}.`];
  const top = drivers[0]?.contributions[0];
  if (top) parts.push(`${top.label} was the largest identified driver, contributing ${fmt(top.delta)} to the change.`);
  if (decomposition?.canDecompose) {
    const major = Math.abs(decomposition.volumeDelta) >= Math.abs(decomposition.priceDelta) ? "volume" : "price";
    parts.push(`${major} was the larger component of the revenue change in the available decomposition.`);
  }
  const corr = correlation?.factors?.find(f => f.strength !== "weak");
  if (corr) parts.push(`${corr.column} showed a ${corr.strength} ${corr.direction} association with ${metric.id}; this is correlation, not causation.`);
  const anomalyCount = anomalies?.anomalies?.length ?? 0;
  if (anomalyCount) parts.push(`${anomalyCount} anomalous period${anomalyCount === 1 ? "" : "s"} was detected.`);
  return parts.join(" ");
}

function fmt(n: number): string {
  const v = A.num(n);
  return Math.abs(v) >= 1000 ? v.toLocaleString(undefined, { maximumFractionDigits: 0 }) : String(Math.round(v * 100) / 100);
}
