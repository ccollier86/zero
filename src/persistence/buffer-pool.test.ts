/** Tests binary helper ownership/bounds entirely in memory. */

import { describe, expect, test } from 'bun:test';
import { BufferPool } from './buffer-pool';
import { resolveSQLiteStorageConfig } from './storage-config';

describe('buffer pool bounds and release', () => {
  for (const maxPoolSize of [0, 1, 4]) {
    test(`preallocation honors retained bucket limit ${maxPoolSize}`, () => {
      const pool = new BufferPool({ maxPoolSize });
      for (const bucket of Object.values(pool.stats())) expect(bucket.pooled).toBeLessThanOrEqual(maxPoolSize);
    });
  }

  test('zeroes a known released buffer even when its bucket is already full', () => {
    const pool = new BufferPool({ maxPoolSize: 1, preallocate: false });
    const first = pool.acquire(10);
    const second = pool.acquire(10);
    first.fill(1); second.fill(2);
    pool.release(first); pool.release(second);
    expect(first.every(value => value === 0)).toBe(true);
    expect(second.every(value => value === 0)).toBe(true);
    expect(pool.stats().TINY?.pooled).toBe(1);
  });

  test('unknown buffers are left alone and double release cannot retain duplicates', () => {
    const pool = new BufferPool({ maxPoolSize: 1, preallocate: false });
    const foreign = new Uint8Array([3]);
    pool.release(foreign);
    expect(foreign[0]).toBe(3);
    const known = pool.acquire(0);
    pool.release(known); pool.release(known);
    expect(pool.stats().TINY?.pooled).toBe(1);
    expect(pool.acquire(0)).toBe(known);
  });

  test('rejects invalid bucket limits and acquisition sizes without allocating', () => {
    for (const value of [-1, NaN, Infinity, 0.5]) {
      expect(() => new BufferPool({ maxPoolSize: value, preallocate: false })).toThrow();
      expect(() => resolveSQLiteStorageConfig({ bufferPool: { maxPoolSize: value } })).toThrow();
      expect(() => new BufferPool({ preallocate: false }).acquire(value)).toThrow();
    }
  });
});
