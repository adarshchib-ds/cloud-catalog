/**
 * Throwaway inspection script — NOT part of the sync pipeline, makes NO database writes.
 * Estimates sync:gcp progress by counting how many distinct regions currently have capability
 * rows (the orchestrator loops region-outer, instance-inner, so this approximates how far
 * through the outer loop the run has gotten).
 *
 * Usage: pnpm ts-node -r tsconfig-paths/register scripts/gcp-progress-check.ts
 */
import 'dotenv/config';
import { prisma } from '../src/config/database';

async function main() {
  const totalRegions = await prisma.region.count({ where: { providerId: 'gcp' } });
  const totalInstances = await prisma.vmInstance.count({
    where: { service: { providerId: 'gcp', slug: 'gce' } },
  });

  const rows = await prisma.$queryRaw<{ regionId: string; count: bigint }[]>`
    SELECT vcm."regionId", COUNT(*) as count
    FROM vm_capability_matrix vcm
    JOIN vm_instances vi ON vi.id = vcm."vmInstanceId"
    JOIN services s ON s.id = vi."serviceId"
    WHERE s."providerId" = 'gcp'
    GROUP BY vcm."regionId"
  `;

  console.log(`Total regions: ${totalRegions}, total instances: ${totalInstances}`);
  console.log(`Distinct regions with capability data so far: ${rows.length} / ${totalRegions}`);
  console.log(`Estimated outer-loop progress: ${((rows.length / totalRegions) * 100).toFixed(1)}%`);
}

main()
  .catch(err => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
