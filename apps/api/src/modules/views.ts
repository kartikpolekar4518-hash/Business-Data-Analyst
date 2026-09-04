import { Router } from "express";
import { z } from "zod";
import { prisma } from "../prisma.js";
import { wrap, HttpError } from "../errors.js";
import { requireAuth, requireRole } from "../auth/middleware.js";

export const viewsRouter = Router();
viewsRouter.use(requireAuth);

// `query` is the Analytics page's URL query string. It is stored and replayed verbatim
// rather than parsed into filter dimensions here — the page already owns that encoding,
// and a sixth place encoding the dimension list is the thing to avoid (see CLAUDE.md).
// Unknown or stale keys are therefore harmless: the page ignores what it does not read.
const viewSchema = z.object({
  name: z.string().min(1).max(80),
  query: z.string().max(2000),
});

viewsRouter.get("/", wrap(async (req, res) => {
  const views = await prisma.savedView.findMany({
    where: { organizationId: req.auth!.organizationId },
    orderBy: { name: "asc" },
  });
  res.json({ views });
}));

// Saving over an existing name replaces that view rather than creating a second one
// with the same label — the picker lists views by name, so two would be unpickable.
// 201 for a new view, 200 for a replacement, so a caller can tell which happened.
viewsRouter.post("/", requireRole("ADMIN", "MANAGER"), wrap(async (req, res) => {
  const body = viewSchema.parse(req.body ?? {});
  const organizationId = req.auth!.organizationId;
  const existing = await prisma.savedView.findFirst({ where: { organizationId, name: body.name } });
  const view = existing
    ? await prisma.savedView.update({ where: { id: existing.id }, data: { query: body.query } })
    : await prisma.savedView.create({ data: { ...body, organizationId } });
  res.status(existing ? 200 : 201).json({ view });
}));

viewsRouter.patch("/:id", requireRole("ADMIN", "MANAGER"), wrap(async (req, res) => {
  const body = viewSchema.partial().parse(req.body ?? {});
  const existing = await prisma.savedView.findFirst({ where: { id: req.params.id, organizationId: req.auth!.organizationId } });
  if (!existing) throw new HttpError(404, "Saved view not found");
  if (body.name && body.name !== existing.name) {
    const clash = await prisma.savedView.findFirst({ where: { organizationId: existing.organizationId, name: body.name } });
    if (clash) throw new HttpError(409, `A saved view named '${body.name}' already exists.`);
  }
  const view = await prisma.savedView.update({ where: { id: existing.id }, data: body });
  res.json({ view });
}));

viewsRouter.delete("/:id", requireRole("ADMIN", "MANAGER"), wrap(async (req, res) => {
  const existing = await prisma.savedView.findFirst({ where: { id: req.params.id, organizationId: req.auth!.organizationId } });
  if (!existing) throw new HttpError(404, "Saved view not found");
  await prisma.savedView.delete({ where: { id: existing.id } });
  res.status(204).end();
}));
