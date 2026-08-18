import { Router } from "express";
import { z } from "zod";
import { wrap } from "../errors.js";
import { prisma } from "../prisma.js";
import { requireAuth } from "../auth/middleware.js";
import { loadDataset } from "./context.js";
import * as A from "../engine/analytics.js";
import type { ColumnProfile } from "../engine/profile.js";
import { getPack, suggestIndustry, type RankSectionDef } from "../engine/industries.js";

export const analyticsRouter = Router();
analyticsRouter.use(requireAuth);

// Validate filter parameters. Dimension filters accept a single value or, via
// repeated query params (?region=A&region=B), an array — OR-matched downstream.
const dim = z.union([z.string(), z.array(z.string())]).optional();
// Accept a plain date (YYYY-MM-DD, as sent by <input type="date"> and the
// relative-date presets) or a full ISO datetime. `.datetime()` alone rejected
// date-only strings, which silently dropped every date-filtered query.
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}(T[\d:.]+(Z|[+-]\d{2}:\d{2})?)?$/).optional();
const filterSchema = z.object({
  dateFrom: isoDate,
  dateTo: isoDate,
  region: dim,
  state: dim,
  category: dim,
  department: dim,
  product: dim,
  customer: dim,
});

function filtersFrom(query: any): A.Filters {
  try {
    const validated = filterSchema.parse(query);
    return Object.fromEntries(
      Object.entries(validated).filter(([, v]) => v !== undefined)
    ) as A.Filters;
  } catch (e) {
    // Return empty filters if validation fails — don't break the query
    console.warn("[analytics] Filter validation failed", e);
    return {};
  }
}

const timeSeries = (metric: "revenue" | "profit") =>
  wrap(async (req, res) => {
    const { rows, schema } = await loadDataset(req.auth!.organizationId, req.query.datasetId as string | undefined);
    res.json({ series: A.timeSeries(rows, schema, metric, filtersFrom(req.query)) });
  });

const groupByDimension = (key: "product_name" | "customer_name" | "region", limit: number) =>
  wrap(async (req, res) => {
    const { rows, schema } = await loadDataset(req.auth!.organizationId, req.query.datasetId as string | undefined);
    res.json({ items: A.groupBy(rows, schema, key, "revenue", filtersFrom(req.query), limit) });
  });

analyticsRouter.get("/overview", wrap(async (req, res) => {
  const orgId = req.auth!.organizationId;
  const { dataset, rows, schema } = await loadDataset(orgId, req.query.datasetId as string | undefined);
  const org = await prisma.organization.findUnique({ where: { id: orgId }, select: { industry: true } });
  const pack = getPack(org?.industry);
  const f = filtersFrom(req.query);

  // The stored schema is kept pack-correct at write time, so it is used directly.
  // The column profile is fetched only here (not in loadDataset) to power the
  // "switch industry?" suggestion banner without bloating other analytics reads.
  const prof = await prisma.dataset.findUnique({ where: { id: dataset.id }, select: { profile: true } });
  const cols = ((prof?.profile as { columns?: ColumnProfile[] } | null)?.columns) ?? [];

  const revenueTrend = A.timeSeries(rows, schema, "revenue", f);
  const profitTrend = A.timeSeries(rows, schema, "profit", f);
  const sparkOf = (t: { value: number }[]) => (t.length > 1 ? t.map((p) => p.value) : undefined);
  // Margin series by period-keyed lookup (not index) so it stays correct even if
  // the revenue/profit trend arrays ever diverge in length or ordering.
  const revByPeriod = new Map(revenueTrend.map((p) => [p.period, p.value]));
  const marginSpark = revenueTrend.length > 1
    ? profitTrend.map((p) => { const r = revByPeriod.get(p.period); return r ? (p.value / r) * 100 : 0; })
    : undefined;

  const kpis = A.computeKpis(rows, schema, pack, f).map((k) => ({
    ...k,
    spark: k.key === "revenue" ? sparkOf(revenueTrend) : k.key === "profit" ? sparkOf(profitTrend) : k.key === "margin" ? marginSpark : undefined,
  }));

  const section = (def: RankSectionDef) => ({
    title: def.title, subtitle: def.subtitle, emptyText: def.emptyText, format: def.format,
    data: A.groupBy(rows, schema, def.dimension, def.metric, f, def.limit),
  });
  const compDim = schema[pack.composition.dimension] ? pack.composition.dimension : pack.composition.fallback;

  res.json({
    datasetId: dataset.id,
    datasetName: dataset.name,
    industry: pack.key,
    suggestedIndustry: cols.length ? suggestIndustry(cols) : pack.key,
    schema,
    kpis,
    trend: { title: pack.trend.title, subtitle: pack.trend.subtitle, revenue: revenueTrend, profit: profitTrend },
    composition: {
      title: pack.composition.title, subtitle: pack.composition.subtitle, centerLabel: pack.composition.centerLabel,
      data: compDim ? A.groupBy(rows, schema, compDim, "revenue", f, 8) : [],
    },
    ranking: section(pack.ranking),
    secondary: section(pack.secondary),
    filterOptions: {
      region: A.distinctValues(rows, schema, "region"),
      state: A.distinctValues(rows, schema, "state"),
      category: A.distinctValues(rows, schema, "category"),
      department: A.distinctValues(rows, schema, "department"),
      product: A.distinctValues(rows, schema, "product_name"),
      customer: A.distinctValues(rows, schema, "customer_name"),
    },
  });
}));

analyticsRouter.get("/revenue", timeSeries("revenue"));

analyticsRouter.get("/profit", timeSeries("profit"));

analyticsRouter.get("/products", groupByDimension("product_name", 20));

analyticsRouter.get("/customers", groupByDimension("customer_name", 20));

analyticsRouter.get("/regions", groupByDimension("region", 20));

// Flat rows for the analytics data table + CSV export on the client (with pagination).
analyticsRouter.get("/table", wrap(async (req, res) => {
  const { rows, schema } = await loadDataset(req.auth!.organizationId, req.query.datasetId as string | undefined);
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
