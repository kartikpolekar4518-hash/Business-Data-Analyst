import type { Row } from "./parse.js";
import type { SchemaMap, Semantic } from "./schema.js";
import * as A from "./analytics.js";
import { analyzeDrivers, type DriverMetric, type DriverResult } from "./drivers.js";
import { analyzeCorrelations, type CorrelationResult } from "./correlate.js";
import { detectAnomalies, type AnomalyResult } from "./anomaly.js";
import { getPack } from "./industries.js";

export interface EvidenceClaim { kind: "driver" | "correlation" | "anomaly"; metric: string; period: string; dimension?: string; detail: string; rows: number; value: number; }
export interface Investigation { metric: DriverMetric; metricLabel: string; pack: string; comparisonAvailable: boolean; totalDelta: number; currentTotal: number; previousTotal: number; changePct: number | null; drivers: DriverResult[]; correlation: CorrelationResult; anomalies: AnomalyResult; claims: EvidenceClaim[]; narrative: string; }

const CANDIDATE_DIMENSIONS: Semantic[] = ["product_name", "medicine_name", "plan", "customer_name", "region", "category", "state", "department"];

// Driver attribution is currently defined only for revenue and profit. Rejecting
// another KPI is safer than silently returning a revenue investigation for a
// question about prescriptions, customers, or another unrelated measure.
function supportedMetric(metricId: string): DriverMetric | null {
  return metricId === "revenue" || metricId === "profit" ? metricId : null;
}

export function investigate(rows: Row[], s: SchemaMap, metricId: string, packId?: string): Investigation {
  const pack = getPack(packId);
  const metric = supportedMetric(metricId);
  if (!metric) throw new RangeError(`Unsupported investigation metric: ${metricId}`);
  const metricLabel = pack.kpis.find((kpi) => kpi.key === metric)?.label ?? metric[0].toUpperCase() + metric.slice(1);
  // Use the same median-based periods as driver analysis. Comparing the last two
  // months here would make the headline disagree with every driver claim.
  const { current, previous } = A.splitPeriods(rows, s);
  const comparisonAvailable = previous.length > 0;
  const drivers: DriverResult[] = [];
  if (comparisonAvailable) {
    for (const dim of CANDIDATE_DIMENSIONS) {
      if (!s[dim]) continue;
      const result = analyzeDrivers(rows, s, metric, dim, {}, 5);
      if (result.drivers.length) drivers.push(result);
    }
  }
  drivers.sort((a, b) => Math.abs(b.totalChange) - Math.abs(a.totalChange));

  const total = (periodRows: Row[]) => {
    if (metric === "revenue") return periodRows.reduce((sum, row) => sum + A.rowRevenue(row, s), 0);
    return periodRows.reduce((sum, row) => sum + A.rowProfit(row, s), 0);
  };
  const currentTotal = total(current);
  const previousTotal = total(previous);
  const totalDelta = comparisonAvailable ? currentTotal - previousTotal : 0;
  const changePct = comparisonAvailable && previousTotal !== 0 ? (totalDelta / Math.abs(previousTotal)) * 100 : null;

  const correlation = analyzeCorrelations(rows);
  const anomalies = detectAnomalies(A.timeSeries(rows, s, metric), metric);
  const periodRowCount = current.length + previous.length;
  const claims: EvidenceClaim[] = [];

  for (const driver of drivers.slice(0, 3)) {
    const top = driver.drivers[0];
    if (!top) continue;
    claims.push({ kind: "driver", metric, period: "current vs previous half", dimension: driver.dimension ?? undefined, detail: `${top.label} contribution ${fmt(top.contribution)}`, rows: periodRowCount, value: top.contribution });
  }

  for (const pair of correlation.pairs.slice(0, 3)) {
    if (pair.strength === "weak" || pair.strength === "negligible") continue;
    const movement = pair.direction === "negative" ? "move in opposite directions" : "move together";
    claims.push({ kind: "correlation", metric, period: "all records", dimension: pair.b, detail: `${pair.a} and ${pair.b} ${movement} (${pair.coefficient})`, rows: pair.sampleSize, value: pair.coefficient });
  }

  for (const anomaly of anomalies.anomalies.slice(0, 2)) {
    claims.push({ kind: "anomaly", metric, period: anomaly.period, detail: `${anomaly.period} was a ${anomaly.direction} (actual ${fmt(anomaly.value)} vs expected ${fmt(anomaly.expected)}; deviation ${fmt(anomaly.deviation)})`, rows: anomalies.points.length, value: anomaly.deviation });
  }

  const narrative = buildNarrative(metricLabel, currentTotal, totalDelta, changePct, comparisonAvailable, drivers, anomalies);
  return { metric, metricLabel, pack: pack.key, comparisonAvailable, totalDelta, currentTotal, previousTotal, changePct, drivers, correlation, anomalies, claims, narrative };
}

function buildNarrative(metricLabel: string, currentTotal: number, totalDelta: number, changePct: number | null, comparisonAvailable: boolean, drivers: DriverResult[], anomalies: AnomalyResult): string {
  if (!comparisonAvailable) return `${metricLabel} is ${fmt(currentTotal)}. There is not enough dated history for a period-over-period comparison.`;
  const direction = totalDelta > 0 ? "increased" : totalDelta < 0 ? "decreased" : "was unchanged";
  const change = changePct === null ? fmt(totalDelta) : `${fmt(totalDelta)} (${Math.round(changePct * 10) / 10}%)`;
  const lead = drivers[0]?.drivers[0];
  const driverText = lead ? ` The largest contribution came from ${lead.label} (${fmt(lead.contribution)}).` : "";
  const anomalyText = anomalies.anomalies.length ? ` ${anomalies.anomalies.length} anomalous period${anomalies.anomalies.length === 1 ? " was" : "s were"} detected.` : "";
  return `${metricLabel} ${direction} by ${change}.${driverText}${anomalyText}`;
}

function fmt(n: number): string {
  const value = A.num(n);
  return Math.abs(value) >= 1000 ? value.toLocaleString(undefined, { maximumFractionDigits: 0 }) : String(Math.round(value * 100) / 100);
}
