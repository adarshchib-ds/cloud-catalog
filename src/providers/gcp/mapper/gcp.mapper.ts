import { Architecture, ProcessorManufacturer, PricingType } from '@prisma/client';
import { GcpRawRegion, GcpRawMachineType, GcpRawSku } from '../dto/gcp-raw.dto';
import {
  NormalizedRegionDTO,
  NormalizedInstanceFamilyDTO,
  NormalizedVmInstanceDTO,
  NormalizedVmCapabilityMatrixDTO,
} from '../dto/gcp-normalized.dto';

export function mapRegion(raw: GcpRawRegion): NormalizedRegionDTO {
  return {
    providerId: 'gcp',
    code: raw.name,
    name: raw.description || raw.name,
    isActive: raw.status !== 'DOWN',
  };
}

function getMachineFamilyToken(machineTypeName: string): string {
  return machineTypeName.split('-')[0]?.toLowerCase() || 'unknown';
}

export function mapInstanceFamily(
  machineTypeName: string,
  architectureHint?: string,
): NormalizedInstanceFamilyDTO {
  const parts = machineTypeName.split('-');
  const familyToken = getMachineFamilyToken(machineTypeName);

  // highmem/highcpu shape a distinct family within a base series (mirrors prisma/seed.ts's GCP branch)
  const name =
    parts[1] === 'highmem' || parts[1] === 'highcpu' ? `${familyToken}-${parts[1]}` : familyToken;

  let processorManufacturer: ProcessorManufacturer = ProcessorManufacturer.INTEL;
  if (familyToken === 't2a') {
    // Ampere Altra ARM chip — not Google-designed silicon, so GOOGLE would overstate it
    processorManufacturer = ProcessorManufacturer.OTHER;
  } else if (familyToken.endsWith('d') && familyToken.length > 1) {
    // n2d, c2d, c3d, t2d — AMD EPYC variants
    processorManufacturer = ProcessorManufacturer.AMD;
  }

  const architecture: Architecture =
    familyToken === 't2a' || architectureHint === 'ARM64'
      ? Architecture.ARM64
      : Architecture.X86_64;

  return {
    providerId: 'gcp',
    name,
    series: familyToken.toUpperCase(),
    processorManufacturer,
    architecture,
  };
}

export function resolveGcpProcessor(machineTypeName: string): string {
  const familyToken = machineTypeName.split('-')[0]?.toLowerCase() || '';
  if (familyToken === 'm1' || familyToken === 'm2')
    return 'Intel Xeon Scalable (Cascade Lake / Skylake)';
  if (familyToken === 'm3') return 'Intel Xeon Scalable (Ice Lake)';
  if (familyToken === 'm4') return '5th Gen Intel Xeon Scalable (Emerald Rapids)';
  if (familyToken === 'n1') return 'Intel Xeon E5 v4 / Scalable (Skylake/Haswell)';
  if (familyToken === 'n2') return 'Intel Xeon Scalable (Ice Lake/Cascade Lake)';
  if (familyToken === 'n2d') return 'AMD EPYC 7002/7003 Series (Rome/Milan)';
  if (familyToken === 'n4') return '5th Gen Intel Xeon Scalable (Emerald Rapids)';
  if (familyToken === 'c2') return 'Intel Xeon Scalable (Cascade Lake)';
  if (familyToken === 'c2d') return 'AMD EPYC 7003 Series (Milan)';
  if (familyToken === 'c3') return '4th Gen Intel Xeon Scalable (Sapphire Rapids)';
  if (familyToken === 'c3d') return 'AMD EPYC 9004 Series (Genoa)';
  if (familyToken === 'c4') return '5th Gen Intel Xeon Scalable (Emerald Rapids)';
  if (familyToken === 't2a') return 'Ampere Altra ARM Processor';
  if (familyToken === 't2d') return 'AMD EPYC 7003 Series (Milan)';
  if (familyToken === 'e2') return 'Custom Intel / AMD EPYC Processor';
  if (familyToken === 'a2') return 'Intel Xeon Platinum 8273CL + NVIDIA A100 GPU';
  if (familyToken === 'a3') return '4th Gen Intel Xeon Scalable + NVIDIA H100 GPU';
  if (familyToken === 'g2') return 'Intel Xeon Scalable + NVIDIA L4 GPU';
  return 'Intel Xeon / AMD EPYC Processor';
}

