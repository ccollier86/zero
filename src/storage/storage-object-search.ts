/** Bounded literal search normalization for server-side object listings. */

import { StorageDomainError } from './storage-domain-error';

export const STORAGE_MAX_OBJECT_SEARCH_LENGTH = 200;
export const STORAGE_MAX_OBJECT_LIST_OFFSET = 1_000_000_000;

const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/u;

/** Return an escaped SQL LIKE substring pattern, or null for an omitted search. */
export function storageObjectSearchLikePattern(
  input: string | undefined,
): string | null {
  if (input === undefined) return null;
  if (typeof input !== 'string') throw invalidSearch();
  const normalized = input.trim();
  if (normalized.length === 0) return null;
  if (normalized.length > STORAGE_MAX_OBJECT_SEARCH_LENGTH
    || CONTROL_CHARACTER.test(normalized)) {
    throw invalidSearch();
  }
  return `%${normalized.replace(/[\\%_]/gu, (value) => `\\${value}`)}%`;
}

/** Decode the opaque numeric list cursor without permissive parseInt fallbacks. */
export function storageObjectListOffset(cursor: string | undefined): number {
  if (cursor === undefined) return 0;
  if (!/^(?:0|[1-9][0-9]*)$/u.test(cursor)) throw invalidCursor();
  const offset = Number(cursor);
  if (!Number.isSafeInteger(offset) || offset > STORAGE_MAX_OBJECT_LIST_OFFSET) {
    throw invalidCursor();
  }
  return offset;
}

function invalidSearch(): StorageDomainError {
  return new StorageDomainError(
    'STORAGE_INPUT_INVALID',
    `Storage search must contain at most ${STORAGE_MAX_OBJECT_SEARCH_LENGTH} printable characters.`,
  );
}

function invalidCursor(): StorageDomainError {
  return new StorageDomainError(
    'STORAGE_INPUT_INVALID',
    `Storage list cursor must be a canonical integer from 0 to ${STORAGE_MAX_OBJECT_LIST_OFFSET}.`,
  );
}
