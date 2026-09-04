-- Named analytics filter queries, promoted from browser localStorage to an org-scoped
-- model so a view can be shared with the rest of the organization instead of being
-- trapped in the browser that saved it. `query` is the Analytics page's URL query
-- string, stored verbatim — the same `{ name, query }` shape the client already kept.
--
-- No backfill is possible: the existing views live in each user's localStorage, which
-- the server cannot read. The client imports its own once, on first load after this
-- ships, and then clears the key.

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

-- CreateIndex: saving under a name that already exists overwrites that view, which is
-- how the localStorage version behaved. The uniqueness makes that an upsert, not a race.
CREATE UNIQUE INDEX "SavedView_organizationId_name_key" ON "SavedView"("organizationId", "name");

-- AddForeignKey
ALTER TABLE "SavedView" ADD CONSTRAINT "SavedView_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
