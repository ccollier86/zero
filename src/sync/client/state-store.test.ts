import { describe, test, expect } from 'bun:test';
import {
  createStateStore,
  routeStateMessage,
  type StateStore,
  type StateStoreContext,
} from './state-store';
import type { JsonValue, PendingStateOp } from '../types';

// ─── Helpers ───────────────────────────────────────────────────────────────

function getCtx(store: StateStore): StateStoreContext {
  return store.getSnapshot().context as StateStoreContext;
}

function getEntry(
  entries: Readonly<Record<string, JsonValue>>,
  key: string,
): JsonValue | undefined {
  return entries[key];
}

// ─── createStateStore ──────────────────────────────────────────────────────

describe('createStateStore', () => {
  test('initializes with empty entries, not ready, no pending', () => {
    const store = createStateStore();
    const ctx = getCtx(store);
    expect(ctx.entries).toEqual({});
    expect(ctx.ready).toBe(false);
    expect(ctx.pending).toEqual([]);
  });
});

// ─── state.snapshot ────────────────────────────────────────────────────────

describe('state.snapshot', () => {
  test('replaces entries and sets ready', () => {
    const store = createStateStore();

    store.send({
      type: 'state.snapshot' as const,
      entries: { theme: 'dark', lang: 'en' },
    } as any);

    const ctx = getCtx(store);
    expect(ctx.entries).toEqual({ theme: 'dark', lang: 'en' });
    expect(ctx.ready).toBe(true);
  });

  test('clears pending on snapshot', () => {
    const store = createStateStore();

    // Add optimistic
    store.send({
      type: 'state.optimistic-set' as const,
      ref: 'ref-1',
      key: 'theme',
      value: 'dark',
    } as any);
    expect(getCtx(store).pending).toHaveLength(1);

    // Snapshot clears pending
    store.send({
      type: 'state.snapshot' as const,
      entries: { theme: 'light' },
    } as any);

    expect(getCtx(store).pending).toEqual([]);
    expect(getCtx(store).entries.theme).toBe('light');
  });

  test('empty snapshot clears all entries', () => {
    const store = createStateStore();

    store.send({
      type: 'state.snapshot' as const,
      entries: { a: 1, b: 2 },
    } as any);

    store.send({
      type: 'state.snapshot' as const,
      entries: {},
    } as any);

    expect(getCtx(store).entries).toEqual({});
    expect(getCtx(store).ready).toBe(true);
  });
});

// ─── state.change ──────────────────────────────────────────────────────────

describe('state.change', () => {
  test('set adds/updates a key', () => {
    const store = createStateStore();

    store.send({
      type: 'state.change' as const,
      op: 'set',
      key: 'theme',
      value: 'dark',
    } as any);

    expect(getCtx(store).entries.theme).toBe('dark');
  });

  test('set overwrites existing key', () => {
    const store = createStateStore();

    store.send({
      type: 'state.change' as const,
      op: 'set',
      key: 'theme',
      value: 'dark',
    } as any);

    store.send({
      type: 'state.change' as const,
      op: 'set',
      key: 'theme',
      value: 'light',
    } as any);

    expect(getCtx(store).entries.theme).toBe('light');
  });

  test('set with null key is a no-op', () => {
    const store = createStateStore();

    store.send({
      type: 'state.change' as const,
      op: 'set',
      key: null,
      value: 'test',
    } as any);

    expect(Object.keys(getCtx(store).entries)).toHaveLength(0);
  });

  test('delete removes a key', () => {
    const store = createStateStore();

    store.send({
      type: 'state.snapshot' as const,
      entries: { a: 1, b: 2 },
    } as any);

    store.send({
      type: 'state.change' as const,
      op: 'delete',
      key: 'a',
      value: undefined,
    } as any);

    expect(getCtx(store).entries).toEqual({ b: 2 });
  });

  test('delete with null key is a no-op', () => {
    const store = createStateStore();

    store.send({
      type: 'state.snapshot' as const,
      entries: { a: 1 },
    } as any);

    store.send({
      type: 'state.change' as const,
      op: 'delete',
      key: null,
      value: undefined,
    } as any);

    expect(getCtx(store).entries).toEqual({ a: 1 });
  });

  test('clear removes all entries', () => {
    const store = createStateStore();

    store.send({
      type: 'state.snapshot' as const,
      entries: { a: 1, b: 2, c: 3 },
    } as any);

    store.send({
      type: 'state.change' as const,
      op: 'clear',
      key: null,
      value: undefined,
    } as any);

    expect(getCtx(store).entries).toEqual({});
  });

  test('delete on non-existent key is a no-op', () => {
    const store = createStateStore();

    store.send({
      type: 'state.change' as const,
      op: 'delete',
      key: 'nonexistent',
      value: undefined,
    } as any);

    expect(getCtx(store).entries).toEqual({});
  });
});

