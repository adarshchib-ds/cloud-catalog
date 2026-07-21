import { logger } from '../../../config/logger';
import { AzureRetailPriceItem, AzureRetailPriceResponseSchema } from '../dto/azure-raw.dto';

/**
 * Fetches all Virtual Machine pricing from the Azure Retail Prices API.
 * Uses pagination and handles rate limits/transient errors with retries.
 */
export async function fetchAzureVmPricing(): Promise<AzureRetailPriceItem[]> {
  logger.info('Fetching Azure Virtual Machine pricing from Retail Prices API...');
  const items: AzureRetailPriceItem[] = [];

  // Start with a general filter for consumption prices of Virtual Machines
  let nextUrl: string | undefined =
    `https://prices.azure.com/api/retail/prices?api-version=2023-01-01-preview&$filter=serviceName eq 'Virtual Machines' and priceType eq 'Consumption'`;
  let pageCount = 0;

  while (nextUrl) {
    pageCount++;
    logger.debug(`Fetching pricing page ${pageCount}: ${nextUrl}`);

    let success = false;
    let retries = 3;
    let delay = 1000;
    let responseData: any = null;

    while (!success && retries > 0) {
      try {
        const response = await fetch(nextUrl);
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        responseData = await response.json();
        success = true;
      } catch (error) {
        retries--;
        logger.warn(`Failed to fetch pricing page. Retries left: ${retries}. Error: ${error}`);
        if (retries === 0) {
          throw error;
        }
        await new Promise(resolve => setTimeout(resolve, delay));
        delay *= 2; // Exponential backoff
      }
    }

    const validated = AzureRetailPriceResponseSchema.safeParse(responseData);
    if (!validated.success) {
      logger.error(`Validation failed for pricing page data: ${validated.error}`);
      throw new Error('Pricing data validation failure.');
    }

    items.push(...validated.data.Items);
    nextUrl = validated.data.NextPageLink || undefined;

    if (pageCount % 10 === 0) {
      logger.info(`Fetched ${items.length} pricing items so far (page ${pageCount})...`);
    }

    // Safety brake to prevent runaway loop in testing (or fetch top 200 pages max)
    if (pageCount > 500) {
      logger.warn('Paging safety limit reached. Stopping pricing ingestion.');
      break;
    }
  }

  logger.info(`Completed fetching Azure pricing. Total items: ${items.length}`);
  return items;
}
