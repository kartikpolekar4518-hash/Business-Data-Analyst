import { prisma } from "../prisma.js";
import { HttpError } from "../errors.js";
import type { Row } from "../engine/parse.js";
import type { SchemaMap } from "../engine/schema.js";

// Parsed-row cache. Deserializing the rows JSON is the dominant cost of every
// analytics request (the dashboard alone fires ~5 in parallel), so rows are
// cached keyed by dataset id + updatedAt — any upload/clean bumps updatedAt and
// naturally invalidates. Metadata is always fetched fresh (cheap, tenant-scoped).
// ponytail: in-process Map, capped FIFO; move to Redis if the API ever runs multi-instance.
const rowCache = new Map<string, Row[]>();
const ROW_CACHE_MAX = 8;

// Load a dataset scoped to the org (tenant isolation) and return its active rows
// (cleaned if cleaning was applied, else original) plus the detected schema map.
export async function loadDataset(organizationId: string, datasetId?: string) {
  const meta = { select: { id: true, name: true, rowCount: true, updatedAt: true, schemaMap: true } };
  const dataset = datasetId
    ? await prisma.dataset.findFirst({ where: { id: datasetId, organizationId }, ...meta })
    : await prisma.dataset.findFirst({ where: { organizationId }, orderBy: { createdAt: "desc" }, ...meta });
  if (!dataset) throw new HttpError(404, "No dataset found. Upload data to get started.");

  const key = `${dataset.id}:${dataset.updatedAt.getTime()}`;
  let rows = rowCache.get(key);
  if (!rows) {
    const blobs = await prisma.dataset.findUniqueOrThrow({ where: { id: dataset.id }, select: { rows: true, cleanedRows: true } });
    rows = (blobs.cleanedRows ?? blobs.rows) as Row[];
    if (rowCache.size >= ROW_CACHE_MAX) rowCache.delete(rowCache.keys().next().value!);
    rowCache.set(key, rows);
  }
  return { dataset, rows, schema: dataset.schemaMap as SchemaMap };
}

// Strip the heavy JSON row blobs from a dataset record before returning it in a response.
export function stripRows<T extends { rows?: unknown; cleanedRows?: unknown }>(d: T) {
  const { rows, cleanedRows, ...rest } = d;
  return rest;
}
