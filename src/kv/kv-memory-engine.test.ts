/**
 * kv-memory-engine.test.ts
 *
 * Verifies the first Zero KV/cache implementation slice: hot in-memory
 * behavior, TTL pruning, LRU eviction, counters, CAS, and batch helpers.
 */

import { describe, expect, test } from 'bun:test';

import { ManualKvClock, KvError, KvMemoryEngine } from './index';

describe('KvMemoryEngine', () => {
  test('stores and returns values with entry metadata', () => {
    const clock = new ManualKvClock(1000);
    const kv = new KvMemoryEngine({ clock });

    const entry = kv.set('user:1', { name: 'Ada' });

    expect(kv.get<{ name: string }>('user:1')).toEqual({ name: 'Ada' });
    expect(entry.key).toBe('user:1');
    expect(entry.kind).toBe('value');
    expect(entry.version).toBe(1);
    expect(entry.createdAt).toBe(1000);
    expect(entry.updatedAt).toBe(1000);
    expect(entry.expiresAt).toBeNull();
    expect(kv.stats().entries).toBe(1);
  });

  test('expires keys by ttl and omits expired entries from snapshots', () => {
    const clock = new ManualKvClock(0);
    const kv = new KvMemoryEngine({ clock, ttlBucketMs: 100 });

    kv.set('token', 'active', { ttlMs: 50 });
    expect(kv.get<string>('token')).toBe('active');

    clock.advance(51);

    expect(kv.get('token')).toBeUndefined();
    expect(kv.entries()).toEqual([]);
    expect(kv.stats().expiredEntries).toBe(1);
  });

  test('supports expire and persist without changing the value', () => {
    const clock = new ManualKvClock(10);
    const kv = new KvMemoryEngine({ clock });

    kv.set('session', 'ok');
    expect(kv.expire('session', 20)).toBe(true);
    expect(kv.getEntry('session')?.expiresAt).toBe(30);

    expect(kv.persist('session')).toBe(true);
    expect(kv.getEntry('session')?.expiresAt).toBeNull();

    clock.advance(100);
    expect(kv.get<string>('session')).toBe('ok');
  });

  test('evicts least recently used entries when maxEntries is exceeded', () => {
    const kv = new KvMemoryEngine({ maxEntries: 2 });

    kv.set('a', 1);
    kv.set('b', 2);
    expect(kv.get<number>('a')).toBe(1);
    kv.set('c', 3);

    expect(kv.get<number>('a')).toBe(1);
    expect(kv.get('b')).toBeUndefined();
    expect(kv.get<number>('c')).toBe(3);
    expect(kv.stats().evictedEntries).toBe(1);
  });

  test('compareAndSet enforces entry versions', () => {
    const kv = new KvMemoryEngine();
    const first = kv.set('feature', 'off');

    const conflict = kv.compareAndSet('feature', first.version + 1, 'on');
    expect(conflict.ok).toBe(false);
    expect(conflict.current).toBe('off');
    expect(kv.get<string>('feature')).toBe('off');

    const updated = kv.compareAndSet('feature', first.version, 'on');
    expect(updated.ok).toBe(true);
    expect(updated.value).toBe('on');
    expect(kv.get<string>('feature')).toBe('on');
  });

  test('supports numeric counters and rejects non-counter values', () => {
    const kv = new KvMemoryEngine();

    expect(kv.increment('requests')).toBe(1);
    expect(kv.increment('requests', 4)).toBe(5);
    expect(kv.decrement('requests', 2)).toBe(3);
    expect(kv.getEntry('requests')?.kind).toBe('counter');

    kv.set('name', 'Ada');
    expect(() => kv.increment('name')).toThrow(KvError);
  });

  test('supports setMany, getMany, and deleteMany helpers', () => {
    const kv = new KvMemoryEngine();

    kv.setMany([
      ['a', 1],
      ['b', 2],
      ['c', 3],
    ]);

    expect([...kv.getMany<number>(['a', 'c', 'missing']).entries()]).toEqual([
      ['a', 1],
      ['c', 3],
    ]);
    expect(kv.deleteMany(['a', 'missing', 'c'])).toBe(2);
    expect(kv.get('a')).toBeUndefined();
    expect(kv.get<number>('b')).toBe(2);
    expect(kv.get('c')).toBeUndefined();
  });

  test('validates keys, ttl, and memory limits', () => {
    expect(() => new KvMemoryEngine({ maxEntries: 0 })).toThrow(KvError);

    const kv = new KvMemoryEngine();
    expect(() => kv.set('', 'bad')).toThrow(KvError);
    expect(() => kv.set('bad-ttl', 'bad', { ttlMs: -1 })).toThrow(KvError);
  });
});
