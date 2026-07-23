import { prisma } from '../../../config/database';
import { logger } from '../../../config/logger';
import { fetchGcpRegions, fetchGcpMachineTypes } from '../services/gcp-compute.service';
import {
  resolveComputeEngineServiceId,
  fetchGcpComputeSkus,
} from '../services/gcp-billing.service';
import {
  mapRegion,
  mapInstanceFamily,
  mapVmInstance,
  mapCapabilityMatrix,
  buildGcpSkuIndex,
  composeHourlyCost,
  USAGE_TYPE_TO_PRICING_TYPE,
  GcpUsageType,
} from '../mapper/gcp.mapper';
import { GcpRawRegionSchema, GcpRawMachineTypeSchema } from '../dto/gcp-raw.dto';
import { upsertProvider } from '../../../repositories/provider.repository';
import { upsertRegion, getRegionMap } from '../../../repositories/region.repository';
import {
  upsertInstanceFamily,
  getInstanceFamilyMap,
} from '../../../repositories/instance-family.repository';
import { upsertVmInstance, getVmInstanceMap } from '../../../repositories/vm-instance.repository';
import { upsertVmCapabilityMatrix } from '../../../repositories/vm-capability.repository';
import { upsertVmPricing } from '../../../repositories/vm-pricing.repository';

// Fallback discount ratios applied only when a real GCP SKU can't be composed for that
// usageType, matching the ratios AWS/Azure already use for their own synthesized fallbacks.
const SPOT_FALLBACK_RATIO = 0.35;
const COMMITMENT_FALLBACK_RATIO = 0.63;
const RESERVED_FALLBACK_RATIO = 0.7;

const USAGE_TYPES: GcpUsageType[] = ['OnDemand', 'Preemptible', 'Commit1Yr', 'Commit3Yr'];

