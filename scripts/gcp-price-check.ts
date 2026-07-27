/**
 * Throwaway verification script — NOT part of the sync pipeline, makes NO database writes.
 * Fetches real regions, machine types, and SKUs, then composes hourly cost for a handful of
 * well-known machine types so the pricing-composition logic can be sanity-checked against
 * Google's public pricing page before running the real DB-writing `pnpm sync:gcp`.
 *
 * Usage: pnpm ts-node -r tsconfig-paths/register scripts/gcp-price-check.ts
 */
import 'dotenv/config';
import {
  fetchGcpRegions,
  fetchGcpMachineTypes,
} from '../src/providers/gcp/services/gcp-compute.service';
import {
  resolveComputeEngineServiceId,
  fetchGcpComputeSkus,
} from '../src/providers/gcp/services/gcp-billing.service';
import { buildGcpSkuIndex, composeHourlyCost } from '../src/providers/gcp/mapper/gcp.mapper';

const SPOT_CHECK_TYPES = ['g4-standard-6', 'g4-standard-48', 'a4-highgpu-8g', 'a4x-highgpu-4g'];
const SPOT_CHECK_REGION = 'us-central1';
const USAGE_TYPES = ['OnDemand', 'Preemptible', 'Commit1Yr', 'Commit3Yr'] as const;

async function main() {
  console.log('Fetching regions...');
  const regions = await fetchGcpRegions();
  console.log(`Regions: ${regions.length}`);
  console.log(`us-central1 present: ${regions.some(r => r.name === SPOT_CHECK_REGION)}`);

  console.log('\nFetching machine types (may take a minute)...');
  const machineTypes = await fetchGcpMachineTypes();
  const byName = new Map<string, (typeof machineTypes)[number]>();
  for (const mt of machineTypes) if (!byName.has(mt.name)) byName.set(mt.name, mt);
  console.log(`Unique machine types: ${byName.size}`);

  console.log('\nFetching pricing catalog...');
  const serviceId = await resolveComputeEngineServiceId();
  const skus = await fetchGcpComputeSkus(serviceId);
  const skuIndex = buildGcpSkuIndex(skus);
  console.log(
    `SKU index buckets: ${skuIndex.familyIndex.size} family, ${skuIndex.gpuIndex.size} GPU`,
  );

  console.log(`\n=== Composed pricing in ${SPOT_CHECK_REGION} ===\n`);
  for (const typeName of SPOT_CHECK_TYPES) {
    const mt = byName.get(typeName);
    if (!mt) {
      console.log(`${typeName}: NOT FOUND in machine types list`);
      continue;
    }
    console.log(
      `${typeName} (vcpu=${mt.guestCpus}, memoryMb=${mt.memoryMb}, accelerators=${JSON.stringify(mt.accelerators ?? [])}):`,
    );
    for (const usageType of USAGE_TYPES) {
      const cost = composeHourlyCost(mt, SPOT_CHECK_REGION, usageType, skuIndex);
      console.log(
        `  ${usageType.padEnd(12)}: ${cost == null ? 'NULL (unresolvable)' : `$${cost.toFixed(6)}/hr`}`,
      );
    }
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
