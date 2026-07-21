import { syncAzure } from './sync/azure-sync.orchestrator';

export const azureProvider = {
  sync: async (): Promise<void> => {
    await syncAzure();
  },
};
export { syncAzure };
