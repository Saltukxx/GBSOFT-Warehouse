-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('COO', 'WAREHOUSE_MANAGER', 'PLANNER', 'TEAM_LEAD', 'OPERATOR', 'DATA_ENGINEER', 'ADMIN');

-- CreateEnum
CREATE TYPE "RackSide" AS ENUM ('LEFT', 'RIGHT');

-- CreateEnum
CREATE TYPE "EquipmentClass" AS ENUM ('MANUAL', 'CART', 'FORKLIFT');

-- CreateEnum
CREATE TYPE "VelocityClass" AS ENUM ('A', 'B', 'C');

-- CreateEnum
CREATE TYPE "HandlingClass" AS ENUM ('STANDARD', 'FRAGILE', 'HEAVY');

-- CreateEnum
CREATE TYPE "RunStatus" AS ENUM ('QUEUED', 'RUNNING', 'FEASIBLE', 'INFEASIBLE', 'FAILED', 'TIMEOUT');

-- CreateEnum
CREATE TYPE "PlanState" AS ENUM ('DRAFT', 'READY', 'PARTIALLY_PUBLISHED', 'PUBLISHED', 'SUPERSEDED', 'ROLLED_BACK');

-- CreateEnum
CREATE TYPE "RecommendationStatus" AS ENUM ('RECOMMENDED', 'ALTERNATIVE', 'EXCLUDED', 'LOCKED');

-- CreateEnum
CREATE TYPE "MoveTaskKind" AS ENUM ('VACATE', 'MOVE', 'VERIFY', 'OPEN');

