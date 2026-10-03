/**
 * storage-error.ts
 *
 * Preserves Storage's legacy status-bearing service error while attaching the
 * canonical domain code used by newer engine and HTTP normalization layers.
 */

import {
  StorageDomainError,
  type StorageErrorCode,
} from './storage-domain-error';

/** Domain error used by legacy storage routes to select an HTTP status. */
export class StorageError extends StorageDomainError {
  constructor(
    public status: number,
    message: string,
    code: StorageErrorCode = legacyStorageErrorCode(status),
  ) {
    super(code, message);
    this.name = 'StorageError';
  }
}

function legacyStorageErrorCode(status: number): StorageErrorCode {
  switch (status) {
    case 400:
      return 'STORAGE_INPUT_INVALID';
    case 401:
      return 'STORAGE_AUTHENTICATION_REQUIRED';
    case 403:
      return 'STORAGE_AUTHORITY_REQUIRED';
    case 404:
      return 'STORAGE_NOT_FOUND';
    case 409:
      return 'STORAGE_CONFLICT';
    case 413:
      return 'STORAGE_LIMIT_EXCEEDED';
    case 415:
      return 'STORAGE_CONTENT_TYPE_UNSUPPORTED';
    case 416:
      return 'STORAGE_RANGE_NOT_SATISFIABLE';
    case 503:
      return 'STORAGE_PROVIDER_UNAVAILABLE';
    default:
      return 'STORAGE_INTERNAL';
  }
}
