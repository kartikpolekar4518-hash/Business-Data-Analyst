import { prisma } from "../prisma.js";
import { profileDataset } from "./profile.js";
import { detectSchema, type SemanticRule } from "./schema.js";
import { cleanRows, validateSteps, type CleaningStep } from "./cleaning.js";
import { normalizeRows } from "./locale.js";
import { getPack, suggestIndustry } from "./industries.js";
import { refreshAlerts } from "../modules/alerts.js";
import { scoreForecasts } from "../modules/forecastAccuracy.js";
import { stripRows } from "../modules/context.js";
import type { Row } from "./parse.js";
import { canonicalDatasetHash } from "./identity.js";
import { deriveShape } from "./shape.js";
import { deriveModel } from "./derived.js";
import { ENGINE_VERSION } from "./version.js";

interface IngestInput {
  organizationId: string;
  actorId: string;
  name: string;
  fileName: string;
  fileType: string;
  fileSize: number;
  rows: Row[];
  columns: string[];
  sourceType: "upload" | "sample" | "connector";
  rawFileHash?: string;
  connectionId?: string;
  activityAction: string; // e.g. "dataset.uploaded"
  activityDetail: string;
}

// Everything a dataset write derives from its rows, recomputed together. A recipe
// changes which rows are analysed, so the profile, the detected schema, the quality
// score and the analytical hash all move with it — and they must move together, or a
// stored number stops matching the rows it claims to describe. Shared by ingest,
// cleaning and combine-files so those three cannot drift apart.
//
// `rules` is passed rather than looked up: ingest detects with the org's industry pack,
// while re-cleaning an existing dataset detects without it. That asymmetry predates
// recipes; it is preserved here rather than quietly fixed, because changing it would
// move numbers on datasets nobody touched.
export function reshapeDataset(originalRows: Row[], columns: string[], steps: CleaningStep[], rules: SemanticRule[] = []) {
  const { rows: stepped, applied } = cleanRows(originalRows, steps);
  const firstRowColumns = Object.keys(stepped[0] ?? {});
  const analysedColumns = firstRowColumns.length ? firstRowColumns : columns;
  // How this file writes its numbers and dates is decided here, once, from the values —
  // before anything downstream reads one. Running after the recipe means the steps still
  // see the file as the user wrote it, and running before profiling means every number
  // below is computed from the corrected values rather than from a silent misreading of
  // "1.234" or "01/02/2026". A file that was already being read correctly comes back as
  // the identical array, so its stored datasetHash does not move.
  const { rows: cleaned, notes: formats } = normalizeRows(stepped, analysedColumns);
  // Carried on the profile so every path that persists a profile — upload, re-clean,
  // combine — stores the decisions too, without each one having to remember to.
  const profile = { ...profileDataset(cleaned, analysedColumns), formats };
  const { map, columns: annotated } = detectSchema(profile.columns, rules);
  // The data decides. `detectSchema` still runs — its annotations label columns in the
  // Detected Schema tab — but the schema map the analytics layer reads is derived from
  // the file's actual structure, so a dataset whose headers match no known vocabulary
  // gets a real dashboard rather than a wall of empty states.
  const shape = deriveShape(profile, cleaned);
  const derived = deriveModel(shape, cleaned);
  return {
    // With no steps cleanRows returns the very same array, and a dataset nobody cleaned
    // keeps a NULL cleanedRows — which is what every such dataset already stores.
    cleanedRows: cleaned === originalRows ? null : cleaned,
    applied,
    profile,
    shape,
    // Semantic detection stays available for anything that wants the name-matched view,
    // but never overrides a slot the data itself filled.
    detectedSchemaMap: map,
    schemaMap: { ...map, ...derived.schema },
    derived,
    columns: annotated,
    datasetHash: canonicalDatasetHash(cleaned),
  };
}

// The organization's auto-apply recipe, if it has one. Steps are re-validated on read:
// a recipe stored by an older shape degrades to "no cleaning" rather than throwing on
// every upload, which is the same posture loadOrgConfig takes with custom metrics.
export async function autoApplyRecipe(organizationId: string) {
  const recipe = await prisma.cleaningRecipe.findFirst({ where: { organizationId, autoApply: true } });
  if (!recipe) return null;
  const steps = recipe.steps as unknown as CleaningStep[];
  if (!Array.isArray(steps) || validateSteps(steps).length) return null;
  return { id: recipe.id, name: recipe.name, steps };
}

// Shared ingestion pipeline: profile -> detect schema (industry-aware) -> store
// dataset -> log activity -> refresh alerts. Used by file upload, sample load and
// connector sync so every path produces an identical dataset.
//
// The org's auto-apply recipe (if any) runs here, before profiling, so all three paths
// get replayed cleaning at once — including connector sync, which has no user present
// to accept suggestions. With no such recipe every value written below is byte for byte
// what this function wrote before recipes existed.
export async function ingestRows(input: IngestInput) {
  const { organizationId, actorId } = input;
  const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { industry: true } });
  const recipe = await autoApplyRecipe(organizationId);
  const shaped = reshapeDataset(input.rows, input.columns, recipe?.steps ?? [], getPack(org?.industry).rules);
  const suggestedIndustry = suggestIndustry(shaped.profile.columns);

  const dataset = await prisma.dataset.create({
    data: {
      organizationId,
      name: input.name,
      fileName: input.fileName,
      fileType: input.fileType,
      fileSize: input.fileSize,
      sourceType: input.sourceType,
      connectionId: input.connectionId,
      status: recipe ? "CLEANED" : "PROFILED",
      rowCount: shaped.profile.rowCount,
      columnCount: shaped.profile.columnCount,
      qualityScore: shaped.profile.qualityScore,
      columns: shaped.columns as object,
      schemaMap: shaped.schemaMap as object,
      profile: shaped.profile as object,
      shape: shaped.shape as unknown as object,
      rows: input.rows as object,
      cleanedRows: shaped.cleanedRows ? (shaped.cleanedRows as object) : undefined,
      recipeId: recipe?.id ?? null,
      cleaningLog: recipe ? (shaped.applied as object) : undefined,
      rawFileHash: input.rawFileHash ?? null,
      datasetHash: shaped.datasetHash,
      engineVersion: ENGINE_VERSION,
      issues: { create: shaped.profile.issues.map((i) => ({ ...i })) },
    },
    include: { issues: true },
  });

  await prisma.activityLog.create({ data: { organizationId, action: input.activityAction, detail: input.activityDetail, actorId, entityType: "dataset", entityId: dataset.id } });
  await refreshAlerts(organizationId); // alerts derive on data change, not on read
  await scoreForecasts(organizationId); // accuracy scores derive on data change, not on read
  return { dataset: stripRows(dataset), suggestedIndustry, recipeApplied: recipe ? { id: recipe.id, name: recipe.name } : null };
}
