-- Faz 8.2: rota-duyarlı araç yükleme planı ve yerleşimleri.
CREATE TYPE "LoadPlanState" AS ENUM ('DRAFT', 'VALIDATED', 'REJECTED', 'PUBLISHED');

CREATE TABLE "LoadPlan" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "shipmentId" TEXT NOT NULL,
    "vehicleTemplateId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "state" "LoadPlanState" NOT NULL DEFAULT 'DRAFT',
    "payloadKg" DOUBLE PRECISION NOT NULL,
    "volumeUtilizationPct" DOUBLE PRECISION NOT NULL,
    "cogX" DOUBLE PRECISION NOT NULL,
    "cogY" DOUBLE PRECISION NOT NULL,
    "cogZ" DOUBLE PRECISION NOT NULL,
    "axleLoads" JSONB NOT NULL,
    "rehandlingRiskCount" INTEGER NOT NULL,
    "violations" JSONB NOT NULL,
    "validatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoadPlan_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LoadPlacement" (
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
    "seq" INTEGER NOT NULL,
    "locked" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "LoadPlacement_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LoadPlan_tenantId_shipmentId_runId_key"
ON "LoadPlan"("tenantId", "shipmentId", "runId");
CREATE INDEX "LoadPlan_tenantId_shipmentId_createdAt_idx"
ON "LoadPlan"("tenantId", "shipmentId", "createdAt");
CREATE UNIQUE INDEX "LoadPlacement_tenantId_planId_huId_key"
ON "LoadPlacement"("tenantId", "planId", "huId");
CREATE UNIQUE INDEX "LoadPlacement_tenantId_planId_seq_key"
ON "LoadPlacement"("tenantId", "planId", "seq");
CREATE INDEX "LoadPlacement_tenantId_planId_idx"
ON "LoadPlacement"("tenantId", "planId");

ALTER TABLE "LoadPlan" ADD CONSTRAINT "LoadPlan_shipmentId_fkey"
FOREIGN KEY ("shipmentId") REFERENCES "Shipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LoadPlan" ADD CONSTRAINT "LoadPlan_vehicleTemplateId_fkey"
FOREIGN KEY ("vehicleTemplateId") REFERENCES "VehicleTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LoadPlacement" ADD CONSTRAINT "LoadPlacement_planId_fkey"
FOREIGN KEY ("planId") REFERENCES "LoadPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LoadPlacement" ADD CONSTRAINT "LoadPlacement_huId_fkey"
FOREIGN KEY ("huId") REFERENCES "HandlingUnit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
