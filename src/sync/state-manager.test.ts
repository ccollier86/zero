import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
  test('records exactly one durable internal change per logical mutation', () => {
    mgr.set('user1', 'theme', 'dark');
    mgr.delete('user1', 'theme');
    mgr.clear('user1');

    const changes = db.getChangesAfter(0);
    expect(changes?.map((change) => [change.seq, change.table, change.op])).toEqual([
      [1, '_user_state', 'INSERT'],
      [2, '_user_state', 'DELETE'],
      [3, '_user_state', 'DELETE'],
    ]);
    expect(db.currentSeq).toBe(3);
  });

  test('keeps state and its durable event in main when a temp table shadows it', () => {
    const raw = db.getRawDatabase();
    raw.run(`
      CREATE TEMP TABLE _user_state (
        user_id TEXT NOT NULL,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (user_id, key)
      )
    `);

    expect(mgr.set('user1', 'theme', 'dark')).toEqual({ ok: true });
    expect(mgr.getUserStateEntries('user1')).toEqual({ theme: 'dark' });
    expect(raw.prepare(
      'SELECT user_id, key, value FROM main._user_state',
    ).all()).toEqual([{
      user_id: 'user1',
      key: 'theme',
      value: '"dark"',
    }]);
    expect(raw.prepare(
      'SELECT COUNT(*) AS count FROM temp._user_state',
    ).get()).toEqual({ count: 0 });
    expect(db.getChangesAfter(0)?.map((change) => [
      change.table,
      change.op,
      change.rowId,
    ])).toEqual([['_user_state', 'INSERT', '["user1","theme"]']]);
  });

  test('records the prior State payload when replacing an existing key', () => {
    mgr.set('user1', 'theme', 'dark');
    mgr.set('user1', 'theme', 'light');

    const replacement = db.getChangesAfter(1)?.[0];
    expect(replacement).toMatchObject({
      seq: 2,
      table: '_user_state',
      op: 'UPDATE',
      row: {
        state_event_version: 1,
        state_op: 'set',
        user_id: 'user1',
        key: 'theme',
        value: 'light',
      },
      previousRow: {
        state_event_version: 1,
        state_op: 'set',
        user_id: 'user1',
        key: 'theme',
        value: 'dark',
      },
    });
  });

  test('does not overwrite a corrupt existing value or allocate a sequence', () => {
    mgr.set('user1', 'theme', 'dark');
    db.prepare(
      'UPDATE _user_state SET value = ? WHERE user_id = ? AND key = ?',
    ).run('{invalid', 'user1', 'theme');

    expect(mgr.set('user1', 'theme', 'light')).toEqual({
      ok: false,
      error: 'INVALID_REQUEST',
    });
    expect(db.currentSeq).toBe(1);
    expect(db.prepare(
      'SELECT value FROM _user_state WHERE user_id = ? AND key = ?',
    ).get('user1', 'theme')).toEqual({ value: '{invalid' });
  });

  test('rolls back the raw state row when durable event recording fails', () => {
    const recordInternalChange = db.recordInternalChange.bind(db);
    db.recordInternalChange = (() => {
      throw new Error('forced state event failure');
    }) as typeof db.recordInternalChange;

    try {
      expect(() => mgr.set('user1', 'theme', 'dark')).toThrow(
        'forced state event failure',
      );
    } finally {
      db.recordInternalChange = recordInternalChange;
    }

    expect(mgr.getUserStateEntries('user1')).toEqual({});
    expect(db.currentSeq).toBe(0);
  });

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

