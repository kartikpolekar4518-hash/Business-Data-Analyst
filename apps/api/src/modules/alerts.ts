import { Router } from "express";
import { prisma } from "../prisma.js";
import { wrap, HttpError } from "../errors.js";
import { requireAuth } from "../auth/middleware.js";
import { loadDataset } from "./context.js";
import { deriveInsights } from "../engine/insights.js";

export const alertsRouter = Router();
alertsRouter.use(requireAuth);

// Regenerate alerts from the latest dataset. Called from the write paths
// (upload, clean) — NOT from GET, which stays a pure read so polling is cheap.
// Reconciles by (type, metric): deletes alerts that no longer fire, refreshes
// the value/severity/description of ones that still fire (so they never go
// stale), and creates newly-triggered ones. Read state is preserved.
export async function refreshAlerts(organizationId: string) {
  try {
    const { rows, schema } = await loadDataset(organizationId);
    const { alerts } = deriveInsights(rows, schema);
    const existing = await prisma.alert.findMany({ where: { organizationId } });
    const desiredKeys = new Set(alerts.map((a) => `${a.type}:${a.metric}`));
    const existingByKey = new Map(existing.map((a) => [`${a.type}:${a.metric}`, a]));
    const stale = existing.filter((a) => !desiredKeys.has(`${a.type}:${a.metric}`));

    await prisma.$transaction(async (tx) => {
      if (stale.length) await tx.alert.deleteMany({ where: { id: { in: stale.map((a) => a.id) } } });
      for (const a of alerts) {
        const prev = existingByKey.get(`${a.type}:${a.metric}`);
        if (!prev) await tx.alert.create({ data: { ...a, organizationId } });
        else await tx.alert.update({ where: { id: prev.id }, data: { severity: a.severity, currentValue: a.currentValue, threshold: a.threshold, description: a.description } });
      }
    });
  } catch { /* no dataset yet — nothing to derive */ }
}

alertsRouter.get("/", wrap(async (req, res) => {
  const alerts = await prisma.alert.findMany({ where: { organizationId: req.auth!.organizationId }, orderBy: [{ read: "asc" }, { createdAt: "desc" }] });
  const unread = alerts.reduce((sum, a) => sum + (a.read ? 0 : 1), 0);
  res.json({ alerts, unread });
}));

alertsRouter.patch("/:id/read", wrap(async (req, res) => {
  const alert = await prisma.alert.findFirst({ where: { id: req.params.id, organizationId: req.auth!.organizationId } });
  if (!alert) throw new HttpError(404, "Alert not found");
  const updated = await prisma.alert.update({ where: { id: alert.id }, data: { read: true } });
  res.json({ alert: updated });
}));
