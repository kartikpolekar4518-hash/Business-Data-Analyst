-- Shareable saved views: promotes the Analytics page's saved filter sets from each
-- browser's localStorage to an org-scoped model, so a view named once is visible to
-- every member of the organization.
--
-- `query` is the page's URL query string verbatim, which is exactly what localStorage
-- held, so the stored shape is unchanged and the client applies a view the same way.
--
-- No backfill: views already in a user's localStorage stay there and are simply not
-- listed. They are per-browser by definition and the server cannot reach them; a user
-- who wants one shared re-saves it once.

-- CreateTable
CREATE TABLE "SavedView" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "organizationId" TEXT NOT NULL,

    CONSTRAINT "SavedView_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SavedView_organizationId_idx" ON "SavedView"("organizationId");

-- CreateIndex: saving a view under a name that already exists replaces it, so a name
-- must identify at most one view within an organization.
CREATE UNIQUE INDEX "SavedView_organizationId_name_key" ON "SavedView"("organizationId", "name");

-- AddForeignKey
ALTER TABLE "SavedView" ADD CONSTRAINT "SavedView_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
