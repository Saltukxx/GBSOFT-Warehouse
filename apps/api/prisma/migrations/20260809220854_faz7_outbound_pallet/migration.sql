-- CreateEnum
CREATE TYPE "ShipmentStatus" AS ENUM ('DRAFT', 'READY', 'PLANNED', 'LOADED', 'DISPATCHED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PalletPlanState" AS ENUM ('DRAFT', 'VALIDATED', 'REJECTED', 'PUBLISHED');

-- AlterEnum
ALTER TYPE "RunKind" ADD VALUE 'PALLET';

-- CreateTable
CREATE TABLE "PackageType" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "shape" TEXT NOT NULL,
    "lengthM" DOUBLE PRECISION NOT NULL,
    "widthM" DOUBLE PRECISION NOT NULL,
    "heightM" DOUBLE PRECISION NOT NULL,
    "tareKg" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "rotation" TEXT NOT NULL DEFAULT 'yaw',
    "maxTopLoadKg" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "minSupportRatio" DOUBLE PRECISION NOT NULL DEFAULT 0.75,
    "stackable" BOOLEAN NOT NULL DEFAULT true,
    "fragile" BOOLEAN NOT NULL DEFAULT false,
    "compressionTolerancePct" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "temperatureClass" TEXT NOT NULL DEFAULT 'ambient',
    "segregationGroup" TEXT,

    CONSTRAINT "PackageType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Shipment" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "carrierCode" TEXT,
    "status" "ShipmentStatus" NOT NULL DEFAULT 'READY',
    "plannedDepartureAt" TIMESTAMP(3),
    "snapshotAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Shipment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShipmentStop" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "shipmentId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "plannedArrivalAt" TIMESTAMP(3),

    CONSTRAINT "ShipmentStop_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShipmentLine" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "shipmentId" TEXT NOT NULL,
    "stopId" TEXT NOT NULL,
    "lineNo" INTEGER NOT NULL,
    "skuId" TEXT NOT NULL,
    "packageTypeId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,

    CONSTRAINT "ShipmentLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HandlingUnit" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "shipmentId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "sscc" TEXT,
    "packageTypeId" TEXT NOT NULL,
    "parentId" TEXT,
    "skuId" TEXT,
    "stopId" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "grossWeightKg" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "HandlingUnit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PalletPlan" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "shipmentId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "code" TEXT NOT NULL,
    "baseTypeId" TEXT NOT NULL,
    "baseLengthM" DOUBLE PRECISION NOT NULL,
    "baseWidthM" DOUBLE PRECISION NOT NULL,
    "deckHeightM" DOUBLE PRECISION NOT NULL,
    "maxHeightM" DOUBLE PRECISION NOT NULL,
    "maxWeightKg" DOUBLE PRECISION NOT NULL,
    "usedHeightM" DOUBLE PRECISION NOT NULL,
    "usedWeightKg" DOUBLE PRECISION NOT NULL,
    "volumeUtilizationPct" DOUBLE PRECISION NOT NULL,
    "footprintUtilizationPct" DOUBLE PRECISION NOT NULL,
    "cogX" DOUBLE PRECISION NOT NULL,
    "cogY" DOUBLE PRECISION NOT NULL,
    "cogZ" DOUBLE PRECISION NOT NULL,
    "state" "PalletPlanState" NOT NULL DEFAULT 'DRAFT',
    "validatedAt" TIMESTAMP(3),
    "violations" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PalletPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PalletPlacement" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "huId" TEXT NOT NULL,
    "x" DOUBLE PRECISION NOT NULL,
    "y" DOUBLE PRECISION NOT NULL,
    "z" DOUBLE PRECISION NOT NULL,
    "lengthM" DOUBLE PRECISION NOT NULL,
    "widthM" DOUBLE PRECISION NOT NULL,
    "heightM" DOUBLE PRECISION NOT NULL,
    "grossWeightKg" DOUBLE PRECISION NOT NULL,
    "layer" INTEGER NOT NULL,
    "seq" INTEGER NOT NULL,

    CONSTRAINT "PalletPlacement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PackageType_tenantId_idx" ON "PackageType"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "PackageType_tenantId_code_key" ON "PackageType"("tenantId", "code");

-- CreateIndex
CREATE INDEX "Shipment_tenantId_facilityId_status_idx" ON "Shipment"("tenantId", "facilityId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Shipment_tenantId_facilityId_code_key" ON "Shipment"("tenantId", "facilityId", "code");

-- CreateIndex
CREATE INDEX "ShipmentStop_tenantId_shipmentId_idx" ON "ShipmentStop"("tenantId", "shipmentId");

-- CreateIndex
CREATE UNIQUE INDEX "ShipmentStop_tenantId_shipmentId_seq_key" ON "ShipmentStop"("tenantId", "shipmentId", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "ShipmentStop_tenantId_shipmentId_code_key" ON "ShipmentStop"("tenantId", "shipmentId", "code");

-- CreateIndex
CREATE INDEX "ShipmentLine_tenantId_shipmentId_idx" ON "ShipmentLine"("tenantId", "shipmentId");

-- CreateIndex
CREATE UNIQUE INDEX "ShipmentLine_tenantId_shipmentId_lineNo_key" ON "ShipmentLine"("tenantId", "shipmentId", "lineNo");

-- CreateIndex
CREATE INDEX "HandlingUnit_tenantId_shipmentId_idx" ON "HandlingUnit"("tenantId", "shipmentId");

-- CreateIndex
CREATE UNIQUE INDEX "HandlingUnit_tenantId_code_key" ON "HandlingUnit"("tenantId", "code");

-- CreateIndex
CREATE INDEX "PalletPlan_tenantId_shipmentId_idx" ON "PalletPlan"("tenantId", "shipmentId");

-- CreateIndex
CREATE UNIQUE INDEX "PalletPlan_tenantId_shipmentId_runId_seq_key" ON "PalletPlan"("tenantId", "shipmentId", "runId", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "PalletPlacement_huId_key" ON "PalletPlacement"("huId");

-- CreateIndex
CREATE INDEX "PalletPlacement_tenantId_planId_idx" ON "PalletPlacement"("tenantId", "planId");

-- CreateIndex
CREATE UNIQUE INDEX "PalletPlacement_tenantId_planId_seq_key" ON "PalletPlacement"("tenantId", "planId", "seq");

-- AddForeignKey
ALTER TABLE "Shipment" ADD CONSTRAINT "Shipment_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShipmentStop" ADD CONSTRAINT "ShipmentStop_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "Shipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShipmentLine" ADD CONSTRAINT "ShipmentLine_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "Shipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShipmentLine" ADD CONSTRAINT "ShipmentLine_stopId_fkey" FOREIGN KEY ("stopId") REFERENCES "ShipmentStop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShipmentLine" ADD CONSTRAINT "ShipmentLine_skuId_fkey" FOREIGN KEY ("skuId") REFERENCES "Sku"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShipmentLine" ADD CONSTRAINT "ShipmentLine_packageTypeId_fkey" FOREIGN KEY ("packageTypeId") REFERENCES "PackageType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HandlingUnit" ADD CONSTRAINT "HandlingUnit_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "Shipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HandlingUnit" ADD CONSTRAINT "HandlingUnit_packageTypeId_fkey" FOREIGN KEY ("packageTypeId") REFERENCES "PackageType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HandlingUnit" ADD CONSTRAINT "HandlingUnit_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "HandlingUnit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HandlingUnit" ADD CONSTRAINT "HandlingUnit_skuId_fkey" FOREIGN KEY ("skuId") REFERENCES "Sku"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HandlingUnit" ADD CONSTRAINT "HandlingUnit_stopId_fkey" FOREIGN KEY ("stopId") REFERENCES "ShipmentStop"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PalletPlan" ADD CONSTRAINT "PalletPlan_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "Shipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PalletPlan" ADD CONSTRAINT "PalletPlan_baseTypeId_fkey" FOREIGN KEY ("baseTypeId") REFERENCES "PackageType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PalletPlacement" ADD CONSTRAINT "PalletPlacement_planId_fkey" FOREIGN KEY ("planId") REFERENCES "PalletPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PalletPlacement" ADD CONSTRAINT "PalletPlacement_huId_fkey" FOREIGN KEY ("huId") REFERENCES "HandlingUnit"("id") ON DELETE CASCADE ON UPDATE CASCADE;
