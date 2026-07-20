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

// Invite = create a brand-new user in this org. No email provider in the MVP,
// so an initial password is set directly by the admin. We deliberately do NOT
// attach a pre-existing account: without a consent/accept-invite flow, silently
// pulling someone's account into another org would breach tenant isolation.
usersRouter.post("/invite", requireRole("ADMIN"), wrap(async (req, res) => {
  const auth = req.auth!;
  const { name, email, password, role } = inviteSchema.parse(req.body);
  const existing = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
  if (existing) throw new HttpError(409, "A user with this email already exists");
  const user = await prisma.user.create({ data: { name, email: email.toLowerCase(), passwordHash: await bcrypt.hash(password, 10) } });
  const member = await prisma.organizationMember.create({ data: { userId: user.id, organizationId: auth.organizationId, role } });
  await prisma.activityLog.create({ data: { organizationId: auth.organizationId, action: "user.invited", detail: email, actorId: auth.userId } });
  res.status(201).json({ user: { membershipId: member.id, role: member.role, id: user.id, name: user.name, email: user.email } });
}));

const roleSchema = z.object({ role: z.enum(["ADMIN", "MANAGER", "VIEWER"]) });

usersRouter.patch("/:id/role", requireRole("ADMIN"), wrap(async (req, res) => {
  const { role } = roleSchema.parse(req.body);
  const auth = req.auth!;
  const member = await prisma.organizationMember.findFirst({ where: { id: req.params.id, organizationId: auth.organizationId }, include: { user: true } });
  if (!member) throw new HttpError(404, "Member not found");
  
  const updated = await prisma.$transaction(async (tx) => {
    if (role !== "ADMIN") {
      const admins = await tx.organizationMember.count({ where: { organizationId: auth.organizationId, role: "ADMIN" } });
      if (admins <= 1) throw new HttpError(400, "This is the last admin — promote another member first");
    }
    const result = await tx.organizationMember.update({ where: { id: member.id }, data: { role } });
    await tx.activityLog.create({ data: { organizationId: auth.organizationId, action: "user.role-changed", detail: `${member.user.email} role changed to ${role}`, actorId: auth.userId } });
    return result;
  });
  
  res.json({ membershipId: updated.id, role: updated.role });
}));

usersRouter.delete("/:id", requireRole("ADMIN"), wrap(async (req, res) => {
  const auth = req.auth!;
  const member = await prisma.organizationMember.findFirst({ where: { id: req.params.id, organizationId: auth.organizationId }, include: { user: true } });
  if (!member) throw new HttpError(404, "Member not found");
  if (member.userId === auth.userId) throw new HttpError(400, "You cannot remove yourself");
  
  await prisma.$transaction(async (tx) => {
    if (member.role === "ADMIN") {
      const admins = await tx.organizationMember.count({ where: { organizationId: auth.organizationId, role: "ADMIN" } });
      if (admins <= 1) throw new HttpError(400, "This is the last admin — promote another member first");
    }
    await tx.organizationMember.delete({ where: { id: member.id } });
    await tx.activityLog.create({ data: { organizationId: auth.organizationId, action: "user.removed", detail: `${member.user.email} removed from organization`, actorId: auth.userId } });
  });
  
  res.json({ ok: true });
}));
