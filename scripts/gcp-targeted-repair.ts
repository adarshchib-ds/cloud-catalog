/**
 * Targeted repair script — NOT part of the regular sync pipeline.
 * Re-composes pricing for only the instances affected by the G4/A4/A4X GPU-token fixes
 * (src/providers/gcp/mapper/gcp.mapper.ts), instead of re-running the full ~80-minute
 * pnpm sync:gcp. Reuses the exact same repository functions the orchestrator uses, so the
 * result is identical to what a full re-sync would produce for these instances.
 *
 * Usage: pnpm ts-node -r tsconfig-paths/register scripts/gcp-targeted-repair.ts
 */
import 'dotenv/config';
import { prisma } from '../src/config/database';
import { logger } from '../src/config/logger';
import { fetchGcpMachineTypes } from '../src/providers/gcp/services/gcp-compute.service';
import {
  resolveComputeEngineServiceId,
  fetchGcpComputeSkus,
} from '../src/providers/gcp/services/gcp-billing.service';
import {
  mapCapabilityMatrix,
  buildGcpSkuIndex,
  composeHourlyCost,
  USAGE_TYPE_TO_PRICING_TYPE,
  GcpUsageType,
} from '../src/providers/gcp/mapper/gcp.mapper';
import { getRegionMap } from '../src/repositories/region.repository';
import { upsertVmCapabilityMatrix } from '../src/repositories/vm-capability.repository';
import { upsertVmPricing } from '../src/repositories/vm-pricing.repository';

const SPOT_FALLBACK_RATIO = 0.35;
const COMMITMENT_FALLBACK_RATIO = 0.63;
const RESERVED_FALLBACK_RATIO = 0.7;
const USAGE_TYPES: GcpUsageType[] = ['OnDemand', 'Preemptible', 'Commit1Yr', 'Commit3Yr'];

const TARGET_FAMILY_PREFIXES = ['g4', 'a4', 'a4x'];

async function main() {
  const service = await prisma.service.findFirst({ where: { providerId: 'gcp', slug: 'gce' } });
  if (!service) throw new Error('GCP gce service not found');

  const targetInstances = await prisma.vmInstance.findMany({
    where: {
      serviceId: service.id,
      instanceFamily: { name: { in: TARGET_FAMILY_PREFIXES } },
    },
  });
  logger.info(
    `Targeting ${targetInstances.length} instances: ${targetInstances.map(i => i.instanceType).join(', ')}`,
  );

  const regionMap = await getRegionMap('gcp');
  const activeRegions = Array.from(regionMap.keys());

  const rawMachineTypesAllZones = await fetchGcpMachineTypes();
  const machineTypeByName = new Map<string, (typeof rawMachineTypesAllZones)[number]>();
  for (const mt of rawMachineTypesAllZones) {
    if (!machineTypeByName.has(mt.name)) machineTypeByName.set(mt.name, mt);
  }

  const serviceCatalogId = await resolveComputeEngineServiceId();
  const rawSkus = await fetchGcpComputeSkus(serviceCatalogId);
  const skuIndex = buildGcpSkuIndex(rawSkus);

  let pricingInserted = 0;
  let pricingSynthesized = 0;
  let skipped = 0;
  let failed = 0;

  for (const regionCode of activeRegions) {
    const regionId = regionMap.get(regionCode)!;

    for (const instance of targetInstances) {
      const machineType = machineTypeByName.get(instance.instanceType);
      if (!machineType) continue;

      try {
        const onDemandCost = composeHourlyCost(machineType, regionCode, 'OnDemand', skuIndex);
        if (onDemandCost == null) {
          skipped++;
          continue;
        }

        const normCapability = mapCapabilityMatrix(regionCode);
        const capabilityRecord = await upsertVmCapabilityMatrix({
          vmInstanceId: instance.id,
          regionId,
          operatingSystem: normCapability.operatingSystem,
          tenancy: normCapability.tenancy,
          licenseType: normCapability.licenseType,
          isRegionAvailable: normCapability.isRegionAvailable,
          isActive: normCapability.isActive,
        });

        await upsertVmPricing({
          capabilityMatrixId: capabilityRecord.id,
          pricingType: USAGE_TYPE_TO_PRICING_TYPE.OnDemand,
          hourlyCost: onDemandCost,
        });
        pricingInserted++;

        for (const usageType of USAGE_TYPES.slice(1)) {
          const composed = composeHourlyCost(machineType, regionCode, usageType, skuIndex);
          const pricingType = USAGE_TYPE_TO_PRICING_TYPE[usageType];

          let hourlyCost: number;
          if (composed != null) {
            hourlyCost = composed;
            pricingInserted++;
          } else {
            const ratio =
              usageType === 'Preemptible'
                ? SPOT_FALLBACK_RATIO
                : usageType === 'Commit1Yr'
                  ? COMMITMENT_FALLBACK_RATIO
                  : RESERVED_FALLBACK_RATIO;
            hourlyCost = onDemandCost * ratio;
            pricingSynthesized++;
          }

          await upsertVmPricing({
            capabilityMatrixId: capabilityRecord.id,
            pricingType,
            hourlyCost,
          });
        }
      } catch (err) {
        logger.error(
          `Failed pricing composition for ${instance.instanceType} in ${regionCode}: ${err}`,
        );
        failed++;
      }
    }
  }

  console.log('\n=== TARGETED REPAIR REPORT ===');
  console.log(`Instances targeted: ${targetInstances.length}`);
  console.log(`Pricing rows (real): ${pricingInserted}`);
  console.log(`Pricing rows (fallback): ${pricingSynthesized}`);
  console.log(`Skipped: ${skipped}`);
  console.log(`Failed: ${failed}`);
}

main()
  .catch(err => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
