import { prisma } from '../../../config/database';
import { logger } from '../../../config/logger';
import {
  fetchAwsRegions,
  fetchAwsInstanceTypes,
  fetchAwsSpotPrices,
  fetchAwsPrices,
} from '../services/aws-client.service';
import {
  mapRegion,
  mapInstanceFamily,
  mapVmInstance,
  mapCapabilityMatrix,
  mapPricing,
  mapReservedPricing,
} from '../mapper/aws.mapper';
import {
  AwsRawRegionSchema,
  AwsRawInstanceTypeSchema,
  AwsRawPricingProductSchema,
} from '../dto/aws-raw.dto';
import { upsertProvider } from '../../../repositories/provider.repository';
import { upsertRegion, getRegionMap } from '../../../repositories/region.repository';
import {
  upsertInstanceFamily,
  getInstanceFamilyMap,
} from '../../../repositories/instance-family.repository';
import {
  upsertVmInstance,
  getVmInstanceMap,
  updateVmInstanceAttributes,
} from '../../../repositories/vm-instance.repository';
import { upsertVmCapabilityMatrix } from '../../../repositories/vm-capability.repository';
import { upsertVmPricing } from '../../../repositories/vm-pricing.repository';

export async function syncAws(): Promise<void> {
  logger.info('Starting AWS Synchronization Ingestion Pipeline...');

  try {
    // 1. Ensure Provider Record exists
    await upsertProvider('aws', 'Amazon Web Services');

    // 2. Sync Regions
    logger.info('Syncing AWS regions...');
    const rawRegions = await fetchAwsRegions();
    for (const raw of rawRegions) {
      const validated = AwsRawRegionSchema.safeParse(raw);
      if (!validated.success) {
        logger.warn(`Skipping invalid region: ${JSON.stringify(raw)}. Error: ${validated.error}`);
        continue;
      }
      const normalized = mapRegion(validated.data);
      await upsertRegion(normalized);
    }

    // Fetch region mapping for resolving regionIds
    const regionMap = await getRegionMap('aws');

    // 3. Resolve AWS EC2 Service ID
    let service = await prisma.service.findFirst({
      where: { providerId: 'aws', slug: 'ec2' },
    });

    if (!service) {
      logger.info('AWS EC2 Service record not found, creating baseline service...');
      // Lookup compute category slug
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
          providerId: 'aws',
          categoryId: computeCategory.id,
          slug: 'ec2',
          name: 'Amazon EC2',
          description: 'Elastic Compute Cloud virtual servers',
          isActive: true,
        },
      });
    }

    const serviceId = service.id;

    // 4. Sync Instance Families and VM Instances
    logger.info('Syncing AWS instance families and VM types...');
    const rawInstances = await fetchAwsInstanceTypes();

    for (const raw of rawInstances) {
      const validated = AwsRawInstanceTypeSchema.safeParse(raw);
      if (!validated.success) {
        logger.warn(
          `Skipping invalid instance type payload: ${raw.InstanceType ?? 'unknown'}. Error: ${validated.error}`,
        );
        continue;
      }

      const rawData = validated.data;

      // Upsert Family
      const normalizedFamily = mapInstanceFamily(rawData);
      await upsertInstanceFamily(normalizedFamily);
    }

    // Fetch family mapping
    const familyMap = await getInstanceFamilyMap('aws');

    // Upsert VM Instances
    for (const raw of rawInstances) {
      const validated = AwsRawInstanceTypeSchema.safeParse(raw);
      if (!validated.success) continue;

      const rawData = validated.data;
      const normalizedInstance = mapVmInstance(rawData);

      const parts = rawData.InstanceType.split('.');
      const familyName = parts[0] || 'unknown';
      const familyId = familyMap.get(familyName);

      if (!familyId) {
        logger.warn(
          `Skipping VM Instance ${rawData.InstanceType}: associated family ${familyName} ID not found.`,
        );
        continue;
      }

      await upsertVmInstance({
        ...normalizedInstance,
        serviceId,
        instanceFamilyId: familyId,
        storageSummary: null,
      });
    }

    // Fetch instance mapping
    const instanceMap = await getVmInstanceMap(serviceId);

    // 5. Ingest Regional Pricing & Capabilities
    // Sync pricing for all active regions
    const activeRegions = Array.from(regionMap.keys());
    const updatedInstanceIds = new Set<string>();

    for (const regionCode of activeRegions) {
      logger.info(`Fetching and processing prices for region: ${regionCode}...`);
      const regionId = regionMap.get(regionCode)!;

      // Fetch live spot prices for this region
      const spotPrices = await fetchAwsSpotPrices(regionCode);
      const rawPrices = await fetchAwsPrices(regionCode);

      for (const rawProduct of rawPrices) {
        const validated = AwsRawPricingProductSchema.safeParse(rawProduct);
        if (!validated.success) {
          logger.warn(`Skipping invalid product pricing record. Error: ${validated.error}`);
          continue;
        }

        const rawData = validated.data;
        const instType = rawData.product.attributes.instanceType;
        const vmInstanceId = instanceMap.get(instType);

        if (!vmInstanceId) {
          // Instance type not registered, skip pricing
          continue;
        }

        // Map and Upsert Capability Matrix Record
        const normCapability = mapCapabilityMatrix(rawData);
        const capabilityRecord = await upsertVmCapabilityMatrix({
          vmInstanceId,
          regionId,
          operatingSystem: normCapability.operatingSystem,
          tenancy: normCapability.tenancy,
          licenseType: normCapability.licenseType,
          isRegionAvailable: normCapability.isRegionAvailable,
          isActive: normCapability.isActive,
        });

        // Update VmInstance attributes (processor, storageSummary, currentGeneration) if present in pricing record (once per instance)
        const physicalProcessor = rawData.product.attributes.physicalProcessor;
        const storage = rawData.product.attributes.storage;
        const currentGenAttr = rawData.product.attributes.currentGeneration;
        if (
          (physicalProcessor || storage || currentGenAttr) &&
          !updatedInstanceIds.has(vmInstanceId)
        ) {
          await updateVmInstanceAttributes(vmInstanceId, {
            ...(physicalProcessor ? { processor: physicalProcessor } : {}),
            ...(storage ? { storageSummary: storage } : {}),
            ...(currentGenAttr ? { currentGeneration: currentGenAttr === 'Yes' } : {}),
          });
          updatedInstanceIds.add(vmInstanceId);
        }

        // Ingest On-Demand Pricing
        const normPricing = mapPricing(rawData);
        if (normPricing) {
          await upsertVmPricing({
            capabilityMatrixId: capabilityRecord.id,
            pricingType: normPricing.pricingType,
            hourlyCost: normPricing.hourlyCost,
          });

          // Derive Commitment Pricing (~37% discount off On-Demand standard baseline)
          await upsertVmPricing({
            capabilityMatrixId: capabilityRecord.id,
            pricingType: 'COMMITMENT',
            hourlyCost: normPricing.hourlyCost * 0.63,
          });
        }

        // Ingest Reserved Pricing
        const reservedPricing = mapReservedPricing(rawData);
        if (reservedPricing) {
          await upsertVmPricing({
            capabilityMatrixId: capabilityRecord.id,
            pricingType: reservedPricing.pricingType,
            hourlyCost: reservedPricing.hourlyCost,
          });
        }

        // Ingest Spot Pricing from EC2 SDK
        const spotPrice = spotPrices.get(instType);
        if (spotPrice !== undefined && spotPrice > 0) {
          await upsertVmPricing({
            capabilityMatrixId: capabilityRecord.id,
            pricingType: 'SPOT',
            hourlyCost: spotPrice,
          });
        } else if (normPricing) {
          // Fallback: If Spot SDK fetch is missing for specific type, calculate ~65% discount baseline
          await upsertVmPricing({
            capabilityMatrixId: capabilityRecord.id,
            pricingType: 'SPOT',
            hourlyCost: normPricing.hourlyCost * 0.35,
          });
        }
      }
    }

    logger.info('AWS Ingestion Synchronization completed successfully.');
  } catch (error) {
    logger.error('AWS Ingestion Pipeline failed:', error);
    throw error;
  }
}
