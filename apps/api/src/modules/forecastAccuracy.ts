import { Prisma } from "@prisma/client";
import { prisma } from "../prisma.js";
import { loadJoinedDataset, loadOrgConfig } from "./context.js";
import * as A from "../engine/analytics.js";
import { detectPack, packMetric } from "../engine/industries.js";
import { scoreForecastPoints, summarize, type PredictedPoint, type ScoredPoint } from "../engine/accuracy.js";

/**
 * Grade every saved forecast whose periods have since completed.
 *
 * Called from the write paths that bring new actuals in — the same three places
 * `refreshAlerts` is called from, for the same reason: the trigger is data arriving,
 * not a clock. A scheduled job would score nothing on most ticks and would lag the
 * upload that made the score possible.
 *
 * Swallows its own errors, exactly as refreshAlerts does. An upload must never fail
 * because a derived artifact could not be computed.
 */
export async function scoreForecasts(organizationId: string): Promise<void> {
  try {
    const { dataset, rows, schema } = await loadJoinedDataset(organizationId);
    const { pack: orgPack, calendar } = await loadOrgConfig(organizationId);

    // A lever projects a counterfactual world. Grading it against the real one
    // measures nothing, so scenario forecasts never enter production accuracy.
    const forecasts = await prisma.forecast.findMany({
      // DbNull, not JsonNull: a plain forecast leaves the column unset, so the SQL NULL
      // is what marks it as having no scenario.
      where: { organizationId, scenario: { equals: Prisma.DbNull } },
      select: { id: true, metric: true, points: true, datasetHash: true },
    });
    if (!forecasts.length) return;

    const detected = detectPack(schema, [], dataset.name);
    // One series per distinct metric, not per forecast — the same metric forecast ten
    // times reads the same actuals.
    const seriesByMetric = new Map<string, { actuals: Map<string, number>; lastComplete: string | null }>();
    const seriesFor = (metric: string) => {
      const cached = seriesByMetric.get(metric);
      if (cached) return cached;
      const metricDef = packMetric(orgPack, metric) ?? packMetric(detected, metric);
      const series = metricDef ? A.timeSeries(rows, schema, metricDef, {}, calendar) : [];
      const built = {
        actuals: new Map(series.map((p) => [p.period, p.value])),
        lastComplete: series.length ? series[series.length - 1].period : null,
      };
      seriesByMetric.set(metric, built);
      return built;
    };

    for (const f of forecasts) {
      const { actuals, lastComplete } = seriesFor(f.metric);
      if (!actuals.size) continue;
      const points = Array.isArray(f.points) ? (f.points as unknown as PredictedPoint[]) : [];
      const scored = scoreForecastPoints(points, actuals, lastComplete);
      if (!scored.length) continue;

      // The forecast was made against data that has since changed. Still scored — the
      // actual is the actual, and reading it is not replaying the forecast — but
      // flagged, kept out of the headline, and counted separately on the page.
      const stale = f.datasetHash !== null && f.datasetHash !== dataset.datasetHash;

      for (const s of scored) {
        const row = {
          horizonStep: s.horizonStep,
          predicted: s.predicted, lower: s.lower, upper: s.upper,
          actual: s.actual, absError: s.absError, pctError: s.pctError, withinBand: s.withinBand,
          stale, datasetHash: dataset.datasetHash, engineVersion: dataset.engineVersion,
        };
        // Upsert, not create: re-running this after another upload converges on one
        // verdict per period instead of accumulating, and a corrected actual updates
        // the row it already wrote.
        await prisma.forecastScore.upsert({
          where: { forecastId_period: { forecastId: f.id, period: s.period } },
          create: { ...row, forecastId: f.id, period: s.period, organizationId },
          update: { ...row, scoredAt: new Date() },
        });
      }
    }
  } catch { /* no dataset yet, or a metric this data cannot compute — nothing to score */ }
}

export interface AccuracyBreakdown {
  summary: ReturnType<typeof summarize> & { scoredForecasts: number; staleCount: number };
  byMetric: { metric: string; predictions: number; accuracyPct: number | null; mape: number | null; withinBandRate: number | null }[];
  byHorizonStep: { horizonStep: number; predictions: number; accuracyPct: number | null; mape: number | null }[];
  byMethod: { method: string; predictions: number; accuracyPct: number | null }[];
  recent: {
    forecastId: string; metric: string; method: string; period: string;
    predicted: number; actual: number; pctError: number | null; withinBand: boolean;
    stale: boolean; createdAt: Date;
  }[];
}

/**
 * The Track Record page's whole payload.
 *
 * Every figure here is production accuracy — predictions that matured and were then
 * observed. None of it is the bake-off's held-out error, which lives on the forecast
 * that produced it and answers a different question.
 */
export async function accuracyBreakdown(organizationId: string): Promise<AccuracyBreakdown> {
  const scores = await prisma.forecastScore.findMany({
    where: { organizationId },
    orderBy: { scoredAt: "desc" },
    include: { forecast: { select: { method: true, metric: true, createdAt: true } } },
  });

  // The headline is computed over predictions made against data that still stands.
  // Stale ones are counted and stated, never silently mixed in.
  const fresh = scores.filter((s) => !s.stale);
  const headline = summarize(fresh);

  const group = <K extends string | number>(rows: typeof scores, key: (s: (typeof scores)[number]) => K) => {
    const buckets = new Map<K, typeof scores>();
    for (const s of rows) {
      const k = key(s);
      const bucket = buckets.get(k);
      if (bucket) bucket.push(s); else buckets.set(k, [s]);
    }
    return buckets;
  };

  const byMetric = [...group(fresh, (s) => s.forecast.metric)].map(([metric, rows]) => {
    const g = summarize(rows);
    return { metric, predictions: g.predictions, accuracyPct: g.accuracyPct, mape: g.mape, withinBandRate: g.withinBandRate };
  }).sort((a, b) => b.predictions - a.predictions);

  const byHorizonStep = [...group(fresh, (s) => s.horizonStep)].map(([horizonStep, rows]) => {
    const g = summarize(rows);
    return { horizonStep, predictions: g.predictions, accuracyPct: g.accuracyPct, mape: g.mape };
  }).sort((a, b) => a.horizonStep - b.horizonStep);

  // Whether the method the bake-off picked actually held up once the periods arrived.
  // The two numbers are reported side by side and never averaged together.
  const byMethod = [...group(fresh, (s) => s.forecast.method)].map(([method, rows]) => {
    const g = summarize(rows);
    return { method, predictions: g.predictions, accuracyPct: g.accuracyPct };
  }).sort((a, b) => b.predictions - a.predictions);

  return {
    summary: {
      ...headline,
      scoredForecasts: new Set(fresh.map((s) => s.forecastId)).size,
      staleCount: scores.length - fresh.length,
    },
    byMetric,
    byHorizonStep,
    byMethod,
    recent: scores.slice(0, 50).map((s) => ({
      forecastId: s.forecastId, metric: s.forecast.metric, method: s.forecast.method,
      period: s.period, predicted: s.predicted, actual: s.actual,
      pctError: s.pctError, withinBand: s.withinBand, stale: s.stale,
      createdAt: s.forecast.createdAt,
    })),
  };
}

export type { ScoredPoint };
