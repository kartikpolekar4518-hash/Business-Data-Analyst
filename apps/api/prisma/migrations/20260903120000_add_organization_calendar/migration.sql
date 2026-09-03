-- Business calendar settings (see engine/calendar.ts).
--
-- No backfill: the defaults below ARE the behaviour every existing organization
-- already has. fiscalYearStartMonth=1 + periodScheme='calendar' reproduces the
-- Gregorian month bucketing that analytics.monthKey has always produced, so every
-- stored number stays valid and no dashboard moves when this migration runs.
-- weekStartDay is only read by the retail schemes; 1 = Monday.

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN "fiscalYearStartMonth" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "Organization" ADD COLUMN "periodScheme" TEXT NOT NULL DEFAULT 'calendar';
ALTER TABLE "Organization" ADD COLUMN "weekStartDay" INTEGER NOT NULL DEFAULT 1;