// ─── Optimistic set ─────────────────────────────────────────────────────────

describe('state.optimistic-set', () => {
  test('applies value and creates pending entry', () => {
    const store = createStateStore();

    store.send({
      type: 'state.optimistic-set' as const,
      ref: 'ref-1',
      key: 'theme',
      value: 'dark',
    } as any);

    const ctx = getCtx(store);
    expect(ctx.entries.theme).toBe('dark');
    expect(ctx.pending).toHaveLength(1);
    expect(ctx.pending[0].ref).toBe('ref-1');
    expect(ctx.pending[0].op).toBe('set');
    expect(ctx.pending[0].key).toBe('theme');
    expect(ctx.pending[0].previousValue).toBeUndefined();
  });

  test('captures previous value when overwriting', () => {
    const store = createStateStore();

    store.send({
      type: 'state.snapshot' as const,
      entries: { theme: 'light' },
    } as any);

    store.send({
      type: 'state.optimistic-set' as const,
      ref: 'ref-1',
      key: 'theme',
      value: 'dark',
    } as any);

    const ctx = getCtx(store);
    expect(ctx.entries.theme).toBe('dark');
    expect(ctx.pending[0].previousValue).toBe('light');
  });
});

// ─── Optimistic delete ──────────────────────────────────────────────────────

describe('state.optimistic-delete', () => {
  test('removes key and creates pending entry', () => {
    const store = createStateStore();

    store.send({
      type: 'state.snapshot' as const,
      entries: { theme: 'dark', lang: 'en' },
    } as any);

    store.send({
      type: 'state.optimistic-delete' as const,
      ref: 'ref-1',
      key: 'theme',
    } as any);

    const ctx = getCtx(store);
    expect(ctx.entries).toEqual({ lang: 'en' });
    expect(ctx.pending).toHaveLength(1);
    expect(ctx.pending[0].previousValue).toBe('dark');
  });

  test('delete on non-existent key records undefined previousValue', () => {
    const store = createStateStore();

    store.send({
      type: 'state.optimistic-delete' as const,
      ref: 'ref-1',
      key: 'missing',
    } as any);

    const ctx = getCtx(store);
    expect(ctx.pending[0].previousValue).toBeUndefined();
  });
});

// ─── Optimistic clear ───────────────────────────────────────────────────────

describe('state.optimistic-clear', () => {
  test('clears all entries and captures previousEntries', () => {
    const store = createStateStore();

    store.send({
      type: 'state.snapshot' as const,
      entries: { a: 1, b: 2, c: 3 },
    } as any);

    store.send({
      type: 'state.optimistic-clear' as const,
      ref: 'ref-1',
    } as any);

    const ctx = getCtx(store);
    expect(ctx.entries).toEqual({});
    expect(ctx.pending).toHaveLength(1);
    expect(ctx.pending[0].op).toBe('clear');
    expect(ctx.pending[0].previousEntries).toEqual({ a: 1, b: 2, c: 3 });
  });

  test('clear on empty state records empty previousEntries', () => {
    const store = createStateStore();

    store.send({
      type: 'state.optimistic-clear' as const,
      ref: 'ref-1',
    } as any);

    expect(getCtx(store).pending[0].previousEntries).toEqual({});
  });
});

// ─── Ack / Rollback ─────────────────────────────────────────────────────────

