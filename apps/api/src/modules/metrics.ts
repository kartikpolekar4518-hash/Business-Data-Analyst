import { Router } from "express";
import { z } from "zod";
import { prisma } from "../prisma.js";
import { wrap, HttpError } from "../errors.js";
import { requireAuth, requireRole } from "../auth/middleware.js";
import { loadDataset, loadOrgConfig } from "./context.js";
import {
  METRIC_FORMATS, METRIC_KINDS, METRIC_OPERATORS,
  compileKpiDef, describeSpec, validateMetricSpec, type MetricSpec,
} from "../engine/metricSpec.js";

export const metricsRouter = Router();
metricsRouter.use(requireAuth);

const field = z.object({
  kind: z.enum(["column", "semantic"]),
  name: z.string().min(1).max(200),
});

// The spec is validated twice on purpose: Zod pins the shape at the edge, then
// validateMetricSpec applies the engine's own cross-field rules (a count takes no
// field, a ratio needs a denominator, and so on) so the API and the engine can never
// disagree about what a valid metric is.
const specSchema = z.object({
  key: z.string().min(1).max(40),
  label: z.string().min(1).max(80),
  kind: z.enum(METRIC_KINDS as [string, ...string[]]),
  format: z.enum(METRIC_FORMATS as [string, ...string[]]),
  field: field.optional(),
  denominator: field.optional(),
  filter: z.object({
    field,
    operator: z.enum(METRIC_OPERATORS as [string, ...string[]]),
    value: z.union([z.string().max(200), z.number()]),
  }).optional(),
  words: z.array(z.string().max(40)).max(20).optional(),
});

function parseSpec(body: unknown): MetricSpec {
  const spec = specSchema.parse(body) as MetricSpec;
  const errors = validateMetricSpec(spec);
  if (errors.length) throw new HttpError(400, errors.join(" "));
  return spec;
}

// A custom metric may not shadow one of the pack's built-in metrics or KPIs: the
// dashboard, alert rules and the NL resolver all address metrics by key, so a
// collision would make which implementation runs depend on lookup order.
function assertKeyIsFree(key: string, pack: { kpis: { key: string }[]; metrics: { id: string }[] }) {
  const taken = pack.kpis.some((k) => k.key === key) || pack.metrics.some((m) => m.id === key);
  if (taken) throw new HttpError(409, `'${key}' is already a built-in metric for your industry. Choose another key.`);
}

metricsRouter.get("/", wrap(async (req, res) => {
  const orgId = req.auth!.organizationId;
  const [metrics, { pack }] = await Promise.all([
    prisma.customMetric.findMany({ where: { organizationId: orgId }, orderBy: { createdAt: "asc" } }),
    loadOrgConfig(orgId),
  ]);
  res.json({
    metrics: metrics.map((m) => ({ id: m.id, key: m.key, label: m.label, spec: m.spec, createdAt: m.createdAt })),
    // Surfaced so the definition UI can offer the same field vocabulary the engine
    // understands, rather than hardcoding a second copy of it in the client.
    builtinKeys: [...new Set([...pack.kpis.map((k) => k.key), ...pack.metrics.map((m) => m.id)])],
    kinds: METRIC_KINDS,
    formats: METRIC_FORMATS,
    operators: METRIC_OPERATORS,
  });
}));

metricsRouter.post("/", requireRole("ADMIN", "MANAGER"), wrap(async (req, res) => {
  const orgId = req.auth!.organizationId;
  const spec = parseSpec(req.body ?? {});
  const { pack } = await loadOrgConfig(orgId);
  assertKeyIsFree(spec.key, pack);

  const existing = await prisma.customMetric.findFirst({ where: { organizationId: orgId, key: spec.key } });
  if (existing) throw new HttpError(409, `A metric with the key '${spec.key}' already exists.`);

  const metric = await prisma.customMetric.create({
    data: { key: spec.key, label: spec.label, spec: spec as object, organizationId: orgId },
  });
  await prisma.activityLog.create({
    data: { organizationId: orgId, action: "metric.created", detail: spec.label, actorId: req.auth!.userId },
  });
  res.status(201).json({ metric: { id: metric.id, key: metric.key, label: metric.label, spec: metric.spec } });
}));

metricsRouter.patch("/:id", requireRole("ADMIN", "MANAGER"), wrap(async (req, res) => {
  const orgId = req.auth!.organizationId;
  const existing = await prisma.customMetric.findFirst({ where: { id: req.params.id, organizationId: orgId } });
  if (!existing) throw new HttpError(404, "Metric not found");

  const spec = parseSpec(req.body ?? {});
  const { pack } = await loadOrgConfig(orgId);
  if (spec.key !== existing.key) {
    assertKeyIsFree(spec.key, pack);
    const clash = await prisma.customMetric.findFirst({ where: { organizationId: orgId, key: spec.key } });
    if (clash) throw new HttpError(409, `A metric with the key '${spec.key}' already exists.`);
  }

  const metric = await prisma.customMetric.update({
    where: { id: existing.id },
    data: { key: spec.key, label: spec.label, spec: spec as object },
  });
  res.json({ metric: { id: metric.id, key: metric.key, label: metric.label, spec: metric.spec } });
}));

metricsRouter.delete("/:id", requireRole("ADMIN", "MANAGER"), wrap(async (req, res) => {
  const orgId = req.auth!.organizationId;
  const existing = await prisma.customMetric.findFirst({ where: { id: req.params.id, organizationId: orgId } });
  if (!existing) throw new HttpError(404, "Metric not found");

  // Alert rules address metrics by key, so a rule left pointing at a deleted metric
  // would silently stop evaluating. Refuse the delete and name the rules instead.
  const rules = await prisma.alertRule.findMany({ where: { organizationId: orgId, metric: existing.key }, select: { name: true } });
  if (rules.length) {
    throw new HttpError(409, `This metric is used by ${rules.length} alert rule(s): ${rules.map((r) => r.name).join(", ")}. Delete or repoint them first.`);
  }

  await prisma.customMetric.delete({ where: { id: existing.id } });
  await prisma.activityLog.create({
    data: { organizationId: orgId, action: "metric.deleted", detail: existing.label, actorId: req.auth!.userId },
  });
  res.status(204).end();
}));

// Dry-run a spec against a dataset's schema before saving it, so the definition UI can
// show the formula that will run and the value it currently produces. Read-only.
metricsRouter.post("/preview", wrap(async (req, res) => {
  const orgId = req.auth!.organizationId;
  const spec = parseSpec(req.body?.spec ?? {});
  const { rows, schema } = await loadDataset(orgId, typeof req.body?.datasetId === "string" ? req.body.datasetId : undefined);
  const def = compileKpiDef(spec);
  res.json({
    formula: describeSpec(spec, schema),
    sources: def.sources(schema),
    value: def.value(rows, schema),
    format: spec.format,
    // An empty source list means nothing in this dataset matched, so the metric would
    // read 0 for every row — worth saying plainly rather than showing a confident zero.
    resolves: def.sources(schema).length > 0 || spec.kind === "count",
  });
}));
