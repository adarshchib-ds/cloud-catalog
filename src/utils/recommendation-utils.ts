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
    const priceDiff = Math.abs(awsPrice - candPrice) / awsPrice;
    const priceScore = Math.max(0, 5 * (1 - priceDiff));
    score += priceScore;
    if (priceDiff <= 0.15) {
      reasons.push('Highly similar price');
    }
  }

  return { score: Math.round(score), reasons };
}
