import { awsProvider } from '../src/providers/aws';
import { logger } from '../src/config/logger';

async function main() {
  logger.info('Starting AWS Sync CLI script...');
  try {
    await awsProvider.sync();
    logger.info('AWS Sync CLI script executed successfully.');
    process.exit(0);
  } catch (error) {
    logger.error('AWS Sync CLI script failed:', error);
    process.exit(1);
  }
}

main();
