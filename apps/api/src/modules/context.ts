import { prisma } from "../prisma.js";
import { HttpError } from "../errors.js";
import type { Row } from "../engine/parse.js";
import type { SchemaMap } from "../engine/schema.js";

// Load a dataset scoped to the org (tenant isolation) and return its active rows
// (cleaned if cleaning was applied, else original) plus the detected schema map.
export async function loadDataset(organizationId: string, datasetId?: string) {
  const dataset = datasetId
    ? await prisma.dataset.findFirst({ where: { id: datasetId, organizationId } })
    : await prisma.dataset.findFirst({ where: { organizationId }, orderBy: { createdAt: "desc" } });
  if (!dataset) throw new HttpError(404, "No dataset found. Upload data to get started.");
  const rows = (dataset.cleanedRows ?? dataset.rows) as Row[];
  const schema = dataset.schemaMap as SchemaMap;
  return { dataset, rows, schema };
}
