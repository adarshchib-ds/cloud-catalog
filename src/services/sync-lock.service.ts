import { logger } from '../config/logger';

class SyncLockService {
  private activeLocks = new Set<string>();

  /**
   * Attempts to acquire an execution lock for a provider sync process.
   * Returns true if lock acquired, false if sync is already active.
   */
  public acquireLock(provider: string): boolean {
    const lockKey = provider.toLowerCase();
    if (this.activeLocks.has(lockKey)) {
      logger.warn(`[SYNC LOCK] Concurrent sync blocked: Process for '${provider}' is already active.`);
      return false;
    }
    this.activeLocks.add(lockKey);
    logger.info(`[SYNC LOCK] Lock acquired for provider '${provider}'.`);
    return true;
  }

  /**
   * Releases the execution lock for a provider sync process.
   */
  public releaseLock(provider: string): void {
    const lockKey = provider.toLowerCase();
    this.activeLocks.delete(lockKey);
    logger.info(`[SYNC LOCK] Lock released for provider '${provider}'.`);
  }

  /**
   * Executes a sync worker function within a safe try/finally lock boundary.
   */
  public async executeWithLock<T>(provider: string, fn: () => Promise<T>): Promise<T | null> {
    if (!this.acquireLock(provider)) {
      return null;
    }
    try {
      return await fn();
    } finally {
      this.releaseLock(provider);
    }
  }
}

export const syncLockService = new SyncLockService();
