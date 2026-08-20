import type { Row } from "./parse.js";
import type { SchemaMap, Semantic } from "./schema.js";
import * as A from "./analytics.js";
import { analyzeDrivers, decomposePriceVolumeMix, type DriverResult, type Decomposition } from "./drivers.js";
import { analyzeCorrelations, type CorrelationResult } from "./correlate.js";
import { detectAnomalies, type AnomalyResult } from "./anomaly.js";
import { detectPack, getPack, packMetric, type PackMetric } from "./industries.js";

export interface EvidenceClaim { kind: "driver" | "decomposition" | "correlation" | "anomaly"; metric: string; period: string; dimension?: string; detail: string; rows: number; value: number; }
export interface Investigation { metric: string; metricLabel: string; pack: string; totalDelta: number; currentTotal: number; previousTotal: number; changePct: number | null; drivers: DriverResult[]; decomposition: Decomposition | null; correlation: CorrelationResult | null; anomalies: AnomalyResult | null; claims: EvidenceClaim[]; narrative: string; }

const CANDIDATE_DIMENSIONS: Semantic[] = ["product_name", "customer_name", "region", "category", "state", "department"];

export function investigate(rows: Row[], s: SchemaMap, metricId: string, packId?: string): Investigation {
  const pack = packId ? getPack(packId) : detectPack(s, [], "");
  const metric = packMetric(pack, metricId) ?? packMetric(pack, "revenue")!;
  const drivers: DriverResult[] = [];
  for (const dim of CANDIDATE_DIMENSIONS) {
    if (!s[dim]) continue;
    const d = analyzeDrivers(rows, s, metric, dim, {}, 5);
    if (d.drivers.length) drivers.push(d);
  }
  drivers.sort((a, b) => Math.abs(b.totalChange) - Math.abs(a.totalChange));

  const series = A.timeSeries(rows, s, metric);
  const fallbackPrev = series.length >= 2 ? series[series.length - 2]!.value : 0;
  const fallbackCur = series.length >= 1 ? series[series.length - 1]!.value : 0;
  const currentTotal = fallbackCur, previousTotal = fallbackPrev, totalDelta = currentTotal - previousTotal;
  const changePct = previousTotal !== 0 ? (totalDelta / previousTotal) * 100 : null;

  const decomposition = metric.id === "revenue" ? decomposePriceVolumeMix(rows, s) : null;
  const correlation = analyzeCorrelations(rows);
  const anomalies = detectAnomalies(A.timeSeries(rows, s, metric.id as "revenue" | "profit"), metric.id);
  const claims: EvidenceClaim[] = [];

  for (const d of drivers.slice(0, 3)) {
    const top = d.drivers[0];
    if (!top) continue;
    claims.push({ kind: "driver", metric: metric.id, period: "current vs previous half", dimension: d.dimension ?? undefined, detail: `${top.label} contribution ${fmt(top.contribution)}`, rows: d.drivers.length, value: top.contribution });
  }

  if (decomposition?.canDecompose) {
    const parts: string[] = [];
    if (Math.abs(decomposition.volumeDelta) > 0.01) parts.push(`volume ${fmt(decomposition.volumeDelta)}`);
    if (Math.abs(decomposition.priceDelta) > 0.01) parts.push(`price ${fmt(decomposition.priceDelta)}`);
    if (parts.length) claims.push({ kind: "decomposition", metric: metric.id, period: "current vs previous half", detail: `Revenue change: ${parts.join(", ")}`, rows: rows.length, value: totalDelta });
  }

  for (const p of (correlation?.pairs ?? []).slice(0, 3)) {
    if (p.strength === "weak" || p.strength === "negligible") continue;
    claims.push({ kind: "correlation", metric: metric.id, period: "monthly", dimension: p.b, detail: `${p.a} and ${p.b} move together`, rows: p.sampleSize, value: p.coefficient });
  }

  for (const a of (anomalies?.anomalies ?? []).slice(0, 2))
    claims.push({ kind: "anomaly", metric: metric.id, period: a.period, detail: `${a.period} was anomalous (${fmt(a.deviation)} vs expected ${fmt(a.expected)})`, rows: rows.length, value: a.deviation });

  const narrative = buildNarrative(metric, totalDelta, changePct, drivers, decomposition, correlation, anomalies);
  return { metric: metric.id, metricLabel: metric.label!, pack: pack.id, totalDelta, currentTotal, previousTotal, changePct, drivers, decomposition, correlation, anomalies, claims, narrative };
}

function buildNarrative(metric: PackMetric, totalDelta: number, changePct: number | null, drivers: DriverResult[], decomposition: Decomposition | null, correlation: CorrelationResult | null, anomalies: AnomalyResult | null): string {
  return "";
}

function fmt(n: number): string {
  const v = A.num(n);
  return Math.abs(v) >= 1000 ? v.toLocaleString(undefined, { maximumFractionDigits: 0 }) : String(Math.round(v * 100) / 100);
}
