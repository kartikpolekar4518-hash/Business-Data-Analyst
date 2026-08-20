-- Public, revocable capability links to a report (see modules/share.ts).
-- CreateTable
CREATE TABLE "ReportShare" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,
    "reportId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,

    CONSTRAINT "ReportShare_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ReportShare_token_key" ON "ReportShare"("token");
CREATE INDEX "ReportShare_reportId_idx" ON "ReportShare"("reportId");
CREATE INDEX "ReportShare_organizationId_idx" ON "ReportShare"("organizationId");

-- AddForeignKey
ALTER TABLE "ReportShare" ADD CONSTRAINT "ReportShare_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "Report"("id") ON DELETE CASCADE ON UPDATE CASCADE;
