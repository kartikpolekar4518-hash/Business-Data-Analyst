import { prisma } from "../prisma.js";
import { HttpError } from "../errors.js";
import type { Row } from "../engine/parse.js";
import { detectSchema, type SchemaMap } from "../engine/schema.js";
import type { Profile } from "../engine/profile.js";
import { getPack, type IndustryPack } from "../engine/industries.js";
import { compileKpiDef, compileMetric, validateMetricSpec, type MetricSpec } from "../engine/metricSpec.js";
import { normalizeCalendar, type PeriodScheme } from "../engine/calendar.js";
import { joinRows, mergeSchemas, type JoinReport } from "../engine/join.js";
import { canonicalDatasetHash } from "../engine/identity.js";
import { profileDataset } from "../engine/profile.js";
import { deriveShape, type DataShape } from "../engine/shape.js";
import { deriveModel, type DerivedModel } from "../engine/derived.js";

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

// ─── Multi-file joins ────────────────────────────────────────────────────────
// The analytical read context. Every analytics route consumes `{ rows, schema }`, so a
// joined dataset is a drop-in for a single one and no route has any join-specific code.
//
// This is a READ context: nothing here writes back. The stored rows, cleaned rows,
// schema map, profile and hash of every participating dataset are untouched, so each
// uploaded file stays independently auditable and deleting a relationship restores
// exactly the numbers the organization had before it.

/** One relationship as it was applied, for the evidence panel. */
export interface AppliedJoin {
  id: string;
  rightDatasetId: string;
  rightDatasetName: string;
  leftColumn: string;
  rightColumn: string;
  report: JoinReport;
}

// Joined rows are cached like single-dataset rows, but the key must cover more: every
// participating dataset's id + updatedAt AND the relation configuration itself. Editing
// a relationship changes which rows are analysed without touching any dataset, so a key
// built only from datasets would keep serving the old join.
const joinCache = new Map<string, { rows: Row[]; schema: SchemaMap; columns: string[]; datasetHash: string; applied: AppliedJoin[] }>();
const JOIN_CACHE_MAX = 8;

/**
 * Load a dataset together with every relationship defined on it, left-joined in a fixed
 * order (createdAt, then id — a total order, so the accumulated columns, names and
 * schema are reproducible run to run).
 *
 * With no relationships this returns exactly what `loadDataset` returned, down to the
 * same `rows` array reference: an organization that has not connected any files must see
 * the numbers it always saw.
 *
 * `excludeRelationId` builds the context as it would be WITHOUT one relationship. That is
 * what validating an edit needs — "what do these rows look like before this connection?"
 * — and it is why validation and analytics can never disagree about what a join does.
 */
