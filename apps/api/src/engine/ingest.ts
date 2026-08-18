import { prisma } from "../prisma.js";
import { env } from "../env.js";
import { HttpError } from "../errors.js";
import { profileDataset } from "./profile.js";
import { detectSchema } from "./schema.js";
import { getPack, suggestIndustry } from "./industries.js";
import { refreshAlerts } from "../modules/alerts.js";
import { stripRows } from "../modules/context.js";
import type { Row } from "./parse.js";

// Reject oversized external data *before* profiling/serializing it, so a small
// file that decompresses into an enormous workbook can't spike CPU/RAM or bloat
// the JSONB write. Sample data is generated internally and trusted, so skip it.
function assertWithinLimits(rows: Row[], columns: string[], sourceType: string) {
  if (sourceType === "sample") return;
  if (rows.length > env.maxUploadRows) {
    throw new HttpError(413, `Dataset has ${rows.length} rows; the limit is ${env.maxUploadRows}. Split the file or raise MAX_UPLOAD_ROWS.`);
  }
  if (columns.length > env.maxUploadColumns) {
    throw new HttpError(413, `Dataset has ${columns.length} columns; the limit is ${env.maxUploadColumns}.`);
  }
  for (const row of rows) {
    for (const col of columns) {
      const v = row[col];
      if (typeof v === "string" && v.length > env.maxCellLength) {
        throw new HttpError(413, `A cell exceeds the ${env.maxCellLength}-character limit.`);
      }
    }
  }
}

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
  activityAction: string; // e.g. "dataset.uploaded"
  activityDetail: string;
}

// Shared ingestion pipeline: profile -> detect schema (industry-aware) -> store
// dataset -> log activity -> refresh alerts. Used by file upload, sample load and
// connector sync so every path produces an identical dataset.
export async function ingestRows(input: IngestInput) {
  const { organizationId, actorId } = input;
  assertWithinLimits(input.rows, input.columns, input.sourceType);
  const profile = profileDataset(input.rows, input.columns);
  const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { industry: true } });
  const { map, columns } = detectSchema(profile.columns, getPack(org?.industry).rules);
  const suggestedIndustry = suggestIndustry(profile.columns);

  const dataset = await prisma.dataset.create({
    data: {
      organizationId,
      name: input.name,
      fileName: input.fileName,
      fileType: input.fileType,
      fileSize: input.fileSize,
      sourceType: input.sourceType,
      connectionId: input.connectionId,
      status: "PROFILED",
      rowCount: profile.rowCount,
      columnCount: profile.columnCount,
      qualityScore: profile.qualityScore,
      columns: columns as object,
      schemaMap: map as object,
      profile: profile as object,
      rows: input.rows as object,
      issues: { create: profile.issues.map((i) => ({ ...i })) },
    },
    include: { issues: true },
  });

  await prisma.activityLog.create({ data: { organizationId, action: input.activityAction, detail: input.activityDetail, actorId } });
  await refreshAlerts(organizationId); // alerts derive on data change, not on read
  return { dataset: stripRows(dataset), suggestedIndustry };
}
