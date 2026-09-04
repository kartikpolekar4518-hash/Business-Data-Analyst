-- What-if scenario inputs on a saved forecast (see engine/scenario.ts).
--
-- Until now goal and driverDelta were accepted by POST /forecasts and then discarded,
-- so two forecasts of the same metric — one plain, one run under a scenario — were
-- indistinguishable once saved. This column records the inputs that produced the saved
-- points, which is what makes a saved scenario re-identifiable.
--
-- Nullable with no backfill and no default: NULL means "no scenario", which is exactly
-- what every existing forecast was. Nothing stored moves.

-- AlterTable
ALTER TABLE "Forecast" ADD COLUMN "scenario" JSONB;
