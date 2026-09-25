import { Router } from "express";
import { z } from "zod";
import { wrap, HttpError } from "../errors.js";
import { prisma } from "../prisma.js";
import { requireAuth, requireRole } from "../auth/middleware.js";
import { loadJoinedDataset, loadOrgConfig, loadAnalysisConfig } from "./context.js";
import * as A from "../engine/analytics.js";
import type { ColumnProfile } from "../engine/profile.js";
import { suggestIndustry, type RankSectionDef } from "../engine/industries.js";
import { analyzeDrivers, type DriverMetric } from "../engine/drivers.js";
import { detectAnomalies } from "../engine/anomaly.js";
import { analyzeCorrelations } from "../engine/correlate.js";
import { availableHierarchies, dateDrillPath, trendGrain } from "../engine/hierarchy.js";
import { segmentEntities, type SegmentEntity } from "../engine/segment.js";
import { explainKpi } from "../engine/explain.js";
import { periodRange } from "../engine/calendar.js";
import { detectSchema } from "../engine/schema.js";
import type { Semantic } from "../engine/schema.js";

export const analyticsRouter = Router();
analyticsRouter.use(requireAuth);

// Validate filter parameters. Dimension filters accept a single value or, via
// repeated query params (?region=A&region=B), an array — OR-matched downstream.
const dim = z.union([z.string(), z.array(z.string())]).optional();
// Accept a plain date (YYYY-MM-DD, as sent by <input type="date"> and the
// relative-date presets) or a full ISO datetime. `.datetime()` alone rejected
// date-only strings, which silently dropped every date-filtered query.
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}(T[\d:.]+(Z|[+-]\d{2}:\d{2})?)?$/).optional();
// Groupings the semantic slots have no name for arrive as `col.<column>=value`, so a
// derived dataset with a dozen dimensions can filter on all of them without the seven
// fixed keys below having to grow a name for each.
const COLUMN_FILTER_PREFIX = "col.";
const filterSchema = z.object({
  dateFrom: isoDate,
  dateTo: isoDate,
  region: dim,
  state: dim,
  city: dim,
  category: dim,
  department: dim,
  product: dim,
  customer: dim,
});

function filtersFrom(query: any): A.Filters {
  // Fail closed: let a ZodError propagate to the central handler (400) rather than
  // silently discarding malformed filters and returning an unfiltered result set.
  const validated = filterSchema.parse(query);
  const base = Object.fromEntries(
    Object.entries(validated).filter(([, v]) => v !== undefined)
  ) as A.Filters;
  const columns: Record<string, string | string[]> = {};
  for (const [k, v] of Object.entries((query ?? {}) as Record<string, unknown>)) {
    if (!k.startsWith(COLUMN_FILTER_PREFIX)) continue;
    const col = k.slice(COLUMN_FILTER_PREFIX.length);
    if (!col) continue;
    if (typeof v === "string") columns[col] = v;
    else if (Array.isArray(v) && v.every((x) => typeof x === "string")) columns[col] = v as string[];
  }
  if (Object.keys(columns).length) base.columns = columns;
  return base;
}

// Not a filter: it removes no rows, it only names which prior window a change is
// measured against. An unrecognised value falls back to the default rather than
// erroring, so a stale bookmarked URL still renders the dashboard.
const compareSchema = z.enum(["previous_period", "previous_year"]).catch("previous_period");
const comparisonFrom = (query: unknown): A.Comparison =>
  compareSchema.parse((query as Record<string, unknown> | null)?.compare);

const timeSeries = (metric: "revenue" | "profit") =>
  wrap(async (req, res) => {
    const orgId = req.auth!.organizationId;
    const { rows, schema } = await loadJoinedDataset(orgId, req.query.datasetId as string | undefined);
    const { calendar } = await loadOrgConfig(orgId);
    res.json({ series: A.timeSeries(rows, schema, metric, filtersFrom(req.query), calendar) });
  });

const groupByDimension = (key: "product_name" | "customer_name" | "region", limit: number) =>
  wrap(async (req, res) => {
    const { rows, schema } = await loadJoinedDataset(req.auth!.organizationId, req.query.datasetId as string | undefined);
    res.json({ items: A.groupBy(rows, schema, key, "revenue", filtersFrom(req.query), limit) });
  });

