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
  // Bumped on password reset / logout-all to invalidate previously issued tokens.
  tokenVersion: number;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request { auth?: AuthContext; }
  }
}

export function signToken(payload: Omit<AuthContext, "tokenVersion"> & { tokenVersion?: number }): string {
  const claims: AuthContext = { ...payload, tokenVersion: payload.tokenVersion ?? 0 };
  return jwt.sign(claims, env.jwtSecret, { expiresIn: env.jwtExpiresIn, algorithm: "HS256" } as jwt.SignOptions);
}

// Verifies the JWT and confirms the membership still exists (org isolation source of truth).
export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  try {
    const auth = req.headers.authorization;
    const token = auth?.startsWith("Bearer ") ? auth.slice(7) : null;
    if (!token) throw new HttpError(401, "Not authenticated");
    const decoded = jwt.verify(token, env.jwtSecret, { algorithms: ["HS256"] }) as AuthContext;
    const member = await prisma.organizationMember.findFirst({
      where: { userId: decoded.userId, organizationId: decoded.organizationId },
      include: { user: { select: { tokenVersion: true } } },
    });
    if (!member) throw new HttpError(401, "Membership not found");
    // Reject tokens issued before the last password reset / logout-all.
    if ((decoded.tokenVersion ?? 0) !== member.user.tokenVersion) throw new HttpError(401, "Token has been revoked");
    req.auth = { userId: member.userId, organizationId: member.organizationId, role: member.role, tokenVersion: member.user.tokenVersion };
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
