/**
 * Narrow HTTP route values that Elysia has already schema-validated into the
 * exact Storage domain types consumed by the service layer. The checks remain
 * here so direct handler invocation and future schema drift still fail closed.
 */

import { StorageDomainError } from './storage-domain-error';
import type {
  GrantType,
  ListOptions,
  PermissionLevel,
} from './types';

export function readStorageWildcardPath(params: object): string {
  const wildcard: unknown = Reflect.get(params, '*');
  if (typeof wildcard !== 'string' || wildcard.length === 0) {
    throw invalidStorageHttpInput('Storage path is invalid.');
  }
  return `/${wildcard}`;
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