analyticsRouter.get("/overview", wrap(async (req, res) => {
  const orgId = req.auth!.organizationId;
  const { dataset, rows, schema, join } = await loadJoinedDataset(orgId, req.query.datasetId as string | undefined);
  // The dashboard configuration comes from this dataset's own structure, not from an
  // industry template. Calculation is unchanged: every number below is still produced
  // by the same engine functions, just pointed at the columns the data actually has.
  const { pack, shape, derived, calendar } = await loadAnalysisConfig(orgId, dataset.id, rows);
  const f = filtersFrom(req.query);

  // The stored schema is kept pack-correct at write time, so it is used directly.
  // The column profile is fetched only here (not in loadJoinedDataset) to power the
  // "switch industry?" suggestion banner without bloating other analytics reads.
  const prof = await prisma.dataset.findUnique({ where: { id: dataset.id }, select: { profile: true } });
  const cols = ((prof?.profile as { columns?: ColumnProfile[] } | null)?.columns) ?? [];

  // Date-grain drill: the trend buckets one level below wherever the date window sits.
  // With no window that is periods, i.e. exactly the series this route always returned.
  const grain = trendGrain(f, calendar);
  const revenueTrend = A.timeSeries(rows, schema, "revenue", f, calendar, grain);
  const profitTrend = A.timeSeries(rows, schema, "profit", f, calendar, grain);
  const sparkOf = (t: { value: number }[]) => (t.length > 1 ? t.map((p) => p.value) : undefined);
  // Margin series by period-keyed lookup (not index) so it stays correct even if
  // the revenue/profit trend arrays ever diverge in length or ordering.
  const revByPeriod = new Map(revenueTrend.map((p) => [p.period, p.value]));
  const marginSpark = revenueTrend.length > 1
    ? profitTrend.map((p) => { const r = revByPeriod.get(p.period); return r ? (p.value / r) * 100 : 0; })
    : undefined;

  const compare = comparisonFrom(req.query);
  const kpis = A.computeKpis(rows, schema, pack, f, compare, calendar).map((k) => ({
    ...k,
    spark: k.key === "revenue" ? sparkOf(revenueTrend) : k.key === "profit" ? sparkOf(profitTrend) : k.key === "margin" ? marginSpark : undefined,
  }));

  // `dimension` is what makes a chart drillable: a clicked bar carries only its label,
  // so the client needs to know which dimension produced it. Emitted alongside
  // `hierarchies` below so the semantic -> filter-key mapping stays in one place.
  const section = (def: RankSectionDef) => ({
    title: def.title, subtitle: def.subtitle, emptyText: def.emptyText, format: def.format,
    dimension: def.dimension,
    data: A.groupBy(rows, schema, def.dimension, def.metric, f, def.limit),
  });
  const compDim = schema[pack.composition.dimension] ? pack.composition.dimension : pack.composition.fallback;

  res.json({
    datasetId: dataset.id,
    datasetName: dataset.name,
    // Which other files these numbers were read across, and what each connection did.
    // Null for the single-file case, which is every organization that has not connected
    // anything — so the client renders exactly what it always did.
    join: join?.map((j) => ({
      rightDatasetName: j.rightDatasetName, leftColumn: j.leftColumn, rightColumn: j.rightColumn,
      kind: j.report.kind, matchedRows: j.report.matchedLeftRows, unmatchedRows: j.report.unmatchedLeftRows,
      applied: j.report.applied, message: j.report.message,
    })) ?? null,
    industry: pack.key,
    suggestedIndustry: cols.length ? suggestIndustry(cols) : pack.key,
    schema,
    kpis,
    // The windows the comparison actually resolved to. The client shows these rather
    // than restating the request, because a requested comparison can come back
    // unavailable and a percentage with no stated basis is unreadable.
    comparison: (() => {
      const split = A.splitPeriods(rows, schema, f, compare, calendar);
      return { compare, basis: split.basis, reason: split.reason, currentRange: split.currentRange, previousRange: split.previousRange };
    })(),
    // Each bucket carries the date window it covers so a click can narrow to it without
    // the client re-deriving 4-4-5 arithmetic — the calendar rules stay in the engine,
    // written down once. `path` is the breadcrumb back up the grain.
    trend: {
      title: pack.trend.title, subtitle: pack.trend.subtitle, revenue: revenueTrend, profit: profitTrend,
      // What the two series are actually called for THIS file, and whether the second
      // one exists at all. A dataset with no cost or profit column has no second series
      // to draw, and a flat line of zeros labelled "Profit" is a lie the chart should
      // not tell — so the label is null and the client draws one series.
      seriesLabel: shape.measures[0]?.label ?? "Records",
      secondSeriesLabel: schema.profit || schema.cost ? "Profit" : null,
      grain,
      ranges: Object.fromEntries(
        [...new Set([...revenueTrend, ...profitTrend].map((p) => p.period))]
          .map((key) => [key, periodRange(key, calendar)] as const)
          .filter(([, range]) => range !== null),
      ),
      path: dateDrillPath(f, calendar),
    },
    composition: {
      title: pack.composition.title, subtitle: pack.composition.subtitle, centerLabel: pack.composition.centerLabel,
      dimension: compDim ?? null,
      data: compDim ? A.groupBy(rows, schema, compDim, "revenue", f, 8) : [],
    },
    ranking: section(pack.ranking),
    secondary: section(pack.secondary),
    hierarchies: availableHierarchies(schema),
    // How the file was read, in the user's own words. Rendered as "How we read your
    // file" so the dashboard can be argued with rather than merely believed.
    shape: {
      kind: shape.kind,
      rowCount: shape.rowCount,
      notes: derived.notes,
      columns: shape.columns.map((c) => ({ name: c.name, label: c.label, role: c.role, confidence: c.confidence, reasons: c.reasons })),
    },
    // Every grouping the file has, each keyed by its real column. A wide file is no
    // longer truncated to the seven named slots.
    dimensions: derived.dimensions.map((d) => ({
      key: d.key, column: d.column, label: d.label, cardinality: d.cardinality,
      values: A.distinctValues(rows, schema, { column: d.column }),
    })),
    // Retained for the screens still keyed on the fixed slots; a derived dataset fills
    // whichever of them its own columns landed in.
    filterOptions: {
      region: A.distinctValues(rows, schema, "region"),
      state: A.distinctValues(rows, schema, "state"),
      city: A.distinctValues(rows, schema, "city"),
      category: A.distinctValues(rows, schema, "category"),
      department: A.distinctValues(rows, schema, "department"),
      product: A.distinctValues(rows, schema, "product_name"),
      customer: A.distinctValues(rows, schema, "customer_name"),
    },
  });
}));

