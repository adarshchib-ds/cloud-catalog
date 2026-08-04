import { prisma as db } from '@config/database';
import { SmartRecommendationBody } from '@validators/instance.validator';
import { calculatePriceRange } from '@utils/pricing';
import { parseInstanceMeta, calculateScore } from '@utils/recommendation-utils';
import {
  mapToRecommendationResponseDto,
  RecommendationResponseDto,
} from '@utils/recommendation.mapper';

const MONTHLY_HOURS = 720;

export async function getSmartRecommendations(
  criteria: SmartRecommendationBody,
): Promise<RecommendationResponseDto> {
  const { reqVcpu, reqMemoryGib, region, tenancy, operatingSystem, pricingModel } = criteria;

  // ── 1. Dynamic Baseline Provider Selection ────────────────────────────────
  // Determine eligible providers that satisfy the capability matrix filters
  const matrixFilter: any = { isActive: true, isRegionAvailable: true };
  
  const validTenancyValues = ['SHARED', 'DEDICATED_INSTANCE', 'DEDICATED_HOST', 'SOLE_TENANT'];
  if (tenancy) {
    if (!validTenancyValues.includes(tenancy)) {
      // Invalid enum string passed (e.g. unsupported filter) -> return empty recommendation cleanly
      return {
        autoSuggestedFamily: 'General Purpose',
        matrixRows: [],
      };
    }
    matrixFilter.tenancy = tenancy;
  }
  if (operatingSystem) matrixFilter.operatingSystem = operatingSystem;
  if (region) {
    matrixFilter.region = { code: { contains: region, mode: 'insensitive' }, isActive: true };
  }

  // Find all providers with matching capability rows
  const matchingProviders = await db.provider.findMany({
    where: {
      services: {
        some: {
          isActive: true,
          vmInstances: {
            some: {
              ...(reqVcpu ? { vcpu: reqVcpu } : {}),
              ...(reqMemoryGib ? { memoryGib: reqMemoryGib } : {}),
              vmCapabilityMatrix: { some: matrixFilter },
            },
          },
        },
      },
    },
    select: { id: true, slug: true },
  });

  // Default priority order: AWS -> Azure -> GCP (if multiple match), or whichever provider satisfies criteria
  const baselineProvider =
    matchingProviders.find(p => p.slug === 'amazon-web-services' || p.id === 'aws') ||
    matchingProviders.find(p => p.slug.includes('azure') || p.id === 'azure') ||
    matchingProviders.find(p => p.slug.includes('gcp') || p.id === 'gcp') ||
    matchingProviders[0];

  if (!baselineProvider) {
    return {
      autoSuggestedFamily: 'General Purpose',
      matrixRows: [],
    };
  }

  // ── 2. Build baseline candidate query ──────────────────────────────────────
  const baselineWhere: any = {
    service: { providerId: baselineProvider.id, isActive: true },
    ...(reqVcpu ? { vcpu: reqVcpu } : {}),
    ...(reqMemoryGib ? { memoryGib: reqMemoryGib } : {}),
  };

  if (region || tenancy || operatingSystem) {
    baselineWhere.vmCapabilityMatrix = { some: matrixFilter };
  }

  const targetType = pricingModel || 'ON_DEMAND';

  // Helper to resolve pricing from relational structure in memory
  const getHourlyCost = (inst: any): number => {
    const matrices = inst.vmCapabilityMatrix || [];

    const matricesWithTargetType = matrices.filter((m: any) =>
      m.pricings?.some((p: any) => p.pricingType === targetType && Number(p.hourlyCost) > 0),
    );

    const activeMatrices = matricesWithTargetType.length > 0 ? matricesWithTargetType : matrices;
    const resolvedType = matricesWithTargetType.length > 0 ? targetType : 'ON_DEMAND';

    const getAzureRegionCode = (awsCode: string): string => {
      const map: Record<string, string> = {
        'eu-west-1': 'northeurope',
        'eu-west-3': 'westeurope',
        'us-east-1': 'eastus',
        'us-east-2': 'eastus2',
        'us-west-1': 'westus',
        'us-west-2': 'westus2',
        'eu-central-1': 'germanywestcentral',
        'eu-west-2': 'uksouth',
        'ap-south-1': 'centralindia',
        'ap-northeast-1': 'japaneast',
        'ap-southeast-1': 'southeastasia',
        'ap-southeast-2': 'australiaeast',
        'sa-east-1': 'brazilsouth',
      };
      return map[awsCode.toLowerCase()] || awsCode;
    };

    let matrix = activeMatrices.find((m: any) => {
      if (
        region &&
        !m.region?.code?.toLowerCase().includes(region.toLowerCase()) &&
        !m.region?.code?.toLowerCase().includes(getAzureRegionCode(region).toLowerCase())
      )
        return false;
      if (tenancy && m.tenancy !== tenancy) return false;
      if (operatingSystem && m.operatingSystem !== operatingSystem) return false;
      return true;
    });

    if (!matrix && !tenancy && !operatingSystem) {
      matrix = activeMatrices.find((m: any) => {
        if (
          region &&
          !m.region?.code?.toLowerCase().includes(region.toLowerCase()) &&
          !m.region?.code?.toLowerCase().includes(getAzureRegionCode(region).toLowerCase())
        )
          return false;
        return true;
      });
    }

    if (!matrix && !tenancy && !operatingSystem && !region) {
      matrix = activeMatrices[0];
    }

    const pricing = matrix?.pricings?.find((p: any) => p.pricingType === resolvedType);
    return pricing ? Number(pricing.hourlyCost) : 0;
  };

  const getHourlyCostRange = (inst: any): { min: number; max: number } => {
    const baseCost = getHourlyCost(inst);
    return calculatePriceRange(baseCost);
  };

  const capabilityInclude = {
    service: { include: { provider: true } },
    instanceFamily: true,
    vmCapabilityMatrix: {
      where: {
        isActive: true,
        isRegionAvailable: true,
        ...(tenancy ? { tenancy } : {}),
        ...(operatingSystem ? { operatingSystem } : {}),
      },
      include: {
        region: true,
        pricings: true,
      },
    },
  };

  const page = criteria.page || 1;
  const pageSize = criteria.pageSize || 20;

  // ── 3. Fetch baseline provider candidates ──────────────────────────────────
  const baselineInstances = (await db.vmInstance.findMany({
    where: baselineWhere,
    skip: (page - 1) * pageSize,
    take: pageSize,
    include: capabilityInclude as any,
  })) as any[];

  baselineInstances.sort((a, b) => getHourlyCost(a) - getHourlyCost(b));

  const familyFreq = new Map<string, { name: string; count: number }>();
  for (const inst of baselineInstances) {
    const fid = inst.instanceFamilyId;
    if (!familyFreq.has(fid)) familyFreq.set(fid, { name: inst.instanceFamily.name, count: 0 });
    familyFreq.get(fid)!.count++;
  }
  const topFamily = [...familyFreq.values()].sort((a, b) => b.count - a.count)[0];
  const suggestedFamilyName = topFamily?.name ?? 'General Purpose';

  const findLatestGenerationEquivalent = async (olderInst: any) => {
    const candidates = await db.vmInstance.findMany({
      where: {
        service: { providerId: baselineProvider.id, isActive: true },
        vcpu: olderInst.vcpu,
        memoryGib: olderInst.memoryGib,
        hasGpu: olderInst.hasGpu,
        currentGeneration: true,
      },
      include: capabilityInclude as any,
    });
    candidates.sort((a, b) => getHourlyCost(a) - getHourlyCost(b));
    return candidates[0] || null;
  };

  // ── 4. Resolve remaining comparison providers ──────────────────────────────
  const otherProviders = await db.provider.findMany({
    where: {
      id: { not: baselineProvider.id },
    },
  });
  const otherProviderIds = otherProviders.map(p => p.id);

  // ── 5. Fetch cross-cloud candidates for comparison ─────────────────────────
  const getAzureRegionCode = (awsCode: string): string => {
    const map: Record<string, string> = {
      'eu-west-1': 'northeurope',
      'eu-west-3': 'westeurope',
      'us-east-1': 'eastus',
      'us-east-2': 'eastus2',
      'us-west-1': 'westus',
      'us-west-2': 'westus2',
      'eu-central-1': 'germanywestcentral',
      'eu-west-2': 'uksouth',
      'ap-south-1': 'centralindia',
      'ap-northeast-1': 'japaneast',
      'ap-southeast-1': 'southeastasia',
      'ap-southeast-2': 'australiaeast',
      'sa-east-1': 'brazilsouth',
    };
    return map[awsCode.toLowerCase()] || awsCode;
  };

  const crossCloudCandidates = (await db.vmInstance.findMany({
    where: {
      service: { providerId: { in: otherProviderIds }, isActive: true },
      ...(reqVcpu ? { vcpu: reqVcpu } : {}),
      ...(reqMemoryGib ? { memoryGib: reqMemoryGib } : {}),
      ...(tenancy || operatingSystem || region
        ? {
            vmCapabilityMatrix: {
              some: {
                isActive: true,
                isRegionAvailable: true,
                ...(tenancy ? { tenancy } : {}),
                ...(operatingSystem ? { operatingSystem } : {}),
                ...(region
                  ? {
                      region: {
                        OR: [
                          { code: { contains: region, mode: 'insensitive' } },
                          { code: { contains: getAzureRegionCode(region), mode: 'insensitive' } },
                        ],
                      },
                    }
                  : {}),
              },
            },
          }
        : {}),
    },
    include: {
      service: { include: { provider: true } },
      instanceFamily: true,
      vmCapabilityMatrix: {
        where: {
          isActive: true,
          isRegionAvailable: true,
          ...(tenancy ? { tenancy } : {}),
          ...(operatingSystem ? { operatingSystem } : {}),
        },
        include: {
          region: true,
          pricings: true,
        },
      },
    },
  })) as any[];

  // Helper function to find best cross-cloud equivalent
  const findBestEquivalent = (candInst: any, targetProviderSlug: string) => {
    const baseMeta = parseInstanceMeta(candInst);
    const candidates = crossCloudCandidates.filter((item: any) => {
      const slug = item.service?.provider?.slug?.toLowerCase() || '';
      const pid = item.service?.providerId?.toLowerCase() || '';
      return (
        slug.includes(targetProviderSlug) ||
        pid.includes(targetProviderSlug) ||
        (targetProviderSlug === 'gcp' && (slug.includes('google') || pid.includes('gcp'))) ||
        (targetProviderSlug === 'azure' && (slug.includes('microsoft') || pid.includes('azure')))
      );
    });

    if (!candidates.length) return null;

    const scored = candidates.map((c: any) => {
      const candPrice = getHourlyCost(c);
      const candMeta = parseInstanceMeta(c);
      const basePrice = getHourlyCost(candInst);

      const { score } = calculateScore(
        baseMeta,
        candMeta,
        { ...candInst, hourlyCost: basePrice },
        { ...c, hourlyCost: candPrice },
      );
      const reasons: string[] = [];

      if (c.vcpu === candInst.vcpu && c.memoryGib === candInst.memoryGib) {
        reasons.push('Identical vCPU and RAM configuration');
      } else {
        reasons.push('Proportional compute capacity match');
      }

      if (candInst.hasGpu && c.hasGpu) {
        reasons.push('GPU capability match');
      }

      if (c.instanceFamily?.series === candInst.instanceFamily?.series) {
        reasons.push('Matching architectural performance tier');
      }

      return { c, score, candPrice, reasons, candMeta };
    });

    scored.sort((a, b) => b.score - a.score || a.candPrice - b.candPrice);

    const best = scored[0];
    if (!best) return null;

    const onDemand = Number(getHourlyCost(best.c));
    const onDemandRange = getHourlyCostRange(best.c);
    return {
      equivalentFamily: best.c.instanceFamily.name,
      recommendedInstance: best.c.instanceType,
      matchScore: best.score,
      onDemandHourlyCost: onDemand.toFixed(4),
      onDemandMonthlyCost: (onDemand * MONTHLY_HOURS).toFixed(2),
      onDemandHourlyCostMin: Number(onDemandRange.min).toFixed(4),
      onDemandHourlyCostMax: Number(onDemandRange.max).toFixed(4),
      onDemandMonthlyCostMin: (Number(onDemandRange.min) * MONTHLY_HOURS).toFixed(2),
      onDemandMonthlyCostMax: (Number(onDemandRange.max) * MONTHLY_HOURS).toFixed(2),
      vcpu: best.c.vcpu,
      memoryGib: best.c.memoryGib,
      storageSummary: best.c.storageSummary || 'SSD Only',
      category: best.candMeta.category,
      architecture: best.candMeta.architecture,
      generation: String(best.candMeta.generation),
      operatingSystem: (best.c.vmCapabilityMatrix?.[0]?.operatingSystem || 'LINUX').toUpperCase(),
      tenancy: best.c.vmCapabilityMatrix?.[0]?.tenancy,
      licenseType: best.c.vmCapabilityMatrix?.[0]?.licenseType || 'INCLUDED',
      reasons: best.reasons,
      currentGeneration: best.c.currentGeneration,
    };
  };

  // ── 6. Build matrix rows using the Mapper layer ─────────────────────────────
  return mapToRecommendationResponseDto(
    baselineInstances,
    suggestedFamilyName,
    pricingModel,
    getHourlyCost,
    getHourlyCostRange,
    findBestEquivalent,
    findLatestGenerationEquivalent,
  );

}
