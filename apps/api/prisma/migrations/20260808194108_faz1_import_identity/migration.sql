-- CreateEnum
CREATE TYPE "ImportStatus" AS ENUM ('VALIDATED', 'APPLIED', 'REJECTED');

-- AlterTable
ALTER TABLE "ImportBatch" ADD COLUMN     "correlationId" TEXT,
ADD COLUMN     "dryRun" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "status" "ImportStatus" NOT NULL DEFAULT 'VALIDATED';

-- CreateTable
CREATE TABLE "IdentityMap" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "sourceSystem" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "canonicalCode" TEXT NOT NULL,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IdentityMap_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "IdentityMap_tenantId_facilityId_entityType_canonicalCode_idx" ON "IdentityMap"("tenantId", "facilityId", "entityType", "canonicalCode");

-- CreateIndex
CREATE UNIQUE INDEX "IdentityMap_tenantId_facilityId_entityType_sourceSystem_sou_key" ON "IdentityMap"("tenantId", "facilityId", "entityType", "sourceSystem", "sourceId");

-- AddForeignKey
ALTER TABLE "IdentityMap" ADD CONSTRAINT "IdentityMap_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE CASCADE ON UPDATE CASCADE;
