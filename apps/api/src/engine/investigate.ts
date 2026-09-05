import type { Row } from "./parse.js";
import type { SchemaMap, Semantic } from "./schema.js";
import * as A from "./analytics.js";
import { analyzeDrivers, decomposePriceVolumeMix, type DriverResult, type Decomposition } from "./drivers.js";
import { correlateMetric, type CorrelationResult } from "./correlate.js";
import { detectAnomalies, type AnomalyResult } from "./anomaly.js";
import { detectPack, getPack, packMetric, type PackMetric } from "./industries.js";

// Root-cause "why" investigation. Pure and deterministic: it orchestrates the
// existing evidence tools (driver attribution, price/volume/mix decomposition,
// correlation, anomaly detection) into one narrative. It never invents a number —
// every claim is computed by those tools and cites the rows it came from.
//
// Two guarantees carried over from the hardened engine:
//  - Period totals use the SAME comparison policy as driver analysis (A.splitPeriods:
//    the equal-duration interval immediately preceding the current one), so the
//    headline delta reconciles with the driver claims by construction.
//  - A single-period dataset is never presented as a change.

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
  comparisonAvailable: boolean;
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

function comparisonLabel(split: A.PeriodSplit): string {
  return split.currentRange && split.previousRange
    ? `${split.currentRange[0]}..${split.currentRange[1]} vs ${split.previousRange[0]}..${split.previousRange[1]}`
    : "no comparison period";
}

export function investigate(rows: Row[], s: SchemaMap, metricId: string, packId?: string): Investigation {
  const pack = packId ? getPack(packId) : detectPack(s, [], "");
  const metric = packMetric(pack, metricId);
  // Silently investigating "revenue" when the caller asked about a metric this
  // pack does not define would produce a confident answer to the wrong question.
  if (!metric) throw new RangeError(`Unsupported investigation metric: ${metricId}`);

  // Same periods as analyzeDrivers, so the headline and the driver claims agree.
  const split = A.splitPeriods(rows, s);
  const { current, previous } = split;
  const comparisonAvailable = split.basis === "trailing_equal_period";
  const currentTotal = round(metric.compute(current, s));
  const previousTotal = comparisonAvailable ? round(metric.compute(previous, s)) : 0;
  const totalDelta = comparisonAvailable ? round(currentTotal - previousTotal) : 0;
  const changePct = comparisonAvailable && previousTotal !== 0 ? round((totalDelta / Math.abs(previousTotal)) * 100) : null;

  // Driver attribution only makes sense for additive metrics — summing a ratio
  // (churn, ARPU) or a distinct count across dimension members is meaningless. For
  // those we still investigate via correlation and anomalies, just not drivers.
  const attributable = metric.kind === "sum";
  const drivers: DriverResult[] = [];
  if (comparisonAvailable && attributable) {
    for (const dim of CANDIDATE_DIMENSIONS) {
      if (!s[dim]) continue;
      const d = analyzeDrivers(rows, s, metric, dim, {}, 5);
      if (d.drivers.length) drivers.push(d);
    }
    drivers.sort((a, b) => Math.abs(b.totalChange) - Math.abs(a.totalChange));
  }

  const decomposition = metric.id === "revenue" ? decomposePriceVolumeMix(rows, s) : null;
  const correlation = correlateMetric(rows, s, metric);
  const anomalies = detectAnomalies(rows, s, metric);
  const claims: EvidenceClaim[] = [];

  for (const d of drivers.slice(0, 3)) {
    const top = d.drivers[0];
    if (!top) continue;
    claims.push({ kind: "driver", metric: metric.id, period: comparisonLabel(split), dimension: d.dimension ?? undefined, detail: `${top.label} contribution ${A.fmt(top.contribution)}`, rows: d.drivers.length, value: top.contribution });
  }

  if (decomposition?.canDecompose) {
    const parts: string[] = [];
    if (Math.abs(decomposition.volumeDelta) > 0.01) parts.push(`volume ${A.fmt(decomposition.volumeDelta)}`);
    if (Math.abs(decomposition.priceDelta) > 0.01) parts.push(`price ${A.fmt(decomposition.priceDelta)}`);
    if (Math.abs(decomposition.mixDelta) > 0.01) parts.push(`mix ${A.fmt(decomposition.mixDelta)}`);
    if (parts.length) claims.push({ kind: "decomposition", metric: metric.id, period: comparisonLabel(split), detail: `Revenue change: ${parts.join(", ")}`, rows: rows.length, value: totalDelta });
  }

  for (const f of (correlation?.factors ?? []).slice(0, 3)) {
    if (f.strength === "weak") continue;
    claims.push({ kind: "correlation", metric: metric.id, period: "monthly", dimension: f.column, detail: `${f.column} moves with ${metric.id} (r=${f.pearson.toFixed(2)})`, rows: rows.length, value: f.pearson });
  }

  for (const a of (anomalies?.anomalies ?? []).slice(0, 2)) {
    claims.push({ kind: "anomaly", metric: metric.id, period: a.period, detail: `${a.period} was anomalous (${A.fmt(a.deviation)} vs expected ${A.fmt(a.expected)})`, rows: rows.length, value: a.deviation });
  }

  const narrative = buildNarrative(metric, comparisonAvailable, currentTotal, totalDelta, changePct, drivers, decomposition, correlation, anomalies);
  return { metric: metric.id, metricLabel: metric.label, pack: pack.id, comparisonAvailable, totalDelta, currentTotal, previousTotal, changePct, drivers, decomposition, correlation, anomalies, claims, narrative };
}

function buildNarrative(metric: PackMetric, comparisonAvailable: boolean, currentTotal: number, totalDelta: number, changePct: number | null, drivers: DriverResult[], decomposition: Decomposition | null, correlation: CorrelationResult | null, anomalies: AnomalyResult | null): string {
  if (!comparisonAvailable) return `${metric.label} is ${A.fmt(currentTotal)}. There is not enough dated history for a period-over-period comparison.`;
  const direction = totalDelta > 0 ? "increased" : totalDelta < 0 ? "decreased" : "was flat";
  const change = changePct === null ? A.fmt(totalDelta) : `${A.fmt(totalDelta)} (${Math.abs(changePct).toFixed(1)}%)`;
  const parts = [`${metric.label} ${direction} by ${change}.`];

  const top = drivers[0]?.drivers[0];
  if (top) parts.push(`${top.label} was the largest identified driver, contributing ${A.fmt(top.contribution)} to the change.`);

  if (decomposition?.canDecompose) {
    const components = [["volume", decomposition.volumeDelta], ["price", decomposition.priceDelta], ["mix", decomposition.mixDelta]] as const;
    const major = components.reduce((best, item) => Math.abs(item[1]) > Math.abs(best[1]) ? item : best, components[0]);
    if (Math.abs(major[1]) > 0.01) parts.push(`${major[0]} was the largest component of the revenue change in the available decomposition.`);
  }

  const corr = correlation?.factors?.find((f) => f.strength !== "weak");
  if (corr) parts.push(`${corr.column} showed a ${corr.strength} ${corr.direction} association with ${metric.id}; this is correlation, not causation.`);

  const anomalyCount = anomalies?.anomalies?.length ?? 0;
  if (anomalyCount) parts.push(`${anomalyCount} anomalous period${anomalyCount === 1 ? " was" : "s were"} detected.`);
  return parts.join(" ");
}

// Coercing round: a ratio metric that divides by zero yields NaN/Infinity, and the
// narrative must not print it. A.round alone does not coerce, so the num() step is
// load-bearing here and is not shared with the other call sites of A.round.
function round(n: number): number { return A.round(A.num(n)); }

