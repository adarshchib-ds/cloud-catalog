import {
  Architecture,
  ProcessorManufacturer,
  OperatingSystem,
  Tenancy,
  LicenseType,
  PricingType,
} from '@prisma/client';
import { ResourceSku } from '@azure/arm-compute';
import { AzureRetailPriceItem } from '../dto/azure-raw.dto';
import {
  NormalizedRegionDTO,
  NormalizedInstanceFamilyDTO,
  NormalizedVmInstanceDTO,
  NormalizedVmCapabilityMatrixDTO,
  NormalizedVmPricingDTO,
} from '../dto/azure-normalized.dto';

// Helper to get capability value safely from a ResourceSku
function getSkuCapability(sku: ResourceSku, name: string): string | undefined {
  return sku.capabilities?.find(c => c.name?.toLowerCase() === name.toLowerCase())?.value;
}

// Maps Azure region name to continent/country
export function mapAzureRegion(armRegionName: string, location: string): NormalizedRegionDTO {
  return {
    providerId: 'azure',
    code: armRegionName,
    name: location,
    isActive: true,
  };
}

// Maps and extracts Azure Instance Family from ResourceSku
export function mapAzureInstanceFamily(sku: ResourceSku): NormalizedInstanceFamilyDTO {
  const armSkuName = sku.name || 'Unknown';
  const cleanName = armSkuName.replace('Standard_', '').replace('Basic_', '');
  const parts = cleanName.split('_');
  const familyName = parts[0] ? parts[0].replace(/[0-9]/g, '') : 'Unknown';

  // Extract series
  const series = familyName.charAt(0).toUpperCase();

  // Determine manufacturer
  let processorManufacturer: ProcessorManufacturer = ProcessorManufacturer.INTEL;
  if (
    cleanName.toLowerCase().includes('as') ||
    cleanName.toLowerCase().includes('ad') ||
    cleanName.toLowerCase().includes('a_v')
  ) {
    processorManufacturer = ProcessorManufacturer.AMD;
  } else if (cleanName.toLowerCase().includes('p_v') || cleanName.toLowerCase().includes('ps_v')) {
    processorManufacturer = ProcessorManufacturer.MICROSOFT; // Cobalt ARM
  }

  // Determine architecture
  let architecture: Architecture = Architecture.X86_64;
  if (cleanName.toLowerCase().includes('p_v') || cleanName.toLowerCase().includes('ps_v')) {
    architecture = Architecture.ARM64;
  }

  return {
    providerId: 'azure',
    name: familyName,
    series,
    processorManufacturer,
    architecture,
  };
}

// Maps VM instance attributes from ResourceSku
export function mapAzureVmInstance(sku: ResourceSku): NormalizedVmInstanceDTO {
  const armSkuName = sku.name || 'Unknown';
  const cleanName = armSkuName.replace('Standard_', '').replace('Basic_', '');
  const parts = cleanName.split('_');
  const size = parts[1] || parts[0] || 'unknown';

  // Parse capability values
  const vcpuStr = getSkuCapability(sku, 'vCPUs');
  const vcpu = vcpuStr ? parseInt(vcpuStr, 10) : 2;

  const memoryStr = getSkuCapability(sku, 'MemoryGB');
  const memoryGib = memoryStr ? parseFloat(memoryStr) : 4;

  const burstable = armSkuName.toLowerCase().includes('standard_b');

  const gpuStr = getSkuCapability(sku, 'GPUs');
  const gpuCount = gpuStr ? parseInt(gpuStr, 10) : 0;
  const hasGpu = gpuCount > 0;

  const gpuModel = hasGpu ? getSkuCapability(sku, 'GpuNames') || 'NVIDIA' : null;
  const gpuMemoryStr = getSkuCapability(sku, 'GpuMemoryGB');
  const gpuMemoryGib = gpuMemoryStr ? parseFloat(gpuMemoryStr) : null;

  // Temporary storage capability mapping
  const tempStorageMBStr = getSkuCapability(sku, 'MaxResourceVolumeMB');
  const tempStorageGib = tempStorageMBStr ? parseFloat(tempStorageMBStr) / 1024 : null;

  // Nested virtualization support
  const nestedVirt = getSkuCapability(sku, 'NestedVirtualizationSupported');
  const supportsNestedVirtualization = nestedVirt === 'True';

  return {
    instanceType: armSkuName,
    instanceSize: size,
    vcpu,
    memoryGib,
    processor: null, // Populated via pricing description if available, or left null
    burstable,
    hasGpu,
    gpuCount: hasGpu ? gpuCount : null,
    gpuModel,
    gpuMemoryGib,
    gpuManufacturer: hasGpu ? 'NVIDIA' : null,
    networkPerformance:
      getSkuCapability(sku, 'AcceleratedNetworkingEnabled') === 'True' ? 'Accelerated' : 'Standard',
    networkBandwidthGbps: null,
    storageSummary:
      getSkuCapability(sku, 'PremiumIO') === 'True'
        ? 'Premium SSD Supported'
        : 'Standard Disk Only',
    storageSizeGib: tempStorageGib,
    supportsLiveMigration: true,
    supportsNestedVirtualization,
  };
}

