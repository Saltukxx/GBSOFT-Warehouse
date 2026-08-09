-- CreateEnum
CREATE TYPE "GraphNodeKind" AS ENUM ('DOCK', 'JUNCTION', 'LOCATION');

-- CreateTable
CREATE TABLE "GraphNode" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "layoutVersionId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "kind" "GraphNodeKind" NOT NULL,
    "x" DOUBLE PRECISION NOT NULL,
    "y" DOUBLE PRECISION NOT NULL,
    "locationId" TEXT,

    CONSTRAINT "GraphNode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GraphEdge" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "layoutVersionId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "fromNodeId" TEXT NOT NULL,
    "toNodeId" TEXT NOT NULL,
    "distanceM" DOUBLE PRECISION NOT NULL,
    "traversable" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "GraphEdge_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GraphNode_locationId_key" ON "GraphNode"("locationId");

-- CreateIndex
CREATE INDEX "GraphNode_tenantId_layoutVersionId_kind_idx" ON "GraphNode"("tenantId", "layoutVersionId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "GraphNode_tenantId_layoutVersionId_code_key" ON "GraphNode"("tenantId", "layoutVersionId", "code");

-- CreateIndex
CREATE INDEX "GraphEdge_tenantId_layoutVersionId_traversable_idx" ON "GraphEdge"("tenantId", "layoutVersionId", "traversable");

-- CreateIndex
CREATE INDEX "GraphEdge_fromNodeId_idx" ON "GraphEdge"("fromNodeId");

-- CreateIndex
CREATE INDEX "GraphEdge_toNodeId_idx" ON "GraphEdge"("toNodeId");

-- CreateIndex
CREATE UNIQUE INDEX "GraphEdge_tenantId_layoutVersionId_code_key" ON "GraphEdge"("tenantId", "layoutVersionId", "code");

-- AddForeignKey
ALTER TABLE "GraphNode" ADD CONSTRAINT "GraphNode_layoutVersionId_fkey" FOREIGN KEY ("layoutVersionId") REFERENCES "LayoutVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GraphNode" ADD CONSTRAINT "GraphNode_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GraphEdge" ADD CONSTRAINT "GraphEdge_layoutVersionId_fkey" FOREIGN KEY ("layoutVersionId") REFERENCES "LayoutVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GraphEdge" ADD CONSTRAINT "GraphEdge_fromNodeId_fkey" FOREIGN KEY ("fromNodeId") REFERENCES "GraphNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GraphEdge" ADD CONSTRAINT "GraphEdge_toNodeId_fkey" FOREIGN KEY ("toNodeId") REFERENCES "GraphNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;
