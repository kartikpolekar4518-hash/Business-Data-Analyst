-- Production accuracy: a saved forecast's predictions graded against what actually
-- happened (see engine/accuracy.ts, modules/forecastAccuracy.ts).
--
-- A separate table rather than columns on Forecast, because the two have different
-- lifetimes. A Forecast is an immutable snapshot of what was projected. A score appears
-- only once its period is complete, changes if the actual is later corrected by a
-- re-upload, and has to aggregate across many forecasts to answer "how accurate have we
-- been" — which is a query, not a field.
--
-- This is NOT the same number as the scoreboard's MAPE. The scoreboard measures how a
-- method did on held-out slices of history during selection; these rows measure what was
-- predicted about the future and then observed. They are never mixed.
--
-- No backfill of historical forecasts. Scores derive on the next data change, the same
-- way alerts do; backfilling now would grade old forecasts against actuals read from a
-- dataset that has since moved, and record that as production accuracy.
--
-- The unique key is the idempotency mechanism: scoring upserts on (forecastId, period),
-- so re-running it converges instead of accumulating, and a corrected actual updates the
-- row in place rather than adding a second verdict on the same period.

-- CreateTable
CREATE TABLE "ForecastScore" (
    "id" TEXT NOT NULL,
    "forecastId" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "horizonStep" INTEGER NOT NULL,
    "predicted" DOUBLE PRECISION NOT NULL,
    "lower" DOUBLE PRECISION NOT NULL,
    "upper" DOUBLE PRECISION NOT NULL,
    "actual" DOUBLE PRECISION NOT NULL,
    "absError" DOUBLE PRECISION NOT NULL,
    -- NULL when the actual was 0: a percentage error does not exist there, and storing 0
    -- or a sentinel would quietly drag the average accuracy toward it.
    "pctError" DOUBLE PRECISION,
    "withinBand" BOOLEAN NOT NULL,
    "stale" BOOLEAN NOT NULL DEFAULT false,
    "datasetHash" TEXT,
    "engineVersion" TEXT,
    "scoredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "organizationId" TEXT NOT NULL,

    CONSTRAINT "ForecastScore_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
-- One verdict per period per forecast. Rescoring upserts against this.
CREATE UNIQUE INDEX "ForecastScore_forecastId_period_key" ON "ForecastScore"("forecastId", "period");

-- CreateIndex
-- The accuracy page reads one org's scores newest-first; the tenant column leads so the
-- org filter is served by the index rather than applied after it.
CREATE INDEX "ForecastScore_organizationId_scoredAt_idx" ON "ForecastScore"("organizationId", "scoredAt");

-- AddForeignKey
ALTER TABLE "ForecastScore" ADD CONSTRAINT "ForecastScore_forecastId_fkey" FOREIGN KEY ("forecastId") REFERENCES "Forecast"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ForecastScore" ADD CONSTRAINT "ForecastScore_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
