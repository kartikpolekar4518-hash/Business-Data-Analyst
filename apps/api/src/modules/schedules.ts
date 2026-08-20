import { Router } from "express";
import { z } from "zod";
import { prisma } from "../prisma.js";
import { wrap, HttpError } from "../errors.js";
import { requireAuth, requireRole } from "../auth/middleware.js";
import { nextRun, executeReport, executeAlertRule, type Frequency } from "../scheduler.js";

export const schedulesRouter = Router();
schedulesRouter.use(requireAuth);

const frequency = z.enum(["HOURLY", "DAILY", "WEEKLY", "MONTHLY"]);
const comparator = z.enum(["LT", "LTE", "GT", "GTE"]);
const metric = z.enum(["revenue", "profit", "margin", "orders", "customers"]);

// ─── Scheduled reports ───
const reportCreate = z.object({
  datasetId: z.string().optional(),
  title: z.string().max(120).optional(),
  frequency: frequency.default("WEEKLY"),
  enabled: z.boolean().default(true),
  recipients: z.array(z.string().email()).max(20).default([]),
});
const reportUpdate = reportCreate.partial();

schedulesRouter.get("/reports", wrap(async (req, res) => {
  const reports = await prisma.scheduledReport.findMany({ where: { organizationId: req.auth!.organizationId }, orderBy: { createdAt: "desc" } });
  res.json({ reports });
}));

schedulesRouter.post("/reports", requireRole("ADMIN", "MANAGER"), wrap(async (req, res) => {
  const body = reportCreate.parse(req.body ?? {});
  const report = await prisma.scheduledReport.create({
    data: { ...body, organizationId: req.auth!.organizationId, nextRunAt: nextRun(body.frequency as Frequency, new Date()) },
  });
  res.status(201).json({ report });
}));

schedulesRouter.patch("/reports/:id", requireRole("ADMIN", "MANAGER"), wrap(async (req, res) => {
  const body = reportUpdate.parse(req.body ?? {});
  const existing = await prisma.scheduledReport.findFirst({ where: { id: req.params.id, organizationId: req.auth!.organizationId } });
  if (!existing) throw new HttpError(404, "Scheduled report not found");
  // If the cadence changes, re-anchor the next run so it takes effect immediately.
  const nextRunAt = body.frequency ? nextRun(body.frequency as Frequency, new Date()) : undefined;
  const report = await prisma.scheduledReport.update({ where: { id: existing.id }, data: { ...body, ...(nextRunAt ? { nextRunAt } : {}) } });
  res.json({ report });
}));

schedulesRouter.delete("/reports/:id", requireRole("ADMIN", "MANAGER"), wrap(async (req, res) => {
  const existing = await prisma.scheduledReport.findFirst({ where: { id: req.params.id, organizationId: req.auth!.organizationId } });
  if (!existing) throw new HttpError(404, "Scheduled report not found");
  await prisma.scheduledReport.delete({ where: { id: existing.id } });
  res.status(204).end();
}));

// Run one schedule immediately, off-cadence. executeReport records success/failure
// in lastRunStatus and never throws, so we re-read and return the updated row.
schedulesRouter.post("/reports/:id/run", requireRole("ADMIN", "MANAGER"), wrap(async (req, res) => {
  const existing = await prisma.scheduledReport.findFirst({ where: { id: req.params.id, organizationId: req.auth!.organizationId } });
  if (!existing) throw new HttpError(404, "Scheduled report not found");
  await executeReport(existing);
  const report = await prisma.scheduledReport.findUnique({ where: { id: existing.id } });
  res.json({ report });
}));

// ─── Alert rules ───
const ruleCreate = z.object({
  name: z.string().min(1).max(80),
  metric,
  comparator,
  threshold: z.number().finite(),
  frequency: frequency.default("DAILY"),
  enabled: z.boolean().default(true),
});
const ruleUpdate = ruleCreate.partial();

schedulesRouter.get("/alert-rules", wrap(async (req, res) => {
  const rules = await prisma.alertRule.findMany({ where: { organizationId: req.auth!.organizationId }, orderBy: { createdAt: "desc" } });
  res.json({ rules });
}));

schedulesRouter.post("/alert-rules", requireRole("ADMIN", "MANAGER"), wrap(async (req, res) => {
  const body = ruleCreate.parse(req.body ?? {});
  const rule = await prisma.alertRule.create({
    data: { ...body, organizationId: req.auth!.organizationId, nextRunAt: nextRun(body.frequency as Frequency, new Date()) },
  });
  res.status(201).json({ rule });
}));

schedulesRouter.patch("/alert-rules/:id", requireRole("ADMIN", "MANAGER"), wrap(async (req, res) => {
  const body = ruleUpdate.parse(req.body ?? {});
  const existing = await prisma.alertRule.findFirst({ where: { id: req.params.id, organizationId: req.auth!.organizationId } });
  if (!existing) throw new HttpError(404, "Alert rule not found");
  const nextRunAt = body.frequency ? nextRun(body.frequency as Frequency, new Date()) : undefined;
  const rule = await prisma.alertRule.update({ where: { id: existing.id }, data: { ...body, ...(nextRunAt ? { nextRunAt } : {}) } });
  res.json({ rule });
}));

schedulesRouter.delete("/alert-rules/:id", requireRole("ADMIN", "MANAGER"), wrap(async (req, res) => {
  const existing = await prisma.alertRule.findFirst({ where: { id: req.params.id, organizationId: req.auth!.organizationId } });
  if (!existing) throw new HttpError(404, "Alert rule not found");
  await prisma.alertRule.delete({ where: { id: existing.id } });
  res.status(204).end();
}));

// Evaluate one rule immediately, off-cadence. executeAlertRule records the outcome
// (and any threshold-crossing alert) and never throws; re-read and return the row.
schedulesRouter.post("/alert-rules/:id/run", requireRole("ADMIN", "MANAGER"), wrap(async (req, res) => {
  const existing = await prisma.alertRule.findFirst({ where: { id: req.params.id, organizationId: req.auth!.organizationId } });
  if (!existing) throw new HttpError(404, "Alert rule not found");
  await executeAlertRule(existing);
  const rule = await prisma.alertRule.findUnique({ where: { id: existing.id } });
  res.json({ rule });
}));
