import { describe, expect, test } from 'bun:test';
import { DataStudioRowPageLru } from './data-studio-row-page-lru';

describe('Data Studio row-page LRU budget', () => {
  test('enforces entry and byte budgets while retaining the just-admitted key', () => {
    const lru = new DataStudioRowPageLru(2, 10);
    expect(lru.record('a', 4)).toEqual({ accepted: true, evictedKeys: [] });
    expect(lru.record('b', 4)).toEqual({ accepted: true, evictedKeys: [] });
    expect(lru.touch('a')).toBe(true);

    expect(lru.record('c', 4)).toEqual({ accepted: true, evictedKeys: ['b'] });
    expect(lru.touch('c')).toBe(true);
    expect(lru.touch('b')).toBe(false);

    expect(lru.record('d', 8)).toEqual({
      accepted: true,
      evictedKeys: ['a', 'c'],
    });
    expect(lru.touch('d')).toBe(true);
    expect(lru.record('oversized', 11)).toEqual({ accepted: false, evictedKeys: [] });
    expect(lru.touch('d')).toBe(true);
  });

  test('drops all recency metadata at an authorization-scope boundary', () => {
    const lru = new DataStudioRowPageLru(2, 10);
    lru.record('scope-a', 4);
    lru.clear();

    expect(lru.touch('scope-a')).toBe(false);
    expect(lru.record('scope-b', 4)).toEqual({ accepted: true, evictedKeys: [] });
  });
});
