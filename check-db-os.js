const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function checkDatabaseOsData() {
  console.log("=========================================================================");
  console.log("      DATABASE OPERATING SYSTEM DATA CHECK (cloud_catalog DB)");
  console.log("=========================================================================\n");

  try {
    const rawResults = await prisma.$queryRaw`
      SELECT 
        p.id AS provider_id,
        p.name AS provider_name,
        vcm."operatingSystem",
        COUNT(vcm.id)::int AS record_count
      FROM vm_capability_matrix vcm
      JOIN vm_instances vi ON vcm."vmInstanceId" = vi.id
      JOIN services s ON vi."serviceId" = s.id
      JOIN providers p ON s."providerId" = p.id
      GROUP BY p.id, p.name, vcm."operatingSystem"
      ORDER BY p.id, vcm."operatingSystem";
    `;

    console.log("📌 OPERATING SYSTEM DISTRIBUTION IN YOUR DATABASE:\n");
    console.table(rawResults);

    const overall = await prisma.vmCapabilityMatrix.groupBy({
      by: ['operatingSystem'],
      _count: {
        _all: true,
      },
    });

    console.log("\n📌 OVERALL OS TOTALS IN DATABASE:\n");
    console.table(overall.map(o => ({ operatingSystem: o.operatingSystem, count: o._count._all })));

  } catch (err) {
    console.error("Error querying database:", err.message);
  } finally {
    await prisma.$disconnect();
  }
}

checkDatabaseOsData();
