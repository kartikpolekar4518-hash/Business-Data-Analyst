import { Router } from "express";
import { z } from "zod";
import { prisma } from "../prisma.js";
import { wrap, HttpError } from "../errors.js";
import { requireAuth } from "../auth/middleware.js";
import { sendMail, isEmailEnabled } from "../mailer.js";
import { env } from "../env.js";

export const commentsRouter = Router();
commentsRouter.use(requireAuth);

// The three things that are both stored server-side and shared with the whole
// organization. The dashboard builder's layout lives in one browser's localStorage
// and the Analytics page is a live computed view, so neither can anchor a comment
// that another member would resolve to the same thing.
const ENTITY_TYPES = ["report", "dataset", "saved_view"] as const;
type EntityType = (typeof ENTITY_TYPES)[number];

const entitySchema = z.object({
  entityType: z.enum(ENTITY_TYPES),
  entityId: z.string().uuid(),
});

// Tenant isolation the same way every other module does it: findFirst on
// id + organizationId, never findUnique on the id alone. Commenting is also the
// one place an id from outside could arrive, so a 404 here is what stops a guessed
// report id from being probed for existence.
async function assertEntityInOrg(organizationId: string, entityType: EntityType, entityId: string) {
  const where = { id: entityId, organizationId };
  const found =
    entityType === "report" ? await prisma.report.findFirst({ where, select: { id: true } })
    : entityType === "dataset" ? await prisma.dataset.findFirst({ where, select: { id: true } })
    : await prisma.savedView.findFirst({ where, select: { id: true } });
  if (!found) throw new HttpError(404, "Not found");
}

interface Member { id: string; name: string; email: string }

// One lookup per request, reused to name authors, name mentions, and validate that a
// mentioned id is actually a colleague. Keeps Comment.authorId a plain scalar.
async function orgMembers(organizationId: string): Promise<Map<string, Member>> {
  const members = await prisma.organizationMember.findMany({
    where: { organizationId },
    select: { user: { select: { id: true, name: true, email: true } } },
  });
  return new Map(members.map((m) => [m.user.id, m.user]));
}

const shape = (
  c: { id: string; body: string; authorId: string; mentionedUserIds: string[]; createdAt: Date },
  members: Map<string, Member>,
) => ({
  id: c.id,
  body: c.body,
  createdAt: c.createdAt,
  authorId: c.authorId,
  // A member who has since left the organization still authored the comment; naming
  // them "Former member" keeps the thread readable rather than showing a bare uuid.
  authorName: members.get(c.authorId)?.name ?? "Former member",
  mentions: c.mentionedUserIds.map((id) => ({ id, name: members.get(id)?.name ?? "Former member" })),
});

commentsRouter.get("/", wrap(async (req, res) => {
  const orgId = req.auth!.organizationId;
  const { entityType, entityId } = entitySchema.parse(req.query);
  await assertEntityInOrg(orgId, entityType, entityId);

  const [comments, members] = await Promise.all([
    prisma.comment.findMany({
      where: { organizationId: orgId, entityType, entityId },
      orderBy: { createdAt: "asc" },
    }),
    orgMembers(orgId),
  ]);
  res.json({ comments: comments.map((c) => shape(c, members)) });
}));

const createSchema = entitySchema.extend({
  body: z.string().trim().min(1).max(2000),
  mentionedUserIds: z.array(z.string().uuid()).max(10).optional(),
});

// Any authenticated member may comment, VIEWER included: a viewer noticing a wrong
// number is exactly the person who most needs to say so. Writes elsewhere are
// ADMIN/MANAGER because they change what the numbers are; a comment does not.
commentsRouter.post("/", wrap(async (req, res) => {
  const auth = req.auth!;
  const { entityType, entityId, body, mentionedUserIds } = createSchema.parse(req.body ?? {});
  await assertEntityInOrg(auth.organizationId, entityType, entityId);

  const members = await orgMembers(auth.organizationId);
  const mentioned = [...new Set(mentionedUserIds ?? [])];
  // Refuse rather than silently drop: a mention of someone outside the organization
  // is either a client bug or a probe for whether a user id exists, and neither
  // should quietly succeed.
  const stranger = mentioned.find((id) => !members.has(id));
  if (stranger) throw new HttpError(400, "You can only mention people in your organization");

  const comment = await prisma.comment.create({
    data: {
      organizationId: auth.organizationId,
      entityType, entityId, body,
      mentionedUserIds: mentioned,
      authorId: auth.userId,
    },
  });

  await prisma.activityLog.create({
    data: {
      organizationId: auth.organizationId, action: "comment.posted",
      detail: body.slice(0, 140), actorId: auth.userId, entityType, entityId,
    },
  });

  await notifyMentions(comment.id, mentioned, members, auth.userId, body, entityType);
  res.status(201).json({ comment: shape(comment, members) });
}));

