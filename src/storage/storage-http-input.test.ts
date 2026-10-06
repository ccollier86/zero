/** Exercises HTTP wildcard decoding without routing, authority, or persistence. */

import { describe, expect, test } from 'bun:test';

import { readStorageWildcardPath } from './storage-http-input';
import { encodeStoragePath } from './storage-paths';

describe('Storage HTTP wildcard paths', () => {
  test('round-trips encoded filenames and folder boundaries exactly once', () => {
    for (const path of [
      '/plain.txt',
      '/space folder/hello world.txt',
      '/unicode-✓-日本語.txt',
      '/percent%.txt',
      '/hash#query?plus+.txt',
      '/literal%20.txt',
      '/literal%2F.txt',
      '/literal%2520.txt',
    ]) {
      expect(readStorageWildcardPath({ '*': encodeStoragePath(path) })).toBe(path);
    }
    expect(readStorageWildcardPath({ '*': 'folder//file.txt' })).toBe('/folder/file.txt');
    expect(readStorageWildcardPath({ '*': 'plus+.txt' })).toBe('/plus+.txt');
  });

  test('distinguishes escaped-looking sibling names from decoded paths', () => {
    expect(readStorageWildcardPath({ '*': 'report%201.txt' })).toBe('/report 1.txt');
    expect(readStorageWildcardPath({ '*': 'report%25201.txt' })).toBe('/report%201.txt');
    expect(readStorageWildcardPath({ '*': 'folder/file.txt' })).toBe('/folder/file.txt');
    expect(readStorageWildcardPath({ '*': 'folder%252Ffile.txt' })).toBe('/folder%2Ffile.txt');
  });

  test('rejects malformed encodings, encoded separators, and decoded unsafe paths', () => {
    const invalidParams = [
      {},
      { '*': null },
      { '*': 1 },
      ...[
        '', '/', '%', '%2', '%GG', '%C3%28',
        'folder%2Ffile.txt', 'folder%2ffile.txt', 'folder%5Cfile.txt',
        'folder/%2E/file.txt', 'folder/%2E%2E/file.txt',
        'nul%00.txt', 'newline%0A.txt', 'delete%7F.txt',
        'folder/%2E%2E%5Cfile.txt',
        '%61'.repeat(256),
      ].map((wildcard) => ({ '*': wildcard })),
    ];
    for (const params of invalidParams) {
      expect(() => readStorageWildcardPath(params))
        .toThrow(expect.objectContaining({ code: 'STORAGE_INPUT_INVALID' }));
    }
  });
});