describe('state.ack', () => {
  test('ok=true removes pending entry, keeps state', () => {
    const store = createStateStore();

    store.send({
      type: 'state.optimistic-set' as const,
      ref: 'ref-1',
      key: 'theme',
      value: 'dark',
    } as any);

    store.send({
      type: 'state.ack' as const,
      ref: 'ref-1',
      ok: true,
    } as any);

    const ctx = getCtx(store);
    expect(ctx.pending).toHaveLength(0);
    expect(ctx.entries.theme).toBe('dark');
  });

  test('ok=false for set rolls back — restores previous value', () => {
    const store = createStateStore();

    store.send({
      type: 'state.snapshot' as const,
      entries: { theme: 'light' },
    } as any);

    store.send({
      type: 'state.optimistic-set' as const,
      ref: 'ref-1',
      key: 'theme',
      value: 'dark',
    } as any);

    store.send({
      type: 'state.ack' as const,
      ref: 'ref-1',
      ok: false,
      error: 'VALUE_TOO_LARGE',
    } as any);

    const ctx = getCtx(store);
    expect(ctx.pending).toHaveLength(0);
    expect(ctx.entries.theme).toBe('light');
  });

  test('ok=false for set with no previous value removes key', () => {
    const store = createStateStore();

    store.send({
      type: 'state.optimistic-set' as const,
      ref: 'ref-1',
      key: 'newkey',
      value: 'value',
    } as any);

    store.send({
      type: 'state.ack' as const,
      ref: 'ref-1',
      ok: false,
    } as any);

    expect(getCtx(store).entries.newkey).toBeUndefined();
  });

  test('ok=false for delete restores previous value', () => {
    const store = createStateStore();

    store.send({
      type: 'state.snapshot' as const,
      entries: { theme: 'dark' },
    } as any);

    store.send({
      type: 'state.optimistic-delete' as const,
      ref: 'ref-1',
      key: 'theme',
    } as any);

    expect(getCtx(store).entries.theme).toBeUndefined();

    store.send({
      type: 'state.ack' as const,
      ref: 'ref-1',
      ok: false,
    } as any);

    expect(getCtx(store).entries.theme).toBe('dark');
  });

  test('ok=false for clear restores all entries', () => {
    const store = createStateStore();

    store.send({
      type: 'state.snapshot' as const,
      entries: { a: 1, b: 2, c: 3 },
    } as any);

    store.send({
      type: 'state.optimistic-clear' as const,
      ref: 'ref-1',
    } as any);

    expect(getCtx(store).entries).toEqual({});

    store.send({
      type: 'state.ack' as const,
      ref: 'ref-1',
      ok: false,
    } as any);

    expect(getCtx(store).entries).toEqual({ a: 1, b: 2, c: 3 });
  });

  test('unknown ref is a no-op', () => {
    const store = createStateStore();

    store.send({
      type: 'state.optimistic-set' as const,
      ref: 'ref-1',
      key: 'theme',
      value: 'dark',
    } as any);

    store.send({
      type: 'state.ack' as const,
      ref: 'nonexistent',
      ok: false,
    } as any);

    // Original pending still there, state unchanged
    expect(getCtx(store).pending).toHaveLength(1);
    expect(getCtx(store).entries.theme).toBe('dark');
  });

  test('multiple pending — ack in any order', () => {
    const store = createStateStore();

    store.send({
      type: 'state.optimistic-set' as const,
      ref: 'ref-1',
      key: 'a',
      value: 1,
    } as any);
    store.send({
      type: 'state.optimistic-set' as const,
      ref: 'ref-2',
      key: 'b',
      value: 2,
    } as any);
    store.send({
      type: 'state.optimistic-set' as const,
      ref: 'ref-3',
      key: 'c',
      value: 3,
    } as any);

    expect(getCtx(store).pending).toHaveLength(3);

    // Ack middle one first
    store.send({ type: 'state.ack' as const, ref: 'ref-2', ok: true } as any);
    expect(getCtx(store).pending).toHaveLength(2);

    // Reject first — rollback removes key 'a'
    store.send({ type: 'state.ack' as const, ref: 'ref-1', ok: false } as any);
    expect(getCtx(store).pending).toHaveLength(1);
    expect(getCtx(store).entries.a).toBeUndefined();
    expect(getCtx(store).entries.b).toBe(2); // confirmed
    expect(getCtx(store).entries.c).toBe(3); // still optimistic

    // Ack last
    store.send({ type: 'state.ack' as const, ref: 'ref-3', ok: true } as any);
    expect(getCtx(store).pending).toHaveLength(0);
  });
});

// ─── routeStateMessage ──────────────────────────────────────────────────────

describe('routeStateMessage', () => {
  test('routes state.snapshot', () => {
    const store = createStateStore();

    const handled = routeStateMessage(store, {
      type: 'state.snapshot',
      entries: { foo: 'bar' },
    });

    expect(handled).toBe(true);
    expect(getCtx(store).entries.foo).toBe('bar');
    expect(getCtx(store).ready).toBe(true);
  });

  test('routes state.change', () => {
    const store = createStateStore();

    const handled = routeStateMessage(store, {
      type: 'state.change',
      op: 'set',
      key: 'theme',
      value: 'dark',
    });

    expect(handled).toBe(true);
    expect(getCtx(store).entries.theme).toBe('dark');
  });

  test('routes state.ack', () => {
    const store = createStateStore();

    store.send({
      type: 'state.optimistic-set' as const,
      ref: 'ref-1',
      key: 'x',
      value: 1,
    } as any);

    const handled = routeStateMessage(store, {
      type: 'state.ack',
      ref: 'ref-1',
      ok: true,
    });

    expect(handled).toBe(true);
    expect(getCtx(store).pending).toHaveLength(0);
  });

  test('returns false for non-state messages', () => {
    const store = createStateStore();

    expect(routeStateMessage(store, { type: 'sync.snapshot' })).toBe(false);
    expect(routeStateMessage(store, { type: 'sync.change' })).toBe(false);
    expect(routeStateMessage(store, { type: 'unknown' })).toBe(false);
  });
});

