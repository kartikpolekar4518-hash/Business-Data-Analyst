-- Signals: stored predictions from the optional Python model service (apps/ml).
--
-- Separate from every deterministic table on purpose. A number produced by a model is
-- never displayed beside one produced by the engine, and nothing outside the Signals
-- routes reads this table.
--
-- `contractVersion` and `modelVersion` are recorded on every row so that replacing a
-- model later cannot leave an older prediction ambiguous about what produced it. That
-- identifies the inputs; it does not enable replay, exactly as on Forecast.
--
-- No unique key. Runs accumulate, and the pages read the latest per (org, kind) — a
-- history is worth keeping when the thing being stored is an estimate whose quality
-- changes as data arrives.

-- CreateEnum
CREATE TYPE "PredictionKind" AS ENUM ('SEGMENTATION', 'CHURN', 'BASKET');

-- CreateEnum
CREATE TYPE "PredictionStatus" AS ENUM ('RUNNING', 'READY', 'FAILED');

-- CreateTable
CREATE TABLE "Prediction" (
    "id" TEXT NOT NULL,
    "kind" "PredictionKind" NOT NULL,
    "status" "PredictionStatus" NOT NULL DEFAULT 'RUNNING',
    "datasetHash" TEXT,
    "contractVersion" TEXT,
    "modelVersion" TEXT,
    "config" JSONB NOT NULL,
    -- NULL while RUNNING, on a refusal, and on failure. A refusal is a READY row whose
    -- answer is in "warnings".
    "result" JSONB,
    "metrics" JSONB,
    "warnings" TEXT[],
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "organizationId" TEXT NOT NULL,
    "datasetId" TEXT,

    CONSTRAINT "Prediction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
-- Every read is "the latest run of this kind for this org", so the tenant column leads.
CREATE INDEX "Prediction_organizationId_kind_idx" ON "Prediction"("organizationId", "kind");

-- AddForeignKey
ALTER TABLE "Prediction" ADD CONSTRAINT "Prediction_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
-- SetNull, not Cascade: deleting the file a prediction was computed from should not
-- silently erase the record that the run happened.
ALTER TABLE "Prediction" ADD CONSTRAINT "Prediction_datasetId_fkey" FOREIGN KEY ("datasetId") REFERENCES "Dataset"("id") ON DELETE SET NULL ON UPDATE CASCADE;
