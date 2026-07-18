import { Router } from "express";
import { wrap } from "../errors.js";
import { requireAuth } from "../auth/middleware.js";
import { loadDataset } from "./context.js";
import * as A from "../engine/analytics.js";

export const analyticsRouter = Router();
analyticsRouter.use(requireAuth);

function filtersFrom(query: any): A.Filters {
  const f: A.Filters = {};
  for (const k of ["dateFrom", "dateTo", "region", "state", "category", "department", "product", "customer"] as const) {
    if (query[k]) (f as any)[k] = String(query[k]);
  }
  return f;
}

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

analyticsRouter.get("/revenue", wrap(async (req, res) => {
  const { rows, schema } = await loadDataset(req.auth!.organizationId, req.query.datasetId as string | undefined);
  res.json({ series: A.timeSeries(rows, schema, "revenue", filtersFrom(req.query)) });
}));

analyticsRouter.get("/profit", wrap(async (req, res) => {
  const { rows, schema } = await loadDataset(req.auth!.organizationId, req.query.datasetId as string | undefined);
  res.json({ series: A.timeSeries(rows, schema, "profit", filtersFrom(req.query)) });
}));

analyticsRouter.get("/products", wrap(async (req, res) => {
  const { rows, schema } = await loadDataset(req.auth!.organizationId, req.query.datasetId as string | undefined);
  res.json({ items: A.groupBy(rows, schema, "product_name", "revenue", filtersFrom(req.query), 20) });
}));

analyticsRouter.get("/customers", wrap(async (req, res) => {
  const { rows, schema } = await loadDataset(req.auth!.organizationId, req.query.datasetId as string | undefined);
  res.json({ items: A.groupBy(rows, schema, "customer_name", "revenue", filtersFrom(req.query), 20) });
}));

analyticsRouter.get("/regions", wrap(async (req, res) => {
  const { rows, schema } = await loadDataset(req.auth!.organizationId, req.query.datasetId as string | undefined);
  res.json({ items: A.groupBy(rows, schema, "region", "revenue", filtersFrom(req.query), 20) });
}));

// Flat rows for the analytics data table + CSV export on the client.
analyticsRouter.get("/table", wrap(async (req, res) => {
  const { rows, schema } = await loadDataset(req.auth!.organizationId, req.query.datasetId as string | undefined);
  const filtered = A.applyFilters(rows, schema, filtersFrom(req.query));
  const columns = Object.keys(filtered[0] ?? rows[0] ?? {});
  res.json({ columns, rows: filtered.slice(0, 500), total: filtered.length });
}));
