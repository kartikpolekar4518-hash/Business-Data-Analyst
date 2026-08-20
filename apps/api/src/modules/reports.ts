import { Router } from "express";
import { z } from "zod";
import { randomBytes } from "node:crypto";
import PDFDocument from "pdfkit";
import { prisma } from "../prisma.js";
import { env } from "../env.js";
import { wrap, HttpError } from "../errors.js";
import { requireAuth, requireRole } from "../auth/middleware.js";
import { assertWithinLimit } from "./billing.js";
import { loadDataset } from "./context.js";
import * as A from "../engine/analytics.js";
import { getPack } from "../engine/industries.js";
import { composeReport, fmtKpiValue, applyTemplate, type ReportInclude } from "../engine/report.js";

export const reportsRouter = Router();
reportsRouter.use(requireAuth);

// Build the full executive report structure from the deterministic engine,
// tailored to the org's industry pack (KPIs, section titles, and wording).
// Exported so the scheduler can regenerate reports on a cadence.
export async function buildReport(organizationId: string, datasetId?: string) {
  const { dataset, rows, schema } = await loadDataset(organizationId, datasetId);
  const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { industry: true } });
  const content = composeReport(getPack(org?.industry), rows, schema);
  return { datasetId: dataset.id, datasetName: dataset.name, ...content };
}

const genSchema = z.object({ datasetId: z.string().optional(), title: z.string().optional(), templateId: z.string().optional() });

reportsRouter.post("/generate", requireRole("ADMIN", "MANAGER"), wrap(async (req, res) => {
  const { datasetId, title, templateId } = genSchema.parse(req.body ?? {});
  await assertWithinLimit(req.auth!.organizationId, "reportsPerMonth");
  // A template (if given) selects which blocks the report includes.
  let include: ReportInclude | undefined;
  if (templateId) {
    const tpl = await prisma.reportTemplate.findFirst({ where: { id: templateId, organizationId: req.auth!.organizationId } });
    if (!tpl) throw new HttpError(404, "Report template not found");
    include = tpl.include as ReportInclude;
  }
  const content = applyTemplate(await buildReport(req.auth!.organizationId, datasetId), include);
  const report = await prisma.report.create({
    data: {
      organizationId: req.auth!.organizationId,
      datasetId: (content as any).datasetId,
      title: title || `Executive Report — ${(content as any).datasetName}`,
      content: content as object,
    },
  });
  res.status(201).json({ report });
}));

// ─── Report templates (named block selections) ───
const includeSchema = z.object({ summary: z.boolean(), kpis: z.boolean(), sections: z.boolean(), forecast: z.boolean(), recommendations: z.boolean() }).partial();
const templateCreate = z.object({ name: z.string().min(1).max(80), include: includeSchema });
const templateUpdate = templateCreate.partial();

reportsRouter.get("/templates", wrap(async (req, res) => {
  const templates = await prisma.reportTemplate.findMany({ where: { organizationId: req.auth!.organizationId }, orderBy: { createdAt: "desc" } });
  res.json({ templates });
}));

reportsRouter.post("/templates", requireRole("ADMIN", "MANAGER"), wrap(async (req, res) => {
  const body = templateCreate.parse(req.body ?? {});
  const template = await prisma.reportTemplate.create({ data: { ...body, organizationId: req.auth!.organizationId } });
  res.status(201).json({ template });
}));

reportsRouter.patch("/templates/:id", requireRole("ADMIN", "MANAGER"), wrap(async (req, res) => {
  const body = templateUpdate.parse(req.body ?? {});
  const existing = await prisma.reportTemplate.findFirst({ where: { id: req.params.id, organizationId: req.auth!.organizationId } });
  if (!existing) throw new HttpError(404, "Report template not found");
  const template = await prisma.reportTemplate.update({ where: { id: existing.id }, data: body });
  res.json({ template });
}));

reportsRouter.delete("/templates/:id", requireRole("ADMIN", "MANAGER"), wrap(async (req, res) => {
  const existing = await prisma.reportTemplate.findFirst({ where: { id: req.params.id, organizationId: req.auth!.organizationId } });
  if (!existing) throw new HttpError(404, "Report template not found");
  await prisma.reportTemplate.delete({ where: { id: existing.id } });
  res.status(204).end();
}));

