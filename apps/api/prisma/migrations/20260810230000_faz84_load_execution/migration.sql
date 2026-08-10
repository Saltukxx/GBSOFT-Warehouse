-- Faz 8.4: barkod/SSCC execution, sapma kaydı ve shadow publish.
CREATE TYPE "LoadExecutionState" AS ENUM ('SHADOW_PUBLISHED', 'LOADING', 'DEVIATED', 'COMPLETED');
CREATE TYPE "LoadScanOutcome" AS ENUM ('CONFIRMED', 'MISSING', 'DAMAGED', 'OUT_OF_SEQUENCE', 'UNKNOWN');

CREATE TABLE "LoadExecution" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'shadow',
    "state" "LoadExecutionState" NOT NULL DEFAULT 'SHADOW_PUBLISHED',
    "idempotencyKey" TEXT NOT NULL,
    "currentSeq" INTEGER NOT NULL DEFAULT 0,
    "loadedCount" INTEGER NOT NULL DEFAULT 0,
    "deviationCount" INTEGER NOT NULL DEFAULT 0,
    "replacementPlanId" TEXT,
    "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LoadExecution_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LoadScanEvent" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "executionId" TEXT NOT NULL,
    "huId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "scannedCode" TEXT NOT NULL,
    "expectedSeq" INTEGER,
    "actualSeq" INTEGER,
    "outcome" "LoadScanOutcome" NOT NULL,
    "note" TEXT,
    "scannedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoadScanEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LoadExecution_planId_key" ON "LoadExecution"("planId");
CREATE UNIQUE INDEX "LoadExecution_tenantId_idempotencyKey_key" ON "LoadExecution"("tenantId", "idempotencyKey");
CREATE INDEX "LoadExecution_tenantId_state_updatedAt_idx" ON "LoadExecution"("tenantId", "state", "updatedAt");
CREATE UNIQUE INDEX "LoadScanEvent_tenantId_executionId_idempotencyKey_key" ON "LoadScanEvent"("tenantId", "executionId", "idempotencyKey");
CREATE INDEX "LoadScanEvent_tenantId_executionId_scannedAt_idx" ON "LoadScanEvent"("tenantId", "executionId", "scannedAt");

ALTER TABLE "LoadExecution" ADD CONSTRAINT "LoadExecution_planId_fkey"
FOREIGN KEY ("planId") REFERENCES "LoadPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LoadScanEvent" ADD CONSTRAINT "LoadScanEvent_executionId_fkey"
FOREIGN KEY ("executionId") REFERENCES "LoadExecution"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LoadScanEvent" ADD CONSTRAINT "LoadScanEvent_huId_fkey"
FOREIGN KEY ("huId") REFERENCES "HandlingUnit"("id") ON DELETE SET NULL ON UPDATE CASCADE;
