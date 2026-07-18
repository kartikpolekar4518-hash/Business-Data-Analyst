import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "../prisma.js";
import { wrap, HttpError } from "../errors.js";
import { requireAuth, requireRole } from "../auth/middleware.js";

export const usersRouter = Router();
usersRouter.use(requireAuth);

usersRouter.get("/", wrap(async (req, res) => {
  const members = await prisma.organizationMember.findMany({
    where: { organizationId: req.auth!.organizationId },
    include: { user: { select: { id: true, name: true, email: true, createdAt: true } } },
    orderBy: { createdAt: "asc" },
  });
  res.json({ users: members.map((m) => ({ membershipId: m.id, role: m.role, ...m.user })) });
}));

const inviteSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(8),
  role: z.enum(["ADMIN", "MANAGER", "VIEWER"]).default("VIEWER"),
});

// Invite = create-or-attach a user to this org. No email provider in the MVP,
// so an initial password is set directly by the admin.
usersRouter.post("/invite", requireRole("ADMIN"), wrap(async (req, res) => {
  const auth = req.auth!;
  const { name, email, password, role } = inviteSchema.parse(req.body);
  let user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
  if (!user) {
    user = await prisma.user.create({ data: { name, email: email.toLowerCase(), passwordHash: await bcrypt.hash(password, 10) } });
  }
  const existing = await prisma.organizationMember.findFirst({ where: { userId: user.id, organizationId: auth.organizationId } });
  if (existing) throw new HttpError(409, "User is already a member of this organization");
  const member = await prisma.organizationMember.create({ data: { userId: user.id, organizationId: auth.organizationId, role } });
  await prisma.activityLog.create({ data: { organizationId: auth.organizationId, action: "user.invited", detail: email, actorId: auth.userId } });
  res.status(201).json({ user: { membershipId: member.id, role: member.role, id: user.id, name: user.name, email: user.email } });
}));

const roleSchema = z.object({ role: z.enum(["ADMIN", "MANAGER", "VIEWER"]) });

usersRouter.patch("/:id/role", requireRole("ADMIN"), wrap(async (req, res) => {
  const { role } = roleSchema.parse(req.body);
  const member = await prisma.organizationMember.findFirst({ where: { id: req.params.id, organizationId: req.auth!.organizationId } });
  if (!member) throw new HttpError(404, "Member not found");
  const updated = await prisma.organizationMember.update({ where: { id: member.id }, data: { role } });
  res.json({ membershipId: updated.id, role: updated.role });
}));

usersRouter.delete("/:id", requireRole("ADMIN"), wrap(async (req, res) => {
  const member = await prisma.organizationMember.findFirst({ where: { id: req.params.id, organizationId: req.auth!.organizationId } });
  if (!member) throw new HttpError(404, "Member not found");
  if (member.userId === req.auth!.userId) throw new HttpError(400, "You cannot remove yourself");
  await prisma.organizationMember.delete({ where: { id: member.id } });
  res.json({ ok: true });
}));