// Determines OS type
export function mapOperatingSystem(productName: string): OperatingSystem {
  const name = productName.toLowerCase();
  if (name.includes('windows')) return OperatingSystem.WINDOWS;
  if (name.includes('ubuntu')) return OperatingSystem.UBUNTU;
  if (name.includes('red hat') || name.includes('rhel')) return OperatingSystem.RED_HAT;
  if (name.includes('suse') || name.includes('sles')) return OperatingSystem.SUSE;
  return OperatingSystem.LINUX;
}

// Maps capability matrix
export function mapAzureCapabilityMatrix(
  item: AzureRetailPriceItem,
): NormalizedVmCapabilityMatrixDTO {
  return {
    regionCode: item.armRegionName,
    operatingSystem: mapOperatingSystem(item.productName),
    tenancy: Tenancy.SHARED,
    licenseType: LicenseType.INCLUDED,
    isRegionAvailable: true,
    isActive: true,
  };
}

// Maps pricing item to internal format
export function mapAzurePricing(item: AzureRetailPriceItem): NormalizedVmPricingDTO {
  const isSpot =
    item.skuName.toLowerCase().includes('spot') ||
    item.skuName.toLowerCase().includes('low priority') ||
    item.meterName.toLowerCase().includes('spot') ||
    item.meterName.toLowerCase().includes('low priority');

  return {
    pricingType: isSpot ? PricingType.SPOT : PricingType.ON_DEMAND,
    hourlyCost: item.retailPrice,
  };
}

// Resolves currentGeneration status for all VM instances
export function determineCurrentGeneration(skuNames: string[]): Map<string, boolean> {
  const generationMap = new Map<string, boolean>();
  const familyGens = new Map<string, number>();

  // First pass: extract families and their versions
  const skuMeta = skuNames.map(sku => {
    const clean = sku.replace('Standard_', '').replace('Basic_', '');
    // Regex to match version suffix like _v5, _v2, etc.
    const match = clean.match(/_v(\d+)/i);
    const gen = match ? parseInt(match[1], 10) : 1;

    // Group name: strip _v5 and Standard_ to get family baseline
    const familyKey = clean.split('_')[0]?.replace(/[0-9]/g, '') || 'unknown';

    return { sku, familyKey, gen };
  });

  // Find max generation per family group
  skuMeta.forEach(({ familyKey, gen }) => {
    const max = familyGens.get(familyKey) || 0;
    if (gen > max) {
      familyGens.set(familyKey, gen);
    }
  });

  // Second pass: mark current generation
  skuMeta.forEach(({ sku, familyKey, gen }) => {
    const maxGen = familyGens.get(familyKey) || 1;
    generationMap.set(sku, gen === maxGen);
  });

  return generationMap;
}