export async function syncGcp(): Promise<void> {
  logger.info('Starting GCP Synchronization Ingestion Pipeline...');

  let regionsInserted = 0;
  let familiesInserted = 0;
  let instancesInserted = 0;
  let pricingInserted = 0;
  let pricingSynthesized = 0;
  let skipped = 0;
  let failed = 0;

  try {
    // 1. Ensure Provider record exists
    await upsertProvider('gcp', 'Google Cloud Platform');

    // 2. Sync Regions
    logger.info('Syncing GCP regions...');
    const rawRegions = await fetchGcpRegions();
    for (const raw of rawRegions) {
      const validated = GcpRawRegionSchema.safeParse(raw);
      if (!validated.success) {
        logger.warn(`Skipping invalid region: ${JSON.stringify(raw)}. Error: ${validated.error}`);
        continue;
      }
      await upsertRegion(mapRegion(validated.data));
      regionsInserted++;
    }

    const regionMap = await getRegionMap('gcp');

    // 3. Resolve GCP Compute Engine Service record
    let service = await prisma.service.findFirst({
      where: { providerId: 'gcp', slug: 'gce' },
    });

    if (!service) {
      logger.info('GCP GCE Service record not found, creating baseline service...');
      const computeCategory = await prisma.category.findUnique({
        where: { slug: 'compute' },
      });
      if (!computeCategory) {
        throw new Error(
          'Database is missing default "compute" category. Run database seeding first.',
        );
      }

      service = await prisma.service.create({
        data: {
          providerId: 'gcp',
          categoryId: computeCategory.id,
          slug: 'gce',
          name: 'Google Compute Engine (GCE)',
          description: 'Google Cloud virtual machine instances',
          isActive: true,
        },
      });
    }

    const serviceId = service.id;

    // 4. Sync Instance Families and VM Instances
    logger.info('Syncing GCP instance families and machine types...');
    const rawMachineTypesAllZones = await fetchGcpMachineTypes();

    // machineTypes.aggregatedList returns one entry per zone; specs are identical across zones
    // for the same machine type name, so dedupe by name before ingesting.
    const machineTypeByName = new Map<string, (typeof rawMachineTypesAllZones)[number]>();
    for (const mt of rawMachineTypesAllZones) {
      if (!machineTypeByName.has(mt.name)) machineTypeByName.set(mt.name, mt);
    }
    const rawMachineTypes = Array.from(machineTypeByName.values());

    for (const raw of rawMachineTypes) {
      const validated = GcpRawMachineTypeSchema.safeParse(raw);
      if (!validated.success) {
        logger.warn(
          `Skipping invalid machine type payload: ${raw.name ?? 'unknown'}. Error: ${validated.error}`,
        );
        continue;
      }
      await upsertInstanceFamily(
        mapInstanceFamily(validated.data.name, validated.data.architecture),
      );
      familiesInserted++;
    }

    const familyMap = await getInstanceFamilyMap('gcp');

    for (const raw of rawMachineTypes) {
      const validated = GcpRawMachineTypeSchema.safeParse(raw);
      if (!validated.success) continue;

      const rawData = validated.data;
      const parts = rawData.name.split('-');
      const familyToken = parts[0]?.toLowerCase() || 'unknown';
      const familyName =
        parts[1] === 'highmem' || parts[1] === 'highcpu'
          ? `${familyToken}-${parts[1]}`
          : familyToken;
      const familyId = familyMap.get(familyName);

      if (!familyId) {
        logger.warn(
          `Skipping machine type ${rawData.name}: associated family ${familyName} ID not found.`,
        );
        skipped++;
        continue;
      }

      await upsertVmInstance({
        ...mapVmInstance(rawData),
        serviceId,
        instanceFamilyId: familyId,
      });
      instancesInserted++;
    }

    const instanceMap = await getVmInstanceMap(serviceId);

    // 5. Ingest Regional Pricing & Capabilities via Cloud Billing Catalog SKU composition
    logger.info('Fetching GCP Compute Engine SKUs for pricing composition...');
    const serviceCatalogId = await resolveComputeEngineServiceId();
    const rawSkus = await fetchGcpComputeSkus(serviceCatalogId);
    const skuIndex = buildGcpSkuIndex(rawSkus);

    const activeRegions = Array.from(regionMap.keys());
    logger.info(
      `Composing pricing for ${instanceMap.size} instances across ${activeRegions.length} regions...`,
    );

    for (const regionCode of activeRegions) {
      const regionId = regionMap.get(regionCode)!;

      for (const [instanceType, vmInstanceId] of instanceMap.entries()) {
        const machineType = machineTypeByName.get(instanceType);
        if (!machineType) continue;

        try {
          // Resolve on-demand pricing before touching the DB — an unresolvable price means we
          // skip the whole (instance, region) combo rather than leave behind a capability row
          // with zero pricing rows attached.
          const onDemandCost = composeHourlyCost(machineType, regionCode, 'OnDemand', skuIndex);
          if (onDemandCost == null) {
            skipped++;
            continue;
          }

          const normCapability = mapCapabilityMatrix(regionCode);
          const capabilityRecord = await upsertVmCapabilityMatrix({
            vmInstanceId,
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
          logger.error(`Failed pricing composition for ${instanceType} in ${regionCode}: ${err}`);
          failed++;
        }
      }
    }

    logger.info('GCP Ingestion Synchronization completed successfully.');
  } catch (error) {
    logger.error('GCP Ingestion Pipeline failed:', error);
    throw error;
  }

  console.log('\n=========================================================');
  console.log('GCP SYNCHRONIZATION PIPELINE REPORT');
  console.log('=========================================================');
  console.log(`Regions inserted      : ${regionsInserted}`);
  console.log(`Families inserted     : ${familiesInserted}`);
  console.log(`Instances inserted    : ${instancesInserted}`);
  console.log(`Pricing rows (real)   : ${pricingInserted}`);
  console.log(`Pricing rows (fallback): ${pricingSynthesized}`);
  console.log(`Skipped               : ${skipped}`);
  console.log(`Failed                : ${failed}`);
  console.log('=========================================================\n');
}
