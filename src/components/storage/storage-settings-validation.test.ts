import { expect, test } from 'bun:test';
import { parseStorageLimit } from './storage-format';

test('storage limit drafts cannot coerce malformed values into unlimited or unsafe bytes', () => {
  for (const value of [-1, '-100', 1.5, '1.5', Number.MAX_SAFE_INTEGER + 1,
    NaN, Infinity, 'not bytes', true, false, {}, [], '   ']) {
    expect(parseStorageLimit(value)).toBeUndefined();
  }
  expect(parseStorageLimit(0)).toBe(0);
  expect(parseStorageLimit('1024')).toBe(1024);
  expect(parseStorageLimit(' 2048 ')).toBe(2048);
  expect(parseStorageLimit(Number.MAX_SAFE_INTEGER)).toBe(Number.MAX_SAFE_INTEGER);
});
