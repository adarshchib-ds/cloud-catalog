import { prisma } from '../config/database';
import { VmPricing } from '@prisma/client';
import { NormalizedVmPricingDTO } from '../types/normalized.dto';

export async function upsertVmPricing(data: Required<NormalizedVmPricingDTO>): Promise<VmPricing> {
  return prisma.vmPricing.upsert({
    where: {
      capabilityMatrixId_pricingType: {
        capabilityMatrixId: data.capabilityMatrixId,
        pricingType: data.pricingType,
      },
    },
    update: {
      hourlyCost: data.hourlyCost,
    },
    create: {
      capabilityMatrixId: data.capabilityMatrixId,
      pricingType: data.pricingType,
      hourlyCost: data.hourlyCost,
    },
  });
}
