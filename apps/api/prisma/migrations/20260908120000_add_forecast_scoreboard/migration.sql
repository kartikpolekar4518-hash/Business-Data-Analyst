-- The bake-off scoreboard on a saved forecast (see engine/forecast.ts).
--
-- The engine now fits eleven candidate methods, scores each on rolling origins of the
-- org's own history, and picks a winner. Until now that comparison was computed and
-- thrown away, so a saved forecast recorded WHICH method won but nothing about what it
-- beat or by how much. This column records the whole comparison alongside the points it
-- produced.
--
-- Stored rather than re-derived on read, deliberately: a scoreboard recomputed against a
-- dataset that has since changed would sit next to `points` computed from the old one and
-- contradict them. Same stance as datasetHash/engineVersion — it identifies the inputs,
-- it does not replay them.
--
-- Nullable with no backfill and no default: NULL means "saved before the bake-off
-- existed", which cannot be reconstructed because the engine that would score it has
-- changed. Nothing stored moves, and no existing forecast's points or engineVersion are
-- touched — 0.9.0 stamps new forecasts only.

-- AlterTable
ALTER TABLE "Forecast" ADD COLUMN "scoreboard" JSONB;
