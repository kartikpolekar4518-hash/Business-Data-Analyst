import { Router } from "express";
import { z } from "zod";
import { prisma } from "../prisma.js";
import { wrap, HttpError } from "../errors.js";
import { requireAuth, requireRole } from "../auth/middleware.js";
import { analyzeJoin, createsCycle, suggestRelations, type JoinSpec } from "../engine/join.js";
import type { Row } from "../engine/parse.js";
import { loadJoinedDataset } from "./context.js";

export const relationsRouter = Router();
relationsRouter.use(requireAuth);

// Relationships between the organization's datasets. A relationship is only ever stored
// after it has been measured against the real rows, because the one thing a join must
// never do is quietly inflate a total (see engine/join.ts).

const shape = (r: {
  id: string; leftColumn: string; rightColumn: string; kind: string; createdAt: Date;
  left: { id: string; name: string }; right: { id: string; name: string };
}) => ({
  id: r.id, kind: r.kind, createdAt: r.createdAt,
  leftDatasetId: r.left.id, leftDatasetName: r.left.name, leftColumn: r.leftColumn,
  rightDatasetId: r.right.id, rightDatasetName: r.right.name, rightColumn: r.rightColumn,
  description: `${r.left.name} → ${r.right.name}, matched on ${r.leftColumn} = ${r.rightColumn}`,
});

const withSides = { include: { left: { select: { id: true, name: true } }, right: { select: { id: true, name: true } } } } as const;

// The rows a relationship is measured against are the ones analytics reads: cleaned if
// the dataset was cleaned, original otherwise — the same choice loadDataset makes.
function activeRows(d: { rows: unknown; cleanedRows: unknown }): Row[] {
  return ((d.cleanedRows ?? d.rows) ?? []) as Row[];
}
function headerOf(rows: Row[]): string[] { return Object.keys(rows[0] ?? {}); }

/**
 * Validate a proposed relationship in a fixed order, each stage refusing plainly before
 * the next is attempted: both datasets, both columns, no cycle, and only then the
 * cardinality. Returns the measured `kind` for storage.
 */
async function validateRelation(organizationId: string, input: { leftDatasetId: string; rightDatasetId: string; leftColumn: string; rightColumn: string }, ignoreId?: string) {
  if (input.leftDatasetId === input.rightDatasetId) throw new HttpError(400, "A file can't be connected to itself.");

  // Tenant isolation: findFirst scoped to the org, never findUnique by id.
  const select = { id: true, name: true, rows: true, cleanedRows: true };
  const [left, right] = await Promise.all([
    prisma.dataset.findFirst({ where: { id: input.leftDatasetId, organizationId }, select }),
    prisma.dataset.findFirst({ where: { id: input.rightDatasetId, organizationId }, select }),
  ]);
  if (!left) throw new HttpError(404, "The first file wasn't found.");
  if (!right) throw new HttpError(404, "The second file wasn't found.");

  // Measured against the SAME context analytics will read: the left file with every
  // connection already made on it. Relationships are applied in a fixed sequence against
  // the accumulating rows, so a second connection may legitimately match on a column the
  // first one added — validating against the stored header alone would refuse exactly the
  // chain the feature exists for. `ignoreId` excludes the relationship being edited.
  const context = await loadJoinedDataset(organizationId, input.leftDatasetId, ignoreId);
  const leftRows = context.rows;
  const rightRows = activeRows(right);
  // A missing column is a validation failure named as such. Left to the analysis it
  // would simply match nothing, and the user would see an empty column rather than a typo.
  if (!context.columns.includes(input.leftColumn)) throw new HttpError(400, `"${left.name}" has no column called "${input.leftColumn}".`);
  if (!headerOf(rightRows).includes(input.rightColumn)) throw new HttpError(400, `"${right.name}" has no column called "${input.rightColumn}".`);

  // Relationships are applied as a fixed sequence, not a planned traversal, so a cycle
  // would re-join a file to itself. Refused here, where it can be explained.
  const edges = await prisma.datasetRelation.findMany({
    where: { organizationId, ...(ignoreId ? { id: { not: ignoreId } } : {}) },
    select: { leftDatasetId: true, rightDatasetId: true },
  });
  if (createsCycle(edges, input.leftDatasetId, input.rightDatasetId)) {
    throw new HttpError(400, `Connecting "${left.name}" to "${right.name}" would loop back on itself. Files can only be connected in one direction.`);
  }

  const spec: JoinSpec = { leftColumn: input.leftColumn, rightColumn: input.rightColumn, rightName: right.name };
  const report = analyzeJoin(leftRows, rightRows, spec);
  // The heart of the feature: a repeated right-hand key duplicates each matching left
  // row, and every total drawn from the result is too high. Refused, not warned about.
  if (!report.safe) throw new HttpError(400, report.message);
  return { kind: report.kind, report };
}

