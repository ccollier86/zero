/** Shared work bounds for opportunistic native-auth persistence cleanup. */

export const NATIVE_STORE_CLEANUP_BATCH_SIZE = 100;

export function requireCleanupBatchSize(value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error('[native-auth] Cleanup batch size must be a positive integer.');
  }
  return value;
}
