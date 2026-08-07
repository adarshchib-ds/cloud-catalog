import { Prisma, VmInstance, Service, Provider, InstanceFamily } from '@prisma/client';
import { prisma as db } from '@config/database';
import { SearchInstancesQuery, FamilyRecommendationQuery } from '@validators/instance.validator';
import { SearchInstanceResult, InstanceSpec, ProviderSummary, FamilyRecommendation } from '@/types';
import { MAX_EQUIVALENTS_PER_PROVIDER } from '@/constants/instance';
import {
  pickInstanceFields,
  pickServiceFields,
  pickProviderFields,
  pickFamilyFields,
} from '../mappers/instance.mapper';
import { computeMatchScore } from '../utils/matching.utils';
import { calculateDetailedPricing } from '../utils/pricing';

type VmInstanceWithRelations = VmInstance & {
  service: Service & { provider: Provider };
  instanceFamily: InstanceFamily;
};

interface PaginatedInstances {
  items: SearchInstanceResult[];
  totalCount: number;
  page: number;
  pageSize: number;
  globalStats?: {
    totalInstances: number;
    gpuInstances: number;
    totalProviders: number;
  };
}

function buildRegionFilter(regionInput: string): Prisma.RegionWhereInput {
  const raw = regionInput.trim();
  const cleaned = raw.replace(/\(\s*\)/g, '').trim();
  const codeInParenMatch = cleaned.match(/\(([^()]+)\)\s*$/);
  const codeInParen = codeInParenMatch ? codeInParenMatch[1].trim() : null;
  const nameWithoutParen = cleaned.replace(/\([^()]*\)/g, '').trim();

  const conditions: Prisma.RegionWhereInput[] = [
    { code: { contains: cleaned, mode: 'insensitive' } },
    { name: { contains: cleaned, mode: 'insensitive' } },
  ];

  if (codeInParen) {
    conditions.push({ code: { contains: codeInParen, mode: 'insensitive' } });
  }

  if (nameWithoutParen && nameWithoutParen !== cleaned) {
    conditions.push({ name: { contains: nameWithoutParen, mode: 'insensitive' } });
  }

  return {
    OR: conditions,
    isActive: true,
  };
}

function buildWhereClause(filters: SearchInstancesQuery): Prisma.VmInstanceWhereInput {
  const where: Prisma.VmInstanceWhereInput = {};

  if (filters.provider) {
    where.service = { providerId: filters.provider, isActive: true };
  } else {
    where.service = { isActive: true };
  }

  if (filters.minVcpu) {
    where.vcpu = filters.minVcpu;
  }

  if (filters.minMemory) {
    where.memoryGib = filters.minMemory;
  }

  if (filters.hasGpu !== undefined) {
    where.hasGpu = filters.hasGpu;
  }

  if (filters.architecture || filters.instanceFamily) {
    where.instanceFamily = {};
    if (filters.architecture) {
      where.instanceFamily.architecture = filters.architecture;
    }
    if (filters.instanceFamily) {
      where.instanceFamily.name = { contains: filters.instanceFamily, mode: 'insensitive' };
    }
  }

  if (filters.service) {
    where.service = {
      ...(where.service as Prisma.ServiceWhereInput),
      slug: { contains: filters.service, mode: 'insensitive' },
    };
  }

  if (filters.region || filters.tenancy) {
    const matrixWhere: Prisma.VmCapabilityMatrixWhereInput = {
      isActive: true,
      isRegionAvailable: true,
    };

    if (filters.region) {
      matrixWhere.region = buildRegionFilter(filters.region);
    }

    if (filters.tenancy) {
      matrixWhere.tenancy = filters.tenancy as Prisma.EnumTenancyFilter['equals'];
    }

    where.vmCapabilityMatrix = { some: matrixWhere };
  }

  if (filters.search) {
    const searchVal = filters.search.trim();
    if (searchVal) {
      where.OR = [
        { instanceType: { contains: searchVal, mode: 'insensitive' } },
        { displayName: { contains: searchVal, mode: 'insensitive' } },
        { processor: { contains: searchVal, mode: 'insensitive' } },
        { instanceFamily: { name: { contains: searchVal, mode: 'insensitive' } } },
      ];
    }
  }

  return where;
}

