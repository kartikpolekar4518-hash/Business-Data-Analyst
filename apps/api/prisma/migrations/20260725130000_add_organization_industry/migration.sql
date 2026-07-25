-- AlterTable: new column defaults to 'generic' for brand-new orgs...
ALTER TABLE "Organization" ADD COLUMN "industry" TEXT NOT NULL DEFAULT 'generic';

-- ...but every org that already existed rendered the retail dashboard before this
-- feature, so backfill them to 'retail' to preserve their current experience.
-- (New signups set their own industry explicitly.)
UPDATE "Organization" SET "industry" = 'retail';
