import { prisma } from '../config/database';
import { VmCapabilityMatrix } from '@prisma/client';
import { NormalizedVmCapabilityMatrixDTO } from '../types/normalized.dto';

export async function upsertVmCapabilityMatrix(
  data: Required<Omit<NormalizedVmCapabilityMatrixDTO, 'regionCode'>> & { regionId: string },
): Promise<VmCapabilityMatrix> {
  return prisma.vmCapabilityMatrix.upsert({
    where: {
      vmInstanceId_regionId_operatingSystem_tenancy_licenseType: {
        vmInstanceId: data.vmInstanceId,
        regionId: data.regionId,
        operatingSystem: data.operatingSystem,
        tenancy: data.tenancy,
        licenseType: data.licenseType ?? 'INCLUDED',
      },
    },
    update: {
      isRegionAvailable: data.isRegionAvailable,
      isActive: data.isActive,
    },
    create: {
      vmInstanceId: data.vmInstanceId,
      regionId: data.regionId,
      operatingSystem: data.operatingSystem,
      tenancy: data.tenancy,
      licenseType: data.licenseType ?? 'INCLUDED',
      isRegionAvailable: data.isRegionAvailable,
      isActive: data.isActive,
    },
  });
}

export async function getVmCapabilityMatrixId(
  vmInstanceId: string,
  regionId: string,
  operatingSystem: string,
  tenancy: string,
  licenseType: string | null,
): Promise<string | null> {
  const record = await prisma.vmCapabilityMatrix.findUnique({
    where: {
      vmInstanceId_regionId_operatingSystem_tenancy_licenseType: {
        vmInstanceId,
        regionId,
        operatingSystem: operatingSystem as any,
        tenancy: tenancy as any,
        licenseType: (licenseType ?? 'INCLUDED') as any,
      },
    },
    select: { id: true },
  });
  return record?.id ?? null;
}
