/** Validation helpers for public signed Storage capability routes. */

import { StorageDomainError } from './storage-domain-error';

export function readStorageContentLength(request: Request): number | undefined {
  const value = request.headers.get('content-length');
  if (value === null) return undefined;
  if (!/^(?:0|[1-9][0-9]*)$/u.test(value)) throw invalidContentLength();
  const length = Number(value);
  if (!Number.isSafeInteger(length)) throw invalidContentLength();
  return length;
}

export function storageContentTypeMatches(actual: string, expected: string): boolean {
  const actualType = actual.split(';')[0].trim().toLowerCase();
  const expectedType = expected.split(';')[0].trim().toLowerCase();
  if (expectedType === '*') return true;
  if (expectedType.endsWith('/*')) {
    return actualType.startsWith(`${expectedType.slice(0, -2)}/`);
  }
  return actualType === expectedType;
}

export function storageContentTypeMatchesAny(
  actual: string,
  expected: readonly string[],
): boolean {
  return expected.some((item) => storageContentTypeMatches(actual, item));
}

export function invalidStorageCapability(): StorageDomainError {
  return new StorageDomainError(
    'STORAGE_CAPABILITY_INVALID',
    'Storage capability is invalid or expired.',
  );
}

function invalidContentLength(): StorageDomainError {
  return new StorageDomainError(
    'STORAGE_INPUT_INVALID',
    'Content-Length is invalid.',
  );
}