async function findEquivalents(
  sourceInstances: VmInstanceWithRelations[],
  otherProviderIds: string[],
): Promise<Map<string, any>> {
  const equivalentMap = new Map<string, any>();

  for (const source of sourceInstances) {
    equivalentMap.set(source.id, { aws: [], azure: [], gcp: [] });
  }

  if (otherProviderIds.length === 0 || sourceInstances.length === 0) return equivalentMap;

  const vcpuSet = [...new Set(sourceInstances.map(s => s.vcpu))];
  const memorySet = [...new Set(sourceInstances.map(s => s.memoryGib))];
  const gpuSet = [...new Set(sourceInstances.map(s => s.hasGpu))];

  const allCandidates = await db.vmInstance.findMany({
    where: {
      service: { providerId: { in: otherProviderIds }, isActive: true },
      vcpu: { in: vcpuSet },
      memoryGib: { in: memorySet },
      ...(gpuSet.length === 1 ? { hasGpu: gpuSet[0] } : {}),
      vmCapabilityMatrix: {
        some: {
          isActive: true,
          isRegionAvailable: true,
        },
      },
    },
    include: {
      service: { include: { provider: true } },
      instanceFamily: true,
      vmCapabilityMatrix: {
        where: { isActive: true, isRegionAvailable: true },
        include: {
          pricings: {
            where: {
              pricingType: 'ON_DEMAND',
            },
          },
        },
      },
    },
  });

  const candidatesByProvider = new Map<string, typeof allCandidates>();
  for (const c of allCandidates) {
    const pid = c.service.providerId;
    if (!candidatesByProvider.has(pid)) candidatesByProvider.set(pid, []);
    candidatesByProvider.get(pid)!.push(c);
  }

  for (const source of sourceInstances) {
    const vcpuRange = 1;
    const memRange = 1;

    const equivalents = equivalentMap.get(source.id)!;

    for (const [providerId, candidates] of candidatesByProvider) {
      const matched = candidates
        .filter(
          c =>
            c.vcpu === source.vcpu &&
            c.memoryGib === source.memoryGib &&
            c.hasGpu === source.hasGpu,
        )
        .map(c => {
          const candCost = resolveHourlyCost(c);
          const pricingInfo = calculateDetailedPricing(candCost);
          return {
            id: c.id,
            instanceType: c.instanceType,
            displayName: c.displayName,
            vcpu: c.vcpu,
            memoryGib: c.memoryGib,
            architecture: c.instanceFamily.architecture || 'X86_64',
            processor: c.processor,
            provider: pickProviderFields(c.service.provider),
            service: pickServiceFields(c.service),
            matchScore: computeMatchScore(
              { vcpu: source.vcpu, memoryGib: source.memoryGib },
              { vcpu: c.vcpu, memoryGib: c.memoryGib },
              vcpuRange,
              memRange,
            ),
            burstable: c.burstable,
            currentGeneration: c.currentGeneration,
            storageType: c.storageType,
            storageSizeGib: c.storageSizeGib,
            storageIops: c.storageIops !== null ? Number(c.storageIops) : null,
            networkPerformance: c.networkPerformance,
            gpuCount: c.gpuCount,
            gpuModel: c.gpuModel,
            gpuMemoryGib: c.gpuMemoryGib,
            ...pricingInfo,
          };
        })
        .sort((a, b) => b.matchScore - a.matchScore)
        .slice(0, MAX_EQUIVALENTS_PER_PROVIDER);

      equivalents[providerId as keyof any] = matched;
    }
  }

  return equivalentMap;
}

function resolveHourlyCost(inst: any, filters?: SearchInstancesQuery): number | null {
  const matrices = inst.vmCapabilityMatrix || [];

  // Filter only matrices that have ON_DEMAND pricing with positive cost
  const onDemandMatrices = matrices.filter((m: any) =>
    m.pricings?.some((p: any) => p.pricingType === 'ON_DEMAND' && Number(p.hourlyCost) > 0),
  );

  if (onDemandMatrices.length === 0) return null;

  // Try matching filters (region/tenancy)
  let candidates = [...onDemandMatrices];

  if (filters?.region) {
    const raw = filters.region.trim().toLowerCase();
    const clean = raw.replace(/\(\s*\)/g, '').trim();
    const regionMatches = candidates.filter((m: any) =>
      m.region?.code?.toLowerCase().includes(clean) ||
      m.region?.name?.toLowerCase().includes(clean)
    );
    if (regionMatches.length > 0) candidates = regionMatches;
  }

  if (filters?.tenancy) {
    const tenancyMatches = candidates.filter((m: any) => m.tenancy === filters.tenancy);
    if (tenancyMatches.length > 0) candidates = tenancyMatches;
  }

  // Prefer LINUX operating system as default
  const linuxMatches = candidates.filter((m: any) => m.operatingSystem === 'LINUX');
  const chosenMatrix = linuxMatches.length > 0 ? linuxMatches[0] : candidates[0];

  const pricing = chosenMatrix?.pricings?.find((p: any) => p.pricingType === 'ON_DEMAND');
  return pricing ? Number(pricing.hourlyCost) : null;
}

