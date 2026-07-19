import { Router } from "express";
import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { prisma } from "../prisma.js";
import { env } from "../env.js";
import { wrap, HttpError } from "../errors.js";
import { signToken, requireAuth } from "./middleware.js";

export const authRouter = Router();

const signupSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(8),
  organizationName: z.string().min(1),
});

authRouter.post("/signup", wrap(async (req, res) => {
  const { name, email, password, organizationName } = signupSchema.parse(req.body);
  const existing = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
  if (existing) throw new HttpError(409, "An account with this email already exists");

  const passwordHash = await bcrypt.hash(password, 10);
  const result = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({ data: { name, email: email.toLowerCase(), passwordHash } });
    const org = await tx.organization.create({ data: { name: organizationName } });
    await tx.organizationMember.create({ data: { userId: user.id, organizationId: org.id, role: "ADMIN" } });
    await tx.activityLog.create({ data: { organizationId: org.id, action: "org.created", detail: organizationName, actorId: user.id } });
    return { user, org };
  });

  const token = signToken({ userId: result.user.id, organizationId: result.org.id, role: "ADMIN" });
  res.status(201).json({ token, user: publicUser(result.user), organization: result.org, role: "ADMIN" });
}));

const loginSchema = z.object({ email: z.string().email(), password: z.string() });

authRouter.post("/login", wrap(async (req, res) => {
  const { email, password } = loginSchema.parse(req.body);
  const user = await prisma.user.findUnique({
    where: { email: email.toLowerCase() },
    include: { memberships: { include: { organization: true }, orderBy: { createdAt: "asc" } } },
  });
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    throw new HttpError(401, "Invalid email or password");
  }
  const membership = user.memberships[0];
  if (!membership) throw new HttpError(403, "No organization membership");
  const token = signToken({ userId: user.id, organizationId: membership.organizationId, role: membership.role });
  res.json({ token, user: publicUser(user), organization: membership.organization, role: membership.role });
}));

authRouter.post("/logout", (_req, res) => {
  // Stateless JWT: client discards the token. Endpoint exists for symmetry/audit.
  res.json({ ok: true });
});

const forgotSchema = z.object({ email: z.string().email() });

authRouter.post("/forgot-password", wrap(async (req, res) => {
  const { email } = forgotSchema.parse(req.body);
  const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
  let devToken: string | undefined;
  if (user) {
    const token = randomUUID();
    await prisma.passwordResetToken.create({
      data: { token, userId: user.id, expiresAt: new Date(Date.now() + 60 * 60 * 1000) },
    });
    // No email provider in the MVP — return the token in dev so the flow is testable.
    // Never expose it in production: that would let anyone reset any account by email.
    if (!env.isProd) devToken = token;
  }
  // Always 200 to avoid leaking which emails exist.
  res.json({ ok: true, message: "If that email exists, a reset link has been created.", devToken });
}));

const resetSchema = z.object({ token: z.string(), password: z.string().min(8) });

authRouter.post("/reset-password", wrap(async (req, res) => {
  const { token, password } = resetSchema.parse(req.body);
  const record = await prisma.passwordResetToken.findUnique({ where: { token } });
  if (!record || record.usedAt || record.expiresAt < new Date()) {
    throw new HttpError(400, "Invalid or expired reset token");
  }
  const passwordHash = await bcrypt.hash(password, 10);
  await prisma.$transaction([
    prisma.user.update({ where: { id: record.userId }, data: { passwordHash } }),
    prisma.passwordResetToken.update({ where: { id: record.id }, data: { usedAt: new Date() } }),
  ]);
  res.json({ ok: true });
}));

authRouter.get("/me", requireAuth, wrap(async (req, res) => {
  const auth = req.auth!;
  const user = await prisma.user.findUnique({ where: { id: auth.userId } });
  const org = await prisma.organization.findUnique({ where: { id: auth.organizationId } });
  res.json({ user: user && publicUser(user), organization: org, role: auth.role });
}));

function publicUser(u: { id: string; name: string; email: string }) {
  return { id: u.id, name: u.name, email: u.email };
}