export function mapVmInstance(raw: GcpRawMachineType): NormalizedVmInstanceDTO {
  const parts = raw.name.split('-');
  const instanceSize = parts.slice(1).join('-') || 'unknown';

  const hasGpu = !!raw.accelerators?.length;
  const firstAccelerator = raw.accelerators?.[0];

  return {
    instanceType: raw.name,
    instanceSize,
    vcpu: raw.guestCpus,
    memoryGib: parseFloat((raw.memoryMb / 1024).toFixed(3)),
    processor: resolveGcpProcessor(raw.name),
    burstable: raw.isSharedCpu === true,
    hasGpu,
    gpuCount: firstAccelerator?.guestAcceleratorCount ?? null,
    gpuModel: firstAccelerator?.guestAcceleratorType ?? null,
    gpuMemoryGib: null,
    gpuManufacturer: hasGpu ? 'NVIDIA' : null,
    networkPerformance: null,
    networkBandwidthGbps: null,
    storageSummary: 'Network Storage Only (Persistent Disk)',
  };
}

export function mapCapabilityMatrix(regionCode: string): NormalizedVmCapabilityMatrixDTO {
  // GCP's base Compute Engine price is OS-agnostic (Linux has no license fee); Windows/RHEL/SUSE
  // licensing is priced via separate SKUs not composed here — see plan's deferred-scope notes.
  return {
    regionCode,
    operatingSystem: 'LINUX',
    tenancy: 'SHARED',
    licenseType: 'INCLUDED',
    isRegionAvailable: true,
    isActive: true,
  };
}

export function parseGcpMoney(unitPrice: { units?: string; nanos?: number }): number {
  return Number(unitPrice.units ?? '0') + (unitPrice.nanos ?? 0) / 1e9;
}

export type GcpUsageType = 'OnDemand' | 'Preemptible' | 'Commit1Yr' | 'Commit3Yr';

export const USAGE_TYPE_TO_PRICING_TYPE: Record<GcpUsageType, PricingType> = {
  OnDemand: PricingType.ON_DEMAND,
  Preemptible: PricingType.SPOT,
  Commit1Yr: PricingType.COMMITMENT,
  Commit3Yr: PricingType.RESERVED,
};

interface SkuBucket {
  core: GcpRawSku[];
  ram: GcpRawSku[];
  flatRate: GcpRawSku[];
}

const KNOWN_GCP_FAMILY_TOKENS = [
  'm4ultramem224',
  'a3ultra',
  'a3plus',
  'a3',
  'a2',
  'c2d',
  'c3d',
  'c4a',
  'c4d',
  'c4n',
  'c3',
  'c4',
  'n2d',
  'n4a',
  'n4d',
  'n4',
  'n2',
  'n1',
  'e2',
  'g2',
  'g4',
  'h3',
  'h4d',
  'm1',
  'm2',
  'm3',
  'm4',
  't2a',
  't2d',
  'z3',
];

// SKU description substrings that mark a row as something other than base predefined pricing:
// user-defined "Custom" machine shapes (we only sync predefined types), sole-tenant nodes,
// capacity-reservation fees (a distinct GCP feature from Committed Use Discounts, despite the
// "Reserved ... in <region>" wording), Dynamic Workload Scheduler, and surcharge/premium add-ons.
const SKU_EXCLUSION_KEYWORDS = [
  'custom',
  'sole tenancy',
  'reserved',
  'dws',
  'premium',
  'overcommit',
];

function isExcludedSku(description: string): boolean {
  const d = description.toLowerCase();
  return SKU_EXCLUSION_KEYWORDS.some(kw => d.includes(kw));
}

const RESOURCE_GROUP_DIRECT_FAMILY_TOKEN: Record<string, string> = {
  F1Micro: 'f1',
  G1Small: 'g1',
};

function detectFamilyToken(description: string): string | null {
  for (const token of KNOWN_GCP_FAMILY_TOKENS) {
    if (new RegExp(`\\b${token}\\b`, 'i').test(description)) return token;
  }
  if (/compute optimized/i.test(description)) return 'c2';
  return null;
}

// Only these resourceGroups carry per-vCPU/per-GB-RAM/per-GPU predefined-instance pricing.
// Everything else (LocalSSD, TPU, PremiumInternetEgress, VmState, ...) is out of scope for
// instance hourly-cost composition and is intentionally ignored rather than text-sniffed, to
// avoid false-positive matches on unrelated SKUs that happen to mention a family name.
function classifyResourceGroupRole(
  resourceGroup: string,
  description: string,
): keyof SkuBucket | null {
  switch (resourceGroup) {
    case 'CPU':
      return 'core';
    case 'RAM':
      return 'ram';
    case 'F1Micro':
    case 'G1Small':
      return 'flatRate';
    case 'N1Standard': {
      // N1's on-demand/spot pricing lives under its own resourceGroup (unlike every other
      // family); its Commit1Yr/Commit3Yr rows live under the generic CPU/RAM groups instead,
      // handled by the cases above — this branch only needs to split Core vs Ram here.
      const d = description.toLowerCase();
      if (d.includes('core')) return 'core';
      if (d.includes('ram')) return 'ram';
      return null;
    }
    default:
      return null;
  }
}

