-- CreateEnum
CREATE TYPE "RunKind" AS ENUM ('SLOT', 'PICK_TOUR');

-- CreateEnum
CREATE TYPE "PickOrderStatus" AS ENUM ('DRAFT', 'READY', 'PLANNED', 'RELEASED', 'CANCELLED');

-- AlterTable
ALTER TABLE "OptimizationRun" ADD COLUMN     "kind" "RunKind" NOT NULL DEFAULT 'SLOT';

-- CreateTable
CREATE TABLE "PickOrder" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "dockCode" TEXT,
    "status" "PickOrderStatus" NOT NULL DEFAULT 'READY',
    "priority" INTEGER NOT NULL DEFAULT 0,
    "dueAt" TIMESTAMP(3),
    "snapshotAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PickOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PickOrderLine" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "lineNo" INTEGER NOT NULL,
    "skuId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "uom" TEXT NOT NULL DEFAULT 'adet',

    CONSTRAINT "PickOrderLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PickTour" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "equipment" TEXT NOT NULL,
    "totalDistanceM" DOUBLE PRECISION NOT NULL,
    "estimatedSec" DOUBLE PRECISION NOT NULL,
    "volumeUsedM3" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "weightUsedKg" DOUBLE PRECISION NOT NULL DEFAULT 0,

    CONSTRAINT "PickTour_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PickTourStop" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "tourId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "locationCode" TEXT NOT NULL,
    "skuCode" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "travelSec" DOUBLE PRECISION NOT NULL,
    "congestionSec" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "pickSec" DOUBLE PRECISION NOT NULL,
    "cumulativeSec" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "PickTourStop_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PickOrder_tenantId_facilityId_status_idx" ON "PickOrder"("tenantId", "facilityId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "PickOrder_tenantId_facilityId_code_key" ON "PickOrder"("tenantId", "facilityId", "code");

-- CreateIndex
CREATE INDEX "PickOrderLine_tenantId_orderId_idx" ON "PickOrderLine"("tenantId", "orderId");

-- CreateIndex
CREATE UNIQUE INDEX "PickOrderLine_tenantId_orderId_lineNo_key" ON "PickOrderLine"("tenantId", "orderId", "lineNo");

-- CreateIndex
CREATE INDEX "PickTour_tenantId_orderId_idx" ON "PickTour"("tenantId", "orderId");

-- CreateIndex
CREATE UNIQUE INDEX "PickTour_tenantId_orderId_runId_seq_key" ON "PickTour"("tenantId", "orderId", "runId", "seq");

-- CreateIndex
CREATE INDEX "PickTourStop_tenantId_tourId_idx" ON "PickTourStop"("tenantId", "tourId");

-- CreateIndex
CREATE UNIQUE INDEX "PickTourStop_tenantId_tourId_seq_key" ON "PickTourStop"("tenantId", "tourId", "seq");

-- AddForeignKey
ALTER TABLE "PickOrder" ADD CONSTRAINT "PickOrder_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PickOrderLine" ADD CONSTRAINT "PickOrderLine_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "PickOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PickOrderLine" ADD CONSTRAINT "PickOrderLine_skuId_fkey" FOREIGN KEY ("skuId") REFERENCES "Sku"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PickTour" ADD CONSTRAINT "PickTour_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "PickOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PickTourStop" ADD CONSTRAINT "PickTourStop_tourId_fkey" FOREIGN KEY ("tourId") REFERENCES "PickTour"("id") ON DELETE CASCADE ON UPDATE CASCADE;
