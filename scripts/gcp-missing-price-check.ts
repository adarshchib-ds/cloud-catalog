/**
 * Throwaway inspection script — NOT part of the sync pipeline, makes NO database writes.
 * Finds GCP instances with zero pricing anywhere, and instances missing pricing in only some
 * regions, to diagnose root causes of composeHourlyCost returning null.
 *
 * Usage: pnpm ts-node -r tsconfig-paths/register scripts/gcp-missing-price-check.ts
 */
import 'dotenv/config';
import { prisma } from '../src/config/database';

async function main() {
  const service = await prisma.service.findFirst({ where: { providerId: 'gcp', slug: 'gce' } });
  if (!service) return;

  const totalRegions = await prisma.region.count({ where: { providerId: 'gcp' } });
  const instances = await prisma.vmInstance.findMany({
    where: { serviceId: service.id },
    include: { instanceFamily: true, _count: { select: { vmCapabilityMatrix: true } } },
  });

  const zeroCoverage = instances.filter(i => i._count.vmCapabilityMatrix === 0);
  const partialCoverage = instances.filter(
    i => i._count.vmCapabilityMatrix > 0 && i._count.vmCapabilityMatrix < totalRegions,
  );
  const fullCoverage = instances.filter(i => i._count.vmCapabilityMatrix === totalRegions);

  console.log(`Total instances: ${instances.length}`);
  console.log(`Zero regions priced (completely unpriced): ${zeroCoverage.length}`);
  console.log(`Partial region coverage: ${partialCoverage.length}`);
  console.log(`Full region coverage (${totalRegions}/${totalRegions}): ${fullCoverage.length}`);

  console.log(`\n=== Sample of completely unpriced instances (up to 20) ===`);
  for (const i of zeroCoverage.slice(0, 20)) {
    console.log(
      `  ${i.instanceType} (family=${i.instanceFamily.name}, hasGpu=${i.hasGpu}, gpuModel=${i.gpuModel ?? 'n/a'})`,
    );
  }

  console.log(`\n=== Sample of partially-priced instances (up to 10) ===`);
  for (const i of partialCoverage.slice(0, 10)) {
    console.log(
      `  ${i.instanceType} (family=${i.instanceFamily.name}, hasGpu=${i.hasGpu}, gpuModel=${i.gpuModel ?? 'n/a'}): ${i._count.vmCapabilityMatrix}/${totalRegions} regions`,
    );
  }

  // Breakdown of unpriced instances by family, to spot systemic gaps
  const byFamily = new Map<string, number>();
  for (const i of zeroCoverage) {
    byFamily.set(i.instanceFamily.name, (byFamily.get(i.instanceFamily.name) ?? 0) + 1);
  }
  console.log(`\n=== Unpriced instance count by family ===`);
  for (const [family, count] of Array.from(byFamily.entries()).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${family}: ${count}`);
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