// GPU SKUs are described by GPU MODEL ("Nvidia Tesla A100 GPU running in..."), never by the
// attached machine family ("A2") — a completely different axis from the CPU/RAM family tokens
// above, so it needs its own detection + its own index keyed by normalized model, not family.
// Order matters: more specific variants (80GB, Mega, 141GB) must be tried before their broader
// substring (e.g. "H100 80GB Mega" before plain "H100 80GB") to avoid mis-bucketing.
const GPU_MODEL_PATTERNS: [RegExp, string][] = [
  [/H100\s*80GB\s*Mega|H100\s*Mega\s*80GB/i, 'h100-mega-80gb'],
  [/H100\s*80GB\s*Plus/i, 'h100-80gb-plus'],
  [/H100\s*80GB/i, 'h100-80gb'],
  [/H200\s*141GB/i, 'h200-141gb'],
  [/Tesla\s*A100\s*80GB|A100\s*80GB/i, 'a100-80gb'],
  [/Tesla\s*A100/i, 'a100'],
  [/Tesla\s*T4/i, 't4'],
  [/Tesla\s*V100/i, 'v100'],
  [/Tesla\s*P100/i, 'p100'],
  [/Tesla\s*P4/i, 'p4'],
  [/\bL4\b/i, 'l4'],
  [/RTX\s*6000/i, 'rtx-6000'],
  [/\bGB200\b/i, 'gb200'],
  [/\bGB300\b/i, 'gb300'],
  [/\bB200\b/i, 'b200'],
];

// Normalizes the Compute Engine API's `guestAcceleratorType` resource name (e.g.
// "nvidia-tesla-a100", "nvidia-a100-80gb") into the same token space as GPU_MODEL_PATTERNS.
const ACCELERATOR_TYPE_TO_GPU_TOKEN: Record<string, string> = {
  'nvidia-tesla-t4': 't4',
  'nvidia-tesla-v100': 'v100',
  'nvidia-tesla-p100': 'p100',
  'nvidia-tesla-p4': 'p4',
  'nvidia-tesla-a100': 'a100',
  'nvidia-a100-80gb': 'a100-80gb',
  'nvidia-h100-80gb': 'h100-80gb',
  'nvidia-h100-mega-80gb': 'h100-mega-80gb',
  'nvidia-h200-141gb': 'h200-141gb',
  'nvidia-l4': 'l4',
  'nvidia-rtx-pro-6000': 'rtx-6000',
  'nvidia-gb200': 'gb200',
  'nvidia-gb300': 'gb300',
  'nvidia-b200': 'b200',
};

function detectGpuToken(description: string): string | null {
  for (const [pattern, token] of GPU_MODEL_PATTERNS) {
    if (pattern.test(description)) return token;
  }
  return null;
}

/**
 * Buckets raw Compute Engine SKUs by `${familyToken}|${usageType}` (CPU/RAM/flat-rate) and
 * separately by `${gpuToken}|${usageType}` (GPU model), so per-instance hourly cost can be
 * composed from GCP's separately-priced core/ram/gpu component rates. Validated against a live
 * Cloud Billing Catalog dump — see scripts/gcp-sku-dump.ts and scripts/gcp-gpu-sku-dump.ts to
 * re-verify if Google changes SKU description wording in the future.
 */
export function buildGcpSkuIndex(skus: GcpRawSku[]): {
  familyIndex: Map<string, SkuBucket>;
  gpuIndex: Map<string, GcpRawSku[]>;
} {
  const familyIndex = new Map<string, SkuBucket>();
  const gpuIndex = new Map<string, GcpRawSku[]>();

  for (const sku of skus) {
    const usageType = sku.category.usageType as GcpUsageType;
    if (!(usageType in USAGE_TYPE_TO_PRICING_TYPE)) continue;
    if (isExcludedSku(sku.description)) continue;

    if (sku.category.resourceGroup === 'GPU') {
      const gpuToken = detectGpuToken(sku.description);
      if (!gpuToken) continue;
      const gpuKey = `${gpuToken}|${usageType}`;
      if (!gpuIndex.has(gpuKey)) gpuIndex.set(gpuKey, []);
      gpuIndex.get(gpuKey)!.push(sku);
      continue;
    }

    const role = classifyResourceGroupRole(sku.category.resourceGroup, sku.description);
    if (!role) continue;

    // F1Micro/G1Small descriptions ("Micro Instance with burstable", "Small Instance with 1
    // vCPU") never mention "f1"/"g1" as text — the resourceGroup itself is the only signal.
    const familyToken =
      RESOURCE_GROUP_DIRECT_FAMILY_TOKEN[sku.category.resourceGroup] ??
      detectFamilyToken(sku.description);
    if (!familyToken) continue;

    const key = `${familyToken}|${usageType}`;
    if (!familyIndex.has(key)) {
      familyIndex.set(key, { core: [], ram: [], flatRate: [] });
    }
    familyIndex.get(key)![role].push(sku);
  }

  return { familyIndex, gpuIndex };
}

