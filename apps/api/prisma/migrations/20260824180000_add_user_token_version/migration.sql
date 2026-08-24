-- Token revocation: incremented on password reset / logout-all so previously
-- issued JWTs are rejected by requireAuth (see auth/middleware.ts).
-- AlterTable
ALTER TABLE "User" ADD COLUMN "tokenVersion" INTEGER NOT NULL DEFAULT 0;
