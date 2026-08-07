import { getSmartRecommendations } from './src/services/recommendation.service';

async function findExactScreenshotRow() {
  console.log('=== SEARCHING FOR EXACT SCREENSHOT RECOMMENDATION ROW ===\n');

  // Test filter combinations (vCPU: 192, RAM: 1536)
  const filters = [
    { reqVcpu: 192, reqMemoryGib: 1536, pageSize: 50 },
    { reqVcpu: 192, reqMemoryGib: 1536, tenancy: 'DEDICATED_INSTANCE', pageSize: 50 },
    { reqVcpu: 192, reqMemoryGib: 1536, operatingSystem: 'SUSE', pageSize: 50 },
    { pageSize: 100 }
  ];

  for (const f of filters) {
    const res = await getSmartRecommendations(f as any);
    for (let i = 0; i < res.matrixRows.length; i++) {
      const row = res.matrixRows[i];
      if (
        row.aws?.instance === 'r8gb.48xlarge' ||
        row.azure?.recommendedInstance === 'Standard_E192s_v7' ||
        row.gcp?.recommendedInstance === 'z3-highmem-192-highlssd-metal'
      ) {
        console.log(`FOUND ROW matching screenshot criteria using filter:`, f);
        console.log(`Row index: ${i}`);
        console.log('AWS:', JSON.stringify(row.aws, null, 2));
        console.log('Azure:', JSON.stringify(row.azure, null, 2));
        console.log('GCP:', JSON.stringify(row.gcp, null, 2));
        return;
      }
    }
  }

  console.log('No matching row found in top pages.');
}

findExactScreenshotRow().catch(console.error);
