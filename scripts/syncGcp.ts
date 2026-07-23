import 'dotenv/config';
import { gcpProvider } from '../src/providers/gcp';
import { logger } from '../src/config/logger';

async function main() {
  logger.info('Starting GCP Sync CLI script...');
  try {
    await gcpProvider.sync();
    logger.info('GCP Sync CLI script executed successfully.');
    process.exit(0);
  } catch (error) {
    logger.error('GCP Sync CLI script failed:', error);
    process.exit(1);
  }
}

main();
