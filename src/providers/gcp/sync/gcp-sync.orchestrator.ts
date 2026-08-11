import { v4 as uuidv4 } from 'uuid';
import { prisma } from '../../../config/database';
import { logger } from '../../../config/logger';
import {
  fetchGcpRegions,
  fetchGcpMachineTypes,
  fetchGcpNodeTypes,
} from '../services/gcp-compute.service';
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

const USAGE_TYPES: GcpUsageType[] = ['OnDemand', 'Preemptible', 'Commit1Yr', 'Commit3Yr'];

export async function syncGcp(): Promise<void> {
  logger.info('Starting GCP Synchronization Ingestion Pipeline...');

  let regionsInserted = 0;
  let familiesInserted = 0;
  let instancesInserted = 0;
  let pricingInserted = 0;
  let skippedPricing = 0;
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

    // 4. Sync Instance Families and VM Instances (Standard VMs + Sole Tenant Nodes)
    logger.info('Syncing GCP instance families, machine types, and sole tenant node types...');
    const rawMachineTypesAllZones = await fetchGcpMachineTypes();
    const rawNodeTypesAllZones = await fetchGcpNodeTypes();
    const rawAllTypes = [...rawMachineTypesAllZones, ...rawNodeTypesAllZones];

    // Dedupe by name before ingesting
    const machineTypeByName = new Map<string, (typeof rawAllTypes)[number]>();
    for (const mt of rawAllTypes) {
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

    // 5. Ingest Regional Pricing & Capabilities via Cloud Billing Catalog SKU composition (Batch Edition)
    logger.info('Fetching GCP Compute Engine SKUs for pricing composition...');
    const serviceCatalogId = await resolveComputeEngineServiceId();
    const rawSkus = await fetchGcpComputeSkus(serviceCatalogId);
    const skuIndex = buildGcpSkuIndex(rawSkus);

    const activeRegions = Array.from(regionMap.keys());
    logger.info(
      `Composing pricing for ${instanceMap.size} instances across ${activeRegions.length} regions (Batch Edition)...`,
    );

    // Fetch existing GCP capability matrix entries to construct in-memory lookup map
    const existingCapabilities = await prisma.vmCapabilityMatrix.findMany({
      where: { region: { providerId: 'gcp' } },
      select: {
        id: true,
        vmInstanceId: true,
        regionId: true,
        operatingSystem: true,
        tenancy: true,
        licenseType: true,
      },
    });

    const capabilityLookup = new Map<string, string>(); // key -> capabilityId
    for (const cap of existingCapabilities) {
      const key = `${cap.vmInstanceId}_${cap.regionId}_${cap.operatingSystem}_${cap.tenancy}_${cap.licenseType || 'INCLUDED'}`;
      capabilityLookup.set(key, cap.id);
    }

    const capabilitiesToCreate: any[] = [];
    const pricingMap = new Map<string, any>(); // priceKey -> pricing object

    for (const regionCode of activeRegions) {
      const regionId = regionMap.get(regionCode)!;

      for (const [instanceType, vmInstanceId] of instanceMap.entries()) {
        const machineType = machineTypeByName.get(instanceType);
        if (!machineType) continue;

        try {
          // Resolve on-demand pricing before touching capability records
          const onDemandCost = composeHourlyCost(machineType, regionCode, 'OnDemand', skuIndex);
          if (onDemandCost == null) {
            skipped++;
            continue;
          }

          const normCapability = mapCapabilityMatrix(regionCode, machineType.name);
          const os = normCapability.operatingSystem;
          const tenancy = normCapability.tenancy;
          const licenseType = normCapability.licenseType || 'INCLUDED';
          const capKey = `${vmInstanceId}_${regionId}_${os}_${tenancy}_${licenseType}`;

          let capabilityId = capabilityLookup.get(capKey);
          if (!capabilityId) {
            capabilityId = uuidv4();
            capabilityLookup.set(capKey, capabilityId);
            capabilitiesToCreate.push({
              id: capabilityId,
              vmInstanceId,
              regionId,
              operatingSystem: os,
              tenancy,
              licenseType,
              isRegionAvailable: normCapability.isRegionAvailable,
              isActive: normCapability.isActive,
            });
          }

          // On-demand pricing record
          const onDemandKey = `${capabilityId}_${USAGE_TYPE_TO_PRICING_TYPE.OnDemand}`;
          if (!pricingMap.has(onDemandKey)) {
            pricingMap.set(onDemandKey, {
              id: uuidv4(),
              capabilityMatrixId: capabilityId,
              pricingType: USAGE_TYPE_TO_PRICING_TYPE.OnDemand,
              hourlyCost: onDemandCost,
            });
            pricingInserted++;
          }

          // Preemptible & Commitment pricing records (Strict Provider Ingestion)
          for (const usageType of USAGE_TYPES.slice(1)) {
            const composed = composeHourlyCost(machineType, regionCode, usageType, skuIndex);
            if (composed == null) {
              logger.debug(
                `Official GCP SKU for ${usageType} unavailable for ${machineType.name} in ${regionCode}. Skipping.`,
              );
              skippedPricing++;
              continue;
            }

            const pricingType = USAGE_TYPE_TO_PRICING_TYPE[usageType];
            const priceKey = `${capabilityId}_${pricingType}`;

            if (!pricingMap.has(priceKey)) {
              pricingMap.set(priceKey, {
                id: uuidv4(),
                capabilityMatrixId: capabilityId,
                pricingType,
                hourlyCost: composed,
              });
              pricingInserted++;
            }
          }
        } catch (err) {
          logger.error(`Failed pricing composition for ${instanceType} in ${regionCode}: ${err}`);
          failed++;
        }
      }
    }

    const pricingToCreate = Array.from(pricingMap.values());

    // Execute bulk batch writes inside atomic database transactions
    if (capabilitiesToCreate.length > 0) {
      logger.info(`Creating ${capabilitiesToCreate.length} new GCP Capability Matrix entries...`);
      const chunkSize = 2000;
      for (let i = 0; i < capabilitiesToCreate.length; i += chunkSize) {
        const chunk = capabilitiesToCreate.slice(i, i + chunkSize);
        await prisma.vmCapabilityMatrix.createMany({
          data: chunk,
          skipDuplicates: true,
        });
      }
    }

    if (pricingToCreate.length > 0) {
      logger.info(
        `Bulk upserting ${pricingToCreate.length} GCP Pricing records via PostgreSQL ON CONFLICT DO UPDATE...`,
      );
      const chunkSize = 1000;
      for (let i = 0; i < pricingToCreate.length; i += chunkSize) {
        const chunk = pricingToCreate.slice(i, i + chunkSize);

        // Construct parametrized values SQL string for bulk ON CONFLICT DO UPDATE
        const valueStrings: string[] = [];
        const params: any[] = [];
        let paramIdx = 1;

        for (const p of chunk) {
          valueStrings.push(
            `($${paramIdx}, $${paramIdx + 1}, CAST($${paramIdx + 2}::text AS "public"."PricingType"), $${paramIdx + 3}, NOW(), NOW())`,
          );
          params.push(p.id, p.capabilityMatrixId, p.pricingType, p.hourlyCost);
          paramIdx += 4;
        }

        const sql = `
          INSERT INTO "public"."vm_pricing" ("id", "capabilityMatrixId", "pricingType", "hourlyCost", "createdAt", "updatedAt")
          VALUES ${valueStrings.join(', ')}
          ON CONFLICT ("capabilityMatrixId", "pricingType")
          DO UPDATE SET 
            "hourlyCost" = EXCLUDED."hourlyCost",
            "updatedAt" = NOW();
        `;

        await prisma.$executeRawUnsafe(sql, ...params);
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
  console.log(`Pricing rows (fallback): 0`);
  console.log(`Pricing rows (skipped) : ${skippedPricing}`);
  console.log(`Skipped               : ${skipped}`);
  console.log(`Failed                : ${failed}`);
  console.log('=========================================================\n');
}
