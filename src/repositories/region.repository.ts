import { prisma } from '../config/database';
import { Region } from '@prisma/client';
import { NormalizedRegionDTO } from '../types/normalized.dto';

export async function upsertRegion(data: NormalizedRegionDTO): Promise<Region> {
  return prisma.region.upsert({
    where: {
      providerId_code: {
        providerId: data.providerId,
        code: data.code,
      },
    },
    update: {
      name: data.name,
      isActive: data.isActive,
    },
    create: {
      providerId: data.providerId,
      code: data.code,
      name: data.name,
      isActive: data.isActive,
    },
  });
}

export async function getRegionMap(providerId: string): Promise<Map<string, string>> {
  const regions = await prisma.region.findMany({
    where: { providerId },
    select: { id: true, code: true },
  });
  return new Map(regions.map(r => [r.code, r.id]));
}
