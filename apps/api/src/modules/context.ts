import { prisma } from "../prisma.js";
import { HttpError } from "../errors.js";
import type { Row } from "../engine/parse.js";
import { detectSchema, type SchemaMap } from "../engine/schema.js";
import type { Profile } from "../engine/profile.js";
import { getPack, type IndustryPack } from "../engine/industries.js";
import { compileKpiDef, compileMetric, validateMetricSpec, type MetricSpec } from "../engine/metricSpec.js";
import { normalizeCalendar, type PeriodScheme } from "../engine/calendar.js";

// Parsed-row cache. Deserializing the rows JSON is the dominant cost of every
// analytics request (the dashboard alone fires ~5 in parallel), so rows are
// cached keyed by dataset id + updatedAt — any upload/clean bumps updatedAt and
// naturally invalidates. Metadata is always fetched fresh (cheap, tenant-scoped).
// ponytail: in-process Map, capped FIFO; move to Redis if the API ever runs multi-instance.
const rowCache = new Map<string, Row[]>();
const ROW_CACHE_MAX = 8;

// Load a dataset scoped to the org (tenant isolation) and return its active rows
// (cleaned if cleaning was applied, else original) plus the detected schema map.
// The schema map is kept pack-correct at write time (upload + industry change),
// so every reader here can trust it without re-detecting.
export async function loadDataset(organizationId: string, datasetId?: string) {
  const meta = { select: { id: true, name: true, fileName: true, rowCount: true, updatedAt: true, schemaMap: true, rawFileHash: true, datasetHash: true, engineVersion: true, cleaningLog: true } };
  const dataset = datasetId
    ? await prisma.dataset.findFirst({ where: { id: datasetId, organizationId }, ...meta })
    : await prisma.dataset.findFirst({ where: { organizationId }, orderBy: { createdAt: "desc" }, ...meta });
  if (!dataset) throw new HttpError(404, "No dataset found. Upload data to get started.");

  const key = `${organizationId}:${dataset.id}:${dataset.updatedAt.getTime()}`;
  let rows = rowCache.get(key);
  if (!rows) {
    const blobs = await prisma.dataset.findUniqueOrThrow({ where: { id: dataset.id }, select: { rows: true, cleanedRows: true } });
    rows = (blobs.cleanedRows ?? blobs.rows) as Row[];
    if (rowCache.size >= ROW_CACHE_MAX) rowCache.delete(rowCache.keys().next().value!);
    rowCache.set(key, rows);
  }
  return { dataset, rows, schema: dataset.schemaMap as SchemaMap };
}

// The org-level configuration every analytical route needs: which industry pack shapes
// the dashboard, and which business calendar buckets its periods. Fetched together in
// one query because every caller wants both, and normalized here so a bad stored value
// degrades to the default instead of throwing on an analytics read.
export async function loadOrgConfig(organizationId: string) {
  const [org, custom] = await Promise.all([
    prisma.organization.findUnique({
      where: { id: organizationId },
      select: { industry: true, fiscalYearStartMonth: true, periodScheme: true, weekStartDay: true },
    }),
    prisma.customMetric.findMany({ where: { organizationId }, orderBy: { createdAt: "asc" } }),
  ]);

  // Custom metrics are compiled and merged into a COPY of the pack. PACKS is a shared
  // module-level constant, so mutating it here would leak one organization's metrics
  // into every other organization served by the same process.
  const base = getPack(org?.industry);
  const specs = custom
    .map((m) => m.spec as unknown as MetricSpec)
    .filter((spec) => validateMetricSpec(spec).length === 0);
  const pack: IndustryPack = specs.length
    ? { ...base, metrics: [...base.metrics, ...specs.map(compileMetric)], kpis: [...base.kpis, ...specs.map(compileKpiDef)] }
    : base;

  return {
    pack,
    calendar: normalizeCalendar({
      fiscalYearStartMonth: org?.fiscalYearStartMonth,
      scheme: org?.periodScheme as PeriodScheme | undefined,
      weekStartDay: org?.weekStartDay,
    }),
  };
}

// Strip the heavy JSON row blobs from a dataset record before returning it in a response.
export function stripRows<T extends { rows?: unknown; cleanedRows?: unknown }>(d: T) {
  const { rows, cleanedRows, ...rest } = d;
  return rest;
}

// Re-detect and persist every dataset's schema under a new industry pack. Called
// when an org changes its business type so ALL readers (dashboard, reports, AI
// chat, forecasts, alerts) see the same pack-aware columns — not just the
// dashboard. Re-detection is cheap (regex over column names); the write bumps
// updatedAt, which naturally invalidates the row cache.
export async function reapplyIndustrySchema(organizationId: string, industryKey: string) {
  const pack = getPack(industryKey);
  const datasets = await prisma.dataset.findMany({ where: { organizationId }, select: { id: true, profile: true } });
  for (const d of datasets) {
    const cols = (d.profile as Profile | null)?.columns;
    if (!cols?.length) continue;
    const { map, columns } = detectSchema(cols, pack.rules);
    await prisma.dataset.update({ where: { id: d.id }, data: { schemaMap: map as object, columns: columns as object } });
  }
}
