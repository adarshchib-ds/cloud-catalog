/**
 * Throwaway inspection script — NOT part of the sync pipeline, makes NO database writes.
 * For specific unpriced machine types, prints the raw guestAcceleratorType from the Compute
 * Engine API, and searches the live SKU catalog for related descriptions, to confirm whether
 * each gap is a real catalog gap or a fixable token-matching gap.
 *
 * Usage: pnpm ts-node -r tsconfig-paths/register scripts/gcp-unpriced-diagnosis.ts
 */
import 'dotenv/config';
import { fetchGcpMachineTypes } from '../src/providers/gcp/services/gcp-compute.service';
import {
  resolveComputeEngineServiceId,
  fetchGcpComputeSkus,
} from '../src/providers/gcp/services/gcp-billing.service';

async function main() {
  const targets = ['g4-standard-6', 'a4-highgpu-8g', 'a4x-highgpu-4g', 'a4x-maxgpu-4g-metal'];
  const machineTypes = await fetchGcpMachineTypes();
  const byName = new Map<string, (typeof machineTypes)[number]>();
  for (const mt of machineTypes) if (!byName.has(mt.name)) byName.set(mt.name, mt);

  console.log('=== Accelerator types for target machine types ===');
  for (const t of targets) {
    const mt = byName.get(t);
    console.log(`${t}: ${mt ? JSON.stringify(mt.accelerators) : 'NOT FOUND'}`);
  }

  const serviceId = await resolveComputeEngineServiceId();
  const skus = await fetchGcpComputeSkus(serviceId);

  console.log('\n=== SKU descriptions mentioning M4N, RTX, GB200, GB300 (OnDemand only) ===');
  const seen = new Set<string>();
  for (const sku of skus) {
    if (sku.category.usageType !== 'OnDemand') continue;
    if (!/M4N|RTX|GB200|GB300/i.test(sku.description)) continue;
    const key = `${sku.category.resourceGroup}|${sku.description}`;
    if (seen.has(key)) continue;
    seen.add(key);
    console.log(`  [${sku.category.resourceGroup}] ${sku.description}`);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
