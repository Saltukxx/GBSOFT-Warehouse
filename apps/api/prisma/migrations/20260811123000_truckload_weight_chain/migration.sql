-- İki kademeli ağırlık zinciri: çekici + regülasyon şablonda, katar
-- dağılımı plan kaydında.
ALTER TABLE "VehicleTemplate" ADD COLUMN "tractor" JSONB;
ALTER TABLE "VehicleTemplate" ADD COLUMN "regulation" JSONB;

ALTER TABLE "LoadPlan"
ADD COLUMN "weightDistribution" JSONB NOT NULL DEFAULT '{}';

ALTER TABLE "LoadPlan"
ALTER COLUMN "weightDistribution" DROP DEFAULT;
