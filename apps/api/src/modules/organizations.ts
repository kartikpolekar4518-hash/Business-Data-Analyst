import { Router } from "express";
import { z } from "zod";
import { prisma } from "../prisma.js";
import { wrap, HttpError } from "../errors.js";
import { requireAuth, requireRole } from "../auth/middleware.js";

export const organizationsRouter = Router();
organizationsRouter.use(requireAuth);

organizationsRouter.get("/current", wrap(async (req, res) => {
  const org = await prisma.organization.findUnique({ where: { id: req.auth!.organizationId } });
  if (!org) throw new HttpError(404, "Organization not found");
  const memberCount = await prisma.organizationMember.count({ where: { organizationId: org.id } });
  res.json({ organization: { ...org, memberCount } });
}));

const patchSchema = z.object({ name: z.string().min(1) });

organizationsRouter.patch("/current", requireRole("ADMIN"), wrap(async (req, res) => {
  const { name } = patchSchema.parse(req.body);
  const org = await prisma.organization.update({ where: { id: req.auth!.organizationId }, data: { name } });
  res.json({ organization: org });
}));
