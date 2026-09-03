import { Router } from "express";
import { z } from "zod";
import { prisma } from "../prisma.js";
import { wrap } from "../errors.js";
import { requireAuth, requireRole } from "../auth/middleware.js";
import { loadDataset, loadOrgConfig } from "./context.js";
import * as A from "../engine/analytics.js";
import { forecast, evaluateGoal, whatIf } from "../engine/forecast.js";
import { detectPack, packMetric } from "../engine/industries.js";

export const forecastingRouter = Router();
forecastingRouter.use(requireAuth);

const createSchema = z.object({
  metric: z.string().min(1).default("revenue"),
  horizon: z.number().int().min(1).max(12).default(3),
  datasetId: z.string().optional(),
  goal: z.number().optional(),
  driverDelta: z.number().optional(),
});

forecastingRouter.post("/", requireRole("ADMIN", "MANAGER"), wrap(async (req, res) => {
  const auth = req.auth!;
  const { metric, horizon, datasetId, goal, driverDelta } = createSchema.parse(req.body);
  const { dataset, rows, schema } = await loadDataset(auth.organizationId, datasetId);
  const { calendar } = await loadOrgConfig(auth.organizationId);

  // Resolve the metric from the pack registry (any pack metric is forecastable).
  const pack = detectPack(schema, [], dataset.name);
  const metricDef = packMetric(pack, metric) ?? packMetric(pack, "revenue")!;
  const series = A.timeSeries(rows, schema, metricDef, {}, calendar);
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
    },
  });
  res.status(201).json({ forecast: saved, goal: goalStatus });
}));

forecastingRouter.get("/", wrap(async (req, res) => {
  const forecasts = await prisma.forecast.findMany({
    where: { organizationId: req.auth!.organizationId },
    orderBy: { createdAt: "desc" },
    take: 20,
  });
  res.json({ forecasts });
}));