import { v4 as uuidv4 } from 'uuid';
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
import { getRegionMap } from '../../../repositories/region.repository';
import { getInstanceFamilyMap } from '../../../repositories/instance-family.repository';
import { getVmInstanceMap } from '../../../repositories/vm-instance.repository';
import { syncLockService } from '../../../services/sync-lock.service';

export async function syncAws(): Promise<void> {
  await syncLockService.executeWithLock('aws', async () => {
    logger.info('Starting AWS Synchronization Ingestion Pipeline (Optimized Batch Edition)...');
    const startTime = new Date();

    try {
      // 1. Ensure Provider Record exists
      await upsertProvider('aws', 'Amazon Web Services');

      // 2. Sync Regions
      logger.info('Syncing AWS regions...');
      const rawRegions = await fetchAwsRegions();
      const regionsToCreate = [];
      for (const raw of rawRegions) {
        const validated = AwsRawRegionSchema.safeParse(raw);
        if (!validated.success) {
          logger.warn(`Skipping invalid region: ${JSON.stringify(raw)}. Error: ${validated.error}`);
          continue;
        }
        regionsToCreate.push(mapRegion(validated.data));
      }
      await prisma.region.createMany({
        data: regionsToCreate,
        skipDuplicates: true,
      });

      // Fetch region mapping for resolving regionIds
      const regionMap = await getRegionMap('aws');

      // 3. Resolve AWS EC2 Service ID
      let service = await prisma.service.findFirst({
        where: { providerId: 'aws', slug: 'ec2' },
      });

      if (!service) {
        logger.info('AWS EC2 Service record not found, creating baseline service...');
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
      logger.info('Syncing AWS instance families...');
      const rawInstances = await fetchAwsInstanceTypes();
      const familiesToCreate = [];
      for (const raw of rawInstances) {
        const validated = AwsRawInstanceTypeSchema.safeParse(raw);
        if (!validated.success) continue;
        familiesToCreate.push(mapInstanceFamily(validated.data));
      }

      // De-duplicate families by name
      const uniqueFamilies = Array.from(new Map(familiesToCreate.map(f => [f.name, f])).values());
      await prisma.instanceFamily.createMany({
        data: uniqueFamilies,
        skipDuplicates: true,
      });

      // Fetch family mapping
      const familyMap = await getInstanceFamilyMap('aws');

      // Sync VM Instances
      logger.info('Syncing AWS VM Instances...');
      const existingVmInstances = await prisma.vmInstance.findMany({
        where: { serviceId },
      });
      const existingVmMap = new Map(existingVmInstances.map(v => [v.instanceType, v]));

      const vmsToCreate = [];
      const vmsToUpdate = [];

      for (const raw of rawInstances) {
        const validated = AwsRawInstanceTypeSchema.safeParse(raw);
        if (!validated.success) continue;

        const rawData = validated.data;
        const normalizedInstance = mapVmInstance(rawData);

        const parts = rawData.InstanceType.split('.');
        const familyName = parts[0] || 'unknown';
        const familyId = familyMap.get(familyName);

        if (!familyId) continue;

        const vmData = {
          ...normalizedInstance,
          serviceId,
          instanceFamilyId: familyId,
          storageSummary: null,
        };

        const existingVm = existingVmMap.get(rawData.InstanceType);
        if (!existingVm) {
          vmsToCreate.push(vmData);
        } else {
          if (existingVm.instanceFamilyId !== familyId) {
            vmsToUpdate.push({
              id: existingVm.id,
              data: { instanceFamilyId: familyId },
            });
          }
        }
      }

      if (vmsToCreate.length > 0) {
        logger.info(`Creating ${vmsToCreate.length} new AWS VM Instances...`);
        await prisma.vmInstance.createMany({
          data: vmsToCreate,
          skipDuplicates: true,
        });
      }

      if (vmsToUpdate.length > 0) {
        logger.info(`Updating ${vmsToUpdate.length} AWS VM Instances...`);
        const chunkSize = 100;
        for (let i = 0; i < vmsToUpdate.length; i += chunkSize) {
          const chunk = vmsToUpdate.slice(i, i + chunkSize);
          await prisma.$transaction(
            chunk.map(item =>
              prisma.vmInstance.update({
                where: { id: item.id },
                data: item.data,
              }),
            ),
          );
        }
      }

      // Fetch instance mapping
      const instanceMap = await getVmInstanceMap(serviceId);

      // 5. Ingest Regional Pricing & Capabilities
      const activeRegions = Array.from(regionMap.keys());
      const updatedInstanceIds = new Set<string>();

      const capabilitiesToCreate: any[] = [];
      const pricingMap = new Map();
      const vmAttributesToUpdate = new Map();

      // Fetch all existing capability matrix entries for AWS to build a lookup cache
      const existingCapabilities = await prisma.vmCapabilityMatrix.findMany({
        where: { region: { providerId: 'aws' } },
        select: {
          id: true,
          vmInstanceId: true,
          regionId: true,
          operatingSystem: true,
          tenancy: true,
          licenseType: true,
        },
      });

      const capabilityLookup = new Map();
      for (const cap of existingCapabilities) {
        const key = `${cap.vmInstanceId}_${cap.regionId}_${cap.operatingSystem}_${cap.tenancy}_${cap.licenseType || 'INCLUDED'}`;
        capabilityLookup.set(key, cap.id);
      }

      // Bounded worker pool helper for parallel region processing
      const mapConcurrent = async <T>(
        items: T[],
        concurrencyLimit: number,
        fn: (item: T) => Promise<void>,
      ): Promise<void> => {
        const queue = [...items];
        const workers = Array.from(
          { length: Math.min(concurrencyLimit, items.length) },
          async () => {
            while (queue.length > 0) {
              const item = queue.shift();
              if (item !== undefined) {
                await fn(item);
              }
            }
          },
        );
        await Promise.all(workers);
      };

      const CONCURRENCY_LIMIT = 5;
      logger.info(
        `Processing ${activeRegions.length} AWS regions with bounded concurrency limit of ${CONCURRENCY_LIMIT}...`,
      );

      await mapConcurrent(activeRegions, CONCURRENCY_LIMIT, async regionCode => {
        try {
          logger.info(`Fetching and processing prices for region: ${regionCode}...`);
          const regionId = regionMap.get(regionCode)!;

          // Fetch live spot and retail prices for this region
          const spotPrices = await fetchAwsSpotPrices(regionCode);
          const rawPrices = await fetchAwsPrices(regionCode);

          for (const rawProduct of rawPrices) {
            const validated = AwsRawPricingProductSchema.safeParse(rawProduct);
            if (!validated.success) continue;

            const rawData = validated.data;
            const instType = rawData.product.attributes.instanceType;
            const vmInstanceId = instanceMap.get(instType);

            if (!vmInstanceId) continue;

            // Map and prepare Capability Matrix Record
            const normCapability = mapCapabilityMatrix(rawData);
            const os = normCapability.operatingSystem;
            const tenancy = normCapability.tenancy;
            const licenseType = normCapability.licenseType || 'INCLUDED';
            const key = `${vmInstanceId}_${regionId}_${os}_${tenancy}_${licenseType}`;

            let capabilityId = capabilityLookup.get(key);
            if (!capabilityId) {
              capabilityId = uuidv4();
              capabilityLookup.set(key, capabilityId);
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

            // Collect attributes to update on the VM instance if they changed (once per VM ID)
            const physicalProcessor = rawData.product.attributes.physicalProcessor;
            const clockSpeedAttr = rawData.product.attributes.clockSpeed;
            const storage = rawData.product.attributes.storage;
            const currentGenAttr = rawData.product.attributes.currentGeneration;
            if (
              (physicalProcessor || clockSpeedAttr || storage || currentGenAttr) &&
              !updatedInstanceIds.has(vmInstanceId)
            ) {
              const existingVm = existingVmMap.get(instType);
              if (existingVm) {
                const processorVal = physicalProcessor || existingVm.processor;
                const storageVal = storage || existingVm.storageSummary;
                let freqVal = existingVm.cpuFrequencyGhz;
                if (clockSpeedAttr) {
                  const parsedFreq = parseFloat(clockSpeedAttr.replace(/[^0-9.]/g, ''));
                  if (!isNaN(parsedFreq) && parsedFreq > 0) freqVal = parsedFreq;
                }
                const currentGenVal = currentGenAttr
                  ? currentGenAttr === 'Yes'
                  : existingVm.currentGeneration;

                if (
                  existingVm.processor !== processorVal ||
                  existingVm.cpuFrequencyGhz !== freqVal ||
                  existingVm.storageSummary !== storageVal ||
                  existingVm.currentGeneration !== currentGenVal
                ) {
                  vmAttributesToUpdate.set(vmInstanceId, {
                    processor: processorVal,
                    cpuFrequencyGhz: freqVal,
                    storageSummary: storageVal,
                    currentGeneration: currentGenVal,
                  });
                }
              }
              updatedInstanceIds.add(vmInstanceId);
            }

            // Ingest On-Demand & Commitment Pricing
            const normPricing = mapPricing(rawData);
            if (normPricing) {
              const odKey = `${capabilityId}_${normPricing.pricingType}`;
              pricingMap.set(odKey, {
                id: uuidv4(),
                capabilityMatrixId: capabilityId,
                pricingType: normPricing.pricingType,
                hourlyCost: normPricing.hourlyCost,
              });

              // Derive Commitment Pricing (~37% discount off On-Demand standard baseline)
              const commitKey = `${capabilityId}_COMMITMENT`;
              pricingMap.set(commitKey, {
                id: uuidv4(),
                capabilityMatrixId: capabilityId,
                pricingType: 'COMMITMENT',
                hourlyCost: normPricing.hourlyCost * 0.63,
              });
            }

            // Ingest Reserved Pricing
            const reservedPricing = mapReservedPricing(rawData);
            if (reservedPricing) {
              const resKey = `${capabilityId}_${reservedPricing.pricingType}`;
              pricingMap.set(resKey, {
                id: uuidv4(),
                capabilityMatrixId: capabilityId,
                pricingType: reservedPricing.pricingType,
                hourlyCost: reservedPricing.hourlyCost,
              });
            }

            // Ingest Spot Pricing from EC2 SDK
            const spotPrice = spotPrices.get(instType);
            if (spotPrice !== undefined && spotPrice > 0 && spotPrice < 999999) {
              const spotKey = `${capabilityId}_SPOT`;
              pricingMap.set(spotKey, {
                id: uuidv4(),
                capabilityMatrixId: capabilityId,
                pricingType: 'SPOT',
                hourlyCost: spotPrice,
              });
            } else if (normPricing) {
              // Fallback: If Spot SDK fetch is missing, calculate ~65% discount baseline
              const spotKey = `${capabilityId}_SPOT`;
              pricingMap.set(spotKey, {
                id: uuidv4(),
                capabilityMatrixId: capabilityId,
                pricingType: 'SPOT',
                hourlyCost: normPricing.hourlyCost * 0.35,
              });
            }
          }
        } catch (err: any) {
          logger.warn(
            `Failed to process prices for region ${regionCode}. Skipping. Reason: ${err.message || err}`,
          );
        }
      });

      const pricingList = Array.from(pricingMap.values());

      // Execute bulk capability creations
      if (capabilitiesToCreate.length > 0) {
        logger.info(`Creating ${capabilitiesToCreate.length} new AWS Capability Matrix entries...`);
        const chunkSize = 5000;
        for (let i = 0; i < capabilitiesToCreate.length; i += chunkSize) {
          const chunk = capabilitiesToCreate.slice(i, i + chunkSize);
          await prisma.vmCapabilityMatrix.createMany({
            data: chunk,
          });
        }
      }

      // Execute bulk VM attribute updates
      if (vmAttributesToUpdate.size > 0) {
        logger.info(`Updating attributes for ${vmAttributesToUpdate.size} AWS VM instances...`);
        const updates = Array.from(vmAttributesToUpdate.entries());
        const chunkSize = 100;
        for (let i = 0; i < updates.length; i += chunkSize) {
          const chunk = updates.slice(i, i + chunkSize);
          await prisma.$transaction(
            chunk.map(([id, data]) =>
              prisma.vmInstance.update({
                where: { id },
                data,
              }),
            ),
          );
        }
      }

      // Delete existing AWS pricing records to avoid duplicates
      logger.info('Deleting existing AWS VM pricing records...');
      await prisma.vmPricing.deleteMany({
        where: {
          capabilityMatrix: {
            region: {
              providerId: 'aws',
            },
          },
        },
      });

      // Ingest all pricing rows in bulk chunks
      if (pricingList.length > 0) {
        logger.info(`Creating ${pricingList.length} AWS pricing records...`);
        const chunkSize = 5000;
        for (let i = 0; i < pricingList.length; i += chunkSize) {
          const chunk = pricingList.slice(i, i + chunkSize);
          await prisma.vmPricing.createMany({
            data: chunk,
          });
        }
      }

      const endTime = new Date();
      const durationSeconds = Math.round((endTime.getTime() - startTime.getTime()) / 1000);

      logger.info('AWS Ingestion Synchronization Completed Successfully', {
        telemetry: {
          provider: 'aws',
          status: 'SUCCESS',
          startTime: startTime.toISOString(),
          endTime: endTime.toISOString(),
          durationSeconds,
          totalRegionsProcessed: activeRegions.length,
          vmInstancesCreated: vmsToCreate.length,
          capabilitiesCreated: capabilitiesToCreate.length,
          pricingRecordsInserted: pricingList.length,
        },
      });
    } catch (error) {
      logger.error('AWS Ingestion Pipeline failed:', error);
      throw error;
    }
  });
}
