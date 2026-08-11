/**
 * Helper to parse workload category, architecture, and generation from instance specifications.
 */
export function parseInstanceMeta(inst: any) {
  const typeLower = inst.instanceType.toLowerCase();
  const famLower = inst.instanceFamily.name.toLowerCase();

  let category = 'GENERAL_PURPOSE';
  if (inst.hasGpu) {
    category = 'GPU';
  } else if (
    inst.burstable ||
    typeLower.startsWith('t') ||
    typeLower.startsWith('b') ||
    typeLower.startsWith('e2')
  ) {
    category = 'BURSTABLE';
  } else if (
    typeLower.startsWith('c') ||
    typeLower.startsWith('f') ||
    famLower.includes('compute')
  ) {
    category = 'COMPUTE_OPTIMIZED';
  } else if (
    typeLower.startsWith('r') ||
    typeLower.startsWith('e') ||
    typeLower.includes('highmem') ||
    typeLower.includes('ultramem')
  ) {
    category = 'MEMORY_OPTIMIZED';
  } else if (
    typeLower.startsWith('i') ||
    typeLower.startsWith('d') ||
    typeLower.startsWith('l') ||
    typeLower.startsWith('h') ||
    famLower.includes('storage')
  ) {
    category = 'STORAGE_OPTIMIZED';
  }

  let architecture = 'X86_64';
  if (
    inst.processor?.toLowerCase().includes('graviton') ||
    famLower.endsWith('g') ||
    famLower.includes('graviton') ||
    typeLower.startsWith('t2a') ||
    typeLower.includes('ps') ||
    typeLower.includes('pd')
  ) {
    architecture = 'ARM64';
  }

  let generation = typeof inst.generation === 'number' && inst.generation > 0 ? inst.generation : 5;
  if (!inst.generation) {
    // Fallback: Check for version suffix like _v6, _v5, -v3 (e.g. Standard_D4as_v6 -> 6)
    const vMatch = inst.instanceType.match(/_?v([0-9]+)/i);
    if (vMatch) {
      generation = parseInt(vMatch[1], 10);
    } else {
      const matches = inst.instanceType.match(/[0-9]+/);
      if (matches) {
        generation = parseInt(matches[0], 10);
      } else {
        const famMatches = inst.instanceFamily.name.match(/[0-9]+/);
        if (famMatches) {
          generation = parseInt(famMatches[0], 10);
        }
      }
    }
  }

  return { category, architecture, generation };
}

/**
 * Helper to score compatibility of candidate against AWS instance.
 */
export function calculateScore(awsMeta: any, candMeta: any, aws: any, cand: any) {
  let score = 0;
  const reasons: string[] = [];

  // 1. Workload Category (40%)
  if (awsMeta.category === candMeta.category) {
    score += 40;
    reasons.push('Same workload category');
  }

  // 2. Architecture (20%) - ARM vs Intel/AMD
  if (awsMeta.architecture === candMeta.architecture) {
    score += 20;
    reasons.push('Same processor architecture');
  }

  // 3. Generation Match (15%)
  const genDiff = Math.abs(awsMeta.generation - candMeta.generation);
  if (genDiff === 0) {
    score += 15;
    reasons.push('Same processor generation');
  } else if (genDiff === 1) {
    score += 7.5;
    reasons.push('Closest generation');
  }

  // 4. CPU Match (10%)
  if (aws.vcpu === cand.vcpu) {
    score += 10;
    reasons.push('Same CPU count');
  } else {
    const cpuDiff = Math.abs(aws.vcpu - cand.vcpu) / aws.vcpu;
    if (cpuDiff <= 0.25) {
      score += 5;
      reasons.push('Similar CPU count');
    }
  }

  // 5. Memory Match (10%)
  if (Math.abs(aws.memoryGib - cand.memoryGib) < 0.1) {
    score += 10;
    reasons.push('Same memory');
  } else {
    const memDiff = Math.abs(aws.memoryGib - cand.memoryGib) / aws.memoryGib;
    if (memDiff <= 0.25) {
      score += 5;
      reasons.push('Similar memory');
    }
  }

  // 6. Price Match (5%)
  const awsPrice = aws.hourlyCost || 0;
  const candPrice = cand.hourlyCost || 0;
  if (awsPrice > 0 && candPrice > 0) {
    if (candPrice <= awsPrice) {
      score += 5;
      reasons.push('Lower or equal hourly price');
    } else {
      const priceDiff = (candPrice - awsPrice) / awsPrice;
      const priceScore = Math.max(0, 5 * (1 - priceDiff));
      score += priceScore;
      if (priceDiff <= 0.15) {
        reasons.push('Highly similar price');
      }
    }
  }

  return { score: Math.round(score), reasons };
}

/**
 * Normalizes provider-specific operating system queries.
 * AWS maintains distro-specific SKUs (Ubuntu, Red Hat, SUSE),
 * while Azure and GCP store Linux distributions under generic 'LINUX'.
 */
