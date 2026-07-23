/**
 * Throwaway inspection script — NOT part of the sync pipeline, makes NO database writes.
 * Reports current row counts for every table scoped to provider 'gcp', so the scope of a
 * cleanup delete can be confirmed before running it.
 *
 * Usage: pnpm ts-node -r tsconfig-paths/register scripts/gcp-data-count.ts
 */
import 'dotenv/config';
import { prisma } from '../src/config/database';

async function main() {
  const allProviders = await prisma.provider.findMany({ select: { id: true, name: true } });
  console.log(`Total providers in DB: ${allProviders.length}`);
  for (const p of allProviders) console.log(`  - ${p.id} (${p.name})`);

  const provider = await prisma.provider.findUnique({ where: { id: 'gcp' } });
  console.log(`\nProvider 'gcp' exists: ${!!provider}`);
  if (!provider) return;

  const regionCount = await prisma.region.count({ where: { providerId: 'gcp' } });
  const familyCount = await prisma.instanceFamily.count({ where: { providerId: 'gcp' } });
  const services = await prisma.service.findMany({ where: { providerId: 'gcp' } });
  console.log(`Regions: ${regionCount}`);
  console.log(`Instance families: ${familyCount}`);
  console.log(
    `Services under provider 'gcp': ${services.length} (${services.map(s => `slug="${s.slug}" id=${s.id}`).join(', ')})`,
  );

  for (const service of services) {
    const vmInstanceCount = await prisma.vmInstance.count({ where: { serviceId: service.id } });
    const capabilityCount = await prisma.vmCapabilityMatrix.count({
      where: { vmInstance: { serviceId: service.id } },
    });
    const pricingCount = await prisma.vmPricing.count({
      where: { capabilityMatrix: { vmInstance: { serviceId: service.id } } },
    });
    console.log(
      `  Service '${service.slug}': ${vmInstanceCount} instances, ${capabilityCount} capability rows, ${pricingCount} pricing rows`,
    );
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
