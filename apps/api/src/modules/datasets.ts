import { Router } from "express";
import { z } from "zod";
import { prisma } from "../prisma.js";
import { wrap, HttpError } from "../errors.js";
import { requireAuth, requireRole } from "../auth/middleware.js";
import type { ColumnProfile } from "../engine/profile.js";
import { buildSteps, validateSteps, type CleaningStep } from "../engine/cleaning.js";
import { reshapeDataset } from "../engine/ingest.js";
import { stripRows } from "./context.js";
import { refreshAlerts } from "./alerts.js";
import { scoreForecasts } from "./forecastAccuracy.js";
import type { Row } from "../engine/parse.js";
import { ENGINE_VERSION } from "../engine/version.js";

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
  const columns = ((d.columns as any[]) || []).map((c: any) => c.name);
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

// Cleaning is now a recipe: either build one from the accepted suggestions (what the
// Quality Report's checkboxes produce) or replay one that was saved earlier.
const cleanSchema = z.object({
  acceptedTypes: z.array(z.string().max(60)).max(50).optional(),
  recipeId: z.string().uuid().optional(),
}).refine((b) => !!b.acceptedTypes !== !!b.recipeId, {
  message: "Pass either acceptedTypes or recipeId, not both",
});

// Apply cleaning steps -> new cleanedRows, re-profile, re-detect schema.
// Original rows are never modified.
datasetsRouter.post("/:id/clean", requireRole("ADMIN", "MANAGER"), wrap(async (req, res) => {
  const { acceptedTypes, recipeId } = cleanSchema.parse(req.body);
  const orgId = req.auth!.organizationId;
  const datasetId = req.params.id;

  // Fetch dataset + issues in a single transaction to prevent race conditions
  const [d, issues] = await prisma.$transaction([
    prisma.dataset.findFirst({ where: { id: datasetId, organizationId: orgId } }),
    prisma.dataQualityIssue.findMany({ where: { datasetId } }),
  ]);

  if (!d) throw new HttpError(404, "Dataset not found");

  const originalRows = d.rows as Row[];
  const columnsList = ((d.columns as unknown as ColumnProfile[]) || []);
  const columns = columnsList.map((c) => c.name);

  // A saved recipe is used verbatim. An accepted-types list is compiled into one first,
  // against THIS dataset's issues and column types — that compilation is the whole point
  // of the feature: after it, the instruction no longer refers back to the issue table.
  let recipe: { id: string; steps: CleaningStep[] } | null = null;
  if (recipeId) {
    const found = await prisma.cleaningRecipe.findFirst({ where: { id: recipeId, organizationId: orgId } });
    if (!found) throw new HttpError(404, "Recipe not found");
    const stored = found.steps as unknown as CleaningStep[];
    const errors = Array.isArray(stored) ? validateSteps(stored) : ["The saved recipe is not a list of steps."];
    if (errors.length) throw new HttpError(400, errors.join(" "));
    recipe = { id: found.id, steps: stored };
  }
  const steps = recipe?.steps ?? buildSteps(acceptedTypes ?? [], issues, columnsList);

  // Detection here deliberately runs without the industry pack's extra rules, as it
  // always has on this route — see reshapeDataset.
  const shaped = reshapeDataset(originalRows, columns, steps);
  const cleaned = shaped.cleanedRows ?? originalRows;

  // Cleaning provenance: what the steps actually changed in these rows, counted as they
  // ran rather than copied out of the pre-clean issue table (a recipe replayed against
  // a different upload has to report that upload's numbers). Count level only — no
  // cell-level before/after diffs — so the question "why did my uploaded data change
  // before analytics ran?" stays answerable.
  const cleaningLog = shaped.applied;

  // Replace the persisted issue list with the ones found on the cleaned data —
  // otherwise the Quality Report keeps showing already-fixed issues (e.g. the
  // duplicate that was just removed) forever, since nothing else clears them.
  const [updated] = await prisma.$transaction([
    prisma.dataset.update({
      where: { id: d.id },
      data: {
        status: "CLEANED",
        cleanedRows: cleaned as object,
        qualityScore: shaped.profile.qualityScore,
        rowCount: cleaned.length,
        columnCount: shaped.profile.columnCount,
        columns: shaped.columns as object,
        schemaMap: shaped.schemaMap as object,
        profile: shaped.profile as object,
        // The analytical rows changed, so the analytical identity changes with them.
        // rawFileHash is untouched: the uploaded file is still the same file.
        datasetHash: shaped.datasetHash,
        engineVersion: ENGINE_VERSION,
        cleaningLog: cleaningLog as object,
        // Remembering the recipe is what lets appended rows be cleaned the same way.
        // Cleaning from checkboxes clears it: those steps were not saved anywhere, so
        // claiming the dataset can replay itself would be a lie.
        recipeId: recipe?.id ?? null,
      },
    }),
    prisma.dataQualityIssue.deleteMany({ where: { datasetId: d.id } }),
    prisma.dataQualityIssue.createMany({ data: shaped.profile.issues.map((i) => ({ ...i, datasetId: d.id })) }),
  ]);
  await prisma.activityLog.create({ data: { organizationId: req.auth!.organizationId, action: "dataset.cleaned", detail: d.name, actorId: req.auth!.userId, entityType: "dataset", entityId: d.id } });
  await refreshAlerts(req.auth!.organizationId); // alerts derive on data change, not on read
  await scoreForecasts(req.auth!.organizationId); // accuracy scores derive on data change, not on read
  // `steps` goes back so the client can offer to save exactly what just ran as a recipe.
  res.json({ dataset: stripRows(updated), steps, appliedFixes: cleaningLog, newQualityScore: shaped.profile.qualityScore });
}));
