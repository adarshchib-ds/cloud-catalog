/**
 * Computes compatibility match score between a source VM and a candidate VM.
 */
export function computeMatchScore(
  source: { vcpu: number; memoryGib: number },
  candidate: { vcpu: number; memoryGib: number },
  vcpuRange: number,
  memRange: number,
): number {
  const vcpuDistance = Math.abs(candidate.vcpu - source.vcpu) / vcpuRange;
  const memDistance = Math.abs(candidate.memoryGib - source.memoryGib) / memRange;
  return Math.round((1 - (vcpuDistance + memDistance) / 2) * 100) / 100;
}