// Email is the only mention notification, and it is best effort. The Alert model is
// the organization's "your business changed" feed (revenue drop, forecast risk);
// putting per-person pings in it would make two different things share one unread
// count. With no SMTP configured the mention still shows in the thread — the same
// optional-email posture scheduled reports already take.
async function notifyMentions(
  commentId: string, mentioned: string[], members: Map<string, Member>,
  authorId: string, body: string, entityType: EntityType,
) {
  const recipients = mentioned.filter((id) => id !== authorId).map((id) => members.get(id)!.email);
  if (!recipients.length || !isEmailEnabled()) return;
  const author = members.get(authorId)?.name ?? "Someone";
  const where = entityType.replace("_", " ");
  try {
    await sendMail({
      to: recipients,
      subject: `${author} mentioned you on a ${where}`,
      text: `${author} mentioned you in a comment on a ${where}:\n\n${body}\n\nOpen ${env.appUrls[0]} to reply.`,
    });
  } catch (e) {
    // A comment that saved must not fail because SMTP did.
    console.error(`[comments] mention email failed for ${commentId}:`, (e as Error)?.message ?? e);
  }
}

// The author or an admin. A manager can change what the dashboard says but not
// delete someone else's remark about it — deleting another person's words is a
// moderation act, which is the admin's.
commentsRouter.delete("/:id", wrap(async (req, res) => {
  const auth = req.auth!;
  const comment = await prisma.comment.findFirst({ where: { id: req.params.id, organizationId: auth.organizationId } });
  if (!comment) throw new HttpError(404, "Comment not found");
  if (comment.authorId !== auth.userId && auth.role !== "ADMIN") {
    throw new HttpError(403, "You can only delete your own comments");
  }

  await prisma.comment.delete({ where: { id: comment.id } });
  await prisma.activityLog.create({
    data: {
      organizationId: auth.organizationId, action: "comment.deleted",
      detail: comment.body.slice(0, 140), actorId: auth.userId,
      entityType: comment.entityType, entityId: comment.entityId,
    },
  });
  res.json({ ok: true });
}));

export const activityRouter = Router();
activityRouter.use(requireAuth);

// The activity trail's first reader. Entries have been written at ~15 call sites
// since the model was introduced and nothing has ever been able to show them.
// Any role can read: knowing what the team did is not a privileged action, and every
// entry is already scoped to the organization.
const feedSchema = z.object({
  entityType: z.enum(ENTITY_TYPES).optional(),
  entityId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

activityRouter.get("/", wrap(async (req, res) => {
  const orgId = req.auth!.organizationId;
  const { entityType, entityId, limit } = feedSchema.parse(req.query);
  // Both or neither: an entityId without its type could match a row of another kind.
  if (Boolean(entityType) !== Boolean(entityId)) throw new HttpError(400, "Pass entityType and entityId together");
  if (entityType && entityId) await assertEntityInOrg(orgId, entityType, entityId);

  const [entries, members] = await Promise.all([
    prisma.activityLog.findMany({
      where: { organizationId: orgId, ...(entityType ? { entityType, entityId } : {}) },
      orderBy: { createdAt: "desc" },
      take: limit ?? 50,
    }),
    orgMembers(orgId),
  ]);

  res.json({
    activity: entries.map((e) => ({
      id: e.id, action: e.action, detail: e.detail, createdAt: e.createdAt,
      entityType: e.entityType, entityId: e.entityId,
      actorName: e.actorId ? members.get(e.actorId)?.name ?? "Former member" : null,
    })),
  });
}));
