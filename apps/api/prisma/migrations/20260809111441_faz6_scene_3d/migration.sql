-- AlterTable
ALTER TABLE "FloorArea" ADD COLUMN     "heightM" DOUBLE PRECISION,
ADD COLUMN     "traversable" BOOLEAN;

-- AlterTable
ALTER TABLE "LayoutVersion" ADD COLUMN     "clearHeightM" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "Location" ADD COLUMN     "depthM" DOUBLE PRECISION,
ADD COLUMN     "levelClearHeightM" DOUBLE PRECISION,
ADD COLUMN     "levelElevationM" DOUBLE PRECISION;