export async function searchInstances(filters: SearchInstancesQuery): Promise<PaginatedInstances> {
  const { page, pageSize } = filters;
  const where = buildWhereClause(filters);

  const [dbResults, totalCount, globalTotalCount, globalGpuCount, globalProviderCount] =
    await Promise.all([
      db.vmInstance.findMany({
        where,
        include: {
          service: { include: { provider: true } },
          instanceFamily: true,
          vmCapabilityMatrix: {
            where: {
              isActive: true,
              isRegionAvailable: true,
            },
            include: {
              region: true,
              pricings: {
                where: {
                  pricingType: 'ON_DEMAND',
                },
              },
            },
          },
        },
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: [{ vcpu: 'desc' }, { memoryGib: 'desc' }, { id: 'asc' }],
      }),
      db.vmInstance.count({ where }),
      db.vmInstance.count(),
      db.vmInstance.count({ where: { hasGpu: true } }),
      db.provider.count(),
    ]);

  const sourceProviderIds = [...new Set(dbResults.map(r => r.service.providerId))];
  const allProviderIds = ['aws', 'azure', 'gcp'];
  const otherProviderIds = allProviderIds.filter(id => !sourceProviderIds.includes(id));

  const equivalentMap = await findEquivalents(dbResults, otherProviderIds);

  const items: SearchInstanceResult[] = dbResults.map(row => {
    const hourlyCost = resolveHourlyCost(row, filters);
    return {
      instance: pickInstanceFields(row, hourlyCost),
      provider: pickProviderFields(row.service.provider),
      service: pickServiceFields(row.service),
      family: pickFamilyFields(row.instanceFamily),
      equivalents: equivalentMap.get(row.id) ?? { aws: [], azure: [], gcp: [] },
    };
  });

  return {
    items,
    totalCount,
    page,
    pageSize,
    globalStats: {
      totalInstances: globalTotalCount,
      gpuInstances: globalGpuCount,
      totalProviders: globalProviderCount,
    },
  };
}

function buildFamilyWhereClause(filters: FamilyRecommendationQuery): Prisma.VmInstanceWhereInput {
  const where: Prisma.VmInstanceWhereInput = {};

  if (filters.provider) {
    where.service = { providerId: filters.provider, isActive: true };
  } else {
    where.service = { isActive: true };
  }

  if (filters.vcpu) {
    where.vcpu = filters.vcpu;
  }

  if (filters.memory) {
    where.memoryGib = filters.memory;
  }

  if (filters.hasGpu !== undefined) {
    where.hasGpu = filters.hasGpu;
  }

  if (filters.region || filters.tenancy || filters.operatingSystem) {
    const matrixWhere: Prisma.VmCapabilityMatrixWhereInput = {
      isActive: true,
      isRegionAvailable: true,
    };

    if (filters.region) {
      matrixWhere.region = buildRegionFilter(filters.region);
    }

    if (filters.tenancy) {
      matrixWhere.tenancy = filters.tenancy as Prisma.EnumTenancyFilter['equals'];
    }

    if (filters.operatingSystem) {
      matrixWhere.operatingSystem = filters.operatingSystem;
    }

    where.vmCapabilityMatrix = { some: matrixWhere };
  }

  return where;
}

export interface PaginatedFamilyRecommendations {
  items: FamilyRecommendation[];
  totalCount: number;
  page: number;
  pageSize: number;
}

export async function recommendFamilies(
  filters: FamilyRecommendationQuery,
): Promise<PaginatedFamilyRecommendations> {
  const page = filters.page || 1;
  const pageSize = filters.pageSize || 12;
  const where = buildFamilyWhereClause(filters);

  const dbResults = await db.vmInstance.findMany({
    where,
    include: {
      service: { include: { provider: true } },
      instanceFamily: true,
    },
    orderBy: [{ vcpu: 'desc' }, { memoryGib: 'desc' }],
  });

  const familyMap = new Map<
    string,
    {
      family: { id: string; name: string; description: string | null };
      provider: ProviderSummary;
      instances: InstanceSpec[];
      vcpuValues: number[];
      memoryValues: number[];
      hasGpu: boolean;
    }
  >();

  for (const row of dbResults) {
    const key = `${row.instanceFamily.id}:${row.service.providerId}`;

    if (!familyMap.has(key)) {
      familyMap.set(key, {
        family: {
          id: row.instanceFamily.id,
          name: row.instanceFamily.name,
          description: row.instanceFamily.description,
        },
        provider: pickProviderFields(row.service.provider),
        instances: [],
        vcpuValues: [],
        memoryValues: [],
        hasGpu: false,
      });
    }

    const group = familyMap.get(key)!;
    group.instances.push(pickInstanceFields(row));
    group.vcpuValues.push(row.vcpu);
    group.memoryValues.push(row.memoryGib);
    if (row.hasGpu) group.hasGpu = true;
  }

  const recommendations: FamilyRecommendation[] = [];

  for (const group of familyMap.values()) {
    recommendations.push({
      family: group.family,
      provider: group.provider,
      instanceCount: group.instances.length,
      vcpuRange: {
        min: Math.min(...group.vcpuValues),
        max: Math.max(...group.vcpuValues),
      },
      memoryRange: {
        min: Math.min(...group.memoryValues),
        max: Math.max(...group.memoryValues),
      },
      hasGpu: group.hasGpu,
      instances: group.instances,
    });
  }

  recommendations.sort((a, b) => b.instanceCount - a.instanceCount);

  const totalCount = recommendations.length;
  const startIndex = (page - 1) * pageSize;
  const paginatedItems = recommendations.slice(startIndex, startIndex + pageSize);

  return {
    items: paginatedItems,
    totalCount,
    page,
    pageSize,
  };
}

