-- Team collaboration: notes on the things an organization already looks at together,
-- and the first entity-scoped reading of the activity trail.
--
-- Comment is deliberately flat rather than threaded — a small team discussing one
-- number needs a conversation, not a tree — and polymorphic over the three things
-- that are both stored server-side and shared org-wide: a report, a dataset, and a
-- saved view. The dashboard builder's layout is per-user localStorage and the
-- Analytics page is a live computed view, so neither is an anchor a comment could
-- reliably point at.
--
-- `authorId` and `mentionedUserIds` are plain scalars, not foreign keys, matching the
-- choice ActivityLog.actorId already makes: removing a user from the organization
-- must not cascade away the discussion they took part in.

-- CreateTable
CREATE TABLE "Comment" (
    "id" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "mentionedUserIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "authorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "organizationId" TEXT NOT NULL,

    CONSTRAINT "Comment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: every read is "the comments on this one thing, in this org".
CREATE INDEX "Comment_organizationId_entityType_entityId_idx" ON "Comment"("organizationId", "entityType", "entityId");

-- AddForeignKey
ALTER TABLE "Comment" ADD CONSTRAINT "Comment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ActivityLog gains an optional subject so the same trail can answer both "what has
-- this team been doing?" and "what happened to this report?". Nullable with no
-- backfill: an entry written before this migration is org-wide by nature (a user
-- invite, a plan change), and NULL is exactly what it already was.
ALTER TABLE "ActivityLog" ADD COLUMN "entityType" TEXT;
ALTER TABLE "ActivityLog" ADD COLUMN "entityId" TEXT;

-- CreateIndex
CREATE INDEX "ActivityLog_organizationId_entityType_entityId_idx" ON "ActivityLog"("organizationId", "entityType", "entityId");
