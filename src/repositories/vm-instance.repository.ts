import { prisma } from '../config/database';
import { VmInstance } from '@prisma/client';
import { NormalizedVmInstanceDTO } from '../types/normalized.dto';

export async function upsertVmInstance(
  data: NormalizedVmInstanceDTO & { serviceId: string; instanceFamilyId: string },
): Promise<VmInstance> {
  return prisma.vmInstance.upsert({
    where: {
      serviceId_instanceType: {
        serviceId: data.serviceId,
        instanceType: data.instanceType,
      },
    },
    update: {
      instanceFamilyId: data.instanceFamilyId,
      instanceSize: data.instanceSize,
      vcpu: data.vcpu,
      memoryGib: data.memoryGib,
      processor: data.processor,
      burstable: data.burstable,
      hasGpu: data.hasGpu,
      gpuCount: data.gpuCount,
      gpuModel: data.gpuModel,
      gpuMemoryGib: data.gpuMemoryGib,
      gpuManufacturer: data.gpuManufacturer,
      networkPerformance: data.networkPerformance,
      networkBandwidthGbps: data.networkBandwidthGbps,
    },
    create: {
      serviceId: data.serviceId,
      instanceFamilyId: data.instanceFamilyId,
      instanceType: data.instanceType,
      instanceSize: data.instanceSize,
      vcpu: data.vcpu,
      memoryGib: data.memoryGib,
      processor: data.processor,
      burstable: data.burstable,
      hasGpu: data.hasGpu,
      gpuCount: data.gpuCount,
      gpuModel: data.gpuModel,
      gpuMemoryGib: data.gpuMemoryGib,
      gpuManufacturer: data.gpuManufacturer,
      networkPerformance: data.networkPerformance,
      networkBandwidthGbps: data.networkBandwidthGbps,
    },
  });
}

export async function getVmInstanceMap(serviceId: string): Promise<Map<string, string>> {
  const instances = await prisma.vmInstance.findMany({
    where: { serviceId },
    select: { id: true, instanceType: true },
  });
  return new Map(instances.map(i => [i.instanceType, i.id]));
}

export async function updateVmInstanceAttributes(
  id: string,
  attributes: {
    processor?: string | null;
    storageSummary?: string | null;
    currentGeneration?: boolean;
  },
): Promise<VmInstance> {
  return prisma.vmInstance.update({
    where: { id },
    data: attributes,
  });
}