-- CreateEnum
CREATE TYPE "MoveTaskStatus" AS ENUM ('READY', 'WAITING', 'BLOCKED', 'PUBLISHED', 'APPLIED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "IssuePriority" AS ENUM ('CRITICAL', 'HIGH', 'MEDIUM', 'LOW');

-- CreateTable
CREATE TABLE "Tenant" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Tenant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "actorUserId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "correlationId" TEXT,
    "before" JSONB,
    "after" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Facility" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'Europe/Istanbul',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Facility_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LayoutVersion" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "viewBoxWidth" DOUBLE PRECISION NOT NULL,
    "viewBoxHeight" DOUBLE PRECISION NOT NULL,
    "unitsPerMeter" DOUBLE PRECISION NOT NULL,
    "dockAnchorX" DOUBLE PRECISION NOT NULL,
    "dockAnchorY" DOUBLE PRECISION NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LayoutVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Zone" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "layoutVersionId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,

    CONSTRAINT "Zone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Aisle" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "layoutVersionId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "x" DOUBLE PRECISION NOT NULL,
    "walkwayWidth" DOUBLE PRECISION NOT NULL,
    "congestionScore" DOUBLE PRECISION NOT NULL DEFAULT 0,

    CONSTRAINT "Aisle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RackFace" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "layoutVersionId" TEXT NOT NULL,
    "aisleId" TEXT NOT NULL,
    "zoneId" TEXT NOT NULL,
    "side" "RackSide" NOT NULL,
    "x" DOUBLE PRECISION NOT NULL,
    "width" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "RackFace_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Location" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "layoutVersionId" TEXT NOT NULL,
    "zoneId" TEXT NOT NULL,
    "aisleId" TEXT NOT NULL,
    "rackFaceId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "bay" INTEGER NOT NULL,
    "level" INTEGER NOT NULL,
    "x" DOUBLE PRECISION NOT NULL,
    "y" DOUBLE PRECISION NOT NULL,
    "width" DOUBLE PRECISION NOT NULL,
    "height" DOUBLE PRECISION NOT NULL,
    "maxWeightKg" DOUBLE PRECISION NOT NULL,
    "maxVolumeM3" DOUBLE PRECISION NOT NULL,
    "equipment" "EquipmentClass" NOT NULL,
    "goldenZone" BOOLEAN NOT NULL DEFAULT false,
    "distanceToDockM" DOUBLE PRECISION NOT NULL,
    "congestionScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "blocked" BOOLEAN NOT NULL DEFAULT false,
    "blockedReason" TEXT,
    "dataQuality" DOUBLE PRECISION NOT NULL DEFAULT 1,

    CONSTRAINT "Location_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FloorArea" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "layoutVersionId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "x" DOUBLE PRECISION NOT NULL,
    "y" DOUBLE PRECISION NOT NULL,
    "width" DOUBLE PRECISION NOT NULL,
    "height" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "FloorArea_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Sku" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "handling" "HandlingClass" NOT NULL DEFAULT 'STANDARD',
    "sourceSystem" TEXT,
    "sourceId" TEXT,
    "gtin" TEXT,

    CONSTRAINT "Sku_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SkuDimension" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "skuId" TEXT NOT NULL,
    "widthCm" DOUBLE PRECISION,
    "depthCm" DOUBLE PRECISION,
    "heightCm" DOUBLE PRECISION,
    "weightKg" DOUBLE PRECISION,
    "source" TEXT NOT NULL,
    "measuredAt" TIMESTAMP(3),
    "toleranceP" DOUBLE PRECISION NOT NULL DEFAULT 0.05,

    CONSTRAINT "SkuDimension_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SkuAffinity" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "skuId" TEXT NOT NULL,
    "relatedSkuId" TEXT NOT NULL,
    "coPickRate" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "SkuAffinity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VelocitySnapshot" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "skuId" TEXT NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "windowEnd" TIMESTAMP(3) NOT NULL,
    "velocityClass" "VelocityClass" NOT NULL,
    "picksPerDay" DOUBLE PRECISION NOT NULL,
    "unitsPerPick" DOUBLE PRECISION NOT NULL,
    "replenishmentsPerDay" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "VelocitySnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SkuPlacement" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "skuId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveTo" TIMESTAMP(3),
    "sourcePlanId" TEXT,

    CONSTRAINT "SkuPlacement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Wave" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "plannedStart" TIMESTAMP(3) NOT NULL,
    "slaCutoff" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL,
    "orderLines" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Wave_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PickTask" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "waveId" TEXT NOT NULL,
    "sourceId" TEXT,
    "skuCode" TEXT NOT NULL,
    "locationCode" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "durationSec" DOUBLE PRECISION,
    "operatorRef" TEXT,
    "exceptionCode" TEXT,

    CONSTRAINT "PickTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Event" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "sourceId" TEXT,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "eventTime" TIMESTAMP(3) NOT NULL,
    "ingestTime" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "locationCode" TEXT,
    "actor" TEXT,
    "sensor" TEXT,
    "payloadSchemaVersion" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "confidence" DOUBLE PRECISION,
    "evidenceUri" TEXT,
    "correlationId" TEXT,

    CONSTRAINT "Event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PickTimeModel" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "parameters" JSONB NOT NULL,
    "calibrated" BOOLEAN NOT NULL DEFAULT false,
    "trainedFrom" TIMESTAMP(3),
    "trainedTo" TIMESTAMP(3),
    "sampleSize" INTEGER NOT NULL DEFAULT 0,
    "p90CoveragePct" DOUBLE PRECISION,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PickTimeModel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ObjectiveProfile" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "pickingTimeWeight" DOUBLE PRECISION NOT NULL,
    "replenishmentWeight" DOUBLE PRECISION NOT NULL,
    "congestionWeight" DOUBLE PRECISION NOT NULL,
    "moveCostWeight" DOUBLE PRECISION NOT NULL,
    "defaultMoveBudget" INTEGER NOT NULL,
    "isSystem" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "ObjectiveProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OptimizationRun" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "basePlanId" TEXT,
    "status" "RunStatus" NOT NULL DEFAULT 'QUEUED',
    "solverVersion" TEXT NOT NULL,
    "modelVersion" TEXT NOT NULL,
    "objectiveProfileKey" TEXT NOT NULL,
    "parameters" JSONB NOT NULL,
    "constraints" JSONB NOT NULL,
    "seed" INTEGER NOT NULL,
    "timeLimitMs" INTEGER NOT NULL,
    "snapshotAt" TIMESTAMP(3) NOT NULL,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "solveDurationMs" INTEGER,
    "objectiveValue" DOUBLE PRECISION,
    "gapPct" DOUBLE PRECISION,
    "hardViolations" INTEGER NOT NULL DEFAULT 0,
    "infeasibilityReasons" JSONB,
    "relaxationOptions" JSONB,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdByUserId" TEXT,

    CONSTRAINT "OptimizationRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SlotPlan" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "layoutVersionId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "basePlanId" TEXT,
    "runId" TEXT,
    "objectiveProfileId" TEXT NOT NULL,
    "state" "PlanState" NOT NULL DEFAULT 'DRAFT',
    "snapshotAt" TIMESTAMP(3) NOT NULL,
    "solverVersion" TEXT NOT NULL,
    "modelVersion" TEXT NOT NULL,
    "netOperationDeltaPct" DOUBLE PRECISION NOT NULL,
    "pickingTimeDeltaPct" DOUBLE PRECISION NOT NULL,
    "walkingDeltaPct" DOUBLE PRECISION NOT NULL,
    "replenishmentDeltaPct" DOUBLE PRECISION NOT NULL,
    "moveTaskCount" INTEGER NOT NULL,
    "moveHours" DOUBLE PRECISION NOT NULL,
    "affectedSkuCount" INTEGER NOT NULL,
    "hardViolationCount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdByUserId" TEXT,
    "createdByLabel" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(3),

    CONSTRAINT "SlotPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SlotRecommendation" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "skuId" TEXT NOT NULL,
    "sourceLocationId" TEXT NOT NULL,
    "targetLocationId" TEXT NOT NULL,
    "expectedSecondsPerLineDelta" DOUBLE PRECISION NOT NULL,
    "p90SecondsPerLineDelta" DOUBLE PRECISION NOT NULL,
    "replenishmentDeltaPerDay" DOUBLE PRECISION NOT NULL,
    "moveHours" DOUBLE PRECISION NOT NULL,
    "reasons" TEXT[],
    "tradeoffs" TEXT[],
    "hardConstraintsPassed" BOOLEAN NOT NULL DEFAULT true,
    "status" "RecommendationStatus" NOT NULL DEFAULT 'RECOMMENDED',
    "confidencePct" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "SlotRecommendation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SlotAlternative" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "recommendationId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "rank" INTEGER NOT NULL,
    "netSecondsDelta" DOUBLE PRECISION NOT NULL,
    "pickingQuality" TEXT NOT NULL,
    "replenishmentDeltaPerDay" DOUBLE PRECISION NOT NULL,
    "congestionLevel" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "blockedReason" TEXT,

    CONSTRAINT "SlotAlternative_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MoveTask" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "code" TEXT NOT NULL,
    "kind" "MoveTaskKind" NOT NULL,
    "label" TEXT NOT NULL,
    "skuId" TEXT,
    "sourceLocationCode" TEXT,
    "targetLocationCode" TEXT,
    "zoneCode" TEXT NOT NULL,
    "loadLabel" TEXT NOT NULL,
    "loadHours" DOUBLE PRECISION NOT NULL,
    "packageKey" TEXT NOT NULL,
    "packageLabel" TEXT NOT NULL,
    "expectedBenefitPct" DOUBLE PRECISION NOT NULL,
    "status" "MoveTaskStatus" NOT NULL DEFAULT 'WAITING',
    "publishedAt" TIMESTAMP(3),
    "idempotencyKey" TEXT,

    CONSTRAINT "MoveTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MoveDependency" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "prerequisiteId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,

    CONSTRAINT "MoveDependency_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlanLock" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "skuId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdByUserId" TEXT,

    CONSTRAINT "PlanLock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlanExclusion" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "skuId" TEXT NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdByUserId" TEXT,

    CONSTRAINT "PlanExclusion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DataQualityIssue" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "priority" "IssuePriority" NOT NULL,
    "problem" TEXT NOT NULL,
    "detail" TEXT NOT NULL,
    "impact" TEXT NOT NULL,
    "suggestedAction" TEXT NOT NULL,
    "owner" TEXT NOT NULL,
    "affectedIds" TEXT[],
    "affectedLabel" TEXT NOT NULL,
    "blocksPublish" BOOLEAN NOT NULL DEFAULT false,
    "resolvedAt" TIMESTAMP(3),
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DataQualityIssue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportBatch" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "rowsTotal" INTEGER NOT NULL DEFAULT 0,
    "rowsAccepted" INTEGER NOT NULL DEFAULT 0,
    "rowsRejected" INTEGER NOT NULL DEFAULT 0,
    "report" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdByUserId" TEXT,

    CONSTRAINT "ImportBatch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "User_tenantId_idx" ON "User"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "User_tenantId_email_key" ON "User"("tenantId", "email");

-- CreateIndex
CREATE INDEX "AuditLog_tenantId_entityType_entityId_idx" ON "AuditLog"("tenantId", "entityType", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_tenantId_createdAt_idx" ON "AuditLog"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "Facility_tenantId_idx" ON "Facility"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "Facility_tenantId_code_key" ON "Facility"("tenantId", "code");

-- CreateIndex
CREATE INDEX "LayoutVersion_tenantId_facilityId_idx" ON "LayoutVersion"("tenantId", "facilityId");

-- CreateIndex
CREATE UNIQUE INDEX "LayoutVersion_tenantId_facilityId_version_key" ON "LayoutVersion"("tenantId", "facilityId", "version");

-- CreateIndex
CREATE INDEX "Zone_tenantId_layoutVersionId_idx" ON "Zone"("tenantId", "layoutVersionId");

-- CreateIndex
CREATE UNIQUE INDEX "Zone_tenantId_layoutVersionId_code_key" ON "Zone"("tenantId", "layoutVersionId", "code");

-- CreateIndex
CREATE INDEX "Aisle_tenantId_layoutVersionId_idx" ON "Aisle"("tenantId", "layoutVersionId");

-- CreateIndex
CREATE UNIQUE INDEX "Aisle_tenantId_layoutVersionId_number_key" ON "Aisle"("tenantId", "layoutVersionId", "number");

-- CreateIndex
CREATE INDEX "RackFace_tenantId_layoutVersionId_idx" ON "RackFace"("tenantId", "layoutVersionId");

-- CreateIndex
CREATE UNIQUE INDEX "RackFace_tenantId_aisleId_side_key" ON "RackFace"("tenantId", "aisleId", "side");

-- CreateIndex
CREATE INDEX "Location_tenantId_layoutVersionId_idx" ON "Location"("tenantId", "layoutVersionId");

-- CreateIndex
CREATE INDEX "Location_tenantId_zoneId_idx" ON "Location"("tenantId", "zoneId");

-- CreateIndex
CREATE UNIQUE INDEX "Location_tenantId_layoutVersionId_code_key" ON "Location"("tenantId", "layoutVersionId", "code");

-- CreateIndex
CREATE INDEX "FloorArea_tenantId_layoutVersionId_idx" ON "FloorArea"("tenantId", "layoutVersionId");

-- CreateIndex
CREATE UNIQUE INDEX "FloorArea_tenantId_layoutVersionId_code_key" ON "FloorArea"("tenantId", "layoutVersionId", "code");

-- CreateIndex
CREATE INDEX "Sku_tenantId_facilityId_idx" ON "Sku"("tenantId", "facilityId");

-- CreateIndex
CREATE UNIQUE INDEX "Sku_tenantId_facilityId_code_key" ON "Sku"("tenantId", "facilityId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "SkuDimension_skuId_key" ON "SkuDimension"("skuId");

-- CreateIndex
CREATE INDEX "SkuDimension_tenantId_idx" ON "SkuDimension"("tenantId");

-- CreateIndex
CREATE INDEX "SkuAffinity_tenantId_skuId_idx" ON "SkuAffinity"("tenantId", "skuId");

-- CreateIndex
CREATE UNIQUE INDEX "SkuAffinity_tenantId_skuId_relatedSkuId_key" ON "SkuAffinity"("tenantId", "skuId", "relatedSkuId");

-- CreateIndex
CREATE INDEX "VelocitySnapshot_tenantId_skuId_idx" ON "VelocitySnapshot"("tenantId", "skuId");

-- CreateIndex
CREATE UNIQUE INDEX "VelocitySnapshot_tenantId_skuId_windowStart_windowEnd_key" ON "VelocitySnapshot"("tenantId", "skuId", "windowStart", "windowEnd");

-- CreateIndex
CREATE INDEX "SkuPlacement_tenantId_skuId_effectiveTo_idx" ON "SkuPlacement"("tenantId", "skuId", "effectiveTo");

-- CreateIndex
CREATE INDEX "SkuPlacement_tenantId_locationId_effectiveTo_idx" ON "SkuPlacement"("tenantId", "locationId", "effectiveTo");

-- CreateIndex
CREATE INDEX "Wave_tenantId_facilityId_idx" ON "Wave"("tenantId", "facilityId");

-- CreateIndex
CREATE UNIQUE INDEX "Wave_tenantId_facilityId_code_key" ON "Wave"("tenantId", "facilityId", "code");

-- CreateIndex
CREATE INDEX "PickTask_tenantId_waveId_idx" ON "PickTask"("tenantId", "waveId");

-- CreateIndex
CREATE INDEX "PickTask_tenantId_completedAt_idx" ON "PickTask"("tenantId", "completedAt");

-- CreateIndex
CREATE INDEX "Event_tenantId_facilityId_eventTime_idx" ON "Event"("tenantId", "facilityId", "eventTime");

-- CreateIndex
CREATE INDEX "Event_tenantId_entityType_entityId_idx" ON "Event"("tenantId", "entityType", "entityId");

-- CreateIndex
CREATE UNIQUE INDEX "Event_tenantId_source_sourceId_eventType_key" ON "Event"("tenantId", "source", "sourceId", "eventType");

-- CreateIndex
CREATE INDEX "PickTimeModel_tenantId_facilityId_idx" ON "PickTimeModel"("tenantId", "facilityId");

-- CreateIndex
CREATE UNIQUE INDEX "PickTimeModel_tenantId_facilityId_version_key" ON "PickTimeModel"("tenantId", "facilityId", "version");

-- CreateIndex
CREATE INDEX "ObjectiveProfile_tenantId_idx" ON "ObjectiveProfile"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "ObjectiveProfile_tenantId_key_key" ON "ObjectiveProfile"("tenantId", "key");

-- CreateIndex
CREATE INDEX "OptimizationRun_tenantId_facilityId_createdAt_idx" ON "OptimizationRun"("tenantId", "facilityId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "SlotPlan_runId_key" ON "SlotPlan"("runId");

-- CreateIndex
CREATE INDEX "SlotPlan_tenantId_facilityId_createdAt_idx" ON "SlotPlan"("tenantId", "facilityId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "SlotPlan_tenantId_facilityId_code_key" ON "SlotPlan"("tenantId", "facilityId", "code");

-- CreateIndex
CREATE INDEX "SlotRecommendation_tenantId_planId_idx" ON "SlotRecommendation"("tenantId", "planId");

-- CreateIndex
CREATE UNIQUE INDEX "SlotRecommendation_tenantId_planId_skuId_key" ON "SlotRecommendation"("tenantId", "planId", "skuId");

-- CreateIndex
CREATE INDEX "SlotAlternative_tenantId_recommendationId_idx" ON "SlotAlternative"("tenantId", "recommendationId");

-- CreateIndex
CREATE UNIQUE INDEX "SlotAlternative_tenantId_recommendationId_locationId_key" ON "SlotAlternative"("tenantId", "recommendationId", "locationId");

-- CreateIndex
CREATE INDEX "MoveTask_tenantId_planId_idx" ON "MoveTask"("tenantId", "planId");

-- CreateIndex
CREATE INDEX "MoveTask_tenantId_planId_zoneCode_idx" ON "MoveTask"("tenantId", "planId", "zoneCode");

-- CreateIndex
CREATE UNIQUE INDEX "MoveTask_tenantId_planId_seq_key" ON "MoveTask"("tenantId", "planId", "seq");

-- CreateIndex
CREATE INDEX "MoveDependency_tenantId_taskId_idx" ON "MoveDependency"("tenantId", "taskId");

-- CreateIndex
CREATE UNIQUE INDEX "MoveDependency_tenantId_taskId_prerequisiteId_key" ON "MoveDependency"("tenantId", "taskId", "prerequisiteId");

-- CreateIndex
CREATE INDEX "PlanLock_tenantId_planId_idx" ON "PlanLock"("tenantId", "planId");

-- CreateIndex
CREATE UNIQUE INDEX "PlanLock_tenantId_planId_skuId_key" ON "PlanLock"("tenantId", "planId", "skuId");

-- CreateIndex
CREATE INDEX "PlanExclusion_tenantId_planId_idx" ON "PlanExclusion"("tenantId", "planId");

-- CreateIndex
CREATE UNIQUE INDEX "PlanExclusion_tenantId_planId_skuId_key" ON "PlanExclusion"("tenantId", "planId", "skuId");

-- CreateIndex
CREATE INDEX "DataQualityIssue_tenantId_facilityId_resolvedAt_idx" ON "DataQualityIssue"("tenantId", "facilityId", "resolvedAt");

-- CreateIndex
CREATE UNIQUE INDEX "DataQualityIssue_tenantId_facilityId_code_key" ON "DataQualityIssue"("tenantId", "facilityId", "code");

-- CreateIndex
CREATE INDEX "ImportBatch_tenantId_facilityId_createdAt_idx" ON "ImportBatch"("tenantId", "facilityId", "createdAt");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Facility" ADD CONSTRAINT "Facility_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LayoutVersion" ADD CONSTRAINT "LayoutVersion_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Zone" ADD CONSTRAINT "Zone_layoutVersionId_fkey" FOREIGN KEY ("layoutVersionId") REFERENCES "LayoutVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Aisle" ADD CONSTRAINT "Aisle_layoutVersionId_fkey" FOREIGN KEY ("layoutVersionId") REFERENCES "LayoutVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RackFace" ADD CONSTRAINT "RackFace_layoutVersionId_fkey" FOREIGN KEY ("layoutVersionId") REFERENCES "LayoutVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RackFace" ADD CONSTRAINT "RackFace_aisleId_fkey" FOREIGN KEY ("aisleId") REFERENCES "Aisle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RackFace" ADD CONSTRAINT "RackFace_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "Zone"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Location" ADD CONSTRAINT "Location_layoutVersionId_fkey" FOREIGN KEY ("layoutVersionId") REFERENCES "LayoutVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Location" ADD CONSTRAINT "Location_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "Zone"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Location" ADD CONSTRAINT "Location_aisleId_fkey" FOREIGN KEY ("aisleId") REFERENCES "Aisle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Location" ADD CONSTRAINT "Location_rackFaceId_fkey" FOREIGN KEY ("rackFaceId") REFERENCES "RackFace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FloorArea" ADD CONSTRAINT "FloorArea_layoutVersionId_fkey" FOREIGN KEY ("layoutVersionId") REFERENCES "LayoutVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sku" ADD CONSTRAINT "Sku_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SkuDimension" ADD CONSTRAINT "SkuDimension_skuId_fkey" FOREIGN KEY ("skuId") REFERENCES "Sku"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SkuAffinity" ADD CONSTRAINT "SkuAffinity_skuId_fkey" FOREIGN KEY ("skuId") REFERENCES "Sku"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SkuAffinity" ADD CONSTRAINT "SkuAffinity_relatedSkuId_fkey" FOREIGN KEY ("relatedSkuId") REFERENCES "Sku"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VelocitySnapshot" ADD CONSTRAINT "VelocitySnapshot_skuId_fkey" FOREIGN KEY ("skuId") REFERENCES "Sku"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SkuPlacement" ADD CONSTRAINT "SkuPlacement_skuId_fkey" FOREIGN KEY ("skuId") REFERENCES "Sku"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SkuPlacement" ADD CONSTRAINT "SkuPlacement_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Wave" ADD CONSTRAINT "Wave_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PickTask" ADD CONSTRAINT "PickTask_waveId_fkey" FOREIGN KEY ("waveId") REFERENCES "Wave"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PickTimeModel" ADD CONSTRAINT "PickTimeModel_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SlotPlan" ADD CONSTRAINT "SlotPlan_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SlotPlan" ADD CONSTRAINT "SlotPlan_layoutVersionId_fkey" FOREIGN KEY ("layoutVersionId") REFERENCES "LayoutVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SlotPlan" ADD CONSTRAINT "SlotPlan_objectiveProfileId_fkey" FOREIGN KEY ("objectiveProfileId") REFERENCES "ObjectiveProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SlotPlan" ADD CONSTRAINT "SlotPlan_runId_fkey" FOREIGN KEY ("runId") REFERENCES "OptimizationRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SlotRecommendation" ADD CONSTRAINT "SlotRecommendation_planId_fkey" FOREIGN KEY ("planId") REFERENCES "SlotPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SlotRecommendation" ADD CONSTRAINT "SlotRecommendation_skuId_fkey" FOREIGN KEY ("skuId") REFERENCES "Sku"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SlotRecommendation" ADD CONSTRAINT "SlotRecommendation_sourceLocationId_fkey" FOREIGN KEY ("sourceLocationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SlotRecommendation" ADD CONSTRAINT "SlotRecommendation_targetLocationId_fkey" FOREIGN KEY ("targetLocationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SlotAlternative" ADD CONSTRAINT "SlotAlternative_recommendationId_fkey" FOREIGN KEY ("recommendationId") REFERENCES "SlotRecommendation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SlotAlternative" ADD CONSTRAINT "SlotAlternative_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MoveTask" ADD CONSTRAINT "MoveTask_planId_fkey" FOREIGN KEY ("planId") REFERENCES "SlotPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MoveTask" ADD CONSTRAINT "MoveTask_skuId_fkey" FOREIGN KEY ("skuId") REFERENCES "Sku"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MoveDependency" ADD CONSTRAINT "MoveDependency_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "MoveTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MoveDependency" ADD CONSTRAINT "MoveDependency_prerequisiteId_fkey" FOREIGN KEY ("prerequisiteId") REFERENCES "MoveTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanLock" ADD CONSTRAINT "PlanLock_planId_fkey" FOREIGN KEY ("planId") REFERENCES "SlotPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanLock" ADD CONSTRAINT "PlanLock_skuId_fkey" FOREIGN KEY ("skuId") REFERENCES "Sku"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanLock" ADD CONSTRAINT "PlanLock_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanExclusion" ADD CONSTRAINT "PlanExclusion_planId_fkey" FOREIGN KEY ("planId") REFERENCES "SlotPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanExclusion" ADD CONSTRAINT "PlanExclusion_skuId_fkey" FOREIGN KEY ("skuId") REFERENCES "Sku"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DataQualityIssue" ADD CONSTRAINT "DataQualityIssue_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportBatch" ADD CONSTRAINT "ImportBatch_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE CASCADE ON UPDATE CASCADE;
