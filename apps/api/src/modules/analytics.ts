import { Router } from "express";
import { z } from "zod";
import { wrap } from "../errors.js";
import { requireAuth } from "../auth/middleware.js";
import { loadDataset } from "./context.js";
import * as A from "../engine/analytics.js";

export const analyticsRouter = Router();
analyticsRouter.use(requireAuth);

// Validate filter parameters. Date inputs are `YYYY-MM-DD` (from <input type="date">),
// NOT full ISO datetimes — using z.string().datetime() here silently rejected every
// date the UI sends. Unknown query keys (datasetId, page, limit) are stripped, not rejected.
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const filterSchema = z.object({
  dateFrom: z.string().regex(DATE_RE, "expected YYYY-MM-DD").optional(),
  dateTo: z.string().regex(DATE_RE, "expected YYYY-MM-DD").optional(),
  region: z.string().optional(),
  state: z.string().optional(),
  category: z.string().optional(),
  department: z.string().optional(),
  product: z.string().optional(),
  customer: z.string().optional(),
});

function filtersFrom(query: unknown): A.Filters {
  // A genuinely malformed filter now surfaces as a 400 (via the Zod error handler)
  // instead of being silently swallowed into "no filters".
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
  // dashboardBundle applies filters once instead of re-scanning per metric.
  const bundle = A.dashboardBundle(rows, schema, filtersFrom(req.query));
  res.json({ datasetId: dataset.id, datasetName: dataset.name, schema, ...bundle });
}));

analyticsRouter.get("/revenue", timeSeries("revenue"));

analyticsRouter.get("/profit", timeSeries("profit"));

analyticsRouter.get("/products", groupByDimension("product_name", 20));

analyticsRouter.get("/customers", groupByDimension("customer_name", 20));

analyticsRouter.get("/regions", groupByDimension("region", 20));

// Full filtered result set as CSV, server-side. Capped so a huge dataset can't
// exhaust memory. Replaces the old client export that only dumped the current page.
const EXPORT_CAP = 50_000;
const csvEscape = (v: unknown) => {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
analyticsRouter.get("/export", wrap(async (req, res) => {
  const { rows, schema } = await loadDataset(req.auth!.organizationId, req.query.datasetId as string | undefined);
  const filtered = A.applyFilters(rows, schema, filtersFrom(req.query));
  const columns = Object.keys(filtered[0] ?? rows[0] ?? {});
  const capped = filtered.slice(0, EXPORT_CAP);
  const csv = [columns.join(","), ...capped.map((r) => columns.map((c) => csvEscape(r[c])).join(","))].join("\n");
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename="analytics-export.csv"`);
  res.send(csv);
}));

// Flat rows for the analytics data table (paginated).
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