describe('shared-file authority', () => {
  test('reads remote commits immediately without waiting for replica polling', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'zero-state-manager-shared-'));
    const path = join(directory, 'app.sqlite');
    const firstDb = createReactiveDB({ mode: path, busyTimeout: 10_000 });
    const secondDb = createReactiveDB({ mode: path, busyTimeout: 10_000 });
    const first = new StateManager(firstDb);
    const second = new StateManager(secondDb);

    try {
      expect(first.getUserStateEntries('shared')).toEqual({});
      expect(second.set('shared', 'remote', 1)).toEqual({ ok: true });
      expect(first.getUserStateEntries('shared')).toEqual({ remote: 1 });

      expect(first.set('shared', 'local', 2)).toEqual({ ok: true });
      expect(second.getUserStateEntries('shared')).toEqual({
        remote: 1,
        local: 2,
      });
    } finally {
      second.dispose();
      first.dispose();
      secondDb.dispose();
      firstDb.dispose();
      await rm(directory, { recursive: true, force: true });
    }
  });

  test('validates key limits against SQLite rather than a stale RAM projection', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'zero-state-manager-limit-'));
    const path = join(directory, 'app.sqlite');
    const firstDb = createReactiveDB({ mode: path, busyTimeout: 10_000 });
    const secondDb = createReactiveDB({ mode: path, busyTimeout: 10_000 });
    const first = new StateManager(firstDb);
    const second = new StateManager(secondDb);

    try {
      expect(first.getUserStateEntries('shared')).toEqual({});
      secondDb.exec(`
        WITH RECURSIVE keys(value) AS (
          SELECT 0
          UNION ALL
          SELECT value + 1 FROM keys WHERE value + 1 < ${STATE_LIMITS.maxKeys}
        )
        INSERT INTO _user_state (user_id, key, value, updated_at)
        SELECT 'shared', 'key_' || value, '0', 0 FROM keys
      `);

      expect(first.set('shared', 'overflow', true)).toEqual({
        ok: false,
        error: 'TOO_MANY_KEYS',
      });
      expect(second.getUserState('shared').size).toBe(STATE_LIMITS.maxKeys);
    } finally {
      second.dispose();
      first.dispose();
      secondDb.dispose();
      firstDb.dispose();
      await rm(directory, { recursive: true, force: true });
    }
  });
});

describe('authorization commit boundaries', () => {
  test('validates set, delete, and clear inside their write transaction', () => {
    expect(mgr.set('user1', 'existing', 'value')).toEqual({ ok: true });
    const baseline = db.currentSeq;
    const observed: boolean[] = [];
    const deny = () => {
      observed.push(db.getRawDatabase().inTransaction);
      return false;
    };

    expect(mgr.set('user1', 'blocked', true, deny)).toEqual({
      ok: false,
      error: 'UNAUTHORIZED',
    });
    expect(mgr.delete('user1', 'existing', deny)).toEqual({
      ok: false,
      error: 'UNAUTHORIZED',
    });
    expect(mgr.clear('user1', deny)).toEqual({
      ok: false,
      error: 'UNAUTHORIZED',
    });

    expect(observed).toEqual([true, true, true]);
    expect(db.currentSeq).toBe(baseline);
    expect(mgr.getUserStateEntries('user1')).toEqual({ existing: 'value' });
  });

  test('validates snapshot authority inside the represented read snapshot', () => {
    expect(mgr.set('user1', 'secret', 'value')).toEqual({ ok: true });
    let observedTransaction = false;

    const snapshot = mgr.getUserStateSnapshot('user1', () => {
      observedTransaction = db.getRawDatabase().inTransaction;
      return false;
    });

    expect(observedTransaction).toBe(true);
    expect(snapshot).toBeNull();
  });

  test('fails closed when a boundary authority resolver throws', () => {
    const baseline = db.currentSeq;
    const fail = () => {
      expect(db.getRawDatabase().inTransaction).toBe(true);
      throw new Error('authority store unavailable');
    };

    expect(mgr.set('user1', 'blocked', 'value', fail)).toEqual({
      ok: false,
      error: 'UNAUTHORIZED',
    });
    expect(mgr.getUserStateSnapshot('user1', fail)).toBeNull();
    expect(db.currentSeq).toBe(baseline);
  });
});

// ─── Limit Enforcement ───────────────────────────────────────────────────────

