-- Faz 8.1: rota-duyarlı araç yüklemenin sürümlü araç geometrisi.
ALTER TYPE "RunKind" ADD VALUE 'TRUCK_LOAD';

CREATE TABLE "VehicleTemplate" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "internalLengthM" DOUBLE PRECISION NOT NULL,
    "internalWidthM" DOUBLE PRECISION NOT NULL,
    "internalHeightM" DOUBLE PRECISION NOT NULL,
    "rearDoorWidthM" DOUBLE PRECISION NOT NULL,
    "rearDoorHeightM" DOUBLE PRECISION NOT NULL,
    "rearDoorSillM" DOUBLE PRECISION NOT NULL,
    "maxPayloadKg" DOUBLE PRECISION NOT NULL,
    "axleGroups" JSONB NOT NULL,
    "obstacles" JSONB NOT NULL,
    "cogMinX" DOUBLE PRECISION NOT NULL,
    "cogMaxX" DOUBLE PRECISION NOT NULL,
    "cogMinY" DOUBLE PRECISION NOT NULL,
    "cogMaxY" DOUBLE PRECISION NOT NULL,
    "cogMaxZ" DOUBLE PRECISION NOT NULL,
    "rulesVersion" TEXT NOT NULL,
    "geometrySource" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VehicleTemplate_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "VehicleTemplate_tenantId_code_key"
ON "VehicleTemplate"("tenantId", "code");

CREATE INDEX "VehicleTemplate_tenantId_kind_idx"
ON "VehicleTemplate"("tenantId", "kind");

ALTER TABLE "VehicleTemplate"
ADD CONSTRAINT "VehicleTemplate_tenantId_fkey"
FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
