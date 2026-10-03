/** Privacy-safe normalization for failures crossing a StorageAdapter boundary. */

import {
  StorageDomainError,
  isStorageDomainError,
} from './storage-domain-error';

export function normalizeStorageProviderWriteError(cause: unknown): StorageDomainError {
  if (isStorageDomainError(cause)) return cause;
  if (cause instanceof TypeError || cause instanceof RangeError) {
    return new StorageDomainError(
      'STORAGE_INPUT_INVALID',
      'Storage upload input is invalid.',
      { cause, outcome: 'not-committed' },
    );
  }
  return unavailable(cause, 'Storage provider could not stage the upload.');
}

export function normalizeStorageProviderReadError(cause: unknown): StorageDomainError {
  if (isStorageDomainError(cause)) return cause;
  return unavailable(cause, 'Storage provider could not read the requested object.');
}

function unavailable(cause: unknown, message: string): StorageDomainError {
  return new StorageDomainError(
    'STORAGE_PROVIDER_UNAVAILABLE',
    message,
    { cause, retryable: true, outcome: 'not-committed' },
  );
}
