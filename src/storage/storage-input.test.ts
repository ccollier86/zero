/** Focused bounds and canonicalization tests for hostile Storage input. */

import { describe, expect, test } from 'bun:test';

import {
  STORAGE_MAX_METADATA_KEYS,
  STORAGE_MAX_METADATA_VALUES,
  STORAGE_MAX_PATH_SEGMENTS,
  normalizeStoragePath,
  parseStorageMetadata,
  serializeStorageMetadata,
} from './storage-input';

describe('storage input boundaries', () => {
  test('canonicalizes ordinary paths and rejects root, traversal, controls, and excess segments', () => {
    expect(normalizeStoragePath('folder//file')).toBe('/folder/file');
    expect(normalizeStoragePath('/', { allowRoot: true })).toBe('/');
    expect(() => normalizeStoragePath('/')).toThrow();
    expect(() => normalizeStoragePath('/a/../b')).toThrow();
    expect(() => normalizeStoragePath('/a\u0000b')).toThrow();
    expect(() => normalizeStoragePath(`/${'x'.repeat(256)}`)).toThrow();
    expect(() => normalizeStoragePath(
      `/${Array.from({ length: STORAGE_MAX_PATH_SEGMENTS + 1 }, () => 'x').join('/')}`,
    )).toThrow();
  });

  test('bounds metadata structure, depth, values, keys, and serialized bytes', () => {
    const tooManyKeys = Object.fromEntries(
      Array.from({ length: STORAGE_MAX_METADATA_KEYS + 1 }, (_, index) => [`k${index}`, index]),
    );
    expect(() => serializeStorageMetadata(tooManyKeys)).toThrow();
    expect(() => serializeStorageMetadata({
      values: Array.from({ length: STORAGE_MAX_METADATA_VALUES + 1 }, () => null),
    })).toThrow();
    expect(() => serializeStorageMetadata({ value: 'x'.repeat(20_000) })).toThrow();

    let nested: Record<string, unknown> = {};
    const root = nested;
    for (let index = 0; index < 40; index += 1) {
      nested.child = {};
      nested = nested.child as Record<string, unknown>;
    }
    expect(() => serializeStorageMetadata(root)).toThrow();

    const accessor = {} as Record<string, unknown>;
    Object.defineProperty(accessor, 'secret', {
      enumerable: true,
      get() {
        throw new Error('hostile getter text');
      },
    });
    try {
      serializeStorageMetadata(accessor);
    } catch (error) {
      expect(error).toMatchObject({ code: 'STORAGE_METADATA_INVALID' });
      expect((error as Error).message).not.toContain('hostile getter text');
    }
  });

  test('normalizes corrupt persisted JSON into the safe Storage domain failure', () => {
    expect(() => parseStorageMetadata('{')).toThrow();
    try {
      parseStorageMetadata('{');
    } catch (error) {
      expect(error).toMatchObject({ code: 'STORAGE_INTERNAL' });
      expect(error).not.toBeInstanceOf(SyntaxError);
    }
  });
});
