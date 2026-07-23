/**
 * Throwaway cleanup script — NOT part of the sync pipeline.
 * Deletes the 'gcp' Provider row, which cascades (real Postgres FK constraints) through every
 * GCP-scoped row: Service, Region, InstanceFamily, VmInstance, VmCapabilityMatrix, VmPricing.
 * Cannot affect 'aws'/'azure' rows since the cascade only follows FKs from the 'gcp' provider.
 *
 * Usage: pnpm ts-node -r tsconfig-paths/register scripts/gcp-data-delete.ts
 */
import 'dotenv/config';
import { prisma } from '../src/config/database';

async function main() {
  const before = await prisma.provider.findMany({ select: { id: true } });
  console.log(`Providers before delete: ${before.map(p => p.id).join(', ')}`);

  const deleted = await prisma.provider.delete({ where: { id: 'gcp' } });
  console.log(`Deleted provider: ${deleted.id} (${deleted.name})`);

  const after = await prisma.provider.findMany({ select: { id: true } });
  console.log(`Providers after delete: ${after.map(p => p.id).join(', ')}`);
}

main()
  .catch(err => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
