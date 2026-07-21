import { syncAws } from './sync/aws-sync.orchestrator';

export const awsProvider = {
  sync: async (): Promise<void> => {
    await syncAws();
  },
};
export { syncAws };