// Deterministic evidence for one KPI: the formula that ran, the rows it consumed,
// the comparison window, and the dataset/engine identity behind it. Recomputed on
// demand from the SAME functions the dashboard calls (never a second implementation)
// and scoped to the caller's organization by loadJoinedDataset, like every other read.
analyticsRouter.get("/explain", wrap(async (req, res) => {
  const orgId = req.auth!.organizationId;
  const { dataset, rows, schema } = await loadJoinedDataset(orgId, req.query.datasetId as string | undefined);
  const { pack, calendar } = await loadOrgConfig(orgId);
  const metricKey = typeof req.query.metric === "string" ? req.query.metric : "revenue";
  if (!pack.kpis.some((k) => k.key === metricKey)) throw new HttpError(400, `Unknown metric '${metricKey}' for this industry.`);

  // Detection rules are re-derived from the stored profile (cheap: regex over column
  // names) so the panel can cite the rule that mapped each column.
  const prof = await prisma.dataset.findUnique({ where: { id: dataset.id }, select: { profile: true } });
  const cols = ((prof?.profile as { columns?: ColumnProfile[] } | null)?.columns) ?? [];
  const detectionRules = cols.length ? detectSchema(cols, pack.rules).rules : {};

  res.json(explainKpi({
    rows, schema, pack, metricKey, filters: filtersFrom(req.query), detectionRules,
    industryKey: pack.key, calendar, compare: comparisonFrom(req.query),
    dataset: {
      id: dataset.id, name: dataset.name, fileName: dataset.fileName, rowCount: dataset.rowCount,
      datasetHash: dataset.datasetHash, rawFileHash: dataset.rawFileHash, engineVersion: dataset.engineVersion,
      cleaning: (dataset.cleaningLog as { type: string; column: string | null; affectedRows: number }[] | null) ?? [],
    },
  }));
}));

