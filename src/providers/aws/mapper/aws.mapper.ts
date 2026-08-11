import {
  Architecture,
  ProcessorManufacturer,
  Tenancy,
  LicenseType,
  PricingType,
} from '@prisma/client';
import { AwsRawRegion, AwsRawInstanceType, AwsRawPricingProduct } from '../dto/aws-raw.dto';
import {
  NormalizedRegionDTO,
  NormalizedInstanceFamilyDTO,
  NormalizedVmInstanceDTO,
  NormalizedVmCapabilityMatrixDTO,
  NormalizedVmPricingDTO,
} from '../dto/aws-normalized.dto';

// Standard AWS Region Code to Human-Readable Name Map
const AWS_REGION_NAMES: Record<string, string> = {
  'us-east-1': 'US East (N. Virginia)',
  'us-east-2': 'US East (Ohio)',
  'us-west-1': 'US West (N. California)',
  'us-west-2': 'US West (Oregon)',
  'af-south-1': 'Africa (Cape Town)',
  'ap-east-1': 'Asia Pacific (Hong Kong)',
  'ap-south-1': 'Asia Pacific (Mumbai)',
  'ap-northeast-1': 'Asia Pacific (Tokyo)',
  'ap-northeast-2': 'Asia Pacific (Seoul)',
  'ap-southeast-1': 'Asia Pacific (Singapore)',
  'ap-southeast-2': 'Asia Pacific (Sydney)',
  'ca-central-1': 'Canada (Central)',
  'eu-central-1': 'Europe (Frankfurt)',
  'eu-west-1': 'Europe (Ireland)',
  'eu-west-2': 'Europe (London)',
  'eu-west-3': 'Europe (Paris)',
  'eu-north-1': 'Europe (Stockholm)',
  'me-south-1': 'Middle East (Bahrain)',
  'sa-east-1': 'South America (São Paulo)',
};

export function mapRegion(raw: AwsRawRegion): NormalizedRegionDTO {
  const code = raw.RegionName;
  return {
    providerId: 'aws',
    code,
    name: AWS_REGION_NAMES[code] || `AWS Region: ${code}`,
    isActive: raw.OptInStatus !== 'not-opted-in',
  };
}

export function mapInstanceFamily(raw: AwsRawInstanceType): NormalizedInstanceFamilyDTO {
  const parts = raw.InstanceType.split('.');
  const familyName = parts[0] || 'unknown';
  const series = familyName.charAt(0);

  // Determine Processor Manufacturer
  let processorManufacturer: ProcessorManufacturer = ProcessorManufacturer.INTEL;
  if (raw.InstanceType.includes('graviton') || familyName.endsWith('g')) {
    processorManufacturer = ProcessorManufacturer.AWS_GRAVITON;
  } else if (raw.InstanceType.includes('a') && !familyName.startsWith('i')) {
    // e.g. t3a.medium or m6a.large
    processorManufacturer = ProcessorManufacturer.AMD;
  }

  // Determine Architecture
  let architecture: Architecture = Architecture.X86_64;
  const rawArchs = raw.ProcessorInfo.SupportedArchitectures;
  if (rawArchs.includes('arm64')) {
    architecture = Architecture.ARM64;
  } else if (rawArchs.includes('i386')) {
    architecture = Architecture.X86;
  }

  return {
    providerId: 'aws',
    name: familyName,
    series: series.toUpperCase(),
    processorManufacturer,
    architecture,
  };
}

export function resolveAwsProcessor(instanceType: string): string {
  const family = instanceType.split('.')[0] || '';
  if (family.endsWith('g') || instanceType.includes('graviton')) {
    if (family.startsWith('c7') || family.startsWith('m7') || family.startsWith('r7'))
      return 'AWS Graviton3 Processor';
    if (family.startsWith('c8') || family.startsWith('m8') || family.startsWith('r8'))
      return 'AWS Graviton4 Processor';
    return 'AWS Graviton2 Processor';
  }
  if (instanceType.includes('a') && !family.startsWith('i')) {
    return 'AMD EPYC 7002/7003 Series';
  }
  if (family.startsWith('c6i') || family.startsWith('m6i') || family.startsWith('r6i'))
    return '3rd Gen Intel Xeon Platinum 8375C (Ice Lake)';
  if (family.startsWith('c7i') || family.startsWith('m7i') || family.startsWith('r7i'))
    return '4th Gen Intel Xeon Platinum 8488C (Sapphire Rapids)';
  return 'Intel Xeon Platinum Processor';
}

