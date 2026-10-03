/**
 * storage-input.ts
 *
 * Owns validation and canonicalization for logical Storage paths, metadata,
 * names, MIME policy, and numeric limits. It does not read Storage tables,
 * inspect adapters, or make authorization decisions.
 */

import {
  StorageDomainError,
  isStorageDomainError,
} from './storage-domain-error';

export const STORAGE_MAX_PATH_LENGTH = 1_024;
export const STORAGE_MAX_PATH_SEGMENTS = 64;
export const STORAGE_MAX_PATH_SEGMENT_LENGTH = 255;
export const STORAGE_MAX_METADATA_BYTES = 16_384;
export const STORAGE_MAX_METADATA_KEYS = 128;
export const STORAGE_MAX_METADATA_VALUES = 1_024;
export const STORAGE_MAX_METADATA_DEPTH = 32;
export const STORAGE_MAX_METADATA_KEY_LENGTH = 128;

const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/;
const UNSAFE_METADATA_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const STORAGE_IDENTIFIER = /^[A-Za-z][A-Za-z0-9_-]{0,199}$/u;

/** Normalize a server-reserved logical drive identifier. */
export function normalizeStorageDriveId(input: string): string {
  if (typeof input !== 'string' || !STORAGE_IDENTIFIER.test(input)) {
    throw invalidInput('Storage drive id is invalid.');
  }
  return input;
}

/** Normalize one logical object path and reject ambiguous/traversal input. */
export function normalizeStoragePath(
  input: string,
  options: Readonly<{ allowRoot?: boolean }> = {},
): string {
  if (typeof input !== 'string') throw invalidInput('Storage path must be a string.');
  if (input.length === 0 || input.length > STORAGE_MAX_PATH_LENGTH) {
    throw invalidInput(`Storage path must contain 1-${STORAGE_MAX_PATH_LENGTH} characters.`);
  }
  if (CONTROL_CHARACTER.test(input) || input.includes('\\')) {
    throw invalidInput('Storage path contains unsupported characters.');
  }

  const segments = input.split('/').filter((segment) => segment.length > 0);
  if (segments.length === 0) {
    if (options.allowRoot) return '/';
    throw invalidInput('Storage path must identify an object below the drive root.');
  }
  if (segments.length > STORAGE_MAX_PATH_SEGMENTS) {
    throw invalidInput(`Storage path may contain at most ${STORAGE_MAX_PATH_SEGMENTS} segments.`);
  }
  for (const segment of segments) {
    if (segment === '.' || segment === '..') {
      throw invalidInput('Storage path traversal segments are not allowed.');
    }
    if (segment.length > STORAGE_MAX_PATH_SEGMENT_LENGTH) {
      throw invalidInput(
        `Storage path segments may contain at most ${STORAGE_MAX_PATH_SEGMENT_LENGTH} characters.`,
      );
    }
    if (CONTROL_CHARACTER.test(segment)) {
      throw invalidInput('Storage path contains unsupported characters.');
    }
  }

  const normalized = `/${segments.join('/')}`;
  if (normalized.length > STORAGE_MAX_PATH_LENGTH) {
    throw invalidInput(`Storage path must contain at most ${STORAGE_MAX_PATH_LENGTH} characters.`);
  }
  return normalized;
}

/** Normalize a bounded, non-empty display name. */
export function normalizeStorageName(input: string, label = 'Storage name'): string {
  if (typeof input !== 'string') throw invalidInput(`${label} must be a string.`);
  const value = input.trim();
  if (value.length < 1 || value.length > 120 || CONTROL_CHARACTER.test(value)) {
    throw invalidInput(`${label} must contain 1-120 printable characters.`);
  }
  return value;
}

/** Normalize a byte limit; zero retains the established unlimited meaning. */
export function normalizeStorageByteLimit(input: number, label: string): number {
  if (!Number.isSafeInteger(input) || input < 0) {
    throw invalidInput(`${label} must be a non-negative safe integer.`);
  }
  return input;
}

