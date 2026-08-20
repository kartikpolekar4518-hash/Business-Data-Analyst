-- AlertRule.id reference stored on Alert so custom-alert de-dup survives rule renames.
ALTER TABLE "Alert" ADD COLUMN "ruleId" TEXT;

-- CreateIndex
CREATE INDEX "Alert_organizationId_ruleId_read_idx" ON "Alert"("organizationId", "ruleId", "read");
