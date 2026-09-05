import { prisma } from "../prisma.js";
import { profileDataset } from "./profile.js";
import { detectSchema, type SemanticRule } from "./schema.js";
import { cleanRows, validateSteps, type CleaningStep } from "./cleaning.js";
import { getPack, suggestIndustry } from "./industries.js";
import { refreshAlerts } from "../modules/alerts.js";
import { stripRows } from "../modules/context.js";
import type { Row } from "./parse.js";
import { canonicalDatasetHash } from "./identity.js";
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
  const { rows: cleaned, applied } = cleanRows(originalRows, steps);
  const firstRowColumns = Object.keys(cleaned[0] ?? {});
  const profile = profileDataset(cleaned, firstRowColumns.length ? firstRowColumns : columns);
  const { map, columns: annotated } = detectSchema(profile.columns, rules);
  return {
    // With no steps cleanRows returns the very same array, and a dataset nobody cleaned
    // keeps a NULL cleanedRows — which is what every such dataset already stores.
    cleanedRows: cleaned === originalRows ? null : cleaned,
    applied,
    profile,
    schemaMap: map,
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
  return { dataset: stripRows(dataset), suggestedIndustry, recipeApplied: recipe ? { id: recipe.id, name: recipe.name } : null };
}