/** Canonicalize and bound an allow-list used by drive MIME policy. */
export function normalizeStorageMimeTypes(input: readonly string[]): readonly string[] {
  if (!Array.isArray(input) || input.length < 1 || input.length > 128) {
    throw invalidInput('Allowed MIME types must contain 1-128 entries.');
  }
  const normalized = [...new Set(input.map((value) => {
    if (typeof value !== 'string') throw invalidInput('Allowed MIME types must be strings.');
    const mime = value.trim().toLowerCase();
    if (mime === '*') return mime;
    if (!/^[a-z0-9!#$&^_.+-]+\/(?:\*|[a-z0-9!#$&^_.+-]+)$/.test(mime)) {
      throw invalidInput('Allowed MIME type is invalid.');
    }
    return mime;
  }))];
  return normalized.includes('*') ? Object.freeze(['*']) : Object.freeze(normalized);
}

/** Serialize caller metadata through a bounded JSON-only contract. */
export function serializeStorageMetadata(input: Record<string, unknown>): string {
  try {
    validateMetadataValue(input);
    const json = JSON.stringify(input);
    if (new TextEncoder().encode(json).byteLength > STORAGE_MAX_METADATA_BYTES) {
      throw invalidMetadata(
        `Storage metadata may contain at most ${STORAGE_MAX_METADATA_BYTES} bytes.`,
      );
    }
    return json;
  } catch (error) {
    if (isStorageDomainError(error)) throw error;
    throw invalidMetadata('Storage metadata must contain valid JSON values.');
  }
}

/** Decode persisted metadata without allowing a corrupt row to leak a raw error. */
export function parseStorageMetadata(input: string): Record<string, unknown> {
  try {
    if (typeof input !== 'string'
      || new TextEncoder().encode(input).byteLength > STORAGE_MAX_METADATA_BYTES) {
      throw new TypeError('invalid');
    }
    const parsed: unknown = JSON.parse(input || '{}');
    validateMetadataValue(parsed);
    if (!isPlainRecord(parsed)) throw new TypeError('invalid');
    return parsed;
  } catch {
    throw new StorageDomainError(
      'STORAGE_INTERNAL',
      'Stored storage metadata is invalid.',
      { outcome: 'not-started' },
    );
  }
}

/** Parse caller-supplied JSON metadata through the bounded public contract. */
export function parseStorageMetadataInput(input: string): Record<string, unknown> {
  if (typeof input !== 'string'
    || new TextEncoder().encode(input).byteLength > STORAGE_MAX_METADATA_BYTES) {
    throw invalidMetadata(
      `Storage metadata may contain at most ${STORAGE_MAX_METADATA_BYTES} bytes.`,
    );
  }
  try {
    const parsed: unknown = JSON.parse(input);
    if (!isPlainRecord(parsed)) {
      throw invalidMetadata('Storage metadata must be a plain object.');
    }
    serializeStorageMetadata(parsed);
    return parsed;
  } catch (error) {
    if (isStorageDomainError(error)) throw error;
    throw invalidMetadata('Storage metadata must contain valid JSON.');
  }
}

/** Return the SQL LIKE parameter for strict descendants of a canonical path. */
export function storageDescendantLikePattern(canonicalPath: string): string {
  return `${canonicalPath.replace(/[\\%_]/g, (value) => `\\${value}`)}/%`;
}

/** Test whether `candidate` is a strict logical descendant of `ancestor`. */
export function isStoragePathDescendant(candidate: string, ancestor: string): boolean {
  return candidate.startsWith(`${ancestor}/`);
}

/** Return canonical object prefixes from the first segment through the target. */
export function storagePathPrefixes(canonicalPath: string): readonly string[] {
  const segments = canonicalPath.split('/').filter(Boolean);
  let current = '';
  return segments.map((segment) => {
    current += `/${segment}`;
    return current;
  });
}

function isPlainRecord(input: unknown): input is Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return false;
  const prototype = Object.getPrototypeOf(input);
  return prototype === Object.prototype || prototype === null;
}

function validateMetadataValue(input: unknown): void {
  const seen = new WeakSet<object>();
  let keyCount = 0;
  let valueCount = 0;

  const visit = (value: unknown, depth: number): void => {
    valueCount += 1;
    if (valueCount > STORAGE_MAX_METADATA_VALUES) {
      throw invalidMetadata(
        `Storage metadata may contain at most ${STORAGE_MAX_METADATA_VALUES} values.`,
      );
    }
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) {
        throw invalidMetadata('Storage metadata numbers must be finite.');
      }
      return;
    }
    if (typeof value !== 'object') {
      throw invalidMetadata('Storage metadata must contain JSON values only.');
    }
    if (depth > STORAGE_MAX_METADATA_DEPTH) {
      throw invalidMetadata(
        `Storage metadata may contain at most ${STORAGE_MAX_METADATA_DEPTH} nested levels.`,
      );
    }
    if (seen.has(value)) throw invalidMetadata('Storage metadata must not contain cycles.');
    seen.add(value);
    try {
      if (Array.isArray(value)) {
        for (const item of value) visit(item, depth + 1);
        return;
      }
      if (!isPlainRecord(value)) {
        throw invalidMetadata('Storage metadata objects must use a plain object prototype.');
      }
      const keys = Reflect.ownKeys(value);
      if (keys.some((key) => typeof key !== 'string')) {
        throw invalidMetadata('Storage metadata keys must be strings.');
      }
      for (const key of keys as string[]) {
        keyCount += 1;
        if (keyCount > STORAGE_MAX_METADATA_KEYS) {
          throw invalidMetadata(
            `Storage metadata may contain at most ${STORAGE_MAX_METADATA_KEYS} keys.`,
          );
        }
        if (key.length < 1
          || key.length > STORAGE_MAX_METADATA_KEY_LENGTH
          || CONTROL_CHARACTER.test(key)
          || UNSAFE_METADATA_KEYS.has(key)) {
          throw invalidMetadata('Storage metadata contains an invalid key.');
        }
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) {
          throw invalidMetadata('Storage metadata properties must be enumerable data values.');
        }
        visit(descriptor.value, depth + 1);
      }
    } finally {
      seen.delete(value);
    }
  };

  if (!isPlainRecord(input)) {
    throw invalidMetadata('Storage metadata must be a plain object.');
  }
  visit(input, 0);
}

function invalidInput(message: string): StorageDomainError {
  return new StorageDomainError('STORAGE_INPUT_INVALID', message);
}

function invalidMetadata(message: string): StorageDomainError {
  return new StorageDomainError('STORAGE_METADATA_INVALID', message);
}
