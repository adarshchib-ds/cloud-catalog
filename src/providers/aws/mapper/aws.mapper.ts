import {
  Architecture,
  ProcessorManufacturer,
  OperatingSystem,
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

export function mapVmInstance(raw: AwsRawInstanceType): NormalizedVmInstanceDTO {
  const parts = raw.InstanceType.split('.');
  const size = parts[1] || 'unknown';

  // Memory: Convert MiB to GiB
  const memoryGib = parseFloat((raw.MemoryInfo.SizeInMiB / 1024).toFixed(3));

  // Burstable instance families
  const burstable =
    raw.InstanceType.startsWith('t2') ||
    raw.InstanceType.startsWith('t3') ||
    raw.InstanceType.startsWith('t4');

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

  return {
    instanceType: raw.InstanceType,
    instanceSize: size,
    vcpu: raw.VCpuInfo.DefaultVCpus,
    memoryGib,
    processor: null, // Populated via pricing description if needed, or left null
    burstable,
    hasGpu,
    gpuCount,
    gpuModel,
    gpuMemoryGib,
    gpuManufacturer,
    networkPerformance: raw.NetworkInfo?.NetworkPerformance ?? null,
    networkBandwidthGbps: raw.NetworkInfo?.NetworkBandwidthGbps ?? null,
  };
}

export function mapOperatingSystem(rawOs: string): OperatingSystem {
  const os = rawOs.toLowerCase();
  if (os.includes('win')) return OperatingSystem.WINDOWS;
  if (os.includes('red hat') || os.includes('rhel')) return OperatingSystem.RED_HAT;
  if (os.includes('suse') || os.includes('sles')) return OperatingSystem.SUSE;
  if (os.includes('ubuntu')) return OperatingSystem.UBUNTU;
  return OperatingSystem.LINUX;
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

  return {
    pricingType: PricingType.RESERVED,
    hourlyCost,
  };
}
