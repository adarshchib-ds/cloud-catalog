import { logger } from '../../../config/logger';
import { getGcpAccessToken } from './gcp-auth.service';
import { GcpRawSku } from '../dto/gcp-raw.dto';

// Well-known Cloud Billing Catalog service ID for "Compute Engine" (stable across GCP projects)
const GCE_SERVICE_ID_FALLBACK = 'services/6F81-5844-456A';

async function fetchWithRetry(url: string): Promise<any> {
  let retries = 3;
  let delay = 1000;

  while (retries > 0) {
    try {
      const token = await getGcpAccessToken();
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) {
        const body = await response.text();
        throw new Error(`HTTP error! status: ${response.status}. Body: ${body}`);
      }
      return await response.json();
    } catch (error) {
      retries--;
      logger.warn(`GCP Billing API request failed. Retries left: ${retries}. Error: ${error}`);
      if (retries === 0) throw error;
      await new Promise(resolve => setTimeout(resolve, delay));
      delay *= 2;
    }
  }
}

export async function resolveComputeEngineServiceId(): Promise<string> {
  try {
    let nextPageToken: string | undefined;
    let pageCount = 0;

    do {
      pageCount++;
      const url = new URL('https://cloudbilling.googleapis.com/v1/services');
      url.searchParams.set('pageSize', '200');
      if (nextPageToken) url.searchParams.set('pageToken', nextPageToken);

      const data = await fetchWithRetry(url.toString());
      const match = (data.services ?? []).find((s: any) => s.displayName === 'Compute Engine');
      if (match?.name) return match.name;

      nextPageToken = data.nextPageToken || undefined;
    } while (nextPageToken && pageCount < 20);

    logger.warn('Compute Engine service not found in Cloud Billing Catalog; using fallback ID.');
    return GCE_SERVICE_ID_FALLBACK;
  } catch (error) {
    logger.warn(`Failed resolving Compute Engine service ID; using fallback. Error: ${error}`);
    return GCE_SERVICE_ID_FALLBACK;
  }
}

export async function fetchGcpComputeSkus(serviceId: string): Promise<GcpRawSku[]> {
  logger.info('Fetching GCP Compute Engine SKUs from Cloud Billing Catalog...');
  const skus: GcpRawSku[] = [];
  let nextPageToken: string | undefined;
  let pageCount = 0;

  do {
    pageCount++;
    const url = new URL(`https://cloudbilling.googleapis.com/v1/${serviceId}/skus`);
    url.searchParams.set('pageSize', '5000');
    url.searchParams.set('currencyCode', 'USD');
    if (nextPageToken) url.searchParams.set('pageToken', nextPageToken);

    const data = await fetchWithRetry(url.toString());
    skus.push(...(data.skus ?? []));
    nextPageToken = data.nextPageToken || undefined;

    if (pageCount % 5 === 0) {
      logger.info(`Fetched ${skus.length} SKUs so far (page ${pageCount})...`);
    }

    // Safety brake to prevent runaway loop
    if (pageCount > 200) {
      logger.warn('Paging safety limit reached. Stopping SKU ingestion.');
      break;
    }
  } while (nextPageToken);

  logger.info(`Completed fetching GCP Compute Engine SKUs. Total: ${skus.length}`);
  return skus;
}
