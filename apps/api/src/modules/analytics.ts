import { Router } from "express";
import { z } from "zod";
import rateLimit from "express-rate-limit";
import { wrap } from "../errors.js";
import { requireAuth } from "../auth/middleware.js";
import { loadDataset } from "./context.js";
import * as A from "../engine/analytics.js";

export const analyticsRouter = Router();
analyticsRouter.use(requireAuth);
// Every route here re-runs the full analytics engine over the dataset on each call.
analyticsRouter.use(rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: true, legacyHeaders: false, message: "Too many analytics requests — slow down" }));

// Validate filter parameters
const filterSchema = z.object({
  dateFrom: z.string().datetime().optional(),
  dateTo: z.string().datetime().optional(),
  region: z.string().optional(),
  state: z.string().optional(),
  category: z.string().optional(),
  department: z.string().optional(),
  product: z.string().optional(),
  customer: z.string().optional(),
});

// Throws a ZodError on invalid filters — the wrap()/errorHandler() pipeline
// turns that into a 400 with field-level details, rather than silently
// dropping the filter and returning unfiltered (and misleading) results.
function filtersFrom(query: unknown): A.Filters {
  const validated = filterSchema.parse(query);
  return Object.fromEntries(
    Object.entries(validated).filter(([, v]) => v !== undefined)
  ) as A.Filters;
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
  const { dataset, rows, schema } = await loadDataset(req.auth!.organizationId, req.query.datasetId as string | undefined);
  const f = filtersFrom(req.query);
  res.json({
    datasetId: dataset.id,
    datasetName: dataset.name,
    schema,
    overview: A.overview(rows, schema, f),
    revenueTrend: A.timeSeries(rows, schema, "revenue", f),
    profitTrend: A.timeSeries(rows, schema, "profit", f),
    topProducts: A.groupBy(rows, schema, "product_name", "revenue", f, 8),
    topCustomers: A.groupBy(rows, schema, "customer_name", "revenue", f, 8),
    regions: A.groupBy(rows, schema, "region", "revenue", f, 10),
    categories: A.groupBy(rows, schema, "category", "revenue", f, 10),
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
