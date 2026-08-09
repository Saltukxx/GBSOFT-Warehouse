-- AlterTable
ALTER TABLE "OptimizationRun" ADD COLUMN     "inputSnapshot" JSONB,
ADD COLUMN     "resultSnapshot" JSONB,
ADD COLUMN     "solutionQuality" TEXT;
