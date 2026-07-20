import { Router } from "express";
import { z } from "zod";
import rateLimit from "express-rate-limit";
import { prisma } from "../prisma.js";
import { wrap } from "../errors.js";
import { requireAuth, requireRole } from "../auth/middleware.js";
import { loadDataset } from "./context.js";
import * as A from "../engine/analytics.js";
import { forecast } from "../engine/forecast.js";

export const forecastingRouter = Router();
forecastingRouter.use(requireAuth);

const createSchema = z.object({
  metric: z.enum(["revenue", "profit", "orders"]).default("revenue"),
  horizon: z.number().int().min(1).max(12).default(3),
  datasetId: z.string().optional(),
});

// Forecast generation re-runs the full analytics engine over the dataset — rate-limit it.
const forecastLimiter = rateLimit({ windowMs: 60_000, limit: 10, standardHeaders: true, legacyHeaders: false, message: "Too many forecast requests — max 10 per minute" });

forecastingRouter.post("/", forecastLimiter, requireRole("ADMIN", "MANAGER"), wrap(async (req, res) => {
  const auth = req.auth!;
  const { metric, horizon, datasetId } = createSchema.parse(req.body);
  const { dataset, rows, schema } = await loadDataset(auth.organizationId, datasetId);
  const series = A.timeSeries(rows, schema, metric);
  const result = forecast(series.map((p) => ({ period: p.period, value: p.value })), horizon);

  const saved = await prisma.forecast.create({
    data: {
      organizationId: auth.organizationId,
      datasetId: dataset.id,
      metric, horizon, method: result.method,
      history: result.history as object,
      points: result.points as object,
    },
  });
  res.status(201).json({ forecast: saved });
}));

forecastingRouter.get("/", wrap(async (req, res) => {
  const forecasts = await prisma.forecast.findMany({
    where: { organizationId: req.auth!.organizationId },
    orderBy: { createdAt: "desc" },
    take: 20,
  });
  res.json({ forecasts });
}));