function findComponentPrice(bucket: GcpRawSku[] | undefined, regionCode: string): number | null {
  if (!bucket?.length) return null;
  const sku =
    bucket.find(s => s.serviceRegions.includes(regionCode)) ??
    bucket.find(s => s.serviceRegions.includes('global'));
  if (!sku) return null;

  const rate = sku.pricingInfo[0]?.pricingExpression.tieredRates[0];
  return rate ? parseGcpMoney(rate.unitPrice) : null;
}

// The SKU-matching family token can differ from the catalog/InstanceFamily grouping token —
// e.g. "m4-ultramem-224" groups under InstanceFamily "m4" but prices against the distinct
// "m4ultramem224" SKU token, not the plain "m4" rate.
function resolveSkuFamilyToken(machineTypeName: string): string {
  const baseToken = getMachineFamilyToken(machineTypeName);
  if (baseToken === 'm4' && /ultramem/i.test(machineTypeName)) {
    return 'm4ultramem224';
  }
  return baseToken;
}

// A4/A4X have no separate CPU/RAM SKU at all — the entire instance (vCPU + RAM + one GPU
// "slice") is priced as a single bundled rate under the GPU resourceGroup (e.g. "A4 Nvidia
// B200 (1 gpu slice) running in..."), unlike every other GPU-equipped family which composes
// core + ram + gpu separately.
const GPU_BUNDLED_SLICE_FAMILIES = new Set(['a4', 'a4x']);

/**
 * Composes a per-instance hourly cost from GCP's separately-priced core/ram/gpu SKU rates.
 * Returns null when a required component price can't be resolved for the region/usageType —
 * callers should skip that row rather than fabricate a number (matches AWS/Azure precedent).
 * For GPU-equipped instances, an unresolvable GPU price also fails the whole composition rather
 * than silently returning a GPU-less (and therefore wrong) price.
 */
export function composeHourlyCost(
  machineType: GcpRawMachineType,
  regionCode: string,
  usageType: GcpUsageType,
  skuIndex: { familyIndex: Map<string, SkuBucket>; gpuIndex: Map<string, GcpRawSku[]> },
): number | null {
  const familyToken = resolveSkuFamilyToken(machineType.name);

  if (GPU_BUNDLED_SLICE_FAMILIES.has(familyToken)) {
    const firstAccelerator = machineType.accelerators?.[0];
    if (!firstAccelerator) return null;
    const gpuToken = ACCELERATOR_TYPE_TO_GPU_TOKEN[firstAccelerator.guestAcceleratorType];
    const gpuBucket = gpuToken ? skuIndex.gpuIndex.get(`${gpuToken}|${usageType}`) : undefined;
    const slicePrice = findComponentPrice(gpuBucket, regionCode);
    return slicePrice == null ? null : firstAccelerator.guestAcceleratorCount * slicePrice;
  }

  const bucket = skuIndex.familyIndex.get(`${familyToken}|${usageType}`);
  if (!bucket) return null;

  if (bucket.flatRate.length) {
    return findComponentPrice(bucket.flatRate, regionCode);
  }

  const corePrice = findComponentPrice(bucket.core, regionCode);
  const ramPrice = findComponentPrice(bucket.ram, regionCode);
  if (corePrice == null || ramPrice == null) return null;

  let hourlyCost = machineType.guestCpus * corePrice + (machineType.memoryMb / 1024) * ramPrice;

  const firstAccelerator = machineType.accelerators?.[0];
  if (firstAccelerator) {
    const gpuToken = ACCELERATOR_TYPE_TO_GPU_TOKEN[firstAccelerator.guestAcceleratorType];
    const gpuBucket = gpuToken ? skuIndex.gpuIndex.get(`${gpuToken}|${usageType}`) : undefined;
    const gpuPrice = findComponentPrice(gpuBucket, regionCode);
    if (gpuPrice == null) return null;
    hourlyCost += firstAccelerator.guestAcceleratorCount * gpuPrice;
  }

  return hourlyCost;
}
