/**
 * Throwaway inspection script — NOT part of the sync pipeline.
 * Dumps unique (resourceGroup, usageType, description-prefix) tuples from the
 * live GCP Cloud Billing Catalog so the family-key matching table in
 * src/providers/gcp/mapper/gcp.mapper.ts can be validated/corrected against
 * real SKU data before relying on it for pricing composition.
 *
 * Usage: pnpm ts-node -r tsconfig-paths/register scripts/gcp-sku-dump.ts
 */
import 'dotenv/config';
import {
  resolveComputeEngineServiceId,
  fetchGcpComputeSkus,
} from '../src/providers/gcp/services/gcp-billing.service';

async function main() {
  const serviceId = await resolveComputeEngineServiceId();
  console.log(`Compute Engine service ID: ${serviceId}`);

  const skus = await fetchGcpComputeSkus(serviceId);
  console.log(`Total SKUs fetched: ${skus.length}`);

  const tuples = new Map<string, number>();
  for (const sku of skus) {
    const prefix = sku.description.split(' ').slice(0, 4).join(' ');
    const key = `${sku.category.resourceGroup} | ${sku.category.usageType} | ${prefix}`;
    tuples.set(key, (tuples.get(key) ?? 0) + 1);
  }

  const sorted = Array.from(tuples.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  console.log('\nresourceGroup | usageType | description-prefix -> count\n');
  for (const [key, count] of sorted) {
    console.log(`${key}  (${count})`);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