export function normalizeOperatingSystem(
  providerSlug: string,
  requestedOs?: string,
): string | undefined {
  if (!requestedOs) return undefined;
  const osUpper = requestedOs.toUpperCase();
  const slugLower = providerSlug.toLowerCase();

  const isAws = slugLower.includes('amazon') || slugLower.includes('aws');
  if (isAws) {
    return osUpper;
  }

  // Azure and GCP Distro Normalization to generic LINUX
  const linuxDistros = ['UBUNTU', 'RED_HAT', 'SUSE', 'DEBIAN', 'ORACLE_LINUX', 'LINUX'];
  if (linuxDistros.includes(osUpper)) {
    return 'LINUX';
  }

  return osUpper;
}

interface RegionGroup {
  aws: string[];
  azure: string[];
  gcp: string[];
}

const REGION_GROUPS: RegionGroup[] = [
  {
    aws: ['us-east-1', 'us-east-2'],
    azure: ['eastus', 'eastus2'],
    gcp: ['us-east1', 'us-east4', 'us-central1'],
  },
  {
    aws: ['us-west-1', 'us-west-2'],
    azure: ['westus', 'westus2', 'westus3'],
    gcp: ['us-west1', 'us-west2', 'us-west3', 'us-central1'],
  },
  {
    aws: ['ca-central-1'],
    azure: ['canadacentral', 'canadaeast'],
    gcp: ['northamerica-northeast1', 'northamerica-northeast2'],
  },
  {
    aws: ['eu-west-1', 'eu-west-2', 'eu-west-3'],
    azure: ['northeurope', 'westeurope', 'uksouth', 'francecentral'],
    gcp: ['europe-west1', 'europe-west2', 'europe-west3', 'europe-west4', 'europe-west9'],
  },
  {
    aws: ['eu-central-1', 'eu-central-2'],
    azure: ['germanywestcentral', 'westeurope'],
    gcp: ['europe-west3', 'europe-west1'],
  },
  {
    aws: ['eu-north-1'],
    azure: ['swedencentral', 'northeurope'],
    gcp: ['europe-north1'],
  },
  {
    aws: ['ap-south-1', 'ap-south-2'],
    azure: ['centralindia', 'southindia'],
    gcp: ['asia-south1', 'asia-south2'],
  },
  {
    aws: ['ap-southeast-1', 'ap-southeast-2', 'ap-southeast-3'],
    azure: ['southeastasia', 'australiaeast', 'australiasoutheast'],
    gcp: ['asia-southeast1', 'asia-southeast2', 'australia-southeast1'],
  },
  {
    aws: ['ap-northeast-1', 'ap-northeast-2', 'ap-northeast-3'],
    azure: ['japaneast', 'japanwest', 'koreacentral'],
    gcp: ['asia-northeast1', 'asia-northeast2', 'asia-northeast3'],
  },
  {
    aws: ['sa-east-1'],
    azure: ['brazilsouth'],
    gcp: ['southamerica-east1', 'southamerica-west1'],
  },
  {
    aws: ['af-south-1'],
    azure: ['southafricanorth'],
    gcp: ['africa-south1'],
  },
  {
    aws: ['me-south-1', 'me-central-1'],
    azure: ['uaenorth'],
    gcp: ['me-central1', 'me-west1'],
  },
];

/**
 * Maps input region codes (from AWS, Azure, or GCP) to provider-equivalent region codes.
 * Works bi-directionally regardless of which cloud provider region is passed.
 */
export function normalizeRegionForProvider(providerSlug: string, inputRegion?: string): string[] {
  if (!inputRegion) return [];
  const regLower = inputRegion.toLowerCase().trim();
  const slugLower = providerSlug.toLowerCase();

  const isAws = slugLower.includes('aws') || slugLower.includes('amazon');
  const isAzure = slugLower.includes('azure') || slugLower.includes('microsoft');
  const isGcp = slugLower.includes('gcp') || slugLower.includes('google');

  // Find matching groups for the input region
  const matchingGroups = REGION_GROUPS.filter(
    group =>
      group.aws.some(r => r.toLowerCase() === regLower) ||
      group.azure.some(r => r.toLowerCase() === regLower) ||
      group.gcp.some(r => r.toLowerCase() === regLower),
  );

  if (matchingGroups.length > 0) {
    const results = new Set<string>();
    results.add(regLower);

    for (const group of matchingGroups) {
      if (isAws) {
        group.aws.forEach(r => results.add(r));
      } else if (isAzure) {
        group.azure.forEach(r => results.add(r));
      } else if (isGcp) {
        group.gcp.forEach(r => results.add(r));
      } else {
        group.aws.forEach(r => results.add(r));
        group.azure.forEach(r => results.add(r));
        group.gcp.forEach(r => results.add(r));
      }
    }
    return Array.from(results);
  }

  const cleanReg = regLower.replace(/[^a-z0-9]/g, '');
  return Array.from(new Set([regLower, cleanReg]));
}