analyticsRouter.get("/revenue", timeSeries("revenue"));

analyticsRouter.get("/profit", timeSeries("profit"));

analyticsRouter.get("/products", groupByDimension("product_name", 20));

analyticsRouter.get("/customers", groupByDimension("customer_name", 20));

analyticsRouter.get("/regions", groupByDimension("region", 20));

// Driver / contribution breakdown: which dimension members moved the metric, and by
// how much. Contributions reconcile to the period-over-period change shown in KPIs.
analyticsRouter.get("/drivers", wrap(async (req, res) => {
  const { rows, schema } = await loadJoinedDataset(req.auth!.organizationId, req.query.datasetId as string | undefined);
  const metric: DriverMetric = req.query.metric === "profit" ? "profit" : "revenue";
  const dimension = typeof req.query.dimension === "string" ? (req.query.dimension as Semantic) : undefined;
  const { calendar, currency } = await loadOrgConfig(req.auth!.organizationId);
  res.json(analyzeDrivers(rows, schema, metric, dimension, filtersFrom(req.query), 10, comparisonFrom(req.query), calendar, currency));
}));

// Anomalies in a metric's time series (deterministic, robust to single outliers).
analyticsRouter.get("/anomalies", wrap(async (req, res) => {
  const orgId = req.auth!.organizationId;
  const { rows, schema } = await loadJoinedDataset(orgId, req.query.datasetId as string | undefined);
  const { calendar } = await loadOrgConfig(orgId);
  const metric = (["revenue", "profit", "orders"] as const).find((m) => m === req.query.metric) ?? "revenue";
  const series = A.timeSeries(rows, schema, metric, filtersFrom(req.query), calendar);
  res.json(detectAnomalies(series, metric.charAt(0).toUpperCase() + metric.slice(1)));
}));

// Value-tier segmentation of customers or products.
analyticsRouter.get("/segments", wrap(async (req, res) => {
  const { rows, schema } = await loadJoinedDataset(req.auth!.organizationId, req.query.datasetId as string | undefined);
  const entity = (["customer_name", "product_name"] as const).find((e) => e === req.query.entity) as SegmentEntity | undefined;
  const { currency } = await loadOrgConfig(req.auth!.organizationId);
  res.json(segmentEntities(A.applyFilters(rows, schema, filtersFrom(req.query)), schema, entity, currency));
}));

// Correlations across the dataset's numeric columns (association only, never causal).
analyticsRouter.get("/correlations", wrap(async (req, res) => {
  const { dataset, rows, schema } = await loadJoinedDataset(req.auth!.organizationId, req.query.datasetId as string | undefined);
  const prof = await prisma.dataset.findUnique({ where: { id: dataset.id }, select: { profile: true } });
  const cols = ((prof?.profile as { columns?: ColumnProfile[] } | null)?.columns) ?? [];
  const numeric = cols.filter((c) => c.type === "number" || c.type === "currency").map((c) => c.name);
  const filtered = A.applyFilters(rows, schema, filtersFrom(req.query));
  res.json(analyzeCorrelations(filtered, numeric.length ? numeric : undefined));
}));

// Flat rows for the analytics data table + CSV export on the client (with pagination).
analyticsRouter.get("/table", wrap(async (req, res) => {
  const { rows, schema } = await loadJoinedDataset(req.auth!.organizationId, req.query.datasetId as string | undefined);
  const filtered = A.applyFilters(rows, schema, filtersFrom(req.query));
  const columns = Object.keys(filtered[0] ?? rows[0] ?? {});
  
  const page = Math.max(0, parseInt(req.query.page as string) || 0);
  const limit = Math.min(100, parseInt(req.query.limit as string) || 50);
  const offset = page * limit;
  
  res.json({ 
    columns, 
    rows: filtered.slice(offset, offset + limit), 
    total: filtered.length,
    page,
    limit,
    hasMore: offset + limit < filtered.length
  });
}));

