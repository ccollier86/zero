import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { createReactiveDB, ReactiveDB } from './reactive-db';
import { StateManager } from './state-manager';
import { STATE_LIMITS } from './types';

let db: ReactiveDB;
let mgr: StateManager;

beforeEach(() => {
  db = createReactiveDB({ mode: 'memory' });
  mgr = new StateManager(db);
});

afterEach(() => {
  db.dispose();
});

// ─── Basic CRUD ──────────────────────────────────────────────────────────────

describe('set / get', () => {
  test('set returns ok: true and value is readable', () => {
    const result = mgr.set('user1', 'theme', 'dark');
    expect(result).toEqual({ ok: true });
    expect(mgr.getUserState('user1').get('theme')).toBe('dark');
  });

  test('set overwrites existing key', () => {
    mgr.set('user1', 'theme', 'dark');
    mgr.set('user1', 'theme', 'light');
    expect(mgr.getUserState('user1').get('theme')).toBe('light');
  });

  test('supports all JSON value types', () => {
    mgr.set('user1', 'str', 'hello');
    mgr.set('user1', 'num', 42);
    mgr.set('user1', 'bool', true);
    mgr.set('user1', 'null', null);
    mgr.set('user1', 'arr', [1, 'two', false]);
    mgr.set('user1', 'obj', { nested: { deep: true } });

    const state = mgr.getUserState('user1');
    expect(state.get('str')).toBe('hello');
    expect(state.get('num')).toBe(42);
    expect(state.get('bool')).toBe(true);
    expect(state.get('null')).toBe(null);
    expect(state.get('arr')).toEqual([1, 'two', false]);
    expect(state.get('obj')).toEqual({ nested: { deep: true } });
  });

  test('getUserStateEntries returns plain object', () => {
    mgr.set('user1', 'a', 1);
    mgr.set('user1', 'b', 2);
    const entries = mgr.getUserStateEntries('user1');
    expect(entries).toEqual({ a: 1, b: 2 });
  });

  test('getUserState returns empty map for new user', () => {
    const state = mgr.getUserState('newuser');
    expect(state.size).toBe(0);
  });

  test('users are isolated from each other', () => {
    mgr.set('user1', 'theme', 'dark');
    mgr.set('user2', 'theme', 'light');
    expect(mgr.getUserState('user1').get('theme')).toBe('dark');
    expect(mgr.getUserState('user2').get('theme')).toBe('light');
  });
});

// ─── Delete ──────────────────────────────────────────────────────────────────

describe('delete', () => {
  test('removes existing key', () => {
    mgr.set('user1', 'theme', 'dark');
    mgr.delete('user1', 'theme');
    expect(mgr.getUserState('user1').has('theme')).toBe(false);
  });

  test('no-op for non-existent key', () => {
    mgr.delete('user1', 'nonexistent');
    expect(mgr.getUserState('user1').size).toBe(0);
  });

  test('only removes the specified key', () => {
    mgr.set('user1', 'a', 1);
    mgr.set('user1', 'b', 2);
    mgr.delete('user1', 'a');
    expect(mgr.getUserState('user1').has('a')).toBe(false);
    expect(mgr.getUserState('user1').get('b')).toBe(2);
  });
});

// ─── Clear ───────────────────────────────────────────────────────────────────

describe('clear', () => {
  test('removes all keys for a user', () => {
    mgr.set('user1', 'a', 1);
    mgr.set('user1', 'b', 2);
    mgr.set('user1', 'c', 3);
    mgr.clear('user1');
    expect(mgr.getUserState('user1').size).toBe(0);
  });

  test('does not affect other users', () => {
    mgr.set('user1', 'theme', 'dark');
    mgr.set('user2', 'theme', 'light');
    mgr.clear('user1');
    expect(mgr.getUserState('user1').size).toBe(0);
    expect(mgr.getUserState('user2').get('theme')).toBe('light');
  });

  test('no-op for user with no state', () => {
    mgr.clear('nonexistent');
    expect(mgr.getUserState('nonexistent').size).toBe(0);
  });
});

// ─── SQLite Durability ───────────────────────────────────────────────────────

describe('SQLite durability', () => {
  test('state survives manager recreation (loads from SQLite)', () => {
    mgr.set('user1', 'theme', 'dark');
    mgr.set('user1', 'lang', 'en');

    // Create new StateManager against same DB — simulates server restart
    const mgr2 = new StateManager(db);

    // RAM is empty, but SQLite has the data — should load on first access
    const entries = mgr2.getUserStateEntries('user1');
    expect(entries).toEqual({ theme: 'dark', lang: 'en' });
  });

  test('delete is durable across recreation', () => {
    mgr.set('user1', 'a', 1);
    mgr.set('user1', 'b', 2);
    mgr.delete('user1', 'a');

    const mgr2 = new StateManager(db);
    const entries = mgr2.getUserStateEntries('user1');
    expect(entries).toEqual({ b: 2 });
  });

  test('clear is durable across recreation', () => {
    mgr.set('user1', 'a', 1);
    mgr.set('user1', 'b', 2);
    mgr.clear('user1');

    const mgr2 = new StateManager(db);
    expect(mgr2.getUserState('user1').size).toBe(0);
  });

  test('overwrite is durable', () => {
    mgr.set('user1', 'counter', 1);
    mgr.set('user1', 'counter', 2);
    mgr.set('user1', 'counter', 3);

    const mgr2 = new StateManager(db);
    expect(mgr2.getUserState('user1').get('counter')).toBe(3);
  });
});