// ─── Complex Scenarios ──────────────────────────────────────────────────────

describe('complex scenarios', () => {
  test('optimistic set → server change → ack', () => {
    const store = createStateStore();

    // Snapshot first
    store.send({
      type: 'state.snapshot' as const,
      entries: {},
    } as any);

    // Optimistic set
    store.send({
      type: 'state.optimistic-set' as const,
      ref: 'ref-1',
      key: 'counter',
      value: 1,
    } as any);

    expect(getCtx(store).entries.counter).toBe(1);
    expect(getCtx(store).pending).toHaveLength(1);

    // Server broadcasts change (from another device)
    store.send({
      type: 'state.change' as const,
      op: 'set',
      key: 'counter',
      value: 1,
    } as any);

    // State still correct, pending still there
    expect(getCtx(store).entries.counter).toBe(1);
    expect(getCtx(store).pending).toHaveLength(1);

    // Server acks
    store.send({
      type: 'state.ack' as const,
      ref: 'ref-1',
      ok: true,
    } as any);

    expect(getCtx(store).pending).toHaveLength(0);
    expect(getCtx(store).entries.counter).toBe(1);
  });

  test('optimistic clear → rejected → state restored', () => {
    const store = createStateStore();

    store.send({
      type: 'state.snapshot' as const,
      entries: { a: 1, b: 2, c: 3 },
    } as any);

    store.send({
      type: 'state.optimistic-clear' as const,
      ref: 'ref-1',
    } as any);

    expect(getCtx(store).entries).toEqual({});

    // Rejected
    store.send({
      type: 'state.ack' as const,
      ref: 'ref-1',
      ok: false,
      error: 'UNAUTHORIZED',
    } as any);

    // Fully restored
    expect(getCtx(store).entries).toEqual({ a: 1, b: 2, c: 3 });
  });

  test('interleaved set and delete on same key', () => {
    const store = createStateStore();

    store.send({
      type: 'state.snapshot' as const,
      entries: { key: 'original' },
    } as any);

    // Optimistic set
    store.send({
      type: 'state.optimistic-set' as const,
      ref: 'ref-1',
      key: 'key',
      value: 'updated',
    } as any);

    // Optimistic delete (before ack of set)
    store.send({
      type: 'state.optimistic-delete' as const,
      ref: 'ref-2',
      key: 'key',
    } as any);

    expect(getCtx(store).entries.key).toBeUndefined();
    expect(getCtx(store).pending).toHaveLength(2);

    // Set is confirmed
    store.send({
      type: 'state.ack' as const,
      ref: 'ref-1',
      ok: true,
    } as any);

    // Delete rejected — restore to value before delete (which was 'updated')
    store.send({
      type: 'state.ack' as const,
      ref: 'ref-2',
      ok: false,
    } as any);

    expect(getCtx(store).entries.key).toBe('updated');
    expect(getCtx(store).pending).toHaveLength(0);
  });

  test('snapshot during pending operations resets everything', () => {
    const store = createStateStore();

    store.send({
      type: 'state.optimistic-set' as const,
      ref: 'ref-1',
      key: 'a',
      value: 1,
    } as any);
    store.send({
      type: 'state.optimistic-set' as const,
      ref: 'ref-2',
      key: 'b',
      value: 2,
    } as any);

    expect(getCtx(store).pending).toHaveLength(2);

    // Server sends snapshot (e.g., reconnect)
    store.send({
      type: 'state.snapshot' as const,
      entries: { x: 'server-state' },
    } as any);

    // All pending cleared, entries are server-authoritative
    expect(getCtx(store).pending).toHaveLength(0);
    expect(getCtx(store).entries).toEqual({ x: 'server-state' });
  });
});

