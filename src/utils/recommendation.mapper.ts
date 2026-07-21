import { parseInstanceMeta } from './recommendation-utils';

const MONTHLY_HOURS = 720;

export interface RecommendationResponseDto {
  autoSuggestedFamily: string;
  matrixRows: any[];
}

/**
 * Maps matching AWS, Azure, and GCP VM instances to the clean smart recommendation matrix structure.
 */
export async function mapToRecommendationResponseDto(
  awsInstances: any[],
  suggestedFamilyName: string,
  pricingModel: string | undefined,
  getHourlyCost: (inst: any) => number,
  getHourlyCostRange: (inst: any) => { min: number; max: number },
  findBestEquivalent: (inst: any, providerSlug: string, meta: any) => any,
  findLatestGenerationEquivalent: (inst: any) => Promise<any>,
): Promise<RecommendationResponseDto> {
  const matrixRows = await Promise.all(
    awsInstances.map(async inst => {
      const awsMeta = parseInstanceMeta(inst);
      const azureMatch = findBestEquivalent(inst, 'azure', awsMeta);
      const gcpMatch = findBestEquivalent(inst, 'gcp', awsMeta);

      const allReasons = [
        ...new Set([...(azureMatch?.reasons || []), ...(gcpMatch?.reasons || [])]),
      ];

      const awsCost = getHourlyCost(inst);
      const awsCostRange = getHourlyCostRange(inst);
      const isOnDemand = !pricingModel || pricingModel === 'ON_DEMAND';

      // Generation Upgrade recommendation logic
      let recommendation: any = null;
      if (!inst.currentGeneration) {
        const upgradeCandidate = await findLatestGenerationEquivalent(inst);
        if (upgradeCandidate) {
          const upgradeCost = getHourlyCost(upgradeCandidate);
          const upgradeRange = getHourlyCostRange(upgradeCandidate);
          const monthlySavingsMin =
            awsCostRange.min * MONTHLY_HOURS - upgradeRange.min * MONTHLY_HOURS;
          const monthlySavingsMax =
            awsCostRange.max * MONTHLY_HOURS - upgradeRange.max * MONTHLY_HOURS;
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

      return {
        aws: {
          family: inst.instanceFamily.name,
          instance: inst.instanceType,
          category: awsMeta.category,
          architecture: awsMeta.architecture,
          generation: String(awsMeta.generation),
          vcpu: inst.vcpu,
          memoryGib: inst.memoryGib,
          storageSummary: inst.storageSummary || 'EBS Only',
          onDemandHourlyCost: awsCost.toFixed(4),
          onDemandMonthlyCost: (awsCost * MONTHLY_HOURS).toFixed(2),
          onDemandHourlyCostMin: awsCostRange.min.toFixed(4),
          onDemandHourlyCostMax: awsCostRange.max.toFixed(4),
          onDemandMonthlyCostMin: (awsCostRange.min * MONTHLY_HOURS).toFixed(2),
          onDemandMonthlyCostMax: (awsCostRange.max * MONTHLY_HOURS).toFixed(2),
          potentialHourlyCost: isOnDemand ? (awsCost * 0.7).toFixed(4) : awsCost.toFixed(4),
          savingsPercent: isOnDemand ? 30 : 0,
          currentGeneration: inst.currentGeneration,
          recommendation,
        },
        azure: azureMatch,
        gcp: gcpMatch,
        reason: allReasons,
      };
    }),
  );

  return {
    autoSuggestedFamily: suggestedFamilyName,
    matrixRows,
  };
}
