import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "../prisma.js";
import { wrap, HttpError } from "../errors.js";
import { requireAuth, requireRole } from "../auth/middleware.js";
import { env } from "../env.js";

export const settingsRouter = Router();
settingsRouter.use(requireAuth);

settingsRouter.get("/", wrap(async (req, res) => {
  const org = await prisma.organization.findUnique({ where: { id: req.auth!.organizationId } });
  const apiKeys = await prisma.apiKey.findMany({
    where: { organizationId: req.auth!.organizationId },
    select: { id: true, name: true, provider: true, lastFour: true, createdAt: true }, // keyHash never returned
    orderBy: { createdAt: "desc" },
  });
  res.json({ organization: org, apiKeys, aiEnabled: env.aiEnabled, role: req.auth!.role });
}));

const patchSchema = z.object({ organizationName: z.string().min(1).optional() });

settingsRouter.patch("/", requireRole("ADMIN"), wrap(async (req, res) => {
  const { organizationName } = patchSchema.parse(req.body);
  if (organizationName) await prisma.organization.update({ where: { id: req.auth!.organizationId }, data: { name: organizationName } });
  res.json({ ok: true });
}));

// --- API key management (stored hashed, never returned) ---
const keySchema = z.object({ name: z.string().min(1), provider: z.string().default("openai"), key: z.string().min(8) });

settingsRouter.post("/api-keys", requireRole("ADMIN"), wrap(async (req, res) => {
  const { name, provider, key } = keySchema.parse(req.body);
  const created = await prisma.apiKey.create({
    data: {
      organizationId: req.auth!.organizationId,
      name, provider,
      keyHash: await bcrypt.hash(key, 10),
      lastFour: key.slice(-4),
    },
    select: { id: true, name: true, provider: true, lastFour: true, createdAt: true },
  });
  res.status(201).json({ apiKey: created });
}));

settingsRouter.delete("/api-keys/:id", requireRole("ADMIN"), wrap(async (req, res) => {
  const existing = await prisma.apiKey.findFirst({ where: { id: req.params.id, organizationId: req.auth!.organizationId } });
  if (!existing) throw new HttpError(404, "API key not found");
  await prisma.apiKey.delete({ where: { id: existing.id } });
  res.json({ ok: true });
}));
