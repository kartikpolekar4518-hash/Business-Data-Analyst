import { Router } from "express";
import { z } from "zod";
import { prisma } from "../prisma.js";
import { wrap, HttpError } from "../errors.js";
import { requireAuth, requireRole } from "../auth/middleware.js";
import { PACKS } from "../engine/industries.js";
import { reapplyIndustrySchema } from "./context.js";

export const organizationsRouter = Router();
organizationsRouter.use(requireAuth);

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
});

organizationsRouter.patch("/current", requireRole("ADMIN"), wrap(async (req, res) => {
  const data = patchSchema.parse(req.body);
  const before = await prisma.organization.findUnique({ where: { id: req.auth!.organizationId }, select: { industry: true } });
  const org = await prisma.organization.update({ where: { id: req.auth!.organizationId }, data });
  // On a real industry change, re-tailor the stored schema for every dataset so
  // all features (not just the dashboard) speak the new business's language.
  if (data.industry && data.industry !== before?.industry) await reapplyIndustrySchema(org.id, data.industry);
  res.json({ organization: org });
}));