export async function getRegions(providerId?: string) {
  return db.region.findMany({
    where: {
      isActive: true,
      ...(providerId ? { providerId } : {}),
      vmCapabilityMatrix: {
        some: {
          isActive: true,
        },
      },
    },
    orderBy: {
      name: 'asc',
    },
  });
}

export async function getInstancesMetadata() {
  const [vcpus, memories, families, matrices] = await Promise.all([
    db.vmInstance.findMany({ select: { vcpu: true }, distinct: ['vcpu'] }),
    db.vmInstance.findMany({ select: { memoryGib: true }, distinct: ['memoryGib'] }),
    db.instanceFamily.findMany({ select: { name: true }, distinct: ['name'] }),
    db.vmCapabilityMatrix.findMany({
      select: {
        operatingSystem: true,
        tenancy: true,
        vmInstance: {
          select: {
            service: {
              select: {
                provider: {
                  select: { slug: true, id: true },
                },
              },
            },
          },
        },
      },
      distinct: ['operatingSystem', 'tenancy', 'vmInstanceId'],
    }),
  ]);

  const allOsSet = new Set<string>();
  const allTenancySet = new Set<string>();
  const byProvider: Record<string, Set<string>> = {
    aws: new Set(),
    azure: new Set(),
    gcp: new Set(),
  };
  const tenanciesByProvider: Record<string, Set<string>> = {
    aws: new Set(),
    azure: new Set(),
    gcp: new Set(),
  };

  const isInvalidOs = (os: string) => {
    const clean = os.toUpperCase().trim();
    return clean === 'NA' || clean === 'N/A' || clean === 'NONE' || clean === 'UNKNOWN';
  };

  for (const m of matrices) {
    const slug = m.vmInstance?.service?.provider?.slug?.toLowerCase() || m.vmInstance?.service?.provider?.id?.toLowerCase() || '';

    if (m.operatingSystem && !isInvalidOs(m.operatingSystem)) {
      allOsSet.add(m.operatingSystem);
      if (slug.includes('aws') || slug.includes('amazon')) {
        byProvider.aws.add(m.operatingSystem);
      } else if (slug.includes('azure') || slug.includes('microsoft')) {
        byProvider.azure.add(m.operatingSystem);
      } else if (slug.includes('gcp') || slug.includes('google')) {
        byProvider.gcp.add(m.operatingSystem);
      }
    }

    if (m.tenancy) {
      allTenancySet.add(m.tenancy);
      if (slug.includes('aws') || slug.includes('amazon')) {
        tenanciesByProvider.aws.add(m.tenancy);
      } else if (slug.includes('azure') || slug.includes('microsoft')) {
        tenanciesByProvider.azure.add(m.tenancy);
      } else if (slug.includes('gcp') || slug.includes('google')) {
        tenanciesByProvider.gcp.add(m.tenancy);
      }
    }
  }

  const providers = {
    aws: Array.from(byProvider.aws).sort(),
    azure: Array.from(byProvider.azure).sort(),
    gcp: Array.from(byProvider.gcp).sort(),
  };

  const providerTenancies = {
    aws: Array.from(tenanciesByProvider.aws).sort(),
    azure: Array.from(tenanciesByProvider.azure).sort(),
    gcp: Array.from(tenanciesByProvider.gcp).sort(),
  };

  return {
    vcpus: vcpus.map(v => v.vcpu).sort((a, b) => a - b),
    memories: memories.map(m => m.memoryGib).sort((a, b) => a - b),
    families: families.map(f => f.name).sort(),
    operatingSystems: Array.from(allOsSet).sort(),
    tenancies: Array.from(allTenancySet).sort(),
    providers,
    byProvider: providers,
    tenanciesByProvider: providerTenancies,
  };
}
