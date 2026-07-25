import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { env } from "../env.js";
import { prisma } from "../prisma.js";
import { HttpError } from "../errors.js";
import type { Role } from "@prisma/client";

export interface AuthContext {
  userId: string;
  organizationId: string;
  role: Role;
}

// Signed into the JWT (superset of AuthContext) — tokenVersion lets a password
// reset invalidate every token issued before it.
interface TokenPayload extends AuthContext {
  tokenVersion: number;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request { auth?: AuthContext; }
  }
}

export function signToken(payload: AuthContext & { tokenVersion: number }): string {
  return jwt.sign(payload, env.jwtSecret, { expiresIn: env.jwtExpiresIn } as jwt.SignOptions);
}

// Verifies the JWT, confirms the membership still exists (org isolation source
// of truth), and rejects tokens minted before the user's last password reset.
export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  try {
    const auth = req.headers.authorization;
    const token = auth?.startsWith("Bearer ") ? auth.slice(7) : null;
    if (!token) throw new HttpError(401, "Not authenticated");
    const decoded = jwt.verify(token, env.jwtSecret) as TokenPayload;
    const member = await prisma.organizationMember.findFirst({
      where: { userId: decoded.userId, organizationId: decoded.organizationId },
      include: { user: { select: { tokenVersion: true } } },
    });
    if (!member) throw new HttpError(401, "Membership not found");
    if ((decoded.tokenVersion ?? 0) !== member.user.tokenVersion) throw new HttpError(401, "Session expired — please sign in again");
    req.auth = { userId: member.userId, organizationId: member.organizationId, role: member.role };
    next();
  } catch (e) {
    if (e instanceof HttpError) return next(e);
    next(new HttpError(401, "Invalid or expired token"));
  }
}

// Role gate. requireRole("ADMIN") or requireRole("ADMIN","MANAGER").
export function requireRole(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.auth) return next(new HttpError(401, "Not authenticated"));
    if (!roles.includes(req.auth.role)) return next(new HttpError(403, "Insufficient permissions"));
    next();
  };
}
