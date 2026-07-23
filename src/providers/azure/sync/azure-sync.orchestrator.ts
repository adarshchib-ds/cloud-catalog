import { v4 as uuidv4 } from 'uuid';
import { prisma } from '../../../config/database';
import { logger } from '../../../config/logger';
import { fetchAzureVmPricing } from '../services/azure-pricing.service';
import { fetchAzureVmSkus } from '../services/azure-client.service';
import {
  mapAzureRegion,
  mapAzureInstanceFamily,
  mapAzureVmInstance,
  mapAzureCapabilityMatrix,
  mapAzurePricing,
  determineCurrentGeneration,
} from '../mapper/azure.mapper';
import { upsertProvider } from '../../../repositories/provider.repository';
import { upsertRegion, getRegionMap } from '../../../repositories/region.repository';
import { getInstanceFamilyMap } from '../../../repositories/instance-family.repository';
import { getVmInstanceMap } from '../../../repositories/vm-instance.repository';

// Static mapping of Azure Region codes to Display Names
const AZURE_REGION_NAMES: Record<string, string> = {
  eastus: 'East US',
  eastus2: 'East US 2',
  westus: 'West US',
  westus2: 'West US 2',
  westus3: 'West US 3',
  centralus: 'Central US',
  northcentralus: 'North Central US',
  southcentralus: 'South Central US',
  westcentralus: 'West Central US',
  canadacentral: 'Canada Central',
  canadaeast: 'Canada East',
  northeurope: 'North Europe',
  westeurope: 'West Europe',
  uksouth: 'UK South',
  ukwest: 'UK West',
  francecentral: 'France Central',
  francesouth: 'France South',
  germanywestcentral: 'Germany West Central',
  germanynorth: 'Germany North',
  norwayeast: 'Norway East',
  norwaywest: 'Norway West',
  swedencentral: 'Sweden Central',
  swedensouth: 'Sweden South',
  switzerlandnorth: 'Switzerland North',
  switzerlandwest: 'Switzerland West',
  brazilsouth: 'Brazil South',
  brazilsoutheast: 'Brazil Southeast',
  southeastasia: 'Southeast Asia',
  eastasia: 'East Asia',
  australiaeast: 'Australia East',
  australiasoutheast: 'Australia Southeast',
  australiacentral: 'Australia Central',
  australiacentral2: 'Australia Central 2',
  japaneast: 'Japan East',
  japanwest: 'Japan West',
  koreacentral: 'Korea Central',
  koreasouth: 'Korea South',
  centralindia: 'Central India',
  southindia: 'South India',
  westindia: 'West India',
  southafricanorth: 'South Africa North',
  southafricawest: 'South Africa West',
  uaenorth: 'UAE North',
  uaecentral: 'UAE Central',
  israelcentral: 'Israel Central',
  italynorth: 'Italy North',
  polandcentral: 'Poland Central',
};

