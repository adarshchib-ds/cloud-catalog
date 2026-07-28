import {
  Architecture,
  ProcessorManufacturer,
  OperatingSystem,
  Tenancy,
  LicenseType,
  PricingType,
} from '@prisma/client';

export interface NormalizedRegionDTO {
  providerId: string;
  code: string;
  name: string;
  isActive: boolean;
}

export interface NormalizedInstanceFamilyDTO {
  providerId: string;
  name: string;
  series: string | null;
  processorManufacturer: ProcessorManufacturer | null;
  architecture: Architecture | null;
}

export interface NormalizedVmInstanceDTO {
  serviceId?: string; // Set by Sync Orchestrator
  instanceFamilyId?: string; // Set by Sync Orchestrator
  instanceType: string;
  instanceSize: string;
  vcpu: number;
  memoryGib: number;
  processor: string | null;
  cpuFrequencyGhz?: number | null;
  burstable: boolean;
  hasGpu: boolean;
  gpuCount: number | null;
  gpuModel: string | null;
  gpuMemoryGib: number | null;
  gpuManufacturer: string | null;
  networkPerformance: string | null;
  networkBandwidthGbps: number | null;
  storageSummary?: string | null;
  storageType?: any;
  storageSizeGib?: number | null;
  storageCount?: number | null;
  storageIops?: any;
  storageThroughputMbps?: number | null;
  supportsLiveMigration?: boolean;
  supportsNestedVirtualization?: boolean;
}

export interface NormalizedVmCapabilityMatrixDTO {
  vmInstanceId?: string; // Set dynamically
  regionCode: string; // Mapped to Region ID by repository
  operatingSystem: OperatingSystem;
  tenancy: Tenancy;
  licenseType: LicenseType | null;
  isRegionAvailable: boolean;
  isActive: boolean;
}

export interface NormalizedVmPricingDTO {
  capabilityMatrixId?: string; // Resolved by repository/orchestrator
  pricingType: PricingType;
  hourlyCost: number;
}
