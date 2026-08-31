-- Dataset identity + cleaning provenance. All nullable: pre-existing rows keep NULL
-- rather than being backfilled with fabricated provenance.
ALTER TABLE "Dataset" ADD COLUMN "rawFileHash" TEXT;
ALTER TABLE "Dataset" ADD COLUMN "datasetHash" TEXT;
ALTER TABLE "Dataset" ADD COLUMN "engineVersion" TEXT;
ALTER TABLE "Dataset" ADD COLUMN "cleaningLog" JSONB;

-- Identification metadata for saved artifacts generated from this point forward.
ALTER TABLE "Report" ADD COLUMN "datasetHash" TEXT;
ALTER TABLE "Report" ADD COLUMN "engineVersion" TEXT;
ALTER TABLE "Report" ADD COLUMN "industryKeyAtGeneration" TEXT;

ALTER TABLE "Forecast" ADD COLUMN "datasetHash" TEXT;
ALTER TABLE "Forecast" ADD COLUMN "engineVersion" TEXT;
