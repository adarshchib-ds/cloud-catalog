-- CreateEnum
CREATE TYPE "Architecture" AS ENUM ('X86_64', 'ARM64', 'X86');

-- CreateEnum
CREATE TYPE "LicenseType" AS ENUM ('INCLUDED', 'BYOL');

-- CreateEnum
CREATE TYPE "OperatingSystem" AS ENUM ('LINUX', 'WINDOWS', 'UBUNTU', 'RED_HAT', 'SUSE');

-- CreateEnum
CREATE TYPE "ProcessorManufacturer" AS ENUM ('INTEL', 'AMD', 'AWS_GRAVITON', 'GOOGLE', 'MICROSOFT', 'NVIDIA', 'OTHER');

-- CreateEnum
CREATE TYPE "StorageType" AS ENUM ('SSD', 'HDD', 'NVME', 'NETWORK');

-- CreateEnum
CREATE TYPE "Tenancy" AS ENUM ('SHARED', 'DEDICATED_INSTANCE', 'DEDICATED_HOST', 'SOLE_TENANT');

-- CreateTable
CREATE TABLE "categories" (
    "id" VARCHAR(36) NOT NULL,
    "slug" VARCHAR(50) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "description" VARCHAR(500),
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "instance_families" (
    "id" VARCHAR(36) NOT NULL,
    "providerId" VARCHAR(20) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "description" VARCHAR(500),

    CONSTRAINT "instance_families_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "providers" (
    "id" VARCHAR(20) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "slug" VARCHAR(50) NOT NULL,
    "websiteUrl" VARCHAR(500),
    "logoUrl" VARCHAR(500),

    CONSTRAINT "providers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "regions" (
    "id" VARCHAR(36) NOT NULL,
    "providerId" VARCHAR(20) NOT NULL,
    "code" VARCHAR(50) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "continent" VARCHAR(50),
    "country" VARCHAR(50),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "regions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "services" (
    "id" VARCHAR(36) NOT NULL,
    "providerId" VARCHAR(20) NOT NULL,
    "categoryId" VARCHAR(36) NOT NULL,
    "slug" VARCHAR(100) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "description" VARCHAR(2000),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "services_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vm_capability_matrix" (
    "id" VARCHAR(36) NOT NULL,
    "vmInstanceId" VARCHAR(36) NOT NULL,
    "regionId" VARCHAR(36) NOT NULL,
    "operatingSystem" "OperatingSystem" NOT NULL,
    "tenancy" "Tenancy" NOT NULL,
    "licenseType" "LicenseType" DEFAULT 'INCLUDED',
    "isRegionAvailable" BOOLEAN NOT NULL DEFAULT true,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vm_capability_matrix_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vm_instances" (
    "id" VARCHAR(36) NOT NULL,
    "serviceId" VARCHAR(36) NOT NULL,
    "instanceFamilyId" VARCHAR(36) NOT NULL,
    "instanceType" VARCHAR(100) NOT NULL,
    "instanceSize" VARCHAR(50) NOT NULL,
    "displayName" VARCHAR(200),
    "generation" INTEGER,
    "vcpu" INTEGER NOT NULL,
    "memoryGib" DOUBLE PRECISION NOT NULL,
    "architecture" "Architecture" NOT NULL,
    "processor" VARCHAR(200),
    "processorManufacturer" "ProcessorManufacturer",
    "cpuFrequencyGhz" DOUBLE PRECISION,
    "burstable" BOOLEAN NOT NULL DEFAULT false,
    "isCustomSizeAllowed" BOOLEAN NOT NULL DEFAULT false,
    "supportsLiveMigration" BOOLEAN NOT NULL DEFAULT false,
    "supportsNestedVirtualization" BOOLEAN NOT NULL DEFAULT false,
    "hasGpu" BOOLEAN NOT NULL DEFAULT false,
    "gpuCount" INTEGER,
    "gpuModel" VARCHAR(200),
    "gpuMemoryGib" DOUBLE PRECISION,
    "gpuManufacturer" VARCHAR(100),
    "storageType" "StorageType",
    "storageSizeGib" DOUBLE PRECISION,
    "storageCount" INTEGER,
    "storageIops" INTEGER,
    "storageThroughputMbps" DOUBLE PRECISION,
    "ebsOptimized" BOOLEAN DEFAULT false,
    "networkPerformance" VARCHAR(100),
    "networkBandwidthGbps" DOUBLE PRECISION,
    "enhancedNetworking" BOOLEAN NOT NULL DEFAULT false,
    "currentGeneration" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vm_instances_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "categories_slug_key" ON "categories"("slug" ASC);

-- CreateIndex
CREATE INDEX "instance_families_providerId_idx" ON "instance_families"("providerId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "instance_families_providerId_name_key" ON "instance_families"("providerId" ASC, "name" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "providers_name_key" ON "providers"("name" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "providers_slug_key" ON "providers"("slug" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "regions_providerId_code_key" ON "regions"("providerId" ASC, "code" ASC);

-- CreateIndex
CREATE INDEX "regions_providerId_idx" ON "regions"("providerId" ASC);

-- CreateIndex
CREATE INDEX "services_categoryId_idx" ON "services"("categoryId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "services_providerId_categoryId_slug_key" ON "services"("providerId" ASC, "categoryId" ASC, "slug" ASC);

-- CreateIndex
CREATE INDEX "services_providerId_idx" ON "services"("providerId" ASC);

-- CreateIndex
CREATE INDEX "vm_capability_matrix_isActive_idx" ON "vm_capability_matrix"("isActive" ASC);

-- CreateIndex
CREATE INDEX "vm_capability_matrix_regionId_idx" ON "vm_capability_matrix"("regionId" ASC);

-- CreateIndex
CREATE INDEX "vm_capability_matrix_vmInstanceId_idx" ON "vm_capability_matrix"("vmInstanceId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "vm_capability_matrix_vmInstanceId_regionId_operatingSystem__key" ON "vm_capability_matrix"("vmInstanceId" ASC, "regionId" ASC, "operatingSystem" ASC, "tenancy" ASC, "licenseType" ASC);

-- CreateIndex
CREATE INDEX "vm_instances_architecture_idx" ON "vm_instances"("architecture" ASC);

-- CreateIndex
CREATE INDEX "vm_instances_hasGpu_idx" ON "vm_instances"("hasGpu" ASC);

-- CreateIndex
CREATE INDEX "vm_instances_instanceFamilyId_idx" ON "vm_instances"("instanceFamilyId" ASC);

-- CreateIndex
CREATE INDEX "vm_instances_memoryGib_idx" ON "vm_instances"("memoryGib" ASC);

-- CreateIndex
CREATE INDEX "vm_instances_serviceId_idx" ON "vm_instances"("serviceId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "vm_instances_serviceId_instanceType_key" ON "vm_instances"("serviceId" ASC, "instanceType" ASC);

-- CreateIndex
CREATE INDEX "vm_instances_vcpu_idx" ON "vm_instances"("vcpu" ASC);

-- AddForeignKey
ALTER TABLE "instance_families" ADD CONSTRAINT "instance_families_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "regions" ADD CONSTRAINT "regions_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "services" ADD CONSTRAINT "services_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "services" ADD CONSTRAINT "services_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vm_capability_matrix" ADD CONSTRAINT "vm_capability_matrix_regionId_fkey" FOREIGN KEY ("regionId") REFERENCES "regions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vm_capability_matrix" ADD CONSTRAINT "vm_capability_matrix_vmInstanceId_fkey" FOREIGN KEY ("vmInstanceId") REFERENCES "vm_instances"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vm_instances" ADD CONSTRAINT "vm_instances_instanceFamilyId_fkey" FOREIGN KEY ("instanceFamilyId") REFERENCES "instance_families"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vm_instances" ADD CONSTRAINT "vm_instances_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "services"("id") ON DELETE CASCADE ON UPDATE CASCADE;

