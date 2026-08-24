import { Router } from "express";
import bcrypt from "bcryptjs";
import rateLimit from "express-rate-limit";
import { randomBytes, createHash } from "node:crypto";
import { z } from "zod";
import { prisma } from "../prisma.js";
import { env } from "../env.js";
import { wrap, HttpError } from "../errors.js";
import { signToken, requireAuth } from "./middleware.js";
import { PACKS } from "../engine/industries.js";

export const authRouter = Router();

// Precomputed hash compared against when an email doesn't exist, so login takes
// the same time whether or not the account is real (no user-enumeration by timing).
const DUMMY_PASSWORD_HASH = bcrypt.hashSync("password-does-not-exist", 10);

// Reset tokens are stored hashed: a DB leak then yields no usable token.
const hashResetToken = (raw: string) => createHash("sha256").update(raw).digest("hex");

// Throttle only the credential surface (brute force, token guessing, reset spam).
// Deliberately NOT applied to /me, which fires on every page load.
const credentialLimiter = rateLimit({ windowMs: 60_000, limit: 20, standardHeaders: true, legacyHeaders: false });
authRouter.use(["/login", "/signup", "/forgot-password", "/reset-password"], credentialLimiter);

const signupSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(8),
  organizationName: z.string().min(1),
  industry: z.enum(Object.keys(PACKS) as [string, ...string[]]).optional(),
});

authRouter.post("/signup", wrap(async (req, res) => {
  const { name, email, password, organizationName, industry } = signupSchema.parse(req.body);
  const existing = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
  if (existing) throw new HttpError(409, "An account with this email already exists");

  const passwordHash = await bcrypt.hash(password, 10);
  const result = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({ data: { name, email: email.toLowerCase(), passwordHash } });
    const org = await tx.organization.create({ data: { name: organizationName, ...(industry ? { industry } : {}) } });
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
  // Always run a bcrypt compare (dummy hash when the user is missing) to keep the
  // response time constant and avoid leaking which emails have accounts.
  const passwordOk = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_PASSWORD_HASH);
  if (!user || !passwordOk) {
    throw new HttpError(401, "Invalid email or password");
  }
  const membership = user.memberships[0];
  if (!membership) throw new HttpError(403, "No organization membership");
  const token = signToken({ userId: user.id, organizationId: membership.organizationId, role: membership.role, tokenVersion: user.tokenVersion });
  res.json({ token, user: publicUser(user), organization: membership.organization, role: membership.role });
}));

authRouter.post("/logout", (_req, res) => {
  // Stateless JWT: client discards the token. Endpoint exists for symmetry/audit.
  res.json({ ok: true });
});

// Revoke every token for the current user (e.g. after a suspected compromise).
// Bumps tokenVersion so all previously issued JWTs fail requireAuth immediately.
authRouter.post("/logout-all", requireAuth, wrap(async (req, res) => {
  await prisma.user.update({ where: { id: req.auth!.userId }, data: { tokenVersion: { increment: 1 } } });
  res.json({ ok: true });
}));

const forgotSchema = z.object({ email: z.string().email() });

authRouter.post("/forgot-password", wrap(async (req, res) => {
  const { email } = forgotSchema.parse(req.body);
  const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
  let devToken: string | undefined;
  if (user) {
    // 256-bit URL-safe token. Only its SHA-256 is stored, so a DB leak yields no
    // usable reset token; the raw token travels only to the user (email / dev echo).
    const raw = randomBytes(32).toString("base64url");
    await prisma.passwordResetToken.create({
      data: { token: hashResetToken(raw), userId: user.id, expiresAt: new Date(Date.now() + 60 * 60 * 1000) },
    });
    // No email provider in the MVP — return the token in dev so the flow is testable.
    // Never expose it in production: that would let anyone reset any account by email.
    if (!env.isProd) devToken = raw;
  }
  // Always 200 to avoid leaking which emails exist.
  res.json({ ok: true, message: "If that email exists, a reset link has been created.", devToken });
}));

const resetSchema = z.object({ token: z.string(), password: z.string().min(8) });

authRouter.post("/reset-password", wrap(async (req, res) => {
  const { token, password } = resetSchema.parse(req.body);
  const record = await prisma.passwordResetToken.findUnique({ where: { token: hashResetToken(token) } });
  if (!record || record.usedAt || record.expiresAt < new Date()) {
    throw new HttpError(400, "Invalid or expired reset token");
  }
  const passwordHash = await bcrypt.hash(password, 10);
  await prisma.$transaction([
    // Bump tokenVersion so any JWT issued before this reset is rejected by requireAuth.
    prisma.user.update({ where: { id: record.userId }, data: { passwordHash, tokenVersion: { increment: 1 } } }),
    prisma.passwordResetToken.update({ where: { id: record.id }, data: { usedAt: new Date() } }),
  ]);
  res.json({ ok: true });
}));

authRouter.get("/me", requireAuth, wrap(async (req, res) => {
  const auth = req.auth!;
  const [user, org] = await Promise.all([
    prisma.user.findUnique({ where: { id: auth.userId } }),
    prisma.organization.findUnique({ where: { id: auth.organizationId } }),
  ]);
  res.json({ user: user && publicUser(user), organization: org, role: auth.role });
}));

function publicUser(u: { id: string; name: string; email: string }) {
  return { id: u.id, name: u.name, email: u.email };
}