reportsRouter.get("/", wrap(async (req, res) => {
  const reports = await prisma.report.findMany({
    where: { organizationId: req.auth!.organizationId },
    orderBy: { createdAt: "desc" },
    select: { id: true, title: true, createdAt: true, datasetId: true },
  });
  res.json({ reports });
}));

reportsRouter.get("/:id", wrap(async (req, res) => {
  const report = await prisma.report.findFirst({ where: { id: req.params.id, organizationId: req.auth!.organizationId } });
  if (!report) throw new HttpError(404, "Report not found");
  res.json({ report });
}));

// ─── Public share links ───
// A share is a bearer capability: anyone with the token can view the report (and
// its PDF) without logging in. Creation/listing/revocation are ADMIN/MANAGER and
// org-scoped; the public read side lives in modules/share.ts.

const shareUrl = (token: string) => `${env.appUrl.split(",")[0]}/share/${token}`;
const shareView = (s: { id: string; token: string; expiresAt: Date | null; revokedAt: Date | null; createdAt: Date }) =>
  ({ id: s.id, token: s.token, url: shareUrl(s.token), expiresAt: s.expiresAt, revokedAt: s.revokedAt, createdAt: s.createdAt });

const shareCreate = z.object({ expiresInDays: z.union([z.literal(7), z.literal(30), z.literal(90)]).nullable().default(30) });

// Listing exposes live bearer tokens, so it needs the same role gate as create/revoke.
reportsRouter.get("/:id/shares", requireRole("ADMIN", "MANAGER"), wrap(async (req, res) => {
  const report = await prisma.report.findFirst({ where: { id: req.params.id, organizationId: req.auth!.organizationId }, select: { id: true } });
  if (!report) throw new HttpError(404, "Report not found");
  const shares = await prisma.reportShare.findMany({ where: { reportId: report.id }, orderBy: { createdAt: "desc" } });
  res.json({ shares: shares.map(shareView) });
}));

reportsRouter.post("/:id/shares", requireRole("ADMIN", "MANAGER"), wrap(async (req, res) => {
  const { expiresInDays } = shareCreate.parse(req.body ?? {});
  const report = await prisma.report.findFirst({ where: { id: req.params.id, organizationId: req.auth!.organizationId }, select: { id: true, title: true } });
  if (!report) throw new HttpError(404, "Report not found");
  const expiresAt = expiresInDays ? new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000) : null;
  const share = await prisma.reportShare.create({
    data: { token: randomBytes(24).toString("base64url"), expiresAt, reportId: report.id, organizationId: req.auth!.organizationId, createdById: req.auth!.userId },
  });
  await prisma.activityLog.create({ data: { organizationId: req.auth!.organizationId, action: "report.shared", detail: report.title, actorId: req.auth!.userId } });
  res.status(201).json({ share: shareView(share) });
}));

reportsRouter.delete("/:id/shares/:shareId", requireRole("ADMIN", "MANAGER"), wrap(async (req, res) => {
  const share = await prisma.reportShare.findFirst({ where: { id: req.params.shareId, reportId: req.params.id, organizationId: req.auth!.organizationId }, include: { report: { select: { title: true } } } });
  if (!share) throw new HttpError(404, "Share link not found");
  if (!share.revokedAt) {
    await prisma.reportShare.update({ where: { id: share.id }, data: { revokedAt: new Date() } });
    await prisma.activityLog.create({ data: { organizationId: req.auth!.organizationId, action: "report.shareRevoked", detail: share.report.title, actorId: req.auth!.userId } });
  }
  res.status(204).end();
}));

reportsRouter.get("/:id/pdf", wrap(async (req, res) => {
  const report = await prisma.report.findFirst({ where: { id: req.params.id, organizationId: req.auth!.organizationId } });
  if (!report) throw new HttpError(404, "Report not found");
  const pdf = await renderReportPdf(report);
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${report.title.replace(/[^\w -]/g, "")}.pdf"`);
  res.send(pdf);
}));

