-- DropIndex
DROP INDEX IF EXISTS "vm_instances_architecture_idx";

-- AlterTable
ALTER TABLE "instance_families" ADD COLUMN IF NOT EXISTS "architecture" "Architecture";
ALTER TABLE "instance_families" ADD COLUMN IF NOT EXISTS "processorManufacturer" "ProcessorManufacturer";
ALTER TABLE "instance_families" ADD COLUMN IF NOT EXISTS "series" VARCHAR(10);

-- Data Backfill SQL: series
UPDATE instance_families SET series = SUBSTRING(name FROM 1 FOR 1) WHERE series IS NULL;

-- Data Backfill SQL: architecture
UPDATE instance_families f SET architecture = (
  SELECT architecture FROM vm_instances v WHERE v."instanceFamilyId" = f.id LIMIT 1
) WHERE f.architecture IS NULL;

-- Data Backfill SQL: processorManufacturer
UPDATE instance_families f SET "processorManufacturer" = (
  SELECT "processorManufacturer" FROM vm_instances v WHERE v."instanceFamilyId" = f.id LIMIT 1
) WHERE f."processorManufacturer" IS NULL;

-- AlterTable
ALTER TABLE "vm_instances" DROP COLUMN IF EXISTS "architecture";
ALTER TABLE "vm_instances" DROP COLUMN IF EXISTS "processorManufacturer";
ALTER TABLE "vm_instances" ADD COLUMN IF NOT EXISTS "onDemandHourlyCost" DECIMAL(10,4) NOT NULL DEFAULT 0.0000;
ALTER TABLE "vm_instances" ADD COLUMN IF NOT EXISTS "potentialHourlyCost" DECIMAL(10,4);
ALTER TABLE "vm_instances" ADD COLUMN IF NOT EXISTS "storageSummary" VARCHAR(100);
ALTER TABLE "vm_instances" ALTER COLUMN "storageIops" SET DATA TYPE BIGINT;
ALTER TABLE "vm_instances" ALTER COLUMN "networkPerformance" SET DATA TYPE VARCHAR(255);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "instance_families_series_idx" ON "instance_families"("series");
