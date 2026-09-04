-- Multi-file joins and relationships.
--
-- Analytics has always read exactly one dataset, so a business whose data arrives as
-- orders + customers + products could only analyse one file at a time. A DatasetRelation
-- is a confirmed join between two of the organization's datasets: the analytical read
-- context (modules/context.ts, loadJoinedDataset) left-joins each relation onto the base
-- dataset before the analytics run.
--
-- The join is a READ CONTEXT ONLY. No source dataset's rows, cleaning, schema map or
-- hash is rewritten by a relationship, so every uploaded file stays independently
-- auditable and deleting a relationship restores exactly the numbers the org had.
--
-- `kind` is the cardinality measured when the user confirmed the relationship. Only a
-- unique right-hand key is ever stored: a repeated one duplicates each matching left row
-- and inflates every downstream sum. modules/relations.ts refuses that at write time
-- (naming the duplicated values) rather than storing a relationship that quietly makes
-- every total too high.
--
-- No backfill and no default: no organization has a relationship today, which is exactly
-- why this migration moves no existing number.

-- CreateTable
CREATE TABLE "DatasetRelation" (
    "id" TEXT NOT NULL,
    "leftColumn" TEXT NOT NULL,
    "rightColumn" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "organizationId" TEXT NOT NULL,
    "leftDatasetId" TEXT NOT NULL,
    "rightDatasetId" TEXT NOT NULL,

    CONSTRAINT "DatasetRelation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DatasetRelation_organizationId_idx" ON "DatasetRelation"("organizationId");

-- CreateIndex: the read context looks relations up by their left (base) dataset on every
-- analytics request; the right index keeps a cascade delete cheap.
CREATE INDEX "DatasetRelation_leftDatasetId_idx" ON "DatasetRelation"("leftDatasetId");

-- CreateIndex
CREATE INDEX "DatasetRelation_rightDatasetId_idx" ON "DatasetRelation"("rightDatasetId");

-- CreateIndex: the same two datasets joined on the same two columns twice would apply
-- the identical join twice, adding only duplicate columns.
CREATE UNIQUE INDEX "DatasetRelation_organizationId_leftDatasetId_rightDatasetI_key" ON "DatasetRelation"("organizationId", "leftDatasetId", "rightDatasetId", "leftColumn", "rightColumn");

-- AddForeignKey
ALTER TABLE "DatasetRelation" ADD CONSTRAINT "DatasetRelation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: unlike cleaned rows, a relationship pointing at a deleted dataset means
-- nothing — there is no join left to perform — so both ends cascade rather than nulling.
ALTER TABLE "DatasetRelation" ADD CONSTRAINT "DatasetRelation_leftDatasetId_fkey" FOREIGN KEY ("leftDatasetId") REFERENCES "Dataset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DatasetRelation" ADD CONSTRAINT "DatasetRelation_rightDatasetId_fkey" FOREIGN KEY ("rightDatasetId") REFERENCES "Dataset"("id") ON DELETE CASCADE ON UPDATE CASCADE;