// Render a stored report to a PDF Buffer. Shared by the download route and the
// scheduler's email attachments so both produce byte-identical documents.
export function renderReportPdf(report: { title: string; createdAt: Date | string; content: unknown }): Promise<Buffer> {
  const c = report.content as any;
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50, size: "A4" });
    const chunks: Buffer[] = [];
    doc.on("data", (ch: Buffer) => chunks.push(ch));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.fontSize(22).fillColor("#111827").text(report.title);
  doc.moveDown(0.3);
  doc.fontSize(9).fillColor("#6b7280").text(`Generated ${new Date(report.createdAt).toLocaleString()}  ·  NoPS`);
  doc.moveDown(1);

  // Blocks can be omitted by a report template — skip any that came through empty.
  if (c.summary) {
    section(doc, "Executive Summary");
    doc.fontSize(11).fillColor("#374151").text(c.summary, { align: "left" });
    doc.moveDown(1);
  }

  // Pack-driven KPIs (new shape). Legacy reports stored the old fixed object; render both.
  if (Array.isArray(c.kpis)) {
    if (c.kpis.length) {
      section(doc, "Key Metrics");
      for (const k of c.kpis as A.KpiResult[]) kv(doc, k.label, fmtKpiValue(k));
      doc.moveDown(0.6);
    }
  } else if (c.kpis) {
    section(doc, "Key Metrics");
    const k = c.kpis;
    kv(doc, "Revenue", money(k.revenue));
    kv(doc, "Profit", `${money(k.profit)}  (${k.profitMargin}% margin)`);
    kv(doc, "Orders", String(k.orders));
    kv(doc, "Customers", String(k.customers));
    kv(doc, "Growth", k.growth === null ? "n/a" : `${k.growth}%`);
    doc.moveDown(0.6);
  }

  if (Array.isArray(c.sections)) {
    for (const s of c.sections) list(doc, s.title, s.items, s.format);
  } else {
    list(doc, "Top Products", c.topProducts);
    list(doc, "Top Customers", c.topCustomers);
    list(doc, "Regional Performance", c.regions);
  }

  if (c.forecast) {
    section(doc, "Forecast (estimate)");
    for (const p of c.forecast.points) doc.fontSize(10).fillColor("#374151").text(`${p.period}: ${money(p.value)}  (range ${money(p.lower)}–${money(p.upper)})`);
    doc.moveDown(0.6);
  }

  if (Array.isArray(c.recommendations) && c.recommendations.length) {
    section(doc, "Risks & Recommendations");
    for (const r of c.recommendations as any[]) {
      doc.fontSize(11).fillColor("#111827").text(`• ${r.title}`);
      doc.fontSize(9).fillColor("#6b7280").text(`Observed: ${r.observation}`);
      doc.fontSize(9).fillColor("#6b7280").text(`Possible cause: ${r.explanation}`);
      doc.fontSize(9).fillColor("#2563eb").text(`Recommended: ${r.action}`);
      doc.moveDown(0.5);
    }
  }

    doc.end();
  });
}

function section(doc: PDFKit.PDFDocument, title: string) {
  doc.moveDown(0.4).fontSize(14).fillColor("#111827").text(title);
  doc.moveTo(doc.x, doc.y + 2).lineTo(545, doc.y + 2).strokeColor("#e5e7eb").stroke();
  doc.moveDown(0.5);
}
function kv(doc: PDFKit.PDFDocument, k: string, v: string) {
  doc.fontSize(10).fillColor("#6b7280").text(k + ":  ", { continued: true }).fillColor("#111827").text(v);
}
function list(doc: PDFKit.PDFDocument, title: string, items: { label: string; value: number }[], format: "money" | "number" = "money") {
  if (!items?.length) return;
  section(doc, title);
  const fmt = format === "number" ? (v: number) => Math.round(v).toLocaleString("en-US") : money;
  for (const it of items) doc.fontSize(10).fillColor("#374151").text(`${it.label}: ${fmt(it.value)}`);
  doc.moveDown(0.4);
}
const money = A.fmtMoney;
