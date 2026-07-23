/**
 * Throwaway inspection script — NOT part of the sync pipeline, makes NO database writes.
 * Dumps FULL (non-truncated) descriptions for GPU resourceGroup SKUs so the GPU-model-based
 * matching table in src/providers/gcp/mapper/gcp.mapper.ts can be built from real data instead
 * of guessed wording.
 *
 * Usage: pnpm ts-node -r tsconfig-paths/register scripts/gcp-gpu-sku-dump.ts
 */
import 'dotenv/config';
import {
  resolveComputeEngineServiceId,
  fetchGcpComputeSkus,
} from '../src/providers/gcp/services/gcp-billing.service';

async function main() {
  const serviceId = await resolveComputeEngineServiceId();
  const skus = await fetchGcpComputeSkus(serviceId);

  const gpuSkus = skus.filter(s => s.category.resourceGroup === 'GPU');
  console.log(`Total GPU-resourceGroup SKUs: ${gpuSkus.length}\n`);

  const seen = new Set<string>();
  const rows: string[] = [];
  for (const sku of gpuSkus) {
    const key = `${sku.category.usageType}|${sku.description}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push(`${sku.category.usageType.padEnd(12)} | ${sku.description}`);
  }
  rows.sort();
  for (const row of rows) console.log(row);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
