-- CreateEnum
CREATE TYPE "ScheduleFrequency" AS ENUM ('HOURLY', 'DAILY', 'WEEKLY', 'MONTHLY');

-- CreateEnum
CREATE TYPE "Comparator" AS ENUM ('LT', 'LTE', 'GT', 'GTE');

-- CreateTable
CREATE TABLE "ScheduledReport" (
    "id" TEXT NOT NULL,
    "title" TEXT,
    "frequency" "ScheduleFrequency" NOT NULL DEFAULT 'WEEKLY',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "recipients" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "lastRunAt" TIMESTAMP(3),
    "lastRunStatus" TEXT,
    "lastError" TEXT,
    "nextRunAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "organizationId" TEXT NOT NULL,
    "datasetId" TEXT,

    CONSTRAINT "ScheduledReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AlertRule" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "comparator" "Comparator" NOT NULL,
    "threshold" DOUBLE PRECISION NOT NULL,
    "frequency" "ScheduleFrequency" NOT NULL DEFAULT 'DAILY',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "lastRunAt" TIMESTAMP(3),
    "lastTriggeredAt" TIMESTAMP(3),
    "lastError" TEXT,
    "nextRunAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "organizationId" TEXT NOT NULL,

    CONSTRAINT "AlertRule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ScheduledReport_organizationId_idx" ON "ScheduledReport"("organizationId");
CREATE INDEX "ScheduledReport_enabled_nextRunAt_idx" ON "ScheduledReport"("enabled", "nextRunAt");
CREATE INDEX "AlertRule_organizationId_idx" ON "AlertRule"("organizationId");
CREATE INDEX "AlertRule_enabled_nextRunAt_idx" ON "AlertRule"("enabled", "nextRunAt");

-- AddForeignKey
ALTER TABLE "ScheduledReport" ADD CONSTRAINT "ScheduledReport_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ScheduledReport" ADD CONSTRAINT "ScheduledReport_datasetId_fkey" FOREIGN KEY ("datasetId") REFERENCES "Dataset"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AlertRule" ADD CONSTRAINT "AlertRule_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
