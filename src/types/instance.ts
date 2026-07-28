import { Architecture, StorageType, ProcessorManufacturer } from '@prisma/client';

export interface ProviderSummary {
  id: string;
  name: string;
  slug: string;
}

export interface ServiceSummary {
  id: string;
  name: string;
  slug: string;
}

export interface FamilySummary {
  id: string;
  name: string;
}

export interface InstanceSpec {
  id: string;
  instanceType: string;
  instanceSize: string;
  displayName: string | null;
  generation: number | null;
  vcpu: number;
  memoryGib: number;
  architecture: Architecture;
  processor: string | null;
  processorManufacturer: ProcessorManufacturer | null;
  cpuFrequencyGhz: number | null;
  burstable: boolean;
  isCustomSizeAllowed: boolean;
  supportsLiveMigration: boolean;
  supportsNestedVirtualization: boolean;
  hasGpu: boolean;
  gpuCount: number | null;
  gpuModel: string | null;
  gpuMemoryGib: number | null;
  gpuManufacturer: string | null;
  storageType: StorageType | null;
  storageSizeGib: number | null;
  storageCount: number | null;
  storageIops: number | null;
  storageThroughputMbps: number | null;
  ebsOptimized: boolean | null;
  storageSummary: string | null;
  networkPerformance: string | null;
  networkBandwidthGbps: number | null;
  enhancedNetworking: boolean;
  currentGeneration: boolean;
  hourlyCost?: number | null;
}

export interface EquivalentInstance {
  id: string;
  instanceType: string;
  displayName: string | null;
  vcpu: number;
  memoryGib: number;
  architecture: Architecture;
  processor: string | null;
  provider: ProviderSummary;
  service: ServiceSummary;
  matchScore: number;
  burstable: boolean;
  currentGeneration: boolean;
  storageType: StorageType | null;
  storageSizeGib: number | null;
  storageIops: number | null;
  networkPerformance: string | null;
  gpuCount: number | null;
  gpuModel: string | null;
  gpuMemoryGib: number | null;
}

export interface EquivalentsMap {
  aws: EquivalentInstance[];
  azure: EquivalentInstance[];
  gcp: EquivalentInstance[];
}

export interface SearchInstanceResult {
  instance: InstanceSpec;
  provider: ProviderSummary;
  service: ServiceSummary;
  family: FamilySummary;
  equivalents: EquivalentsMap;
}

export interface FamilyRecommendation {
  family: { id: string; name: string; description: string | null };
  provider: ProviderSummary;
  instanceCount: number;
  vcpuRange: { min: number; max: number };
  memoryRange: { min: number; max: number };
  hasGpu: boolean;
  instances: InstanceSpec[];
}
