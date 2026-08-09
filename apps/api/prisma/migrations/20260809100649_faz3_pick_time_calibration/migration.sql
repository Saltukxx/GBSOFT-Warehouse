-- AlterTable
ALTER TABLE "PickTimeModel" ADD COLUMN     "algorithm" TEXT NOT NULL DEFAULT 'analytic-baseline-v1',
ADD COLUMN     "metrics" JSONB;
