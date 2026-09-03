-- Organization-defined metrics (see engine/metricSpec.ts). `spec` holds a declarative
-- MetricSpec — an aggregation kind over one or two named fields with at most one
-- filter — which is compiled back into the engine's PackMetric/KpiDef shapes at request
-- time. It is never evaluated as an expression.
--
-- No backfill: organizations start with no custom metrics and see only their industry
-- pack's built-in KPIs, exactly as before.

-- CreateTable
CREATE TABLE "CustomMetric" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "spec" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "organizationId" TEXT NOT NULL,

    CONSTRAINT "CustomMetric_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CustomMetric_organizationId_idx" ON "CustomMetric"("organizationId");

-- CreateIndex: a metric key is referenced by alert rules and URLs, so it must be
-- unambiguous within an organization.
CREATE UNIQUE INDEX "CustomMetric_organizationId_key_key" ON "CustomMetric"("organizationId", "key");

-- AddForeignKey
ALTER TABLE "CustomMetric" ADD CONSTRAINT "CustomMetric_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
