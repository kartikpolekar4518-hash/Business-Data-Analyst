import { Router } from "express";
import { z } from "zod";
import { prisma } from "../prisma.js";
import { wrap } from "../errors.js";
import { requireAuth, requireRole } from "../auth/middleware.js";
import { loadJoinedDataset, loadOrgConfig } from "./context.js";
import * as A from "../engine/analytics.js";
import { forecast, evaluateGoal, whatIf } from "../engine/forecast.js";
import { detectPack, packMetric } from "../engine/industries.js";
import { applyScenario, scenarioImpact, isEmptyScenario, SCENARIO_FIELDS, MIN_CHANGE_PCT, MAX_CHANGE_PCT } from "../engine/scenario.js";

export const forecastingRouter = Router();
forecastingRouter.use(requireAuth);

// A lever is one percentage change to one business quantity — no expression language,
// the same rule metricSpec.ts follows. Bounds are the engine's, so an out-of-range
// slider is a 400 here rather than a nonsense projection.
const leverSchema = z.object({
  field: z.enum(SCENARIO_FIELDS),
  changePct: z.number().finite().min(MIN_CHANGE_PCT).max(MAX_CHANGE_PCT),
});

const createSchema = z.object({
  metric: z.string().min(1).default("revenue"),
  horizon: z.number().int().min(1).max(12).default(3),
  datasetId: z.string().optional(),
  goal: z.number().optional(),
  driverDelta: z.number().optional(),
  levers: z.array(leverSchema).max(SCENARIO_FIELDS.length * 2).optional(),
});

forecastingRouter.post("/", requireRole("ADMIN", "MANAGER"), wrap(async (req, res) => {
  const auth = req.auth!;
  const { metric, horizon, datasetId, goal, driverDelta, levers = [] } = createSchema.parse(req.body);
  const { dataset, rows, schema } = await loadJoinedDataset(auth.organizationId, datasetId);
  const { pack: orgPack, calendar } = await loadOrgConfig(auth.organizationId);

  // Resolve the metric from the pack registry (any pack metric is forecastable).
  // The org's compiled pack is consulted first because it carries the custom metrics;
  // the dataset-detected pack still supplies industry metrics for an uploaded file
  // whose shape differs from the org's configured industry.
  const detected = detectPack(schema, [], dataset.name);
  const metricDef = packMetric(orgPack, metric) ?? packMetric(detected, metric)
    ?? packMetric(orgPack, "revenue") ?? packMetric(detected, "revenue")!;
  // The scenario is applied to the ROWS, before any analytic runs; timeSeries and the
  // forecaster below are unchanged and never learn that a scenario exists. With no
  // levers applyScenario hands back the very same array, so a plain forecast is
  // byte-identical to the one this route produced before scenarios existed.
  const scenarioRows = applyScenario(rows, schema, levers);
  const impact = scenarioImpact(schema, levers);
  const series = A.timeSeries(scenarioRows, schema, metricDef, {}, calendar);
  const history = series.map((p) => ({ period: p.period, value: p.value }));

  let result;
  let goalStatus = null;
  if (driverDelta !== undefined) {
    const wi = whatIf(history, horizon, driverDelta, goal);
    result = wi.scenario;
    goalStatus = wi.goal ?? null;
  } else {
    result = forecast(history, horizon);
    if (goal !== undefined) goalStatus = evaluateGoal(result.points[0]?.value ?? 0, goal);
  }

  const saved = await prisma.forecast.create({
    data: {
      organizationId: auth.organizationId,
      datasetId: dataset.id,
      metric: metricDef.id, horizon, method: result.method,
      datasetHash: dataset.datasetHash, engineVersion: dataset.engineVersion,
      history: result.history as object,
      points: result.points as object,
      // Recorded so a saved scenario can be told apart from a plain forecast of the
      // same metric. Null when nothing was asked for, which is what every forecast
      // saved before this column existed carries.
      scenario: isEmptyScenario(levers) && goal === undefined && driverDelta === undefined
        ? undefined
        : { levers, goal: goal ?? null, driverDelta: driverDelta ?? null },
    },
  });
  // `impact` states what each lever can and cannot reach in THIS dataset's shape — a
  // price lever moves profit only where revenue is derived as quantity x unit_price.
  // The panel prints it rather than showing a silently unchanged profit.
  res.status(201).json({ forecast: saved, goal: goalStatus, impact });
}));

forecastingRouter.get("/", wrap(async (req, res) => {
  const forecasts = await prisma.forecast.findMany({
    where: { organizationId: req.auth!.organizationId },
    orderBy: { createdAt: "desc" },
    take: 20,
  });
  res.json({ forecasts });
}));