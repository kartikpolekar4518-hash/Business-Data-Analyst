import { Router } from "express";
import { z } from "zod";
import { prisma } from "../prisma.js";
import { wrap, HttpError } from "../errors.js";
import { requireAuth, requireRole } from "../auth/middleware.js";
import { profileDataset } from "../engine/profile.js";
import { cleanRows, detectSchema } from "../engine/schema.js";
import { stripRows } from "./context.js";
import { refreshAlerts } from "./alerts.js";
import type { Row } from "../engine/parse.js";

export const datasetsRouter = Router();
datasetsRouter.use(requireAuth);

async function getOwned(orgId: string, id: string) {
  const d = await prisma.dataset.findFirst({ where: { id, organizationId: orgId } });
  if (!d) throw new HttpError(404, "Dataset not found");
  return d;
}

// (Listing lives on GET /uploads — one endpoint per operation.)

datasetsRouter.get("/:id", wrap(async (req, res) => {
  const d = await getOwned(req.auth!.organizationId, req.params.id);
  res.json({ dataset: stripRows(d) });
}));

datasetsRouter.get("/:id/preview", wrap(async (req, res) => {
  const d = await getOwned(req.auth!.organizationId, req.params.id);
  const rows = (d.cleanedRows ?? d.rows) as Row[];
  const columns = (d.columns as { name: string }[]).map((c) => c.name);
  res.json({ columns, rows: rows.slice(0, 50), total: rows.length, cleaned: !!d.cleanedRows });
}));

datasetsRouter.get("/:id/quality", wrap(async (req, res) => {
  const d = await getOwned(req.auth!.organizationId, req.params.id);
  const issues = await prisma.dataQualityIssue.findMany({ where: { datasetId: d.id }, orderBy: { severity: "desc" } });
  res.json({ qualityScore: d.qualityScore, rowCount: d.rowCount, columnCount: d.columnCount, profile: d.profile, issues });
}));

datasetsRouter.get("/:id/schema", wrap(async (req, res) => {
  const d = await getOwned(req.auth!.organizationId, req.params.id);
  res.json({ schemaMap: d.schemaMap, columns: d.columns });
}));

const cleanSchema = z.object({ acceptedTypes: z.array(z.string()) });

// Apply accepted cleaning suggestions -> new cleanedRows, re-profile, re-detect schema.
// Original rows are never modified.
datasetsRouter.post("/:id/clean", requireRole("ADMIN", "MANAGER"), wrap(async (req, res) => {
  const d = await getOwned(req.auth!.organizationId, req.params.id);
  const { acceptedTypes } = cleanSchema.parse(req.body);
  const originalRows = d.rows as Row[];
  const columns = (d.columns as { name: string }[]).map((c) => c.name);
  const issues = await prisma.dataQualityIssue.findMany({ where: { datasetId: d.id } });

  const numericColumns = new Set((d.columns as { name: string; type: string }[])
    .filter((c) => c.type === "number" || c.type === "currency").map((c) => c.name));
  const cleaned = cleanRows(originalRows, columns, acceptedTypes, issues as any, numericColumns);
  const newColumns = Object.keys(cleaned[0] ?? {});
  const profile = profileDataset(cleaned, newColumns.length ? newColumns : columns);
  const { map, columns: annotated } = detectSchema(profile.columns);

  // Replace the persisted issue list with the ones found on the cleaned data —
  // otherwise the Quality Report keeps showing already-fixed issues (e.g. the
  // duplicate that was just removed) forever, since nothing else clears them.
  const [updated] = await prisma.$transaction([
    prisma.dataset.update({
      where: { id: d.id },
      data: {
        status: "CLEANED",
        cleanedRows: cleaned as object,
        qualityScore: profile.qualityScore,
        rowCount: cleaned.length,
        columnCount: profile.columnCount,
        columns: annotated as object,
        schemaMap: map as object,
        profile: profile as object,
      },
    }),
    prisma.dataQualityIssue.deleteMany({ where: { datasetId: d.id } }),
    prisma.dataQualityIssue.createMany({ data: profile.issues.map((i) => ({ ...i, datasetId: d.id })) }),
  ]);
  await prisma.activityLog.create({ data: { organizationId: req.auth!.organizationId, action: "dataset.cleaned", detail: d.name, actorId: req.auth!.userId } });
  await refreshAlerts(req.auth!.organizationId); // alerts derive on data change, not on read
  res.json({ dataset: stripRows(updated), appliedFixes: acceptedTypes, newQualityScore: profile.qualityScore });
}));
