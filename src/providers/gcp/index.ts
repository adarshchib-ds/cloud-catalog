import { syncGcp } from './sync/gcp-sync.orchestrator';

export const gcpProvider = {
  sync: async (): Promise<void> => {
    await syncGcp();
  },
};
export { syncGcp };
