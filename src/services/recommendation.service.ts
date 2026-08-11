import { prisma as db } from '@config/database';
import { SmartRecommendationBody } from '@validators/instance.validator';
import { calculatePriceRange } from '@utils/pricing';
import {
  parseInstanceMeta,
  calculateScore,
  normalizeOperatingSystem,
  normalizeRegionForProvider,
} from '@utils/recommendation-utils';
import { resolveOperatingSystemCandidates } from '@utils/os-resolver';
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
  if (operatingSystem) {
    const osCandidates = resolveOperatingSystemCandidates(operatingSystem);
    if (osCandidates.length > 0) {
      matrixFilter.operatingSystem = { in: osCandidates };
    } else {
      matrixFilter.operatingSystem = operatingSystem;
    }
  }
  if (region) {
    const allowedRegions = Array.from(
      new Set([
        ...normalizeRegionForProvider('aws', region),
        ...normalizeRegionForProvider('azure', region),
        ...normalizeRegionForProvider('gcp', region),
      ]),
    );
    matrixFilter.region = {
      OR: allowedRegions.map(r => ({ code: { contains: r, mode: 'insensitive' } })),
      isActive: true,
    };
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

  // Default priority order: GCP if SOLE_TENANT requested, else AWS -> Azure -> GCP
  const baselineProvider =
    tenancy === 'SOLE_TENANT'
      ? matchingProviders.find(p => p.slug.includes('gcp') || p.id === 'gcp') ||
        matchingProviders[0]
      : matchingProviders.find(p => p.slug === 'amazon-web-services' || p.id === 'aws') ||
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

  // Pre-resolve OS candidates once — used by both the DB query and in-memory pricing logic
  const osCandidates = operatingSystem ? resolveOperatingSystemCandidates(operatingSystem) : [];

  // Helper to resolve pricing from relational structure in memory
  const getHourlyCost = (inst: any): number => {
    const matrices = inst.vmCapabilityMatrix || [];

    const matricesWithTargetType = matrices.filter((m: any) =>
      m.pricings?.some((p: any) => p.pricingType === targetType && Number(p.hourlyCost) > 0),
    );

    const activeMatrices = matricesWithTargetType.length > 0 ? matricesWithTargetType : matrices;
    const resolvedType = matricesWithTargetType.length > 0 ? targetType : 'ON_DEMAND';

    let matrix = activeMatrices.find((m: any) => {
      if (region) {
        const rCode = m.region?.code?.toLowerCase() || '';
        const providerSlug = inst.service?.provider?.slug || inst.service?.providerId || 'aws';
        const allowedRegions = normalizeRegionForProvider(providerSlug, region);
        if (!allowedRegions.some(ar => rCode.includes(ar.toLowerCase()))) return false;
      }
      if (tenancy && m.tenancy !== tenancy) return false;

      if (osCandidates.length > 0 && !osCandidates.includes(m.operatingSystem)) return false;
      return true;
    });

    if (!matrix && !tenancy && !operatingSystem) {
      matrix = activeMatrices.find((m: any) => {
        if (region) {
          const rCode = m.region?.code?.toLowerCase() || '';
          const providerSlug = inst.service?.provider?.slug || inst.service?.providerId || 'aws';
          const allowedRegions = normalizeRegionForProvider(providerSlug, region);
          if (!allowedRegions.some(ar => rCode.includes(ar.toLowerCase()))) return false;
        }
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
        ...(osCandidates.length > 0 ? { operatingSystem: { in: osCandidates } } : {}),
        ...(region
          ? {
              region: {
                OR: normalizeRegionForProvider(
                  baselineProvider.slug || baselineProvider.id || 'aws',
                  region,
                ).map(r => ({
                  code: { contains: r, mode: 'insensitive' },
                })),
              },
            }
          : {}),
      },
      include: {
        region: true,
        pricings: {
          where: { pricingType: targetType },
        },
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

  // Filter to only instances with valid pricing — prevents $0 baseline cards
  // when newer AWS/Azure instances haven't had pricing fetched from the API yet
  const pricedBaselineInstances = baselineInstances.filter(inst => getHourlyCost(inst) > 0);
  const effectiveBaseline =
    pricedBaselineInstances.length > 0 ? pricedBaselineInstances : baselineInstances;
  effectiveBaseline.sort((a, b) => getHourlyCost(a) - getHourlyCost(b));

  const familyFreq = new Map<string, { name: string; count: number }>();
  for (const inst of effectiveBaseline) {
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

  const targetVcpus = reqVcpu ? [reqVcpu] : [...new Set(effectiveBaseline.map(b => b.vcpu))];
  const targetMemories = reqMemoryGib
    ? [reqMemoryGib]
    : [...new Set(effectiveBaseline.map(b => b.memoryGib))];
  const targetGpu = [...new Set(effectiveBaseline.map(b => b.hasGpu))];

  const candidateRegionFilter = region
    ? {
        region: {
          OR: Array.from(
            new Set([
              ...normalizeRegionForProvider('aws', region),
              ...normalizeRegionForProvider('azure', region),
              ...normalizeRegionForProvider('gcp', region),
            ]),
          ).map(r => ({ code: { contains: r, mode: 'insensitive' as const } })),
        },
      }
    : {};

  const crossCloudCandidates =
    effectiveBaseline.length === 0
      ? []
      : ((await db.vmInstance.findMany({
          where: {
            service: { providerId: { in: otherProviderIds }, isActive: true },
            vcpu: { in: targetVcpus },
            memoryGib: { in: targetMemories },
            ...(targetGpu.length === 1 ? { hasGpu: targetGpu[0] } : {}),
            vmCapabilityMatrix: {
              some: {
                isActive: true,
                isRegionAvailable: true,
                ...(tenancy ? { tenancy } : {}),
                ...candidateRegionFilter,
              },
            },
          },
          take: 100,
          include: {
            service: { include: { provider: true } },
            instanceFamily: true,
            vmCapabilityMatrix: {
              where: {
                isActive: true,
                isRegionAvailable: true,
                ...(tenancy ? { tenancy } : {}),
                ...candidateRegionFilter,
              },
              take: 20,
              include: {
                region: true,
                pricings: {
                  where: { pricingType: targetType },
                },
              },
            },
          },
        })) as any[]);

  // Helper function to find best cross-cloud equivalent using 4-Tier Progressive Candidate Selection
  const findBestEquivalent = (candInst: any, targetProviderSlug: string) => {
    const baseMeta = parseInstanceMeta(candInst);

    // Filter cross-cloud candidates by target provider
    const providerCandidates = crossCloudCandidates.filter((item: any) => {
      const slug = item.service?.provider?.slug?.toLowerCase() || '';
      const pid = item.service?.providerId?.toLowerCase() || '';
      return (
        slug.includes(targetProviderSlug) ||
        pid.includes(targetProviderSlug) ||
        (targetProviderSlug === 'gcp' && (slug.includes('google') || pid.includes('gcp'))) ||
        (targetProviderSlug === 'azure' && (slug.includes('microsoft') || pid.includes('azure')))
      );
    });

    if (!providerCandidates.length) return null;

    const requestedOs = operatingSystem ? operatingSystem.toUpperCase() : undefined;
    const requestedTenancy = tenancy ? tenancy : undefined;
    const requestedRegion = region ? region : undefined;

    // Helper to evaluate candidate eligibility under specific OS, tenancy, and region constraints
    const evaluateCandidate = (
      c: any,
      targetOs?: string,
      targetTenancy?: string,
      targetRegion?: string,
    ) => {
      const matrices = c.vmCapabilityMatrix || [];
      const providerSlug = c.service?.provider?.slug || c.service?.providerId || targetProviderSlug;
      const allowedRegions = targetRegion
        ? normalizeRegionForProvider(providerSlug, targetRegion)
        : [];

      const matchingMatrix = matrices.find((m: any) => {
        if (targetOs && m.operatingSystem !== targetOs) return false;
        if (targetTenancy && m.tenancy !== targetTenancy) return false;
        if (targetRegion) {
          const rCode = m.region?.code?.toLowerCase() || '';
          if (!allowedRegions.some(ar => rCode.includes(ar.toLowerCase()))) {
            return false;
          }
        }
        const hasPricing = m.pricings?.some(
          (p: any) => p.pricingType === targetType && Number(p.hourlyCost) > 0,
        );
        return hasPricing;
      });

      if (!matchingMatrix) return null;

      const pricing = matchingMatrix.pricings.find(
        (p: any) => p.pricingType === targetType && Number(p.hourlyCost) > 0,
      );
      if (!pricing) return null;

      const hourlyPrice = Number(pricing.hourlyCost);
      if (hourlyPrice <= 0) return null;

      const candMeta = parseInstanceMeta(c);
      const basePrice = getHourlyCost(candInst);

      const { score } = calculateScore(
        baseMeta,
        candMeta,
        { ...candInst, hourlyCost: basePrice },
        { ...c, hourlyCost: hourlyPrice },
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

      return {
        candidate: c,
        score,
        hourlyPrice,
        reasons,
        candMeta,
        matchedMatrix: matchingMatrix,
      };
    };

    let winnerResult: any = null;
    let matchType: 'EXACT' | 'APPROXIMATE' = 'EXACT';
    let matchedTen: string | undefined = requestedTenancy;
    let matchedReg = requestedRegion;
    let fallbackReason: string | undefined = undefined;

    // ── TIER 1: EXACT MATCH ──────────────────────────────────────────────────
    const tier1Evaluations = providerCandidates
      .map(c => evaluateCandidate(c, requestedOs, requestedTenancy, requestedRegion))
      .filter((res): res is NonNullable<typeof res> => res !== null);

    if (tier1Evaluations.length > 0) {
      tier1Evaluations.sort((a, b) => b.score - a.score || a.hourlyPrice - b.hourlyPrice);
      winnerResult = tier1Evaluations[0];
      matchType = 'EXACT';
    }

    // ── TIER 2: OS NORMALIZATION (Azure & GCP Open-Source Distro -> LINUX) ───
    const isCommercialOs = [
      'WINDOWS',
      'WINDOWS_SQL_SERVER',
      'RED_HAT',
      'RHEL_SAP',
      'SUSE',
      'SLES_SAP',
    ].includes(requestedOs || '');
    if (
      !winnerResult &&
      requestedOs &&
      !isCommercialOs &&
      (targetProviderSlug === 'azure' || targetProviderSlug === 'gcp')
    ) {
      const normalizedOs = normalizeOperatingSystem(targetProviderSlug, requestedOs);

      if (normalizedOs === 'LINUX' && requestedOs !== 'LINUX') {
        const tier2Evaluations = providerCandidates
          .map(c => evaluateCandidate(c, 'LINUX', requestedTenancy, requestedRegion))
          .filter((res): res is NonNullable<typeof res> => res !== null);

        if (tier2Evaluations.length > 0) {
          tier2Evaluations.sort((a, b) => b.score - a.score || a.hourlyPrice - b.hourlyPrice);
          winnerResult = tier2Evaluations[0];
          matchType = 'APPROXIMATE';
          fallbackReason = 'Provider catalogs Linux distributions under generic Linux pricing.';
        }
      }
    }

    // ── TIER 3: TENANCY FALLBACK ─────────────────────────────────────────────
    if (!winnerResult && requestedTenancy) {
      const activeOsFilter = requestedOs
        ? (targetProviderSlug === 'azure' || targetProviderSlug === 'gcp') && !isCommercialOs
          ? normalizeOperatingSystem(targetProviderSlug, requestedOs) || requestedOs
          : requestedOs
        : undefined;

      const tenancyOrder = ['DEDICATED_HOST', 'DEDICATED_INSTANCE', 'SHARED'];
      const startIndex = tenancyOrder.indexOf(requestedTenancy);
      const fallbackTenancies = startIndex >= 0 ? tenancyOrder.slice(startIndex + 1) : ['SHARED'];

      for (const fallbackTen of fallbackTenancies) {
        const tier3Evaluations = providerCandidates
          .map(c => evaluateCandidate(c, activeOsFilter, fallbackTen, requestedRegion))
          .filter((res): res is NonNullable<typeof res> => res !== null);

        if (tier3Evaluations.length > 0) {
          tier3Evaluations.sort((a, b) => b.score - a.score || a.hourlyPrice - b.hourlyPrice);
          winnerResult = tier3Evaluations[0];
          matchType = 'APPROXIMATE';
          matchedTen = fallbackTen;
          fallbackReason = `Provider does not offer ${requestedTenancy} tenancy for this SKU. Rerecommended ${fallbackTen} tenancy.`;
          break;
        }
      }
    }

    // ── TIER 4: REGION FALLBACK ──────────────────────────────────────────────
    if (!winnerResult) {
      const activeOsFilter = requestedOs
        ? (targetProviderSlug === 'azure' || targetProviderSlug === 'gcp') && !isCommercialOs
          ? normalizeOperatingSystem(targetProviderSlug, requestedOs) || requestedOs
          : requestedOs
        : undefined;
      const activeTenancyFilter = matchedTen || requestedTenancy;

      const tier4Evaluations = providerCandidates
        .map(c => evaluateCandidate(c, activeOsFilter, activeTenancyFilter, undefined))
        .filter((res): res is NonNullable<typeof res> => res !== null);

      if (tier4Evaluations.length > 0) {
        tier4Evaluations.sort((a, b) => b.score - a.score || a.hourlyPrice - b.hourlyPrice);
        winnerResult = tier4Evaluations[0];
        matchType = 'APPROXIMATE';
        matchedReg = winnerResult.matchedMatrix.region?.code || 'Global Default';
        if (!fallbackReason) {
          fallbackReason = 'Rerecommended best available region with valid pricing catalog.';
        }
      }
    }

    if (!winnerResult) return null;

    const best = winnerResult;
    const onDemand = best.hourlyPrice;
    const onDemandRange = calculatePriceRange(onDemand);

    return {
      equivalentFamily: best.candidate.instanceFamily.name,
      recommendedInstance: best.candidate.instanceType,
      matchScore: best.score,
      onDemandHourlyCost: onDemand.toFixed(4),
      onDemandMonthlyCost: (onDemand * MONTHLY_HOURS).toFixed(2),
      onDemandHourlyCostMin: Number(onDemandRange.min).toFixed(4),
      onDemandHourlyCostMax: Number(onDemandRange.max).toFixed(4),
      onDemandMonthlyCostMin: (Number(onDemandRange.min) * MONTHLY_HOURS).toFixed(2),
      onDemandMonthlyCostMax: (Number(onDemandRange.max) * MONTHLY_HOURS).toFixed(2),
      vcpu: best.candidate.vcpu,
      memoryGib: best.candidate.memoryGib,
      storageSummary: best.candidate.storageSummary || 'SSD Only',
      category: best.candMeta.category,
      architecture: best.candMeta.architecture,
      generation: String(best.candMeta.generation),
      operatingSystem: (best.matchedMatrix.operatingSystem || 'LINUX').toUpperCase(),
      tenancy: best.matchedMatrix.tenancy,
      licenseType: best.matchedMatrix.licenseType || 'INCLUDED',
      reasons: best.reasons,
      currentGeneration: best.candidate.currentGeneration,

      // Metadata Extensions
      matchType,
      matchedOperatingSystem: (best.matchedMatrix.operatingSystem || 'LINUX').toUpperCase(),
      matchedTenancy: best.matchedMatrix.tenancy,
      matchedRegion: best.matchedMatrix.region?.code || matchedReg,
      fallbackReason,
    };
  };

  // ── 6. Build matrix rows using the Mapper layer ─────────────────────────────
  return mapToRecommendationResponseDto(
    effectiveBaseline,
    suggestedFamilyName,
    pricingModel,
    getHourlyCost,
    getHourlyCostRange,
    findBestEquivalent,
    findLatestGenerationEquivalent,
  );
}