describe('state.reset', () => {
  test('clears entries, pending operations, and readiness', () => {
    const store = createStateStore();

    store.send({
      type: 'state.snapshot' as const,
      entries: { theme: 'dark' },
    } as any);
    store.send({
      type: 'state.optimistic-set' as const,
      ref: 'ref-1',
      key: 'draft',
      value: 'secret',
    } as any);

    store.send({ type: 'state.reset' as const } as any);

    expect(getCtx(store)).toEqual({
      entries: {},
      ready: false,
      pending: [],
    });
  });
});

describe('prototype-safe state keys', () => {
  const dangerousEntries = () => JSON.parse(
    '{"__proto__":"proto-value","constructor":"constructor-value","toString":"string-value"}',
  ) as Record<string, JsonValue>;

  test('snapshots preserve arbitrary own keys without inheriting Object properties', () => {
    const store = createStateStore();

    expect(Object.getPrototypeOf(getCtx(store).entries)).toBeNull();
    for (const key of ['__proto__', 'constructor', 'toString']) {
      expect(Object.hasOwn(getCtx(store).entries, key)).toBe(false);
      expect(getCtx(store).entries[key]).toBeUndefined();
    }

    store.send({
      type: 'state.snapshot' as const,
      entries: dangerousEntries(),
    } as any);

    const entries = getCtx(store).entries;
    expect(Object.getPrototypeOf(entries)).toBeNull();
    expect(Object.keys(entries)).toEqual(['__proto__', 'constructor', 'toString']);
    expect(entries.__proto__).toBe('proto-value');
    expect(getEntry(entries, 'constructor')).toBe('constructor-value');
    expect(getEntry(entries, 'toString')).toBe('string-value');
  });

  test('optimistic set, delete, clear, and rejected rollback keep special keys safe', () => {
    const store = createStateStore();
    store.send({
      type: 'state.snapshot' as const,
      entries: dangerousEntries(),
    } as any);

    store.send({
      type: 'state.optimistic-set' as const,
      ref: 'set-ref',
      key: '__proto__',
      value: 'optimistic',
    } as any);
    expect(getCtx(store).entries.__proto__).toBe('optimistic');
    store.send({ type: 'state.ack', ref: 'set-ref', ok: false } as any);
    expect(getCtx(store).entries.__proto__).toBe('proto-value');
    expect(Object.getPrototypeOf(getCtx(store).entries)).toBeNull();

    store.send({
      type: 'state.optimistic-delete' as const,
      ref: 'delete-ref',
      key: 'constructor',
    } as any);
    expect(Object.hasOwn(getCtx(store).entries, 'constructor')).toBe(false);
    store.send({ type: 'state.ack', ref: 'delete-ref', ok: false } as any);
    expect(getEntry(getCtx(store).entries, 'constructor')).toBe('constructor-value');
    expect(Object.getPrototypeOf(getCtx(store).entries)).toBeNull();

    store.send({
      type: 'state.optimistic-clear' as const,
      ref: 'clear-ref',
    } as any);
    expect(Object.keys(getCtx(store).entries)).toEqual([]);
    expect(Object.getPrototypeOf(getCtx(store).entries)).toBeNull();
    store.send({ type: 'state.ack', ref: 'clear-ref', ok: false } as any);

    const restored = getCtx(store).entries;
    expect(Object.getPrototypeOf(restored)).toBeNull();
    expect(restored.__proto__).toBe('proto-value');
    expect(getEntry(restored, 'constructor')).toBe('constructor-value');
    expect(getEntry(restored, 'toString')).toBe('string-value');
  });

  test('remote set, delete, and clear do not reintroduce an object prototype', () => {
    const store = createStateStore();

    for (const key of ['__proto__', 'constructor', 'toString']) {
      store.send({
        type: 'state.change' as const,
        op: 'set',
        key,
        value: `value:${key}`,
      } as any);
      expect(getCtx(store).entries[key]).toBe(`value:${key}`);
      expect(Object.getPrototypeOf(getCtx(store).entries)).toBeNull();
    }

    store.send({
      type: 'state.change' as const,
      op: 'delete',
      key: '__proto__',
      value: undefined,
    } as any);
    expect(Object.hasOwn(getCtx(store).entries, '__proto__')).toBe(false);
    expect(getCtx(store).entries.__proto__).toBeUndefined();

    store.send({
      type: 'state.change' as const,
      op: 'clear',
      key: null,
      value: undefined,
    } as any);
    expect(Object.getPrototypeOf(getCtx(store).entries)).toBeNull();
    expect(getEntry(getCtx(store).entries, 'constructor')).toBeUndefined();
    expect(getEntry(getCtx(store).entries, 'toString')).toBeUndefined();
  });
});
