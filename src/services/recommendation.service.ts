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

  // ── 1. Resolve AWS provider ID ────────────────────────────────────────────
  const awsProvider = await db.provider.findFirst({ where: { slug: 'amazon-web-services' } });
  if (!awsProvider) {
    throw new Error('AWS provider not found.');
  }

  // ── 2. Build where clause for AWS instances ───────────────────────────────
  const awsWhere: any = {
    service: { providerId: awsProvider.id, isActive: true },
    vcpu: reqVcpu,
    memoryGib: reqMemoryGib,
  };

  if (region || tenancy || operatingSystem) {
    const matrixWhere: any = { isActive: true, isRegionAvailable: true };
    if (region) {
      matrixWhere.region = { code: { contains: region, mode: 'insensitive' }, isActive: true };
    }
    if (tenancy) {
      matrixWhere.tenancy = tenancy;
    }
    if (operatingSystem) {
      matrixWhere.operatingSystem = operatingSystem;
    }
    awsWhere.vmCapabilityMatrix = { some: matrixWhere };
  }

  const targetType = pricingModel || 'ON_DEMAND';

  // Helper to resolve pricing from new relational structure in memory
  const getHourlyCost = (inst: any): number => {
    const matrices = inst.vmCapabilityMatrix || [];

    // Filter matrices that actually have targetType pricing first
    const matricesWithTargetType = matrices.filter((m: any) =>
      m.pricings?.some((p: any) => p.pricingType === targetType && Number(p.hourlyCost) > 0),
    );

    // If there are none, we fall back to ON_DEMAND pricing
    const activeMatrices = matricesWithTargetType.length > 0 ? matricesWithTargetType : matrices;
    const resolvedType = matricesWithTargetType.length > 0 ? targetType : 'ON_DEMAND';

    // Helper to map AWS region code to Azure region code equivalents
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

    // 1. Try exact match (Region + Tenancy + OS)
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

    // 2. Fallback: Match Region + OS (ignore tenancy)
    if (!matrix) {
      matrix = activeMatrices.find((m: any) => {
        if (
          region &&
          !m.region?.code?.toLowerCase().includes(region.toLowerCase()) &&
          !m.region?.code?.toLowerCase().includes(getAzureRegionCode(region).toLowerCase())
        )
          return false;
        if (operatingSystem && m.operatingSystem !== operatingSystem) return false;
        return true;
      });
    }

    // 3. Fallback: Match Region only
    if (!matrix) {
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

    // 4. Fallback: Match OS only
    if (!matrix) {
      matrix = activeMatrices.find((m: any) => {
        if (operatingSystem && m.operatingSystem !== operatingSystem) return false;
        return true;
      });
    }

    // 5. Ultimate fallback: First available record
    if (!matrix) {
      matrix = activeMatrices[0];
    }

    const pricing = matrix?.pricings?.find((p: any) => p.pricingType === resolvedType);
    return pricing ? Number(pricing.hourlyCost) : 0;
  };

  // Helper to resolve min/max hourly cost range across ALL capability matrix entries
  const getHourlyCostRange = (inst: any): { min: number; max: number } => {
    const baseCost = getHourlyCost(inst);
    return calculatePriceRange(baseCost);
  };

  const capabilityInclude = {
    instanceFamily: true,
    vmCapabilityMatrix: {
      where: {
        isActive: true,
        isRegionAvailable: true,
      },
      include: {
        region: true,
        pricings: true, // Fetch all pricing types for robust fallback
      },
    },
  };

  // ── 3. Fetch matching AWS instances ───────────────────────────────────────
  let awsInstances = (await db.vmInstance.findMany({
    where: awsWhere,
    take: 8,
    include: capabilityInclude as any,
  })) as any[];

  // Fallback 1: If 0 instances matched (e.g. unseeded tenancy), try ignoring the tenancy filter
  if (awsInstances.length === 0 && tenancy) {
    const fallbackWhere = { ...awsWhere };
    if (region || operatingSystem) {
      fallbackWhere.vmCapabilityMatrix = {
        some: {
          isActive: true,
          isRegionAvailable: true,
          ...(region
            ? { region: { code: { contains: region, mode: 'insensitive' }, isActive: true } }
            : {}),
          ...(operatingSystem ? { operatingSystem } : {}),
        },
      };
    } else {
      delete fallbackWhere.vmCapabilityMatrix;
    }

    awsInstances = (await db.vmInstance.findMany({
      where: fallbackWhere,
      take: 8,
      include: capabilityInclude as any,
    })) as any[];
  }

  // Fallback 2: If still 0 instances matched (e.g. unseeded region), search globally without capability matrix filter
  if (awsInstances.length === 0 && (region || tenancy || operatingSystem)) {
    const globalWhere = { ...awsWhere };
    delete globalWhere.vmCapabilityMatrix;

    awsInstances = (await db.vmInstance.findMany({
      where: globalWhere,
      take: 8,
      include: capabilityInclude as any,
    })) as any[];
  }

  // Sort by price in memory
  awsInstances.sort((a, b) => getHourlyCost(a) - getHourlyCost(b));

  // Pick top family for response label
  const familyFreq = new Map<string, { name: string; count: number }>();
  for (const inst of awsInstances) {
    const fid = inst.instanceFamilyId;
    if (!familyFreq.has(fid)) familyFreq.set(fid, { name: inst.instanceFamily.name, count: 0 });
    familyFreq.get(fid)!.count++;
  }
  const topFamily = [...familyFreq.values()].sort((a, b) => b.count - a.count)[0];
  const suggestedFamilyName = topFamily?.name ?? 'General Purpose';

  // Helper to find latest generation equivalent for an older generation instance
  const findLatestGenerationEquivalent = async (olderInst: any) => {
    const candidates = await db.vmInstance.findMany({
      where: {
        service: { providerId: awsProvider.id, isActive: true },
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

  // ── 4. Get other providers ────────────────────────────────────────────────
  const otherProviders = await db.provider.findMany({
    where: { slug: { in: ['microsoft-azure', 'gcp'] } },
  });
  const otherProviderIds = otherProviders.map(p => p.id);

  // ── 5. Fetch Azure + GCP candidates (filtered by matching specs) ──────────
  // Helper to map AWS region code to Azure region code equivalents
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
      vcpu: reqVcpu,
      memoryGib: reqMemoryGib,
    },
    include: {
      service: { include: { provider: true } },
      instanceFamily: true,
      vmCapabilityMatrix: {
        where: {
          isActive: true,
          isRegionAvailable: true,
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
        include: {
          region: true,
          pricings: true,
        },
      },
    },
  })) as any[];

  // Helper to find best equivalent for azure / gcp
  const findBestEquivalent = (inst: any, providerSlug: string, awsMeta: any) => {
    const targetSlug = providerSlug === 'azure' ? 'microsoft-azure' : providerSlug;
    const candidates = crossCloudCandidates.filter(
      c =>
        c.service.provider.slug === targetSlug &&
        c.vcpu === inst.vcpu &&
        c.memoryGib === inst.memoryGib,
    );
    if (candidates.length === 0) return null;

    const scored = candidates
      .map(c => {
        const candMeta = parseInstanceMeta(c);
        // Map costs to pass to score pricing logic
        const awsPrice = getHourlyCost(inst);
        const candPrice = getHourlyCost(c);
        const { score, reasons } = calculateScore(
          awsMeta,
          candMeta,
          { ...inst, hourlyCost: awsPrice },
          { ...c, hourlyCost: candPrice },
        );
        return { c, score, reasons, candMeta };
      })
      .sort((a, b) => b.score - a.score || getHourlyCost(a.c) - getHourlyCost(b.c));

    const best = scored[0];
    if (!best) return null;

    const onDemand = getHourlyCost(best.c);
    const onDemandRange = getHourlyCostRange(best.c);
    return {
      equivalentFamily: best.c.instanceFamily.name,
      recommendedInstance: best.c.instanceType,
      matchScore: best.score,
      onDemandHourlyCost: onDemand.toFixed(4),
      onDemandMonthlyCost: (onDemand * MONTHLY_HOURS).toFixed(2),
      onDemandHourlyCostMin: onDemandRange.min.toFixed(4),
      onDemandHourlyCostMax: onDemandRange.max.toFixed(4),
      onDemandMonthlyCostMin: (onDemandRange.min * MONTHLY_HOURS).toFixed(2),
      onDemandMonthlyCostMax: (onDemandRange.max * MONTHLY_HOURS).toFixed(2),
      vcpu: best.c.vcpu,
      memoryGib: best.c.memoryGib,
      storageSummary: best.c.storageSummary || 'SSD Only',
      category: best.candMeta.category,
      architecture: best.candMeta.architecture,
      generation: String(best.candMeta.generation),
      reasons: best.reasons,
      currentGeneration: best.c.currentGeneration,
    };
  };

  // ── 6. Build matrix rows using the Mapper layer ─────────────────────────────
  return mapToRecommendationResponseDto(
    awsInstances,
    suggestedFamilyName,
    pricingModel,
    getHourlyCost,
    getHourlyCostRange,
    findBestEquivalent,
    findLatestGenerationEquivalent,
  );
}
