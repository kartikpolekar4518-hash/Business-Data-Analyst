-- AlterTable: session-invalidation counter. Bumped on password reset so any
-- JWT issued before the reset no longer verifies. Existing users start at 0,
-- matching the default embedded in already-issued tokens (treated as 0).
ALTER TABLE "User" ADD COLUMN "tokenVersion" INTEGER NOT NULL DEFAULT 0;
