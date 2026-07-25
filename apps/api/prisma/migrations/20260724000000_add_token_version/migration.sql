-- Add token versioning so a password reset invalidates all previously issued JWTs.
ALTER TABLE "User" ADD COLUMN "tokenVersion" INTEGER NOT NULL DEFAULT 0;