// ─── Limit Enforcement ───────────────────────────────────────────────────────

describe('limits', () => {
  test('KEY_TOO_LONG — rejects key exceeding maxKeyLength', () => {
    const longKey = 'k'.repeat(STATE_LIMITS.maxKeyLength + 1);
    const result = mgr.set('user1', longKey, 'value');
    expect(result).toEqual({ ok: false, error: 'KEY_TOO_LONG' });
  });

  test('key at exact limit is allowed', () => {
    const exactKey = 'k'.repeat(STATE_LIMITS.maxKeyLength);
    const result = mgr.set('user1', exactKey, 'value');
    expect(result).toEqual({ ok: true });
  });

  test('VALUE_TOO_LARGE — rejects value exceeding maxValueSize', () => {
    const largeValue = 'x'.repeat(STATE_LIMITS.maxValueSize + 1);
    const result = mgr.set('user1', 'big', largeValue);
    expect(result).toEqual({ ok: false, error: 'VALUE_TOO_LARGE' });
  });

  test('value at exact limit is allowed', () => {
    // maxValueSize is bytes of JSON.stringify — a string of length N becomes N+2 with quotes
    const value = 'x'.repeat(STATE_LIMITS.maxValueSize - 2);
    const result = mgr.set('user1', 'big', value);
    expect(result).toEqual({ ok: true });
  });

  test('TOO_MANY_KEYS — rejects when maxKeys exceeded', () => {
    for (let i = 0; i < STATE_LIMITS.maxKeys; i++) {
      const r = mgr.set('user1', `key_${i}`, i);
      expect(r.ok).toBe(true);
    }

    // One more should fail
    const result = mgr.set('user1', 'overflow', 'value');
    expect(result).toEqual({ ok: false, error: 'TOO_MANY_KEYS' });
  });

  test('overwriting existing key does not count as new key', () => {
    for (let i = 0; i < STATE_LIMITS.maxKeys; i++) {
      mgr.set('user1', `key_${i}`, i);
    }

    // Overwrite an existing key — should succeed
    const result = mgr.set('user1', 'key_0', 'updated');
    expect(result).toEqual({ ok: true });
  });

  test('TOTAL_SIZE_EXCEEDED — rejects when total size too large', () => {
    // maxValueSize is 64KB, maxTotalSize is 10MB.
    // Fill with many entries that individually stay under VALUE_TOO_LARGE
    // but together exceed maxTotalSize.
    // Each value: 60,000 chars → serialized ~60,002 bytes.
    // Each entry ≈ key(4 chars) + 60,002 ≈ 60,006 bytes.
    // Need ~175 entries to reach 10MB: 175 * 60,006 ≈ 10.5MB
    const fillValue = 'x'.repeat(60_000);
    let lastResult: { ok: boolean; error?: string } = { ok: true };
    for (let i = 0; i < 200; i++) {
      lastResult = mgr.set('user1', `k${i}`, fillValue);
      if (!lastResult.ok) break;
    }
    expect(lastResult).toEqual({ ok: false, error: 'TOTAL_SIZE_EXCEEDED' });
  });

  test('replacing a large value with a smaller one adjusts total', () => {
    // Fill up close to limit
    const bigValue = 'x'.repeat(STATE_LIMITS.maxTotalSize - 200);
    mgr.set('user1', 'big', bigValue);

    // Replace with smaller value
    mgr.set('user1', 'big', 'small');

    // Now we have lots of room — this should succeed
    const result = mgr.set('user1', 'extra', 'hello');
    expect(result).toEqual({ ok: true });
  });

  test('limits are per-user', () => {
    for (let i = 0; i < STATE_LIMITS.maxKeys; i++) {
      mgr.set('user1', `key_${i}`, i);
    }

    // user2 has independent limits
    const result = mgr.set('user2', 'key_0', 'value');
    expect(result).toEqual({ ok: true });
  });
});

// ─── Edge Cases ──────────────────────────────────────────────────────────────

describe('edge cases', () => {
  test('empty string key is valid', () => {
    const result = mgr.set('user1', '', 'empty-key');
    expect(result).toEqual({ ok: true });
    expect(mgr.getUserState('user1').get('')).toBe('empty-key');
  });

  test('empty string value is valid', () => {
    const result = mgr.set('user1', 'key', '');
    expect(result).toEqual({ ok: true });
    expect(mgr.getUserState('user1').get('key')).toBe('');
  });

  test('deeply nested JSON values are preserved', () => {
    const complex = {
      a: { b: { c: { d: [1, { e: true }] } } },
    };
    mgr.set('user1', 'deep', complex);
    expect(mgr.getUserState('user1').get('deep')).toEqual(complex);
  });

  test('unicode keys and values are handled', () => {
    mgr.set('user1', 'emoji_key', 'hello world');
    expect(mgr.getUserState('user1').get('emoji_key')).toBe('hello world');
  });

  test('set after clear works', () => {
    mgr.set('user1', 'a', 1);
    mgr.clear('user1');
    mgr.set('user1', 'b', 2);
    expect(mgr.getUserState('user1').size).toBe(1);
    expect(mgr.getUserState('user1').get('b')).toBe(2);
  });

  test('delete then set same key works', () => {
    mgr.set('user1', 'key', 'original');
    mgr.delete('user1', 'key');
    mgr.set('user1', 'key', 'new');
    expect(mgr.getUserState('user1').get('key')).toBe('new');
  });
});