export function mapVmInstance(raw: AwsRawInstanceType): NormalizedVmInstanceDTO {
  const parts = raw.InstanceType.split('.');
  const size = parts[1] || 'unknown';

  // Memory: Convert MiB to GiB
  const memoryGib = parseFloat((raw.MemoryInfo.SizeInMiB / 1024).toFixed(3));

  // Burstable instance families (t1, t2, t3, t3a, t4g, etc.)
  const burstable = raw.InstanceType.toLowerCase().startsWith('t');

  // GPU properties
  const hasGpu = !!raw.GpuInfo?.Gpus && raw.GpuInfo.Gpus.length > 0;
  let gpuCount: number | null = null;
  let gpuModel: string | null = null;
  let gpuMemoryGib: number | null = null;
  let gpuManufacturer: string | null = null;

  if (hasGpu && raw.GpuInfo?.Gpus?.[0]) {
    const gpu = raw.GpuInfo.Gpus[0];
    gpuCount = gpu.Count ?? null;
    gpuModel = gpu.Name ?? null;
    gpuManufacturer = gpu.Manufacturer ?? null;
    if (gpu.MemoryInfo?.SizeInMiB) {
      gpuMemoryGib = parseFloat((gpu.MemoryInfo.SizeInMiB / 1024).toFixed(3));
    }
  }

  // Storage mapping from InstanceStorageInfo
  let storageSummary: string | null = 'Network Storage Only (EBS)';
  let storageSizeGib: number | null = null;
  if (raw.InstanceStorageInfo?.TotalSizeInGB) {
    storageSizeGib = raw.InstanceStorageInfo.TotalSizeInGB;
    const disks = raw.InstanceStorageInfo.Disks?.[0];
    if (disks && disks.Count && disks.SizeInGB) {
      storageSummary = `${disks.Count} x ${disks.SizeInGB} GB NVMe SSD`;
    } else {
      storageSummary = `Local Temp ${raw.InstanceStorageInfo.TotalSizeInGB} GB SSD`;
    }
  }

  // CPU Frequency directly from AWS SDK
  const cpuFrequencyGhz = raw.ProcessorInfo.SustainedClockSpeedInGhz ?? null;

  // Extract numeric generation and currentGeneration boolean
  const { generation, currentGeneration } = parseAwsGeneration(
    raw.InstanceType,
    raw.CurrentGeneration,
  );

  return {
    instanceType: raw.InstanceType,
    instanceSize: size,
    displayName: `AWS ${raw.InstanceType}`,
    generation,
    currentGeneration,
    vcpu: raw.VCpuInfo.DefaultVCpus,
    memoryGib,
    processor: null, // Populated dynamically from AWS Pricing API physicalProcessor attribute
    cpuFrequencyGhz,
    burstable,
    hasGpu,
    gpuCount,
    gpuModel,
    gpuMemoryGib,
    gpuManufacturer,
    networkPerformance: raw.NetworkInfo?.NetworkPerformance ?? null,
    networkBandwidthGbps: raw.NetworkInfo?.NetworkBandwidthGbps ?? null,
    enhancedNetworking:
      raw.NetworkInfo?.EnaSupport === 'supported' ||
      raw.NetworkInfo?.EnaSupport === 'required' ||
      raw.NetworkInfo?.EfaSupported === true,
    storageSummary,
    storageSizeGib,
    supportsLiveMigration: false, // Explicitly represents AWS EC2 reboot/stop-start host maintenance model
    supportsNestedVirtualization:
      raw.InstanceType.endsWith('.metal') || (generation !== null && generation >= 5), // All Nitro hypervisor instances support hardware-assisted virtualization extensions
  };
}

export function parseAwsGeneration(
  instanceType: string,
  rawCurrentGeneration?: boolean,
): { generation: number | null; currentGeneration: boolean } {
  const family = instanceType.split('.')[0]?.toLowerCase() || '';

  // Previous generation families explicitly listed by AWS (fallback list)
  const legacyFamilies = [
    't1',
    'm1',
    'c1',
    'm2',
    'cr1',
    'cg1',
    'hs1',
    'cc1',
    'cc2',
    'g2',
    'i2',
    'r3',
    'm3',
    'c3',
    't2',
  ];
  const isLegacy = legacyFamilies.includes(family);

  // Extract numeric generation from family string (e.g. t1 -> 1, m5 -> 5, c6i -> 6, m7i -> 7, u7i -> 7)
  const match = family.match(/^[a-z]+([0-9]+)/i);
  let generation: number | null = null;
  if (match && match[1]) {
    generation = parseInt(match[1], 10);
  }

  // Prioritize native AWS SDK CurrentGeneration boolean flag if present
  const currentGeneration =
    typeof rawCurrentGeneration === 'boolean' ? rawCurrentGeneration : !isLegacy;

  return {
    generation,
    currentGeneration,
  };
}

