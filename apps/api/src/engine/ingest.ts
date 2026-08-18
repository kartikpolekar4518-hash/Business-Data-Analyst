import { prisma } from "../prisma.js";
import { profileDataset } from "./profile.js";
import { detectSchema, mergeAiSemantics } from "./schema.js";
import { getPack, suggestIndustry } from "./industries.js";
import { llmAnalyzeSchema } from "../ai/provider.js";
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
  const regexDetected = detectSchema(profile.columns, getPack(org?.industry).rules);

  // AI-assisted detection when configured: gap-fill column meanings regex missed and let
  // the model classify the industry. Null (no key / failure) => pure regex, exactly as before.
  const ai = await llmAnalyzeSchema(profile.columns);
  const { map, columns } = ai ? mergeAiSemantics(regexDetected, ai.mappings) : regexDetected;
  // The AI's industry is used only when it commits to a specific one; "generic" is its
  // no-opinion answer and must not override a pack the column signals clearly support.
  const regexIndustry = suggestIndustry(columns);
  const suggestedIndustry = ai && ai.industry !== "generic" ? ai.industry : regexIndustry;

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
