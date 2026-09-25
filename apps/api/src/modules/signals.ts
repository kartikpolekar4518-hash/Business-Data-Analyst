import { Router } from "express";
import { z } from "zod";
import { Prisma, PredictionKind, PredictionStatus } from "@prisma/client";
import { prisma } from "../prisma.js";
import { wrap, HttpError } from "../errors.js";
import { requireAuth, requireRole } from "../auth/middleware.js";
import { assertPlanFeature, planHasFeature } from "./billing.js";
import { loadJoinedDataset } from "./context.js";
import { isMlEnabled, mlHealth, runModel, type MlKind } from "../ml/client.js";

// Signals — predictions from the optional Python model service.
//
// Every number this router stores came from a model, not from the deterministic engine,
// and the two are never mixed: nothing here is read by the Dashboard, Analytics,
// Forecasts or any report, and the Signals pages carry a permanent estimate banner.
//
// Tenant isolation is unchanged and stays in one place. Rows are loaded through the same
// org-scoped context every analytics route uses, posted to Python, and the result is
// written back against the same organizationId. Python is told nothing about who asked.

export const signalsRouter = Router();
signalsRouter.use(requireAuth);

// The URL segment a page asks for, and the enum it is stored as. Two spellings of one
// thing, mapped in exactly one place so a typo cannot silently create a second kind.
const KINDS = {
  segments: { kind: PredictionKind.SEGMENTATION, ml: "segment" as MlKind },
  churn: { kind: PredictionKind.CHURN, ml: "churn" as MlKind },
  basket: { kind: PredictionKind.BASKET, ml: "basket" as MlKind },
} as const;
type Slug = keyof typeof KINDS;

const slugSchema = z.enum(Object.keys(KINDS) as [Slug, ...Slug[]]);

// Config is per-model and every key is optional — the Python side applies its own
// defaults and clamps anything out of range. Bounded here so a caller cannot post an
// arbitrary object into a Json column.
const configSchema = z.object({
  datasetId: z.string().uuid().optional(),
  gapMultiple: z.number().min(1).max(10).optional(),
  riskThreshold: z.number().min(0.05).max(0.95).optional(),
  minSupport: z.number().min(0.001).max(0.9).optional(),
  minConfidence: z.number().min(0.05).max(0.99).optional(),
}).strict();

const shape = (p: {
  id: string; kind: PredictionKind; status: PredictionStatus; modelVersion: string | null;
  contractVersion: string | null; datasetHash: string | null; config: unknown; result: unknown;
  metrics: unknown; warnings: string[]; error: string | null; createdAt: Date; datasetId: string | null;
}) => ({
  id: p.id,
  kind: p.kind,
  status: p.status,
  modelVersion: p.modelVersion,
  contractVersion: p.contractVersion,
  datasetHash: p.datasetHash,
  config: p.config,
  result: p.result,
  metrics: p.metrics,
  warnings: p.warnings,
  error: p.error,
  createdAt: p.createdAt,
  datasetId: p.datasetId,
});

// Is the feature available at all, and to this organization? Reports rather than
// refuses, so a page can render the right one of its four states before asking for
// anything. Both answers matter and they are different: "not switched on for this
// deployment" is an ops fact, "not on your plan" is a billing one.
signalsRouter.get("/status", wrap(async (req, res) => {
  const [health, entitled] = await Promise.all([
    mlHealth(),
    planHasFeature(req.auth!.organizationId, "predictions"),
  ]);
  res.json({ enabled: isMlEnabled(), reachable: health.reachable, contractVersion: health.contractVersion ?? null, entitled });
}));

/**
 * Start a run. Returns 202 immediately and finishes in the background.
 *
 * Training takes seconds — too slow to hold a request open, not enough work to justify a
 * queue. This matches the in-process approach the scheduler already documents; revisit
 * only if the API ever runs on more than one instance.
 */
