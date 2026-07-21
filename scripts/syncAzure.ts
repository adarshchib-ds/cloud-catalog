import { azureProvider } from '../src/providers/azure';
import { logger } from '../src/config/logger';

async function main() {
  logger.info('Starting Azure Sync CLI script...');
  try {
    await azureProvider.sync();
    logger.info('Azure Sync CLI script executed successfully.');
    process.exit(0);
  } catch (error) {
    logger.error('Azure Sync CLI script failed:', error);
    process.exit(1);
  }
}

main();
