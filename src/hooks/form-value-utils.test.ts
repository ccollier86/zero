/**
 * form-value-utils.test.ts
 *
 * Verifies internal form value comparison behavior used by dirty-state
 * detection. React hook behavior is covered by integration paths.
 */

import { describe, expect, test } from 'bun:test';

import { areFormValuesEqual } from './form-value-utils';

describe('areFormValuesEqual', () => {
  test('compares primitive values with Object.is semantics', () => {
    expect(areFormValuesEqual('a', 'a')).toBe(true);
    expect(areFormValuesEqual(1, 1)).toBe(true);
    expect(areFormValuesEqual(Number.NaN, Number.NaN)).toBe(true);
    expect(areFormValuesEqual('1', 1)).toBe(false);
  });

  test('compares nested arrays and plain objects structurally', () => {
    expect(areFormValuesEqual(
      { tags: ['a', 'b'], nested: { ok: true } },
      { tags: ['a', 'b'], nested: { ok: true } },
    )).toBe(true);

    expect(areFormValuesEqual(
      { tags: ['a', 'b'], nested: { ok: true } },
      { tags: ['b', 'a'], nested: { ok: true } },
    )).toBe(false);
  });

  test('compares dates by timestamp', () => {
    expect(areFormValuesEqual(
      new Date('2026-07-01T00:00:00.000Z'),
      new Date('2026-07-01T00:00:00.000Z'),
    )).toBe(true);

    expect(areFormValuesEqual(
      new Date('2026-07-01T00:00:00.000Z'),
      new Date('2026-07-02T00:00:00.000Z'),
    )).toBe(false);
  });
});
