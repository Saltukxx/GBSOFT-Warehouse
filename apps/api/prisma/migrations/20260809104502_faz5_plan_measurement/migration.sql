-- CreateTable
CREATE TABLE "PlanMeasurement" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "windowEnd" TIMESTAMP(3) NOT NULL,
    "expectedDeltaPct" DOUBLE PRECISION NOT NULL,
    "actualDeltaPct" DOUBLE PRECISION,
    "baselineP50Sec" DOUBLE PRECISION,
    "observedP50Sec" DOUBLE PRECISION,
    "baselineSamples" INTEGER NOT NULL,
    "observedSamples" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "evidence" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlanMeasurement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PlanMeasurement_tenantId_planId_createdAt_idx" ON "PlanMeasurement"("tenantId", "planId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PlanMeasurement_tenantId_planId_windowStart_windowEnd_key" ON "PlanMeasurement"("tenantId", "planId", "windowStart", "windowEnd");

-- AddForeignKey
ALTER TABLE "PlanMeasurement" ADD CONSTRAINT "PlanMeasurement_planId_fkey" FOREIGN KEY ("planId") REFERENCES "SlotPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
