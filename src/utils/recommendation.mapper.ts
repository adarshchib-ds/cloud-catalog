import { parseInstanceMeta } from './recommendation-utils';

const MONTHLY_HOURS = 720;

export interface RecommendationMatchMetadata {
  matchType: 'EXACT' | 'APPROXIMATE';
  matchedOperatingSystem?: string;
  matchedTenancy?: string;
  matchedRegion?: string;
  fallbackReason?: string;
}

export interface RecommendationResponseDto {
  autoSuggestedFamily: string;
  matrixRows: any[];
}

/**
 * Maps matching AWS, Azure, and GCP VM instances to the clean smart recommendation matrix structure.
 */
export async function mapToRecommendationResponseDto(
  baselineInstances: any[],
  suggestedFamilyName: string,
  pricingModel: string | undefined,
  getHourlyCost: (inst: any) => number,
  getHourlyCostRange: (inst: any) => { min: number; max: number },
  findBestEquivalent: (inst: any, providerSlug: string) => any,
  findLatestGenerationEquivalent: (inst: any) => Promise<any>,
): Promise<RecommendationResponseDto> {
  const matrixRows = await Promise.all(
    baselineInstances.map(async inst => {
      const baseMeta = parseInstanceMeta(inst);
      const providerSlug =
        inst.service?.provider?.slug?.toLowerCase() ||
        inst.service?.providerId?.toLowerCase() ||
        '';

      const isBaselineAws = providerSlug.includes('amazon') || providerSlug.includes('aws');
      const isBaselineAzure = providerSlug.includes('azure') || providerSlug.includes('microsoft');
      const isBaselineGcp = providerSlug.includes('gcp') || providerSlug.includes('google');

      const awsMatch = isBaselineAws ? null : findBestEquivalent(inst, 'aws');
      const azureMatch = isBaselineAzure ? null : findBestEquivalent(inst, 'azure');
      const gcpMatch = isBaselineGcp ? null : findBestEquivalent(inst, 'gcp');

      const allReasons = [
        ...new Set([
          ...(awsMatch?.reasons || []),
          ...(azureMatch?.reasons || []),
          ...(gcpMatch?.reasons || []),
        ]),
      ];

      const baseCost = getHourlyCost(inst);
      const baseCostRange = getHourlyCostRange(inst);
      const isOnDemand = !pricingModel || pricingModel === 'ON_DEMAND';

      // Generation Upgrade recommendation logic
      let recommendation: any = null;
      if (!inst.currentGeneration) {
        const upgradeCandidate = await findLatestGenerationEquivalent(inst);
        if (upgradeCandidate) {
          const upgradeCost = getHourlyCost(upgradeCandidate);
          const upgradeRange = getHourlyCostRange(upgradeCandidate);
          const monthlySavingsMin =
            baseCostRange.min * MONTHLY_HOURS - upgradeRange.min * MONTHLY_HOURS;
          const monthlySavingsMax =
            baseCostRange.max * MONTHLY_HOURS - upgradeRange.max * MONTHLY_HOURS;
          recommendation = {
            recommendedInstance: upgradeCandidate.instanceType,
            generation: 'Current Generation',
            vcpu: upgradeCandidate.vcpu,
            memoryGib: upgradeCandidate.memoryGib,
            onDemandHourlyCost: upgradeCost.toFixed(4),
            onDemandMonthlyCost: (upgradeCost * MONTHLY_HOURS).toFixed(2),
            onDemandHourlyCostMin: upgradeRange.min.toFixed(4),
            onDemandHourlyCostMax: upgradeRange.max.toFixed(4),
            onDemandMonthlyCostMin: (upgradeRange.min * MONTHLY_HOURS).toFixed(2),
            onDemandMonthlyCostMax: (upgradeRange.max * MONTHLY_HOURS).toFixed(2),
            monthlySavingsMin: monthlySavingsMin.toFixed(2),
            monthlySavingsMax: monthlySavingsMax.toFixed(2),
          };
        }
      }

      const baseObj = {
        family: inst.instanceFamily.name,
        instance: inst.instanceType,
        category: baseMeta.category,
        architecture: baseMeta.architecture,
        generation: String(baseMeta.generation),
        operatingSystem: (inst.vmCapabilityMatrix?.[0]?.operatingSystem || 'LINUX').toUpperCase(),
        tenancy: inst.vmCapabilityMatrix?.[0]?.tenancy,
        licenseType: inst.vmCapabilityMatrix?.[0]?.licenseType || 'INCLUDED',
        vcpu: inst.vcpu,
        memoryGib: inst.memoryGib,
        storageSummary: inst.storageSummary || 'Network Storage Only',
        onDemandHourlyCost: baseCost.toFixed(4),
        onDemandMonthlyCost: (baseCost * MONTHLY_HOURS).toFixed(2),
        onDemandHourlyCostMin: baseCostRange.min.toFixed(4),
        onDemandHourlyCostMax: baseCostRange.max.toFixed(4),
        onDemandMonthlyCostMin: (baseCostRange.min * MONTHLY_HOURS).toFixed(2),
        onDemandMonthlyCostMax: (baseCostRange.max * MONTHLY_HOURS).toFixed(2),
        potentialHourlyCost: isOnDemand ? (baseCost * 0.7).toFixed(4) : baseCost.toFixed(4),
        savingsPercent: isOnDemand ? 30 : 0,
        currentGeneration: inst.currentGeneration,
        recommendation,
        isBaseline: true,
        matchScore: 100,
        matchType: 'EXACT',
        reasons: ['Baseline Instance'],
      };

      return {
        aws: isBaselineAws
          ? baseObj
          : awsMatch
            ? {
                ...awsMatch,
                operatingSystem:
                  awsMatch.matchedMatrix?.operatingSystem || awsMatch.operatingSystem || 'LINUX',
              }
            : null,
        azure: isBaselineAzure
          ? baseObj
          : azureMatch
            ? {
                ...azureMatch,
                operatingSystem:
                  azureMatch.matchedMatrix?.operatingSystem ||
                  azureMatch.operatingSystem ||
                  'LINUX',
              }
            : null,
        gcp: isBaselineGcp
          ? baseObj
          : gcpMatch
            ? {
                ...gcpMatch,
                operatingSystem:
                  gcpMatch.matchedMatrix?.operatingSystem || gcpMatch.operatingSystem || 'LINUX',
              }
            : null,
        reason: allReasons,
      };
    }),
  );

  return {
    autoSuggestedFamily: suggestedFamilyName,
    matrixRows,
  };
}