export function mapOperatingSystem(rawOs: string): string {
  if (!rawOs || !rawOs.trim()) return 'LINUX';
  const os = rawOs.toLowerCase().trim();
  if (os.includes('win') && os.includes('sql')) return 'WINDOWS_SQL_SERVER';
  if (os.includes('win')) return 'WINDOWS';
  if (os.includes('red hat') || os.includes('rhel')) return 'RED_HAT';
  if (os.includes('suse') || os.includes('sles')) return 'SUSE';
  if (os.includes('ubuntu')) return 'UBUNTU';
  if (os.includes('debian')) return 'DEBIAN';
  if (os.includes('almalinux') || os.includes('alma')) return 'ALMALINUX';
  if (os.includes('oracle')) return 'ORACLE_LINUX';
  if (os.includes('flatcar')) return 'FLATCAR';
  if (os.includes('mac')) return 'MACOS';
  return rawOs.trim().toUpperCase().replace(/\s+/g, '_');
}

export function mapTenancy(rawTenancy: string): Tenancy {
  const tenancy = rawTenancy.toLowerCase();
  if (tenancy.includes('dedicated host') || tenancy === 'host') return Tenancy.DEDICATED_HOST;
  if (tenancy.includes('dedicated')) return Tenancy.DEDICATED_INSTANCE;
  return Tenancy.SHARED;
}

export function mapLicenseType(rawLicense: string | undefined): LicenseType {
  if (!rawLicense) return LicenseType.INCLUDED;
  const lic = rawLicense.toLowerCase();
  if (lic.includes('byol') || lic.includes('bring your own')) {
    return LicenseType.BYOL;
  }
  return LicenseType.INCLUDED;
}

export function mapCapabilityMatrix(raw: AwsRawPricingProduct): NormalizedVmCapabilityMatrixDTO {
  const attrs = raw.product.attributes;
  return {
    regionCode: attrs.regionCode || 'us-east-1',
    operatingSystem: mapOperatingSystem(attrs.operatingSystem),
    tenancy: mapTenancy(attrs.tenancy),
    licenseType: mapLicenseType(attrs.licenseModel),
    isRegionAvailable: true,
    isActive: true,
  };
}

export function mapPricing(raw: AwsRawPricingProduct): NormalizedVmPricingDTO | null {
  const terms = raw.terms.OnDemand;
  if (!terms) return null;

  // Get the first active offer term
  const termKeys = Object.keys(terms);
  if (termKeys.length === 0) return null;

  const firstTerm = terms[termKeys[0]];
  const priceDims = firstTerm.priceDimensions;
  const priceKeys = Object.keys(priceDims);
  if (priceKeys.length === 0) return null;

  const rate = priceDims[priceKeys[0]].pricePerUnit.USD;
  const hourlyCost = parseFloat(rate);

  if (isNaN(hourlyCost) || hourlyCost <= 0 || hourlyCost >= 999999) {
    return null;
  }

  return {
    pricingType: PricingType.ON_DEMAND,
    hourlyCost,
  };
}

export function mapReservedPricing(raw: AwsRawPricingProduct): NormalizedVmPricingDTO | null {
  const terms = raw.terms.Reserved;
  if (!terms) return null;

  const termKeys = Object.keys(terms);
  if (termKeys.length === 0) return null;

  // Look for standard 1yr, no upfront, shared tenancy contract standard options
  const standardTermKey =
    termKeys.find(k => {
      const termAttrs = terms[k].termAttributes;
      return (
        termAttrs?.LeaseContractLength === '1yr' &&
        termAttrs?.PurchaseOption === 'No Upfront' &&
        termAttrs?.OfferingClass === 'standard'
      );
    }) || termKeys[0];

  const targetTerm = terms[standardTermKey];
  if (!targetTerm) return null;

  const priceDims = targetTerm.priceDimensions;
  const priceKeys = Object.keys(priceDims);
  if (priceKeys.length === 0) return null;

  const rate = priceDims[priceKeys[0]].pricePerUnit.USD;
  const hourlyCost = parseFloat(rate);

  if (isNaN(hourlyCost) || hourlyCost <= 0 || hourlyCost >= 999999) {
    return null;
  }

  return {
    pricingType: PricingType.RESERVED,
    hourlyCost,
  };
}
