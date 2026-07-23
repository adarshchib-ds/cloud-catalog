import { ClientSecretCredential } from '@azure/identity';
import { ComputeManagementClient, ResourceSku } from '@azure/arm-compute';
import { logger } from '../../../config/logger';

function getCredentials() {
  const tenantId = process.env.AZURE_TENANT_ID;
  const clientId = process.env.AZURE_CLIENT_ID;
  const clientSecret = process.env.AZURE_CLIENT_SECRET;
  const subscriptionId = process.env.AZURE_SUBSCRIPTION_ID;

  if (!tenantId || !clientId || !clientSecret || !subscriptionId) {
    throw new Error(
      'Missing required Azure credentials in environment variables (AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET, AZURE_SUBSCRIPTION_ID).',
    );
  }

  const credential = new ClientSecretCredential(tenantId, clientId, clientSecret);
  return { credential, subscriptionId };
}

/**
 * Fetches Azure Virtual Machine SKUs using the ComputeManagementClient.
 */
export async function fetchAzureVmSkus(): Promise<ResourceSku[]> {
  logger.info('Fetching Azure Virtual Machine SKUs using ComputeManagementClient...');
  const { credential, subscriptionId } = getCredentials();
  const client = new ComputeManagementClient(credential, subscriptionId);

  const skus: ResourceSku[] = [];
  try {
    const skuList = client.resourceSkus.list();
    for await (const sku of skuList) {
      if (sku.resourceType === 'virtualMachines') {
        skus.push(sku);
      }
    }
    logger.info(`Successfully fetched ${skus.length} Azure VM SKUs.`);
    return skus;
  } catch (error) {
    logger.error('Failed to fetch Azure VM SKUs:', error);
    throw error;
  }
}
