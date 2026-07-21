import { prisma } from '../../../config/database';
import { logger } from '../../../config/logger';
import { fetchAzureVmPricing } from '../services/azure-pricing.service';
import { fetchSeriesFileList, fetchRawMarkdown } from '../services/azure-docs.service';
import {
  parseSeriesMarkdown,
  ParsedSeries,
  ParsedVmSize,
} from '../documentation/azure-docs.parser';
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

export async function syncAzure(): Promise<void> {
  logger.info('Starting Azure Ingestion Ingress synchronization pipeline...');

  // Sync metrics counters
  let familiesDiscovered = 0;
  let familiesProcessed = 0;
  let skusDiscovered = 0;
  let skusInserted = 0;
  const skusUpdated = 0;
  let pricingInserted = 0;
  let capabilitiesInserted = 0;
  let regionsInserted = 0;
  let skipped = 0;
  let failed = 0;

  try {
    // 1. Ensure Provider record exists
    await upsertProvider('azure', 'Microsoft Azure');

    // 2. Fetch Pricing & Enumerate Regions/SKUs
    const rawPricing = await fetchAzureVmPricing();

    // De-duplicate regions
    const uniqueRegions = new Map<string, string>(); // code -> location name
    const uniqueSkus = new Set<string>();

    for (const item of rawPricing) {
      uniqueRegions.set(item.armRegionName, item.location);
      uniqueSkus.add(item.armSkuName);
    }

    // 3. Upsert Regions
    logger.info(`Syncing ${uniqueRegions.size} Azure regions...`);
    for (const [code, location] of uniqueRegions.entries()) {
      try {
        const normalized = mapAzureRegion(code, location);
        await upsertRegion(normalized);
        regionsInserted++;
      } catch (err) {
        logger.error(`Failed region upsert for ${code}: ${err}`);
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

    // 5. Discover & Parse VM Documentation from GitHub raw Markdown
    const docFiles = await fetchSeriesFileList();
    const docSpecsMap = new Map<string, ParsedSeries>();
    const skuSpecsMap = new Map<string, ParsedVmSize>();

    familiesDiscovered = docFiles.length;
    logger.info(`Parsing ${docFiles.length} discovered VM family specifications files...`);

    for (const file of docFiles) {
      try {
        const markdown = await fetchRawMarkdown(file.path);
        const parsed = parseSeriesMarkdown(markdown, file.path);
        docSpecsMap.set(parsed.seriesName, parsed);

        // Map individual size specs for easy lookup by SKU name
        for (const size of parsed.sizes) {
          skuSpecsMap.set(size.name, size);
          skuSpecsMap.set(size.name.toLowerCase(), size);
        }
        familiesProcessed++;
      } catch (err) {
        logger.warn(`Skipping spec parse for documentation page ${file.path}: ${err}`);
        failed++;
      }
    }

    // 6. Sync Instance Families
    logger.info('Syncing Azure Instance Families...');
    const skuList = Array.from(uniqueSkus);
    skusDiscovered = skuList.length;

    const uniqueFamilyNames = new Set<string>();
    for (const sku of skuList) {
      const clean = sku.replace('Standard_', '').replace('Basic_', '');
      const familyName = clean.split('_')[0]?.replace(/[0-9]/g, '') || 'unknown';
      uniqueFamilyNames.add(familyName);
    }

    for (const familyName of uniqueFamilyNames) {
      try {
        // Find matching parsed series configuration
        const parsedSeries = Array.from(docSpecsMap.values()).find(s =>
          s.seriesName.toLowerCase().startsWith(familyName.toLowerCase()),
        );

        const normalizedFamily = mapAzureInstanceFamily(familyName, parsedSeries);
        await upsertInstanceFamily(normalizedFamily);
      } catch (err) {
        logger.warn(`Failed family upsert for ${familyName}: ${err}`);
        failed++;
      }
    }

    const familyMap = await getInstanceFamilyMap('azure');

    // 7. Upsert VM Instances
    logger.info('Syncing Azure VM Instances...');
    const generationMap = determineCurrentGeneration(skuList);

    for (const sku of skuList) {
      try {
        // Resolve associated family ID
        const clean = sku.replace('Standard_', '').replace('Basic_', '');
        const familyName = clean.split('_')[0]?.replace(/[0-9]/g, '') || 'unknown';
        const familyId = familyMap.get(familyName);

        if (!familyId) {
          skipped++;
          continue;
        }

        const parsedSize = skuSpecsMap.get(sku) || skuSpecsMap.get(sku.toLowerCase());
        const parsedSeries = Array.from(docSpecsMap.values()).find(s =>
          s.seriesName.toLowerCase().startsWith(familyName.toLowerCase()),
        );

        const normalizedVm = mapAzureVmInstance(sku, parsedSize, parsedSeries);
        const isCurrent = generationMap.get(sku) ?? true;

        await upsertVmInstance({
          ...normalizedVm,
          serviceId,
          instanceFamilyId: familyId,
          storageSummary: normalizedVm.storageSummary || null,
          storageType: normalizedVm.storageType || null,
          storageSizeGib: normalizedVm.storageSizeGib || null,
          storageCount: normalizedVm.storageCount || null,
          storageIops: normalizedVm.storageIops || null,
          storageThroughputMbps: normalizedVm.storageThroughputMbps || null,
          supportsLiveMigration: normalizedVm.supportsLiveMigration ?? false,
          supportsNestedVirtualization: normalizedVm.supportsNestedVirtualization ?? false,
        });

        // Update currentGeneration status
        const instanceRecord = await prisma.vmInstance.findFirst({
          where: { serviceId, instanceType: sku },
        });

        if (instanceRecord) {
          await prisma.vmInstance.update({
            where: { id: instanceRecord.id },
            data: { currentGeneration: isCurrent },
          });
        }

        skusInserted++;
      } catch (err) {
        logger.error(`Failed VM Instance upsert for SKU ${sku}: ${err}`);
        failed++;
      }
    }

    const instanceMap = await getVmInstanceMap(serviceId);

    // 8. Ingest Regional Pricing and Capability Matrix
    logger.info('Syncing Azure Capability Matrix & Pricing...');
    const updatedInstanceIds = new Set<string>();

    for (const item of rawPricing) {
      try {
        const vmInstanceId = instanceMap.get(item.armSkuName);
        const regionId = regionMap.get(item.armRegionName);

        if (!vmInstanceId || !regionId) {
          skipped++;
          continue;
        }

        // Map capabilities
        const normCap = mapAzureCapabilityMatrix(item);
        const capRecord = await upsertVmCapabilityMatrix({
          vmInstanceId,
          regionId,
          operatingSystem: normCap.operatingSystem,
          tenancy: normCap.tenancy,
          licenseType: normCap.licenseType,
          isRegionAvailable: normCap.isRegionAvailable,
          isActive: normCap.isActive,
        });

        capabilitiesInserted++;

        // Update VM Instance attributes from pricing (once)
        if (!updatedInstanceIds.has(vmInstanceId)) {
          await updateVmInstanceAttributes(vmInstanceId, {
            processor: item.productName.replace('Virtual Machines ', ''),
            storageSummary: item.meterName,
          });
          updatedInstanceIds.add(vmInstanceId);
        }

        // Ingest pricing record
        const normPricing = mapAzurePricing(item);
        await upsertVmPricing({
          capabilityMatrixId: capRecord.id,
          pricingType: normPricing.pricingType,
          hourlyCost: normPricing.hourlyCost,
        });

        pricingInserted++;

        // Generate static Reservation discount pricing representation if missing (~30% off On-Demand)
        if (normPricing.pricingType === 'ON_DEMAND') {
          await upsertVmPricing({
            capabilityMatrixId: capRecord.id,
            pricingType: 'RESERVED',
            hourlyCost: normPricing.hourlyCost * 0.7,
          });

          await upsertVmPricing({
            capabilityMatrixId: capRecord.id,
            pricingType: 'COMMITMENT',
            hourlyCost: normPricing.hourlyCost * 0.7,
          });
        }
      } catch {
        failed++;
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
  console.log(`Families discovered : ${familiesDiscovered}`);
  console.log(`Families processed  : ${familiesProcessed}`);
  console.log(`VM SKUs discovered  : ${skusDiscovered}`);
  console.log(`VM SKUs inserted    : ${skusInserted}`);
  console.log(`VM SKUs updated     : ${skusUpdated}`);
  console.log(`Pricing inserted    : ${pricingInserted}`);
  console.log(`Capabilities inserted: ${capabilitiesInserted}`);
  console.log(`Regions inserted    : ${regionsInserted}`);
  console.log(`Skipped             : ${skipped}`);
  console.log(`Failed              : ${failed}`);
  console.log('=========================================================\n');
}
