import { VmInstance, Service, Provider, InstanceFamily } from '@prisma/client';
import { InstanceSpec, ServiceSummary, ProviderSummary, FamilySummary } from '@/types';

export function pickInstanceFields(
  row: VmInstance & { instanceFamily: InstanceFamily },
): InstanceSpec {
  return {
    id: row.id,
    instanceType: row.instanceType,
    instanceSize: row.instanceSize,
    displayName: row.displayName,
    generation: row.generation,
    vcpu: row.vcpu,
    memoryGib: row.memoryGib,
    architecture: row.instanceFamily.architecture || 'X86_64',
    processor: row.processor,
    processorManufacturer: row.instanceFamily.processorManufacturer,
    cpuFrequencyGhz: row.cpuFrequencyGhz,
    burstable: row.burstable,
    isCustomSizeAllowed: row.isCustomSizeAllowed,
    supportsLiveMigration: row.supportsLiveMigration,
    supportsNestedVirtualization: row.supportsNestedVirtualization,
    hasGpu: row.hasGpu,
    gpuCount: row.gpuCount,
    gpuModel: row.gpuModel,
    gpuMemoryGib: row.gpuMemoryGib,
    gpuManufacturer: row.gpuManufacturer,
    storageType: row.storageType,
    storageSizeGib: row.storageSizeGib,
    storageCount: row.storageCount,
    storageIops: row.storageIops !== null ? Number(row.storageIops) : null,
    storageThroughputMbps: row.storageThroughputMbps,
    ebsOptimized: row.ebsOptimized,
    networkPerformance: row.networkPerformance,
    networkBandwidthGbps: row.networkBandwidthGbps,
    enhancedNetworking: row.enhancedNetworking,
    currentGeneration: row.currentGeneration,
  };
}

export function pickServiceFields(service: Service & { provider: Provider }): ServiceSummary {
  return { id: service.id, name: service.name, slug: service.slug };
}

export function pickProviderFields(provider: Provider): ProviderSummary {
  return { id: provider.id, name: provider.name, slug: provider.slug };
}

export function pickFamilyFields(family: InstanceFamily): FamilySummary {
  return { id: family.id, name: family.name };
}