// Full CSV export of the filtered analytics dataset.
import Papa from "papaparse";
analyticsRouter.get("/export", wrap(async (req, res) => {
  const { rows, schema, dataset } = await loadJoinedDataset(req.auth!.organizationId, req.query.datasetId as string | undefined);
  const filtered = A.applyFilters(rows, schema, filtersFrom(req.query));
  
  if (!filtered.length) {
    throw new HttpError(404, "No data matching filters to export");
  }

  // Prevent formula injection if any string starts with =, +, -, @
  // Also stringify handles quotes, commas, etc via papaparse.
  const sanitizedRows = filtered.map(row => {
    const safeRow: Record<string, any> = {};
    for (const [k, v] of Object.entries(row as Record<string, unknown>)) {
      if (typeof v === "string" && /^[=\+\-@]/.test(v)) {
        safeRow[k] = "'" + v;
      } else {
        safeRow[k] = v;
      }
    }
    return safeRow;
  });

  const csv = Papa.unparse(sanitizedRows, { header: true });
  
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${dataset.name}-export.csv"`);
  res.status(200).send(csv);
}));

// ─── Saved views (named filter queries, shared across the organization) ───
// A view stores the Analytics page's URL query string. It is validated against the
// same filterSchema the analytics routes use, so a view that could not be applied
// cannot be saved in the first place.
function parseQuery(query: string): void {
  const params = new URLSearchParams(query);
  const grouped: Record<string, string | string[]> = {};
  for (const key of new Set(params.keys())) {
    const values = params.getAll(key);
    grouped[key] = values.length > 1 ? values : values[0];
  }
  const result = filterSchema.strict().safeParse(grouped);
  if (!result.success) throw new HttpError(400, "That filter combination can't be saved as a view");
}

const viewCreate = z.object({ name: z.string().min(1).max(80), query: z.string().max(2000) });
const viewUpdate = viewCreate.partial();

analyticsRouter.get("/views", wrap(async (req, res) => {
  const views = await prisma.savedView.findMany({
    where: { organizationId: req.auth!.organizationId },
    orderBy: { name: "asc" },
  });
  res.json({ views });
}));

// Saving under an existing name overwrites that view — the localStorage version
// replaced by name, and the unique index makes that one atomic upsert.
analyticsRouter.post("/views", requireRole("ADMIN", "MANAGER"), wrap(async (req, res) => {
  const body = viewCreate.parse(req.body ?? {});
  parseQuery(body.query);
  const organizationId = req.auth!.organizationId;
  const view = await prisma.savedView.upsert({
    where: { organizationId_name: { organizationId, name: body.name } },
    update: { query: body.query },
    create: { ...body, organizationId },
  });
  await prisma.activityLog.create({ data: { organizationId, action: "view.saved", detail: view.name, actorId: req.auth!.userId, entityType: "saved_view", entityId: view.id } });
  res.status(201).json({ view });
}));

analyticsRouter.patch("/views/:id", requireRole("ADMIN", "MANAGER"), wrap(async (req, res) => {
  const body = viewUpdate.parse(req.body ?? {});
  if (body.query !== undefined) parseQuery(body.query);
  const organizationId = req.auth!.organizationId;
  const existing = await prisma.savedView.findFirst({ where: { id: req.params.id, organizationId } });
  if (!existing) throw new HttpError(404, "Saved view not found");
  if (body.name && body.name !== existing.name) {
    const clash = await prisma.savedView.findFirst({ where: { organizationId, name: body.name } });
    if (clash) throw new HttpError(409, `A view named '${body.name}' already exists.`);
  }
  const view = await prisma.savedView.update({ where: { id: existing.id }, data: body });
  res.json({ view });
}));

analyticsRouter.delete("/views/:id", requireRole("ADMIN", "MANAGER"), wrap(async (req, res) => {
  const existing = await prisma.savedView.findFirst({ where: { id: req.params.id, organizationId: req.auth!.organizationId } });
  if (!existing) throw new HttpError(404, "Saved view not found");
  await prisma.savedView.delete({ where: { id: existing.id } });
  res.status(204).end();
}));