export async function syncAzure(): Promise<void> {
  logger.info(
    'Starting Azure Ingestion Ingress synchronization pipeline (Optimized Batch Edition)...',
  );

  // Sync metrics counters
  let regionsInserted = 0;
  let familiesInserted = 0;
  let skusDiscovered = 0;
  let skusInserted = 0;
  let pricingInserted = 0;
  let capabilitiesInserted = 0;
  let skipped = 0;
  let failed = 0;

  try {
    // 1. Ensure Provider record exists
    await upsertProvider('azure', 'Microsoft Azure');

    // 2. Fetch VM SKUs using Official SDK
    const rawSkus = await fetchAzureVmSkus();
    skusDiscovered = rawSkus.length;

    // 3. Extract and Sync Regions from SKUs location lists
    const uniqueRegions = new Map<string, string>(); // code -> location name
    for (const sku of rawSkus) {
      if (sku.locations) {
        for (const loc of sku.locations) {
          const code = loc.toLowerCase();
          if (!uniqueRegions.has(code)) {
            uniqueRegions.set(code, AZURE_REGION_NAMES[code] || loc);
          }
        }
      }
    }

    logger.info(`Syncing ${uniqueRegions.size} Azure regions...`);
    const regionsToUpsert = Array.from(uniqueRegions.entries()).map(([code, location]) =>
      mapAzureRegion(code, location),
    );

    // Regions are few (~75), so standard loop upserts are fine and fast
    for (const region of regionsToUpsert) {
      try {
        await upsertRegion(region);
        regionsInserted++;
      } catch (err) {
        logger.error(`Failed region upsert for ${region.code}: ${err}`);
        failed++;
      }
    }

    const regionMap = await getRegionMap('azure');

    // 4. Resolve Azure Service ID
    let service = await prisma.service.findFirst({
      where: { providerId: 'azure', slug: 'azure-vm' },
    });

    if (!service) {
      logger.info('Azure VM Service record not found. Baseline service setup...');
      const computeCategory = await prisma.category.findUnique({
        where: { slug: 'compute' },
      });
      if (!computeCategory) {
        throw new Error('Database is missing default "compute" category. Seeding required.');
      }
      service = await prisma.service.create({
        data: {
          providerId: 'azure',
          categoryId: computeCategory.id,
          slug: 'azure-vm',
          name: 'Azure Virtual Machines',
          description: 'On-demand scalable cloud VM compute',
          isActive: true,
        },
      });
    }

    const serviceId = service.id;

    // 5. Sync Instance Families
    logger.info('Syncing Azure Instance Families...');
    const uniqueFamilies = new Map<string, any>();
    for (const sku of rawSkus) {
      const normalizedFamily = mapAzureInstanceFamily(sku);
      if (!uniqueFamilies.has(normalizedFamily.name)) {
        uniqueFamilies.set(normalizedFamily.name, normalizedFamily);
      }
    }

    const familiesList = Array.from(uniqueFamilies.values());
    await prisma.instanceFamily.createMany({
      data: familiesList,
      skipDuplicates: true,
    });
    familiesInserted = familiesList.length;

    const familyMap = await getInstanceFamilyMap('azure');

    // 6. Sync VM Instances
    logger.info('Syncing Azure VM Instances...');
    const skuNames = rawSkus.map(s => s.name!).filter(Boolean);
    const generationMap = determineCurrentGeneration(skuNames);

    // Fetch existing VM instances to determine what needs to be created vs updated
    const existingVmInstances = await prisma.vmInstance.findMany({
      where: { serviceId },
    });
    const existingVmMap = new Map(existingVmInstances.map(v => [v.instanceType, v]));

    const vmsToCreate: any[] = [];
    const vmsToUpdate: { id: string; data: any }[] = [];

    for (const sku of rawSkus) {
      if (!sku.name) {
        skipped++;
        continue;
      }

      const clean = sku.name.replace('Standard_', '').replace('Basic_', '');
      const familyName = clean.split('_')[0]?.replace(/[0-9]/g, '') || 'unknown';
      const familyId = familyMap.get(familyName);

      if (!familyId) {
        skipped++;
        continue;
      }

      const normalizedVm = mapAzureVmInstance(sku);
      const isCurrent = generationMap.get(sku.name) ?? true;

      const vmData = {
        ...normalizedVm,
        serviceId,
        instanceFamilyId: familyId,
        currentGeneration: isCurrent,
        storageSummary: normalizedVm.storageSummary || null,
        storageType: normalizedVm.storageType || null,
        storageSizeGib: normalizedVm.storageSizeGib || null,
        storageCount: normalizedVm.storageCount || null,
        storageIops: normalizedVm.storageIops || null,
        storageThroughputMbps: normalizedVm.storageThroughputMbps || null,
        supportsLiveMigration: normalizedVm.supportsLiveMigration ?? false,
        supportsNestedVirtualization: normalizedVm.supportsNestedVirtualization ?? false,
      };

      const existingVm = existingVmMap.get(sku.name);
      if (!existingVm) {
        vmsToCreate.push(vmData);
      } else {
        // Only update if critical attributes or generation changed to reduce unnecessary DB writes
        if (
          existingVm.currentGeneration !== isCurrent ||
          existingVm.instanceFamilyId !== familyId
        ) {
          vmsToUpdate.push({
            id: existingVm.id,
            data: {
              currentGeneration: isCurrent,
              instanceFamilyId: familyId,
            },
          });
        }
      }
    }

    if (vmsToCreate.length > 0) {
      logger.info(`Creating ${vmsToCreate.length} new VM Instances...`);
      await prisma.vmInstance.createMany({
        data: vmsToCreate,
        skipDuplicates: true,
      });
    }

    if (vmsToUpdate.length > 0) {
      logger.info(`Updating ${vmsToUpdate.length} VM Instances...`);
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

    skusInserted = vmsToCreate.length + vmsToUpdate.length;

    // Refresh the complete instance map from database
    const instanceMap = await getVmInstanceMap(serviceId);

    // 7. Fetch VM Pricing from Retail Prices API
    const rawPricing = await fetchAzureVmPricing();

    // 8. Ingest Regional Pricing and Capability Matrix (Optimized Batch Edition)
    logger.info('Syncing Azure Capability Matrix & Pricing...');

    // Fetch all existing capability matrix entries for Azure
    const existingCapabilities = await prisma.vmCapabilityMatrix.findMany({
      where: { region: { providerId: 'azure' } },
      select: {
        id: true,
        vmInstanceId: true,
        regionId: true,
        operatingSystem: true,
        tenancy: true,
        licenseType: true,
      },
    });

    // Map existing capability matrix entries to a lookup key: vmInstanceId_regionId_os_tenancy_license
    const capabilityLookup = new Map<string, string>(); // key -> id
    for (const cap of existingCapabilities) {
      const key = `${cap.vmInstanceId}_${cap.regionId}_${cap.operatingSystem}_${cap.tenancy}_${cap.licenseType || 'INCLUDED'}`;
      capabilityLookup.set(key, cap.id);
    }

    const capabilitiesToCreate: any[] = [];
    const pricingMap = new Map<string, any>(); // key = capabilityId_pricingType -> pricing record
    const instancesToUpdate = new Map<string, { processor: string; storageSummary: string }>();

    for (const item of rawPricing) {
      const vmInstanceId = instanceMap.get(item.armSkuName);
      const regionId = regionMap.get(item.armRegionName);

      if (!vmInstanceId || !regionId) {
        skipped++;
        continue;
      }

      // Map capabilities
      const normCap = mapAzureCapabilityMatrix(item);
      const os = normCap.operatingSystem;
      const tenancy = normCap.tenancy;
      const licenseType = normCap.licenseType || 'INCLUDED';
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
          isRegionAvailable: normCap.isRegionAvailable,
          isActive: normCap.isActive,
        });
      }

      // Collect attributes to update on the VM instance if they changed
      const existingVm = existingVmMap.get(item.armSkuName);
      if (existingVm) {
        const newProcessor = item.productName.replace('Virtual Machines ', '');
        const newStorageSummary = item.meterName;
        if (
          existingVm.processor !== newProcessor ||
          existingVm.storageSummary !== newStorageSummary
        ) {
          instancesToUpdate.set(vmInstanceId, {
            processor: newProcessor,
            storageSummary: newStorageSummary,
          });
        }
      }

      // Collect pricing records
      const normPricing = mapAzurePricing(item);
      const pricingType = normPricing.pricingType;

      const priceKey = `${capabilityId}_${pricingType}`;
      if (!pricingMap.has(priceKey)) {
        pricingMap.set(priceKey, {
          id: uuidv4(),
          capabilityMatrixId: capabilityId,
          pricingType: pricingType,
          hourlyCost: normPricing.hourlyCost,
        });
      }

      // Generate static Reservation discount pricing representation if missing (~30% off On-Demand)
      if (pricingType === 'ON_DEMAND') {
        const reservedKey = `${capabilityId}_RESERVED`;
        if (!pricingMap.has(reservedKey)) {
          pricingMap.set(reservedKey, {
            id: uuidv4(),
            capabilityMatrixId: capabilityId,
            pricingType: 'RESERVED',
            hourlyCost: normPricing.hourlyCost * 0.7,
          });
        }

        const commitmentKey = `${capabilityId}_COMMITMENT`;
        if (!pricingMap.has(commitmentKey)) {
          pricingMap.set(commitmentKey, {
            id: uuidv4(),
            capabilityMatrixId: capabilityId,
            pricingType: 'COMMITMENT',
            hourlyCost: normPricing.hourlyCost * 0.7,
          });
        }
      }
    }

    const pricingToCreate = Array.from(pricingMap.values());

    // Execute capability and pricing writes inside a single atomic database transaction
    await prisma.$transaction(
      async tx => {
        // a. Insert all new capability matrix entries
        if (capabilitiesToCreate.length > 0) {
          logger.info(`Creating ${capabilitiesToCreate.length} new Capability Matrix entries...`);
          const chunkSize = 5000;
          for (let i = 0; i < capabilitiesToCreate.length; i += chunkSize) {
            const chunk = capabilitiesToCreate.slice(i, i + chunkSize);
            await tx.vmCapabilityMatrix.createMany({
              data: chunk,
            });
          }
          capabilitiesInserted = capabilitiesToCreate.length;
        }

        // b. Delete all existing Azure VM pricing records to avoid conflicts
        logger.info('Deleting existing Azure pricing records...');
        await tx.vmPricing.deleteMany({
          where: {
            capabilityMatrix: {
              region: {
                providerId: 'azure',
              },
            },
          },
        });

        // c. Insert all pricing records in chunks
        if (pricingToCreate.length > 0) {
          logger.info(`Inserting ${pricingToCreate.length} pricing records...`);
          const chunkSize = 5000;
          for (let i = 0; i < pricingToCreate.length; i += chunkSize) {
            const chunk = pricingToCreate.slice(i, i + chunkSize);
            await tx.vmPricing.createMany({
              data: chunk,
            });
          }
          pricingInserted = pricingToCreate.length;
        }
      },
      {
        timeout: 600000, // 10 minutes timeout to handle network latency on live DB
      },
    );

    // d. Batch update VM Instance attributes (processor, storageSummary) outside the transaction
    if (instancesToUpdate.size > 0) {
      logger.info(`Updating attributes for ${instancesToUpdate.size} VM instances...`);
      const updatePromises = Array.from(instancesToUpdate.entries()).map(([id, attrs]) =>
        prisma.vmInstance.update({
          where: { id },
          data: {
            processor: attrs.processor,
            storageSummary: attrs.storageSummary,
          },
        }),
      );

      const chunkSize = 100;
      for (let i = 0; i < updatePromises.length; i += chunkSize) {
        await Promise.all(updatePromises.slice(i, i + chunkSize));
      }
    }

    logger.info('Azure Ingestion Synchronization Pipeline execution completed successfully.');
  } catch (error) {
    logger.error('Azure sync pipeline crashed:', error);
    throw error;
  }

  // Print execution summary report
  console.log('\n=========================================================');
  console.log('AZURE SYNCHRONIZATION PIPELINE REPORT');
  console.log('=========================================================');
  console.log(`Regions inserted     : ${regionsInserted}`);
  console.log(`Families inserted    : ${familiesInserted}`);
  console.log(`VM SKUs discovered   : ${skusDiscovered}`);
  console.log(`VM SKUs inserted     : ${skusInserted}`);
  console.log(`Pricing inserted     : ${pricingInserted}`);
  console.log(`Capabilities inserted: ${capabilitiesInserted}`);
  console.log(`Skipped              : ${skipped}`);
  console.log(`Failed               : ${failed}`);
  console.log('=========================================================\n');
}
