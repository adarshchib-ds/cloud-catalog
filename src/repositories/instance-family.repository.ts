import { prisma } from '../config/database';
import { InstanceFamily } from '@prisma/client';
import { NormalizedInstanceFamilyDTO } from '../types/normalized.dto';

export async function upsertInstanceFamily(
  data: NormalizedInstanceFamilyDTO,
): Promise<InstanceFamily> {
  return prisma.instanceFamily.upsert({
    where: {
      providerId_name: {
        providerId: data.providerId,
        name: data.name,
      },
    },
    update: {
      series: data.series,
      processorManufacturer: data.processorManufacturer,
      architecture: data.architecture,
    },
    create: {
      providerId: data.providerId,
      name: data.name,
      series: data.series,
      processorManufacturer: data.processorManufacturer,
      architecture: data.architecture,
    },
  });
}

export async function getInstanceFamilyMap(providerId: string): Promise<Map<string, string>> {
  const families = await prisma.instanceFamily.findMany({
    where: { providerId },
    select: { id: true, name: true },
  });
  return new Map(families.map(f => [f.name, f.id]));
}
