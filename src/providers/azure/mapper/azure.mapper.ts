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
    processor: null,
    cpuFrequencyGhz: null,
    burstable,
    hasGpu,
    gpuCount: hasGpu ? gpuCount : null,
    gpuModel,
    gpuMemoryGib,
    gpuManufacturer: hasGpu ? 'NVIDIA' : null,
    networkPerformance:
      getSkuCapability(sku, 'AcceleratedNetworkingEnabled') === 'True' ? 'Accelerated' : 'Standard',
    networkBandwidthGbps: null,
    enhancedNetworking: getSkuCapability(sku, 'AcceleratedNetworkingEnabled') === 'True',
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

// Resolves currentGeneration status for all Azure VM instances using Microsoft's official lifecycle lists
export function determineCurrentGeneration(skuNames: string[]): Map<string, boolean> {
  const generationMap = new Map<string, boolean>();

  const isLegacySku = (skuName: string): boolean => {
    const clean = skuName.replace('Standard_', '').replace('Basic_', '').toLowerCase();

    // Basic & Standard A-series (A0-A7, Av2, Amv2)
    if (/^a[0-9]/i.test(clean) || (clean.includes('v2') && clean.startsWith('a'))) return true;

    // Series with version suffixes _v1, _v2, _v3, _v4 listed in Microsoft previous-gen / retired lists
    if (clean.includes('_v1') || clean.includes('_v2') || clean.includes('_v3') || clean.includes('_v4')) {
      if (
        clean.startsWith('d') || clean.startsWith('ds') || clean.startsWith('e') ||
        clean.startsWith('es') || clean.startsWith('f') || clean.startsWith('fs') ||
        clean.startsWith('l') || clean.startsWith('ls') || clean.startsWith('m192') ||
        clean.startsWith('nv') || clean.startsWith('nc')
      ) return true;
    }

    // Unversioned legacy series (D1-D14, DS1-DS14, F1-F16, G1-G5, GS1-GS5, Ls)
    if (
      /^d[0-9]/i.test(clean) || /^ds[0-9]/i.test(clean) || /^f[0-9]/i.test(clean) ||
      /^fs[0-9]/i.test(clean) || /^g[0-9]/i.test(clean) || /^gs[0-9]/i.test(clean) ||
      /^ls[0-9]/i.test(clean)
    ) {
      if (!clean.includes('_v5') && !clean.includes('_v6') && !clean.includes('_v4')) return true;
    }

    // B-series (V1) is previous-gen per Microsoft previous-gen-sizes-list.md
    if (clean.startsWith('b') && !clean.includes('_v2')) return true;

    return false;
  };

  for (const sku of skuNames) {
    generationMap.set(sku, !isLegacySku(sku));
  }

  return generationMap;
}