signalsRouter.post("/:slug", requireRole("ADMIN", "MANAGER"), wrap(async (req, res) => {
  const auth = req.auth!;
  const slug = slugSchema.parse(req.params.slug);
  const { kind, ml } = KINDS[slug];
  const config = configSchema.parse(req.body ?? {});

  await assertPlanFeature(auth.organizationId, "predictions");
  if (!isMlEnabled()) throw new HttpError(503, "Predictions aren't switched on for this deployment.");

  // Loaded before the row is written, so a request with no data fails as a 404 the user
  // can act on rather than a stored FAILED run they have to go and read.
  const { dataset, rows, schema } = await loadJoinedDataset(auth.organizationId, config.datasetId);

  // Two runs of the same kind at once would race to be "the latest" and the loser's
  // numbers would sit under the winner's timestamp. One at a time, per org per kind.
  const running = await prisma.prediction.findFirst({ where: { organizationId: auth.organizationId, kind, status: PredictionStatus.RUNNING } });
  if (running) throw new HttpError(409, "That prediction is already running. It'll be ready shortly.");

  const record = await prisma.prediction.create({
    data: {
      organizationId: auth.organizationId,
      datasetId: dataset.id,
      kind,
      status: PredictionStatus.RUNNING,
      datasetHash: dataset.datasetHash,
      config: config as object,
      warnings: [],
    },
  });

  await prisma.activityLog.create({
    data: {
      organizationId: auth.organizationId, action: "signal.run", actorId: auth.userId,
      entityType: "prediction", entityId: record.id,
      detail: `Started ${LABEL[kind]} on ${dataset.name}`,
    },
  });

  // Deliberately not awaited: the response is already going out. Every failure path
  // inside is handled, so this can neither reject nor take the process down.
  void finish(record.id, ml, rows, schema, config);

  res.status(202).json({ prediction: shape(record) });
}));

// The latest run of one kind for this organization.
signalsRouter.get("/:slug", wrap(async (req, res) => {
  const slug = slugSchema.parse(req.params.slug);
  const prediction = await prisma.prediction.findFirst({
    where: { organizationId: req.auth!.organizationId, kind: KINDS[slug].kind },
    orderBy: { createdAt: "desc" },
  });
  res.json({ prediction: prediction ? shape(prediction) : null });
}));

const LABEL: Record<PredictionKind, string> = {
  [PredictionKind.SEGMENTATION]: "customer segments",
  [PredictionKind.CHURN]: "churn risk",
  [PredictionKind.BASKET]: "product affinities",
};

/**
 * Run the model and record what came back. Never throws — it is called without an
 * awaiting caller, so a rejection here would be an unhandled promise, and the row would
 * stay RUNNING for ever with nothing to explain why.
 */
async function finish(
  id: string,
  ml: MlKind,
  rows: Awaited<ReturnType<typeof loadJoinedDataset>>["rows"],
  schema: Awaited<ReturnType<typeof loadJoinedDataset>>["schema"],
  config: Record<string, unknown>,
): Promise<void> {
  try {
    const result = await runModel(ml, rows, schema, config);

    // null is every way the service can let us down at once — off, unreachable, timed
    // out, non-2xx, or an answer that did not match the contract. The client cannot tell
    // them apart on purpose, and none of them is a reason to store a number.
    if (!result || "_error" in result) {
      await prisma.prediction.update({
        where: { id },
        data: { status: PredictionStatus.FAILED, error: result && "_error" in result ? result._error : "The prediction service did not return a usable result. It may be switched off, still starting, or the run may have taken too long." },
      });
      return;
    }

    if (result.status === "error") {
      await prisma.prediction.update({
        where: { id },
        data: {
          status: PredictionStatus.FAILED, error: result.warnings[0] ?? "The model failed.",
          contractVersion: result.contractVersion, modelVersion: result.modelVersion,
          warnings: result.warnings,
        },
      });
      return;
    }

    // "insufficient_data" is a READY row. A refusal is a result — the reason is the
    // answer the user needs, and it is stored and shown verbatim rather than being
    // rounded down into an error or, worse, a weak estimate.
    await prisma.prediction.update({
      where: { id },
      data: {
        status: PredictionStatus.READY,
        contractVersion: result.contractVersion,
        modelVersion: result.modelVersion,
        // Prisma.DbNull, not null: a refusal genuinely has no payload, and the
        // typed client distinguishes "no value" from the JSON literal `null`.
        result: (result.predictions ?? Prisma.DbNull) as Prisma.InputJsonValue | typeof Prisma.DbNull,
        metrics: result.metrics as object,
        warnings: result.warnings,
      },
    });
  } catch (err) {
    // Includes the database being unreachable for the update above. Try once to record
    // it; if even that fails there is nowhere left to put it, and the process must not
    // come down over an optional add-on.
    try {
      await prisma.prediction.update({
        where: { id },
        data: { status: PredictionStatus.FAILED, error: err instanceof Error ? err.message : "Unknown error" },
      });
    } catch {
      console.error(`[signals] Could not record the outcome of prediction ${id}`, err);
    }
  }
}
