-- CreateEnum
CREATE TYPE "ConnectorType" AS ENUM ('POSTGRES', 'MYSQL', 'SQLSERVER', 'GOOGLE_SHEETS');

-- CreateTable
CREATE TABLE "Connection" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "ConnectorType" NOT NULL,
    "config" JSONB NOT NULL,
    "secret" TEXT NOT NULL,
    "lastSyncedAt" TIMESTAMP(3),
    "lastSyncStatus" TEXT,
    "lastSyncError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "organizationId" TEXT NOT NULL,

    CONSTRAINT "Connection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Connection_organizationId_idx" ON "Connection"("organizationId");

-- AlterTable: link datasets back to the connector they were synced from.
ALTER TABLE "Dataset" ADD COLUMN "sourceType" TEXT NOT NULL DEFAULT 'upload';
ALTER TABLE "Dataset" ADD COLUMN "connectionId" TEXT;

-- CreateIndex
CREATE INDEX "Dataset_connectionId_idx" ON "Dataset"("connectionId");

-- AddForeignKey
ALTER TABLE "Connection" ADD CONSTRAINT "Connection_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dataset" ADD CONSTRAINT "Dataset_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "Connection"("id") ON DELETE SET NULL ON UPDATE CASCADE;
