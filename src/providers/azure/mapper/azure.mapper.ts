import {
  Architecture,
  ProcessorManufacturer,
  OperatingSystem,
  Tenancy,
  LicenseType,
  PricingType,
} from '@prisma/client';
import { AzureRetailPriceItem } from '../dto/azure-raw.dto';
import {
  NormalizedRegionDTO,
  NormalizedInstanceFamilyDTO,
  NormalizedVmInstanceDTO,
  NormalizedVmCapabilityMatrixDTO,
  NormalizedVmPricingDTO,
} from '../dto/azure-normalized.dto';
import { ParsedSeries, ParsedVmSize } from '../documentation/azure-docs.parser';

// Maps Azure region name to continent/country
export function mapAzureRegion(armRegionName: string, location: string): NormalizedRegionDTO {
  return {
    providerId: 'azure',
    code: armRegionName,
    name: location,
    isActive: true,
  };
}

// Maps and extracts Azure Instance Family from SKU name
export function mapAzureInstanceFamily(
  armSkuName: string,
  parsedDocs: ParsedSeries | undefined,
): NormalizedInstanceFamilyDTO {
  // Strip Standard_ prefix and size suffix
  // e.g. Standard_D2s_v5 -> familyName: D, seriesName: Dsv5
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
  if (
    cleanName.toLowerCase().includes('p_v') ||
    cleanName.toLowerCase().includes('ps_v') ||
    parsedDocs?.architecture === 'ARM64'
  ) {
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

// Maps VM instance attributes from Retail Prices API and documentation
export function mapAzureVmInstance(
  armSkuName: string,
  parsedSize: ParsedVmSize | undefined,
  parsedDocs: ParsedSeries | undefined,
): NormalizedVmInstanceDTO {
  const cleanName = armSkuName.replace('Standard_', '').replace('Basic_', '');
  const parts = cleanName.split('_');
  const size = parts[1] || parts[0] || 'unknown';

  // Fallback default specs if doc parsing was missing for this specific SKU
  const vcpu = parsedSize?.vcpu || 2;
  const memoryGib = parsedSize?.memoryGib || 4;
  const burstable = armSkuName.toLowerCase().includes('standard_b');
  let hasGpu = parsedSize
    ? !!parsedSize.tempStorageGib && armSkuName.toLowerCase().includes('nv')
    : false;

  if (
    armSkuName.toLowerCase().includes('gpu') ||
    armSkuName.toLowerCase().includes('nc') ||
    armSkuName.toLowerCase().includes('nd')
  ) {
    hasGpu = true;
  }

  // Extract network bandwidth
  let networkBandwidthGbps: number | null = null;
  if (parsedSize?.networkBandwidthMbps) {
    networkBandwidthGbps = parseFloat((parsedSize.networkBandwidthMbps / 1000).toFixed(2));
  }

  return {
    instanceType: armSkuName,
    instanceSize: size,
    vcpu,
    memoryGib,
    processor: parsedDocs?.processor || null,
    burstable,
    hasGpu,
    gpuCount: hasGpu ? 1 : null,
    gpuModel: hasGpu ? 'NVIDIA' : null,
    gpuMemoryGib: null,
    gpuManufacturer: hasGpu ? 'NVIDIA' : null,
    networkPerformance: parsedSize?.networkBandwidthMbps
      ? `${parsedSize.networkBandwidthMbps} Mbps`
      : null,
    networkBandwidthGbps,
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