relationsRouter.get("/", wrap(async (req, res) => {
  const relations = await prisma.datasetRelation.findMany({
    where: { organizationId: req.auth!.organizationId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    ...withSides,
  });
  res.json({ relations: relations.map(shape) });
}));

// Auto-detection: column-name affinity plus value-overlap sampling, offered as a
// SUGGESTION. Nothing here writes — connecting two files is always a separate, explicit
// POST by the user, because a wrongly guessed join changes every number on the page.
relationsRouter.get("/suggestions", wrap(async (req, res) => {
  const organizationId = req.auth!.organizationId;
  const datasets = await prisma.dataset.findMany({
    where: { organizationId },
    orderBy: { createdAt: "desc" },
    take: 10, // newest handful: the value-overlap sampling is O(datasets²) in column pairs
    select: { id: true, name: true, rows: true, cleanedRows: true },
  });
  const existing = new Set(
    (await prisma.datasetRelation.findMany({ where: { organizationId }, select: { leftDatasetId: true, rightDatasetId: true, leftColumn: true, rightColumn: true } }))
      .map((r) => `${r.leftDatasetId}|${r.rightDatasetId}|${r.leftColumn}|${r.rightColumn}`),
  );

  const candidates = datasets.map((d) => {
    const rows = activeRows(d);
    return { id: d.id, name: d.name, columns: headerOf(rows), rows };
  });
  const suggestions = suggestRelations(candidates)
    .filter((s) => !existing.has(`${s.leftDatasetId}|${s.rightDatasetId}|${s.leftColumn}|${s.rightColumn}`))
    .slice(0, 10);
  res.json({ suggestions });
}));

relationsRouter.post("/", requireRole("ADMIN", "MANAGER"), wrap(async (req, res) => {
  const organizationId = req.auth!.organizationId;
  const body = z.object({
    leftDatasetId: z.string().uuid(),
    rightDatasetId: z.string().uuid(),
    leftColumn: z.string().min(1).max(200),
    rightColumn: z.string().min(1).max(200),
  }).parse(req.body ?? {});

  const duplicate = await prisma.datasetRelation.findFirst({ where: { organizationId, ...body } });
  if (duplicate) throw new HttpError(409, "Those two files are already connected on those columns.");

  const { kind, report } = await validateRelation(organizationId, body);
  const relation = await prisma.datasetRelation.create({ data: { organizationId, ...body, kind }, ...withSides });
  await prisma.activityLog.create({
    data: { organizationId, action: "relation.created", detail: shape(relation).description, actorId: req.auth!.userId },
  });
  res.status(201).json({ relation: shape(relation), report });
}));

relationsRouter.patch("/:id", requireRole("ADMIN", "MANAGER"), wrap(async (req, res) => {
  const organizationId = req.auth!.organizationId;
  const existing = await prisma.datasetRelation.findFirst({ where: { id: req.params.id, organizationId } });
  if (!existing) throw new HttpError(404, "Connection not found");

  const body = z.object({
    leftColumn: z.string().min(1).max(200).optional(),
    rightColumn: z.string().min(1).max(200).optional(),
  }).parse(req.body ?? {});

  // Re-measured against the real rows, exactly like a create: an edited relationship is
  // a different join, and must earn the same guarantee.
  const next = {
    leftDatasetId: existing.leftDatasetId, rightDatasetId: existing.rightDatasetId,
    leftColumn: body.leftColumn ?? existing.leftColumn, rightColumn: body.rightColumn ?? existing.rightColumn,
  };
  const { kind, report } = await validateRelation(organizationId, next, existing.id);
  const relation = await prisma.datasetRelation.update({
    where: { id: existing.id },
    data: { leftColumn: next.leftColumn, rightColumn: next.rightColumn, kind },
    ...withSides,
  });
  res.json({ relation: shape(relation), report });
}));

relationsRouter.delete("/:id", requireRole("ADMIN", "MANAGER"), wrap(async (req, res) => {
  const organizationId = req.auth!.organizationId;
  const existing = await prisma.datasetRelation.findFirst({ where: { id: req.params.id, organizationId }, ...withSides });
  if (!existing) throw new HttpError(404, "Connection not found");
  // Nothing was ever written into either dataset by the join, so disconnecting simply
  // returns the organization to the numbers it had before.
  await prisma.datasetRelation.delete({ where: { id: existing.id } });
  await prisma.activityLog.create({
    data: { organizationId, action: "relation.deleted", detail: shape(existing).description, actorId: req.auth!.userId },
  });
  res.status(204).end();
}));
