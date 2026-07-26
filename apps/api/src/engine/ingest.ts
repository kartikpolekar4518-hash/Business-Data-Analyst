import { Prisma } from "@prisma/client";
import { prisma } from "../prisma.js";
import { profileDataset } from "./profile.js";
import { detectSchema } from "./schema.js";
import { getPack, suggestIndustry } from "./industries.js";
import { refreshAlerts } from "../modules/alerts.js";
import { stripRows } from "../modules/context.js";
import type { Row } from "./parse.js";

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
  connectionId?: string;
  // When set, refresh this existing dataset in place instead of creating a new
  // one (used by connector re-sync so the dataset keeps its id and downstream
  // reports/forecasts/alerts stay pointed at live data).
  existingDatasetId?: string;
  activityAction: string; // e.g. "dataset.uploaded"
  activityDetail: string;
}

// Shared ingestion pipeline: profile -> detect schema (industry-aware) -> store
// dataset -> log activity -> refresh alerts. Used by file upload, sample load and
// connector sync so every path produces an identical dataset.
export async function ingestRows(input: IngestInput) {
  const { organizationId, actorId } = input;
  const profile = profileDataset(input.rows, input.columns);
  const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { industry: true } });
  const { map, columns } = detectSchema(profile.columns, getPack(org?.industry).rules);
  const suggestedIndustry = suggestIndustry(profile.columns);

  const shared = {
    rowCount: profile.rowCount,
    columnCount: profile.columnCount,
    qualityScore: profile.qualityScore,
    columns: columns as object,
    schemaMap: map as object,
    profile: profile as object,
    rows: input.rows as object,
  };

  let dataset;
  let created: boolean;
  if (input.existingDatasetId) {
    // Refresh in place. The source changed, so drop any prior cleaning and
    // replace the issue list (mirrors the /clean route's in-place pattern).
    created = false;
    const [updated] = await prisma.$transaction([
      prisma.dataset.update({
        where: { id: input.existingDatasetId },
        data: { ...shared, status: "PROFILED", cleanedRows: Prisma.DbNull },
      }),
      prisma.dataQualityIssue.deleteMany({ where: { datasetId: input.existingDatasetId } }),
      prisma.dataQualityIssue.createMany({ data: profile.issues.map((i) => ({ ...i, datasetId: input.existingDatasetId! })) }),
    ]);
    dataset = updated;
  } else {
    created = true;
    dataset = await prisma.dataset.create({
      data: {
        organizationId,
        name: input.name,
        fileName: input.fileName,
        fileType: input.fileType,
        fileSize: input.fileSize,
        sourceType: input.sourceType,
        connectionId: input.connectionId,
        status: "PROFILED",
        ...shared,
        issues: { create: profile.issues.map((i) => ({ ...i })) },
      },
    });
  }

  await prisma.activityLog.create({ data: { organizationId, action: input.activityAction, detail: input.activityDetail, actorId } });
  await refreshAlerts(organizationId); // alerts derive on data change, not on read
  return { dataset: stripRows(dataset), suggestedIndustry, created };
}
