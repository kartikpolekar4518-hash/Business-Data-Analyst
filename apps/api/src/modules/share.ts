import { Router } from "express";
import rateLimit from "express-rate-limit";
import { prisma } from "../prisma.js";
import { wrap, HttpError } from "../errors.js";
import { renderReportPdf } from "./reports.js";

export const shareRouter = Router();

// Public capability links: holding the token grants read/PDF access with no
// login. No requireAuth here. Rate-limited to blunt token guessing (tokens are
// 192-bit, so this is defense in depth) and to bound public PDF rendering.
shareRouter.use(rateLimit({ windowMs: 60_000, limit: 60, standardHeaders: true, legacyHeaders: false }));

// A share grants access iff it is neither revoked nor past its expiry. Pure +
// unit-tested. expiresAt null = never expires.
export function isShareLive(share: { revokedAt: Date | null; expiresAt: Date | null }, now = new Date()): boolean {
  if (share.revokedAt) return false;
  if (share.expiresAt && share.expiresAt <= now) return false;
  return true;
}

// Resolve a live share to its report + owning org name, or throw a generic 404
// that never distinguishes "no such token" from "expired/revoked" (no existence leak).
async function resolveShare(token: string) {
  const share = await prisma.reportShare.findUnique({
    where: { token },
    include: { report: { include: { organization: { select: { name: true } } } } },
  });
  if (!share || !isShareLive(share)) throw new HttpError(404, "This link is invalid or has expired");
  return share;
}

shareRouter.get("/:token", wrap(async (req, res) => {
  const share = await resolveShare(req.params.token);
  // Minimal public payload: the report content + org name only. Never the org id,
  // dataset rows, other reports, or any user info.
  res.json({
    report: { title: share.report.title, createdAt: share.report.createdAt, content: share.report.content },
    org: { name: share.report.organization.name },
  });
}));

shareRouter.get("/:token/pdf", wrap(async (req, res) => {
  const share = await resolveShare(req.params.token);
  const pdf = await renderReportPdf(share.report);
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${share.report.title.replace(/[^\w -]/g, "")}.pdf"`);
  res.send(pdf);
}));
