/**
 * Narrow HTTP route values into the exact Storage domain types consumed by
 * the service layer. Owns decoding and canonicalizing Elysia's raw wildcard
 * paths before authorization; does not inspect authority or mutate Storage.
 */

import { StorageDomainError } from './storage-domain-error';
import { normalizeStoragePath } from './storage-input';
import type {
  GrantType,
  ListOptions,
  PermissionLevel,
} from './types';

/** Decode raw HTTP path segments exactly once, then validate the logical path. */
export function readStorageWildcardPath(params: object): string {
  const wildcard: unknown = Reflect.get(params, '*');
  if (typeof wildcard !== 'string' || wildcard.length === 0) {
    throw invalidStorageHttpInput('Storage path is invalid.');
  }
  const segments = wildcard.split('/').map((segment) => {
    let decoded: string;
    try {
      decoded = decodeURIComponent(segment);
    } catch {
      throw invalidStorageHttpInput('Storage path encoding is invalid.');
    }
    // A transport segment must not create another logical folder boundary.
    // Literal percent-escape text remains a filename after this single decode.
    if (decoded.includes('/')) {
      throw invalidStorageHttpInput('Storage path contains an encoded separator.');
    }
    return decoded;
  });
  return normalizeStoragePath(`/${segments.join('/')}`);
}

export function readStorageListType(value: unknown): ListOptions['type'] {
  if (value === undefined || value === 'file' || value === 'folder' || value === 'all') {
    return value;
  }
  throw invalidStorageHttpInput('Storage object type filter is invalid.');
}

export function readStorageSortBy(value: unknown): ListOptions['sortBy'] {
  if (value === undefined
    || value === 'name'
    || value === 'size'
    || value === 'created_at'
    || value === 'updated_at') {
    return value;
  }
  throw invalidStorageHttpInput('Storage sort field is invalid.');
}

export function readStorageSortDirection(value: unknown): ListOptions['sortDir'] {
  if (value === undefined || value === 'asc' || value === 'desc') return value;
  throw invalidStorageHttpInput('Storage sort direction is invalid.');
}

export function readStorageGrantType(value: unknown): GrantType {
  if (value === 'role' || value === 'user' || value === 'property') return value;
  throw invalidStorageHttpInput('Storage permission grant type is invalid.');
}

export function readStoragePermissionLevel(value: unknown): PermissionLevel {
  if (value === 'read' || value === 'write' || value === 'admin') return value;
  throw invalidStorageHttpInput('Storage permission level is invalid.');
}

function invalidStorageHttpInput(message: string): StorageDomainError {
  return new StorageDomainError('STORAGE_INPUT_INVALID', message);
}