describe('limits', () => {
  test('KEY_TOO_LONG — rejects key exceeding maxKeyLength', () => {
    const longKey = 'k'.repeat(STATE_LIMITS.maxKeyLength + 1);
    const result = mgr.set('user1', longKey, 'value');
    expect(result).toEqual({ ok: false, error: 'KEY_TOO_LONG' });
  });

  test('delete applies the same key limit without writing a durable event', () => {
    const baseline = db.currentSeq;
    const result = mgr.delete(
      'user1',
      'k'.repeat(STATE_LIMITS.maxKeyLength + 1),
    );

    expect(result).toEqual({ ok: false, error: 'KEY_TOO_LONG' });
    expect(db.currentSeq).toBe(baseline);
    expect(db.getChangesAfter(baseline)).toEqual([]);
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

  test('measures serialized value limits in UTF-8 bytes', () => {
    const withinLimit = '😀'.repeat(16_383); // 65,534 bytes including JSON quotes
    const overLimit = '😀'.repeat(16_384); // 65,538 bytes including JSON quotes

    expect(mgr.set('user1', 'within', withinLimit)).toEqual({ ok: true });
    expect(mgr.set('user1', 'over', overLimit)).toEqual({
      ok: false,
      error: 'VALUE_TOO_LARGE',
    });
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

  test('counts multibyte key bytes toward the total-size limit', () => {
    const fillValue = 'x'.repeat(60_000);
    for (let index = 0; index < 173; index += 1) {
      expect(mgr.set('user1', `${'é'.repeat(250)}${index}`, fillValue)).toEqual({
        ok: true,
      });
    }

    // UTF-16 string lengths would leave this final entry just under 10 MB;
    // UTF-8 byte accounting correctly rejects it.
    expect(mgr.set('user1', `${'é'.repeat(250)}173`, fillValue)).toEqual({
      ok: false,
      error: 'TOTAL_SIZE_EXCEEDED',
    });
  });

  test('replacing a large value with a smaller one adjusts total', () => {
    const fillValue = 'x'.repeat(60_000);
    for (let index = 0; index < 174; index += 1) {
      expect(mgr.set('user1', `k${index}`, fillValue)).toEqual({ ok: true });
    }
    expect(mgr.set('user1', 'overflow', fillValue)).toEqual({
      ok: false,
      error: 'TOTAL_SIZE_EXCEEDED',
    });

    expect(mgr.set('user1', 'k0', 'small')).toEqual({ ok: true });
    expect(mgr.set('user1', 'extra', fillValue)).toEqual({ ok: true });
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
  test('prototype-like keys remain own snapshot entries', () => {
    expect(mgr.set('user1', '__proto__', { safe: true })).toEqual({ ok: true });
    expect(mgr.set('user1', 'constructor', 'stored')).toEqual({ ok: true });
    expect(mgr.set('user1', 'toString', 'also-stored')).toEqual({ ok: true });

    const entries = mgr.getUserStateEntries('user1');
    expect(Object.getPrototypeOf(entries)).toBeNull();
    expect(Object.keys(entries).sort()).toEqual(['__proto__', 'constructor', 'toString'].sort());
    const unsafeNames = entries as Record<string, unknown>;
    expect(unsafeNames['__proto__']).toEqual({ safe: true });
    expect(unsafeNames['constructor']).toBe('stored');
    expect(unsafeNames['toString']).toBe('also-stored');
    expect(JSON.parse(JSON.stringify(entries))).toEqual(JSON.parse(
      '{"__proto__":{"safe":true},"constructor":"stored","toString":"also-stored"}',
    ));
  });

  test('rejects non-JSON direct values without advancing durable state', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    const accessor: Record<string, unknown> = {};
    Object.defineProperty(accessor, 'value', {
      enumerable: true,
      get() {
        throw new Error('must not escape validation');
      },
    });
    const sparse: unknown[] = [];
    sparse.length = 1;
    const baseline = db.currentSeq;

    expect(mgr.set('user1', 'missing', undefined as never)).toEqual({
      ok: false,
      error: 'INVALID_REQUEST',
    });
    expect(mgr.set('user1', 'nan', Number.NaN as never)).toEqual({
      ok: false,
      error: 'INVALID_REQUEST',
    });
    expect(mgr.set('user1', 'cycle', cyclic as never)).toEqual({
      ok: false,
      error: 'INVALID_REQUEST',
    });
    expect(mgr.set('user1', 'accessor', accessor as never)).toEqual({
      ok: false,
      error: 'INVALID_REQUEST',
    });
    expect(mgr.set('user1', 'sparse', sparse as never)).toEqual({
      ok: false,
      error: 'INVALID_REQUEST',
    });
    expect(db.currentSeq).toBe(baseline);
  });

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
