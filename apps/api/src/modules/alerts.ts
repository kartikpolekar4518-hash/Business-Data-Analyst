import { Router } from "express";
import { prisma } from "../prisma.js";
import { wrap, HttpError } from "../errors.js";
import { requireAuth } from "../auth/middleware.js";
import { loadJoinedDataset, loadOrgConfig } from "./context.js";
import { deriveInsights } from "../engine/insights.js";

export const alertsRouter = Router();
alertsRouter.use(requireAuth);

// Regenerate alerts from the latest dataset. Called from the write paths
// (upload, clean) — NOT from GET, which stays a pure read so polling is cheap.
// De-dupes by (type, metric) so re-running doesn't pile up copies.
export async function refreshAlerts(organizationId: string) {
  try {
    const { rows, schema } = await loadJoinedDataset(organizationId);
    const { currency } = await loadOrgConfig(organizationId);
    const { alerts } = deriveInsights(rows, schema, undefined, currency);
    const existing = await prisma.alert.findMany({ where: { organizationId } });
    const seen = new Set(existing.map((a) => `${a.type}:${a.metric}`));
    const fresh = alerts.filter((a) => !seen.has(`${a.type}:${a.metric}`));
    if (fresh.length) await prisma.alert.createMany({ data: fresh.map((a) => ({ ...a, organizationId })) });
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
