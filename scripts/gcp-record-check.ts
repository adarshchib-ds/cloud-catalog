/**
 * Throwaway inspection script — NOT part of the sync pipeline, makes NO database writes.
 * Pulls real persisted rows for a few well-known machine types and prints every column, so
 * data completeness/correctness can be spot-checked against what's actually in the DB (not
 * just what was computed pre-write).
 *
 * Usage: pnpm ts-node -r tsconfig-paths/register scripts/gcp-record-check.ts
 */
import 'dotenv/config';
import { prisma } from '../src/config/database';

const SPOT_CHECK_TYPES = [
  'n2-standard-4',
  'e2-medium',
  'a2-highgpu-1g',
  'g2-standard-4',
  'f1-micro',
];
async function main() {
  // Pick any region that already has capability data, rather than a hardcoded one that might
  // not have been reached yet by the still-running region-outer loop.
  const anyCapability = await prisma.vmCapabilityMatrix.findFirst({
    where: { vmInstance: { service: { providerId: 'gcp', slug: 'gce' } } },
    include: { region: true },
    orderBy: { createdAt: 'asc' },
  });
  const region = anyCapability?.region ?? null;
  console.log('Using region with existing data:', JSON.stringify(region, null, 2));

  for (const typeName of SPOT_CHECK_TYPES) {
    const instance = await prisma.vmInstance.findFirst({
      where: { instanceType: typeName, service: { providerId: 'gcp', slug: 'gce' } },
      include: { instanceFamily: true },
    });
    if (!instance) {
      console.log(`\n${typeName}: NOT YET IN DB`);
      continue;
    }
    console.log(`\n=== ${typeName} ===`);
    console.log('VmInstance:', JSON.stringify(instance, null, 2));

    if (!region) continue;
    const capability = await prisma.vmCapabilityMatrix.findFirst({
      where: { vmInstanceId: instance.id, regionId: region.id },
      include: { pricings: true },
    });
    console.log('CapabilityMatrix + Pricing:', JSON.stringify(capability, null, 2));
  }
}

main()
  .catch(err => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
