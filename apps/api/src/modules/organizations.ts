import { Router } from "express";
import { z } from "zod";
import { prisma } from "../prisma.js";
import { wrap, HttpError } from "../errors.js";
import { requireAuth, requireRole } from "../auth/middleware.js";
import { PACKS } from "../engine/industries.js";
import { CURRENCY_CODES, isValidTimezone } from "../engine/currency.js";
import { reapplyIndustrySchema } from "./context.js";

export const organizationsRouter = Router();
organizationsRouter.use(requireAuth);

// Org-wide activity feed. ActivityLog is written across the app (uploads, dataset
// cleaning, user/role changes, connections, billing) but has no FK to User, so
// actor names are batch-resolved here. Cursor-paginated (newest first).
organizationsRouter.get("/activity", wrap(async (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 30, 1), 100);
  const cursor = typeof req.query.cursor === "string" ? req.query.cursor : undefined;
  const rows = await prisma.activityLog.findMany({
    where: { organizationId: req.auth!.organizationId },
    orderBy: { createdAt: "desc" },
    take: limit + 1, // one extra to detect a next page
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const actorIds = [...new Set(page.map((r) => r.actorId).filter((id): id is string => !!id))];
  const actors = actorIds.length ? await prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true, email: true } }) : [];
  const byId = new Map(actors.map((a) => [a.id, a]));
  res.json({
    activity: page.map((r) => ({ id: r.id, action: r.action, detail: r.detail, createdAt: r.createdAt, actor: r.actorId ? byId.get(r.actorId) ?? null : null })),
    nextCursor: hasMore ? page[page.length - 1].id : null,
  });
}));

organizationsRouter.get("/current", wrap(async (req, res) => {
  const org = await prisma.organization.findUnique({
    where: { id: req.auth!.organizationId },
    include: { _count: { select: { members: true } } },
  });
  if (!org) throw new HttpError(404, "Organization not found");
  res.json({ organization: { ...org, memberCount: org._count.members } });
}));

const patchSchema = z.object({
  name: z.string().min(1).optional(),
  industry: z.enum(Object.keys(PACKS) as [string, ...string[]]).optional(),
  // Business calendar (engine/calendar.ts). Validated at the edge so a bad value can
  // never reach the analytics path, where it would silently re-bucket every period.
  fiscalYearStartMonth: z.number().int().min(1).max(12).optional(),
  periodScheme: z.enum(["calendar", "445", "454", "544"]).optional(),
  weekStartDay: z.number().int().min(0).max(6).optional(),
  // Money and time. Validated at the edge for the same reason the calendar is: a bad
  // currency prints the wrong symbol on every figure, and a bad zone silently re-buckets
  // every timestamped row. The timezone is checked against the runtime's own zone data
  // rather than a hardcoded list, so it stays correct as zones are added or renamed.
  currency: z.enum(CURRENCY_CODES as [string, ...string[]]).optional(),
  timezone: z.string().min(1).refine(isValidTimezone, "Not a recognised IANA time zone").optional(),
});

organizationsRouter.patch("/current", requireRole("ADMIN"), wrap(async (req, res) => {
  const data = patchSchema.parse(req.body);
  const before = await prisma.organization.findUnique({ where: { id: req.auth!.organizationId }, select: { industry: true } });
  const org = await prisma.organization.update({ where: { id: req.auth!.organizationId }, data });
  // On a real industry change, re-tailor the stored schema for every dataset so
  // all features (not just the dashboard) speak the new business's language.
  if (data.industry && data.industry !== before?.industry) await reapplyIndustrySchema(org.id, data.industry);
  // A calendar or currency change needs no equivalent recompute: neither stores anything
  // on a dataset, and both are read fresh by loadOrgConfig on every analytics request.
  //
  // A TIMEZONE change is different, and deliberately not retroactive. The zone decides
  // which calendar day a timestamped row was normalised onto at ingest, so applying a new
  // one would move already-analysed rows between periods and silently change every saved
  // report's figures. It takes effect for data ingested or re-cleaned after the change,
  // which is the same rule recipes follow.
  res.json({ organization: org });
}));
