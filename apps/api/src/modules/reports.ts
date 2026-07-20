import { Router } from "express";
import { z } from "zod";
import PDFDocument from "pdfkit";
import { prisma } from "../prisma.js";
import { wrap, HttpError } from "../errors.js";
import { requireAuth, requireRole } from "../auth/middleware.js";
import { loadDataset } from "./context.js";
import * as A from "../engine/analytics.js";
import { forecast } from "../engine/forecast.js";
import { deriveInsights } from "../engine/insights.js";

export const reportsRouter = Router();
reportsRouter.use(requireAuth);

type ReportContent = Awaited<ReturnType<typeof buildReport>>;

// Build the full executive report structure from the deterministic engine.
async function buildReport(organizationId: string, datasetId?: string) {
  const { dataset, rows, schema } = await loadDataset(organizationId, datasetId);
  const ov = A.overview(rows, schema);
  const revSeries = A.timeSeries(rows, schema, "revenue");
  const fc = revSeries.length >= 2 ? forecast(revSeries.map((p) => ({ period: p.period, value: p.value })), 3) : null;
  const { recommendations } = deriveInsights(rows, schema);

  return {
    datasetId: dataset.id,
    datasetName: dataset.name,
    generatedAt: new Date().toISOString(),
    summary: buildSummary(ov),
    kpis: {
      revenue: ov.revenue.value, profit: ov.profit.value, orders: ov.orders.value,
      customers: ov.customers.value, growth: ov.growth, profitMargin: ov.profitMargin,
    },
    topProducts: A.groupBy(rows, schema, "product_name", "revenue", {}, 5),
    topCustomers: A.groupBy(rows, schema, "customer_name", "revenue", {}, 5),
    regions: A.groupBy(rows, schema, "region", "revenue", {}, 5),
    forecast: fc ? { metric: "revenue", points: fc.points } : null,
    recommendations,
  };
}

function buildSummary(ov: ReturnType<typeof A.overview>): string {
  const g = ov.growth;
  const dir = g === null ? "held steady" : g >= 0 ? `grew ${g}%` : `declined ${Math.abs(g)}%`;
  return `Revenue reached ${money(ov.revenue.value)} with ${money(ov.profit.value)} profit (${ov.profitMargin}% margin) across ${ov.orders.value.toLocaleString()} orders and ${ov.customers.value.toLocaleString()} customers. Revenue ${dir} versus the prior period.`;
}

const genSchema = z.object({ datasetId: z.string().optional(), title: z.string().optional() });

reportsRouter.post("/generate", requireRole("ADMIN", "MANAGER"), wrap(async (req, res) => {
  const { datasetId, title } = genSchema.parse(req.body ?? {});
  const content = await buildReport(req.auth!.organizationId, datasetId);
  const report = await prisma.report.create({
    data: {
      organizationId: req.auth!.organizationId,
      datasetId: content.datasetId,
      title: title || `Executive Report — ${content.datasetName}`,
      content: content as object,
    },
  });
  res.status(201).json({ report });
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

reportsRouter.get("/:id/pdf", wrap(async (req, res) => {
  const report = await prisma.report.findFirst({ where: { id: req.params.id, organizationId: req.auth!.organizationId } });
  if (!report) throw new HttpError(404, "Report not found");
  const c = report.content as unknown as ReportContent;

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${report.title.replace(/[^\w -]/g, "")}.pdf"`);

  const doc = new PDFDocument({ margin: 50, size: "A4" });
  doc.pipe(res);

  doc.fontSize(22).fillColor("#111827").text(report.title);
  doc.moveDown(0.3);
  doc.fontSize(9).fillColor("#6b7280").text(`Generated ${new Date(report.createdAt).toLocaleString()}  ·  DecisionIQ`);
  doc.moveDown(1);

  section(doc, "Executive Summary");
  doc.fontSize(11).fillColor("#374151").text(c.summary, { align: "left" });
  doc.moveDown(1);

  section(doc, "Key Metrics");
  const k = c.kpis;
  kv(doc, "Revenue", money(k.revenue));
  kv(doc, "Profit", `${money(k.profit)}  (${k.profitMargin}% margin)`);
  kv(doc, "Orders", String(k.orders));
  kv(doc, "Customers", String(k.customers));
  kv(doc, "Growth", k.growth === null ? "n/a" : `${k.growth}%`);
  doc.moveDown(0.6);

  list(doc, "Top Products", c.topProducts);
  list(doc, "Top Customers", c.topCustomers);
  list(doc, "Regional Performance", c.regions);

  if (c.forecast) {
    section(doc, "Forecast (estimate)");
    for (const p of c.forecast.points) doc.fontSize(10).fillColor("#374151").text(`${p.period}: ${money(p.value)}  (range ${money(p.lower)}–${money(p.upper)})`);
    doc.moveDown(0.6);
  }

  section(doc, "Risks & Recommendations");
  for (const r of c.recommendations) {
    doc.fontSize(11).fillColor("#111827").text(`• ${r.title}`);
    doc.fontSize(9).fillColor("#6b7280").text(`Observed: ${r.observation}`);
    doc.fontSize(9).fillColor("#6b7280").text(`Possible cause: ${r.explanation}`);
    doc.fontSize(9).fillColor("#2563eb").text(`Recommended: ${r.action}`);
    doc.moveDown(0.5);
  }

  doc.end();
}));

function section(doc: PDFKit.PDFDocument, title: string) {
  doc.moveDown(0.4).fontSize(14).fillColor("#111827").text(title);
  doc.moveTo(doc.x, doc.y + 2).lineTo(545, doc.y + 2).strokeColor("#e5e7eb").stroke();
  doc.moveDown(0.5);
}
function kv(doc: PDFKit.PDFDocument, k: string, v: string) {
  doc.fontSize(10).fillColor("#6b7280").text(k + ":  ", { continued: true }).fillColor("#111827").text(v);
}
function list(doc: PDFKit.PDFDocument, title: string, items: { label: string; value: number }[]) {
  if (!items?.length) return;
  section(doc, title);
  for (const it of items) doc.fontSize(10).fillColor("#374151").text(`${it.label}: ${money(it.value)}`);
  doc.moveDown(0.4);
}
const money = A.fmtMoney;