export async function loadJoinedDataset(organizationId: string, datasetId?: string, excludeRelationId?: string) {
  const base = await loadDataset(organizationId, datasetId);
  const relations = await prisma.datasetRelation.findMany({
    where: { organizationId, leftDatasetId: base.dataset.id, ...(excludeRelationId ? { id: { not: excludeRelationId } } : {}) },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  if (!relations.length) return { ...base, join: null as AppliedJoin[] | null, columns: Object.keys(base.rows[0] ?? {}) };

  const rights = await prisma.dataset.findMany({
    where: { id: { in: relations.map((r) => r.rightDatasetId) }, organizationId },
    select: { id: true, name: true, updatedAt: true, schemaMap: true, rows: true, cleanedRows: true },
  });
  const byId = new Map(rights.map((d) => [d.id, d]));

  const key = [
    organizationId, base.dataset.id, base.dataset.updatedAt.getTime(),
    excludeRelationId ?? "",
    ...relations.map((r) => `${r.id}:${r.updatedAt.getTime()}`),
    ...rights.map((d) => `${d.id}:${d.updatedAt.getTime()}`),
  ].join("|");

  // The reports are cached with the rows they describe. Each hop's report measures the
  // ACCUMULATED left side, not the base dataset, so it cannot be reconstructed from the
  // inputs alone once a chain is more than one relationship long.
  let cached = joinCache.get(key);
  if (!cached) {
    const applied: AppliedJoin[] = [];
    let rows = base.rows;
    let schema = base.schema;
    let columns = Object.keys(base.rows[0] ?? {});

    for (const rel of relations) {
      const right = byId.get(rel.rightDatasetId);
      // A relationship whose other side is gone is skipped rather than thrown: an
      // analytics read must not 500 because a dataset was deleted in another tab. The FK
      // cascades, so this is only the narrow window between the two.
      if (!right) continue;
      const rightRows = ((right.cleanedRows ?? right.rows) ?? []) as Row[];
      const result = joinRows(rows, rightRows, { leftColumn: rel.leftColumn, rightColumn: rel.rightColumn, rightName: right.name }, columns);
      rows = result.rows;
      columns = result.columns;
      // A refused join contributes no columns, so it merges no semantics either.
      schema = mergeSchemas(schema, right.schemaMap as SchemaMap, result.report.columnRenames);
      applied.push({
        id: rel.id, rightDatasetId: right.id, rightDatasetName: right.name,
        leftColumn: rel.leftColumn, rightColumn: rel.rightColumn, report: result.report,
      });
    }

    // Nothing actually joined (every right side vanished, or every join was refused):
    // the base rows are returned untouched, as they must be.
    if (rows === base.rows) return { ...base, join: applied.length ? applied : null, columns };

    cached = { rows, schema, columns, datasetHash: canonicalDatasetHash(rows), applied };
    if (joinCache.size >= JOIN_CACHE_MAX) joinCache.delete(joinCache.keys().next().value!);
    joinCache.set(key, cached);
  }

  const { rows, schema, columns, datasetHash, applied } = cached;
  return {
    // The evidence panel must describe what was ANALYSED, not one of the inputs, so the
    // row count and analytical hash are those of the joined rows. Neither is persisted.
    dataset: { ...base.dataset, rowCount: rows.length, datasetHash },
    rows,
    schema,
    // The accumulated header. A later connection can match on a column an earlier one
    // added, so this — not the stored dataset's header — is what a new one is validated
    // against.
    columns,
    join: applied,
  };
}

// The org-level configuration every analytical route needs: which industry pack shapes
// the dashboard, and which business calendar buckets its periods. Fetched together in
// one query because every caller wants both, and normalized here so a bad stored value
// degrades to the default instead of throwing on an analytics read.
/**
 * The analytical model for one dataset: the dashboard configuration derived from the
 * file's own structure, with the organization's custom metrics merged on top.
 *
 * The industry packs no longer shape a dashboard — the data does. `getPack` survives
 * only as the carrier of the organization's calendar-independent defaults for the rare
 * dataset whose shape is unusable, so a screen always has a pack to render against.
 *
 * A dataset ingested before shapes existed has no stored shape, so one is derived here
 * from its stored profile. That keeps every historic upload working with no backfill.
 */
export async function loadAnalysisConfig(organizationId: string, datasetId: string, rows: Row[]) {
  const [record, custom, org] = await Promise.all([
    prisma.dataset.findFirst({ where: { id: datasetId, organizationId }, select: { shape: true, profile: true, name: true } }),
    prisma.customMetric.findMany({ where: { organizationId }, orderBy: { createdAt: "asc" } }),
    prisma.organization.findUnique({
      where: { id: organizationId },
      select: { industry: true, fiscalYearStartMonth: true, periodScheme: true, weekStartDay: true },
    }),
  ]);

  let shape = (record?.shape as unknown as DataShape | null) ?? null;
  if (!shape) {
    const stored = record?.profile as unknown as Profile | null;
    const profile = stored?.columns?.length ? stored : profileDataset(rows, Object.keys(rows[0] ?? {}));
    shape = deriveShape(profile, rows);
  }
  const derived: DerivedModel = deriveModel(shape, rows);

  // Custom metrics merge into a COPY of the derived pack, never the shared PACKS
  // constant — one organization's metrics must not leak into another's process-shared
  // pack. Same rule loadOrgConfig has always applied.
  const specs = custom
    .map((m) => m.spec as unknown as MetricSpec)
    .filter((spec) => validateMetricSpec(spec).length === 0);
  const pack: IndustryPack = specs.length
    ? { ...derived.pack, metrics: [...derived.pack.metrics, ...specs.map(compileMetric)], kpis: [...derived.pack.kpis, ...specs.map(compileKpiDef)] }
    : derived.pack;

  return {
    pack,
    shape,
    derived,
    calendar: normalizeCalendar({
      fiscalYearStartMonth: org?.fiscalYearStartMonth,
      scheme: org?.periodScheme as PeriodScheme | undefined,
      weekStartDay: org?.weekStartDay,
    }),
  };
}

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
