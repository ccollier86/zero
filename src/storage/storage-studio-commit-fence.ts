/** Canonical live-authority fence used by delayed Storage Studio commits. */

import { StorageDomainError } from './storage-domain-error';

export type StorageStudioCommitFence = () => void;

/** Convert any revoked/invalid live credential into Storage's closed contract. */
export function assertStorageStudioCommitAuthority(
  fence?: StorageStudioCommitFence,
): void {
  if (!fence) return;
  try {
    fence();
  } catch (cause) {
    throw storageStudioAuthorityChanged(cause);
  }
}

export function storageStudioAuthorityChanged(cause?: unknown): StorageDomainError {
  return new StorageDomainError(
    'STORAGE_AUTHORITY_CHANGED',
    'Storage Studio authority changed before commit.',
    { cause, outcome: 'not-committed' },
  );
}
