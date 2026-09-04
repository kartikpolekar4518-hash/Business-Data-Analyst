-- Replayable cleaning recipes.
--
-- A cleaning instruction was previously a list of accepted issue *types*, which only
-- had meaning next to the dataset whose issue table it was read against. A recipe
-- stores an ordered CleaningStep[] instead (see engine/cleaning.ts): every step names
-- its own column and carries its own decisions, so the same recipe is the same
-- transform against any upload.
--
-- `autoApply` marks the one recipe (at most one per organization, enforced in
-- modules/recipes.ts) that the shared ingest pipeline runs over every new dataset.
--
-- Dataset.recipeId records which recipe produced `cleanedRows`, so appending more rows
-- to a dataset can replay the identical transform over the combination. It is nullable
-- with no backfill and no default: NULL is what every existing dataset already is —
-- cleaned by an accepted-types list that cannot be reconstructed — and it is what a
-- dataset cleaned without a saved recipe still writes.

-- CreateTable
CREATE TABLE "CleaningRecipe" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "steps" JSONB NOT NULL,
    "autoApply" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "organizationId" TEXT NOT NULL,

    CONSTRAINT "CleaningRecipe_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CleaningRecipe_organizationId_idx" ON "CleaningRecipe"("organizationId");

-- CreateIndex: recipes are picked by name in the UI, so saving under an existing name
-- overwrites that recipe rather than creating a second one that looks identical.
CREATE UNIQUE INDEX "CleaningRecipe_organizationId_name_key" ON "CleaningRecipe"("organizationId", "name");

-- AddForeignKey
ALTER TABLE "CleaningRecipe" ADD CONSTRAINT "CleaningRecipe_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "Dataset" ADD COLUMN "recipeId" TEXT;

-- CreateIndex
CREATE INDEX "Dataset_recipeId_idx" ON "Dataset"("recipeId");

-- AddForeignKey: deleting a recipe must not delete the data it once cleaned. The rows
-- stay exactly as they are; the dataset simply stops knowing how to replay itself.
ALTER TABLE "Dataset" ADD CONSTRAINT "Dataset_recipeId_fkey" FOREIGN KEY ("recipeId") REFERENCES "CleaningRecipe"("id") ON DELETE SET NULL ON UPDATE CASCADE;
