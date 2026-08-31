import { describe, test, expect } from 'bun:test';
import {
  createSyncStore,
  createTableSlice,
  createSlice,
  routeServerMessage,
  type SyncStoreContext,
} from './sync-store';
import type { Row, ClientTableDef, ServerMessage } from '../types';

// ─── Helpers ───────────────────────────────────────────────────────────────

function makeTables(): Record<string, ClientTableDef> {
  return {
    todos: { _pk: 'id', id: 'string', title: 'string', done: 'number' },
    users: { _pk: 'id', id: 'string', name: 'string' },
  };
}

function getCtx(
  store: ReturnType<typeof createSyncStore>['store']
): SyncStoreContext {
  return store.getSnapshot().context as SyncStoreContext;
}

// ─── createSyncStore ───────────────────────────────────────────────────────

describe('createSyncStore', () => {
  test('initializes with empty tables and default sync meta', () => {
    const { store } = createSyncStore(makeTables());
    const ctx = getCtx(store);

    expect(ctx.todos).toEqual({});
    expect(ctx.users).toEqual({});
    expect(ctx._sync).toEqual({
      connected: false,
      lastSeq: 0,
      epoch: null,
      scope: null,
      pending: [],
    });
  });

  test('returns table definitions', () => {
    const tables = makeTables();
    const result = createSyncStore(tables);
    expect(result.tables).toBe(tables);
  });
});

// ─── sync.snapshot reducer ─────────────────────────────────────────────────

describe('sync.snapshot', () => {
  test('replacement purges stale full and lazy rows while preserving optimistic work', () => {
    const { store } = createSyncStore(makeTables());
    store.send({
      type: 'sync.snapshot',
      tables: {
        todos: { old: { id: 'old', title: 'Stale', done: 0 } },
        users: { stale: { id: 'stale', name: 'No longer visible' } },
      },
      seq: 8,
      epoch: 'old-epoch',
      scope: 'same-scope',
    });
    store.send({
      type: 'optimistic.insert', table: 'todos', rowId: 'draft',
      row: { id: 'draft', title: 'Offline draft', done: 0 }, ref: 'draft-ref',
    });

    store.send({
      type: 'sync.snapshot',
      tables: { todos: { fresh: { id: 'fresh', title: 'Fresh', done: 0 } } },
      seq: 0,
      epoch: 'new-epoch',
      scope: 'same-scope',
      reset: 'preserve-pending',
    });

    expect(getCtx(store).todos).toEqual({
      fresh: { id: 'fresh', title: 'Fresh', done: 0 },
      draft: { id: 'draft', title: 'Offline draft', done: 0 },
    });
    expect(getCtx(store).users).toEqual({});
    expect(getCtx(store)._sync.pending.map((item) => item.ref)).toEqual(['draft-ref']);
    expect(getCtx(store)._sync.epoch).toBe('new-epoch');
  });

  test('authorization replacement purges every cached row and pending mutation', () => {
    const { store } = createSyncStore(makeTables());
    store.send({
      type: 'optimistic.insert', table: 'users', rowId: 'private',
      row: { id: 'private', name: 'Private' }, ref: 'private-ref',
    });
    store.send({
      type: 'sync.snapshot', tables: { todos: {} }, seq: 1,
      epoch: 'epoch', scope: 'new-scope', reset: 'purge',
    });

    expect(getCtx(store).todos).toEqual({});
    expect(getCtx(store).users).toEqual({});
    expect(getCtx(store)._sync.pending).toEqual([]);
  });

  test('rebases an attempted mutation so failure cannot restore stale state', () => {
    const { store } = createSyncStore(makeTables());
    store.send({
      type: 'sync.snapshot', tables: {
        todos: { '1': { id: '1', title: 'Before', done: 0 } },
      }, seq: 2, epoch: 'old', scope: 'same',
    });
    store.send({
      type: 'optimistic.update', table: 'todos', rowId: '1',
      partial: { title: 'Requested' }, ref: 'uncertain',
    });
    store.send({
      type: 'sync.mutation-sent', ref: 'uncertain', sentAt: 10, attempt: 1,
    });
    store.send({
      type: 'sync.snapshot', tables: {
        todos: { '1': { id: '1', title: 'Server canonical', done: 1 } },
      }, seq: 0, epoch: 'new', scope: 'same', reset: 'preserve-pending',
    });

    expect((getCtx(store).todos as Record<string, Row>)['1'].title).toBe(
      'Server canonical',
    );
    store.send({ type: 'sync.ack', ref: 'uncertain', ok: false });
    expect((getCtx(store).todos as Record<string, Row>)['1']).toEqual({
      id: '1', title: 'Server canonical', done: 1,
    });
  });

  test('replaces table contents and updates lastSeq', () => {
    const { store } = createSyncStore(makeTables());

    store.send({
      type: 'sync.snapshot',
      tables: {
        todos: { '1': { id: '1', title: 'Buy milk', done: 0 } },
        users: { 'u1': { id: 'u1', name: 'Alice' } },
      },
      seq: 42,
    });

    const ctx = getCtx(store);
    expect(ctx.todos).toEqual({
      '1': { id: '1', title: 'Buy milk', done: 0 },
    });
    expect(ctx.users).toEqual({
      'u1': { id: 'u1', name: 'Alice' },
    });
    expect(ctx._sync.lastSeq).toBe(42);
  });

  test('clears pending entries for included snapshot tables', () => {
    const { store } = createSyncStore(makeTables());

    // Add a pending mutation
    store.send({
      type: 'optimistic.insert',
      table: 'todos',
      rowId: '1',
      row: { id: '1', title: 'Test', done: 0 },
      ref: 'ref-1',
    });

    expect(getCtx(store)._sync.pending).toHaveLength(1);

    // Snapshot clears it
    store.send({
      type: 'sync.snapshot',
      tables: { todos: {} },
      seq: 10,
    });

    expect(getCtx(store)._sync.pending).toHaveLength(0);
  });

  test('partial snapshot only replaces provided tables', () => {
    const { store } = createSyncStore(makeTables());

    // Set initial data
    store.send({
      type: 'sync.snapshot',
      tables: {
        todos: { '1': { id: '1', title: 'A', done: 0 } },
        users: { 'u1': { id: 'u1', name: 'Alice' } },
      },
      seq: 1,
    });

    // Partial snapshot — only todos
    store.send({
      type: 'sync.snapshot',
      tables: {
        todos: { '2': { id: '2', title: 'B', done: 0 } },
      },
      seq: 5,
    });

    const ctx = getCtx(store);
    // todos replaced
    expect(ctx.todos).toEqual({
      '2': { id: '2', title: 'B', done: 0 },
    });
    // users preserved
    expect(ctx.users).toEqual({
      'u1': { id: 'u1', name: 'Alice' },
    });
  });

  test('keeps pending entries for tables omitted from a partial snapshot', () => {
    const { store } = createSyncStore(makeTables());

    store.send({
      type: 'optimistic.insert',
      table: 'todos',
      rowId: '1',
      row: { id: '1', title: 'Todo pending', done: 0 },
      ref: 'todo-ref',
    });
    store.send({
      type: 'optimistic.insert',
      table: 'users',
      rowId: 'u1',
      row: { id: 'u1', name: 'User pending' },
      ref: 'user-ref',
    });

    store.send({
      type: 'sync.snapshot',
      tables: { todos: {} },
      seq: 10,
    });

    const pending = getCtx(store)._sync.pending;
    expect(pending).toHaveLength(1);
    expect(pending[0].ref).toBe('user-ref');
  });
});

// ─── sync.change reducer ───────────────────────────────────────────────────

describe('sync.change', () => {
  test('INSERT adds row to table', () => {
    const { store } = createSyncStore(makeTables());

    store.send({
      type: 'sync.change',
      seq: 1,
      table: 'todos',
      op: 'INSERT',
      rowId: '1',
      row: { id: '1', title: 'Buy milk', done: 0 },
    });

    const ctx = getCtx(store);
    expect((ctx.todos as Record<string, Row>)['1']).toEqual({
      id: '1',
      title: 'Buy milk',
      done: 0,
    });
    expect(ctx._sync.lastSeq).toBe(1);
  });

  test('UPDATE replaces existing row', () => {
    const { store } = createSyncStore(makeTables());

    store.send({
      type: 'sync.change',
      seq: 1,
      table: 'todos',
      op: 'INSERT',
      rowId: '1',
      row: { id: '1', title: 'Buy milk', done: 0 },
    });

    store.send({
      type: 'sync.change',
      seq: 2,
      table: 'todos',
      op: 'UPDATE',
      rowId: '1',
      row: { id: '1', title: 'Buy milk', done: 1 },
    });

    expect((getCtx(store).todos as Record<string, Row>)['1'].done).toBe(1);
    expect(getCtx(store)._sync.lastSeq).toBe(2);
  });

  test('DELETE removes row', () => {
    const { store } = createSyncStore(makeTables());

    store.send({
      type: 'sync.change',
      seq: 1,
      table: 'todos',
      op: 'INSERT',
      rowId: '1',
      row: { id: '1', title: 'Buy milk', done: 0 },
    });

    store.send({
      type: 'sync.change',
      seq: 2,
      table: 'todos',
      op: 'DELETE',
      rowId: '1',
      row: null,
    });

    expect((getCtx(store).todos as Record<string, Row>)['1']).toBeUndefined();
    expect(getCtx(store)._sync.lastSeq).toBe(2);
  });

  test('does not add row when row is null for INSERT', () => {
    const { store } = createSyncStore(makeTables());

    store.send({
      type: 'sync.change',
      seq: 1,
      table: 'todos',
      op: 'INSERT',
      rowId: '1',
      row: null,
    });

    expect((getCtx(store).todos as Record<string, Row>)['1']).toBeUndefined();
  });

  test('does NOT check origin — applies unconditionally', () => {
    const { store } = createSyncStore(makeTables());

    // First insert optimistically
    store.send({
      type: 'optimistic.insert',
      table: 'todos',
      rowId: '1',
      row: { id: '1', title: 'Optimistic', done: 0 },
      ref: 'ref-1',
    });

    // Server change replaces with canonical state
    store.send({
      type: 'sync.change',
      seq: 1,
      table: 'todos',
      op: 'INSERT',
      rowId: '1',
      row: { id: '1', title: 'Server canonical', done: 0 },
    });

    // Canonical state wins
    expect((getCtx(store).todos as Record<string, Row>)['1'].title).toBe(
      'Server canonical'
    );
    // Pending still there (cleared by sync.ack, not sync.change)
    expect(getCtx(store)._sync.pending).toHaveLength(1);
  });
});

// ─── sync.ack reducer ──────────────────────────────────────────────────────

describe('sync.ack', () => {
  test('ok=true removes mutation from pending', () => {
    const { store } = createSyncStore(makeTables());

    store.send({
      type: 'optimistic.insert',
      table: 'todos',
      rowId: '1',
      row: { id: '1', title: 'Test', done: 0 },
      ref: 'ref-1',
    });

    expect(getCtx(store)._sync.pending).toHaveLength(1);

    store.send({ type: 'sync.ack', ref: 'ref-1', ok: true });

    expect(getCtx(store)._sync.pending).toHaveLength(0);
    // Row remains (confirmed)
    expect((getCtx(store).todos as Record<string, Row>)['1']).toBeDefined();
  });

  test('ok=true installs the authoritative receipt result', () => {
    const { store } = createSyncStore(makeTables());
    store.send({
      type: 'optimistic.insert', table: 'todos', rowId: '1',
      row: { id: '1', title: 'Requested', done: 0 }, ref: 'ref-1',
    });
    store.send({
      type: 'sync.ack', ref: 'ref-1', ok: true, seq: 1,
      change: {
        table: 'todos', op: 'UPDATE', rowId: '1',
        row: { id: '1', title: 'Normalized', done: 1 },
      },
    });

    expect((getCtx(store).todos as Record<string, Row>)['1']).toEqual({
      id: '1', title: 'Normalized', done: 1,
    });
    expect(getCtx(store)._sync.pending).toEqual([]);
  });

  test('ok=false rolls back to previous state', () => {
    const { store } = createSyncStore(makeTables());

    // Insert a row first (so there's something to roll back to)
    store.send({
      type: 'sync.change',
      seq: 1,
      table: 'todos',
      op: 'INSERT',
      rowId: '1',
      row: { id: '1', title: 'Original', done: 0 },
    });

    // Optimistic update
    store.send({
      type: 'optimistic.update',
      table: 'todos',
      rowId: '1',
      partial: { title: 'Updated' },
      ref: 'ref-2',
    });

    expect((getCtx(store).todos as Record<string, Row>)['1'].title).toBe(
      'Updated'
    );

    // Reject — should rollback
    store.send({ type: 'sync.ack', ref: 'ref-2', ok: false, error: 'Denied' });

    expect((getCtx(store).todos as Record<string, Row>)['1'].title).toBe(
      'Original'
    );
    expect(getCtx(store)._sync.pending).toHaveLength(0);
  });

  test('ok=false for insert rollback removes the row', () => {
    const { store } = createSyncStore(makeTables());

    store.send({
      type: 'optimistic.insert',
      table: 'todos',
      rowId: '1',
      row: { id: '1', title: 'Test', done: 0 },
      ref: 'ref-1',
    });

    // Reject — row should be removed (previousState was null)
    store.send({ type: 'sync.ack', ref: 'ref-1', ok: false });

    expect((getCtx(store).todos as Record<string, Row>)['1']).toBeUndefined();
  });

  test('unknown ref is a no-op', () => {
    const { store } = createSyncStore(makeTables());

    const before = getCtx(store);
    store.send({ type: 'sync.ack', ref: 'nonexistent', ok: false });
    // Context may or may not be referentially equal, but data should be same
    expect(getCtx(store)._sync.pending).toHaveLength(0);
  });
});

// ─── sync.catchup reducer ──────────────────────────────────────────────────

describe('sync.catchup', () => {
  test('applies multiple changes in order', () => {
    const { store } = createSyncStore(makeTables());

    store.send({
      type: 'sync.catchup',
      changes: [
        {
          seq: 1,
          table: 'todos',
          op: 'INSERT',
          rowId: '1',
          row: { id: '1', title: 'A', done: 0 },
        },
        {
          seq: 2,
          table: 'todos',
          op: 'INSERT',
          rowId: '2',
          row: { id: '2', title: 'B', done: 0 },
        },
        {
          seq: 3,
          table: 'todos',
          op: 'UPDATE',
          rowId: '1',
          row: { id: '1', title: 'A Updated', done: 1 },
        },
      ],
      seq: 3,
    });

    const ctx = getCtx(store);
    expect(Object.keys(ctx.todos as Record<string, Row>)).toHaveLength(2);
    expect((ctx.todos as Record<string, Row>)['1'].title).toBe('A Updated');
    expect((ctx.todos as Record<string, Row>)['2'].title).toBe('B');
    expect(ctx._sync.lastSeq).toBe(3);
  });

  test('does not mistake an unrelated same-row catchup for confirmation', () => {
    const { store } = createSyncStore(makeTables());

    // Add optimistic insert
    store.send({
      type: 'optimistic.insert',
      table: 'todos',
      rowId: '1',
      row: { id: '1', title: 'Optimistic', done: 0 },
      ref: 'ref-1',
    });

    // Also add a different pending mutation (should survive)
    store.send({
      type: 'optimistic.insert',
      table: 'todos',
      rowId: '2',
      row: { id: '2', title: 'Other', done: 0 },
      ref: 'ref-2',
    });

    expect(getCtx(store)._sync.pending).toHaveLength(2);
    store.send({ type: 'sync.mutation-sent', ref: 'ref-1', sentAt: 1, attempt: 1 });
    store.send({ type: 'sync.mutation-sent', ref: 'ref-2', sentAt: 1, attempt: 1 });

    // Catchup contains the row we inserted
    store.send({
      type: 'sync.catchup',
      changes: [
        {
          seq: 5,
          table: 'todos',
          op: 'INSERT',
          rowId: '1',
          row: { id: '1', title: 'Server version', done: 0 },
        },
      ],
      seq: 5,
    });

    // Row identity is not a mutation receipt: both remain unresolved.
    expect(getCtx(store)._sync.pending.map((item) => item.ref)).toEqual([
      'ref-1', 'ref-2',
    ]);

    // Server's canonical version applied
    expect((getCtx(store).todos as Record<string, Row>)['1'].title).toBe(
      'Server version'
    );
  });

  test('handles DELETE in catchup', () => {
    const { store } = createSyncStore(makeTables());

    // Insert then catchup with delete
    store.send({
      type: 'sync.change',
      seq: 1,
      table: 'todos',
      op: 'INSERT',
      rowId: '1',
      row: { id: '1', title: 'A', done: 0 },
    });

    store.send({
      type: 'sync.catchup',
      changes: [
        { seq: 2, table: 'todos', op: 'DELETE', rowId: '1', row: null },
      ],
      seq: 2,
    });

    expect((getCtx(store).todos as Record<string, Row>)['1']).toBeUndefined();
  });
});

// ─── Connection events ─────────────────────────────────────────────────────

describe('connection events', () => {
  test('sync.connected sets connected to true', () => {
    const { store } = createSyncStore(makeTables());
    store.send({ type: 'sync.connected' });
    expect(getCtx(store)._sync.connected).toBe(true);
  });

  test('sync.disconnected sets connected to false', () => {
    const { store } = createSyncStore(makeTables());
    store.send({ type: 'sync.connected' });
    store.send({ type: 'sync.disconnected' });
    expect(getCtx(store)._sync.connected).toBe(false);
  });
});

// ─── Optimistic mutations ──────────────────────────────────────────────────

describe('optimistic.insert', () => {
  test('adds row and creates pending entry', () => {
    const { store } = createSyncStore(makeTables());

    store.send({
      type: 'optimistic.insert',
      table: 'todos',
      rowId: '1',
      row: { id: '1', title: 'Test', done: 0 },
      ref: 'ref-1',
    });

    const ctx = getCtx(store);
    expect((ctx.todos as Record<string, Row>)['1']).toEqual({
      id: '1',
      title: 'Test',
      done: 0,
    });

    expect(ctx._sync.pending).toHaveLength(1);
    expect(ctx._sync.pending[0].ref).toBe('ref-1');
    expect(ctx._sync.pending[0].op).toBe('INSERT');
    expect(ctx._sync.pending[0].previousState).toBeNull();
  });

  test('captures previousState when row already exists', () => {
    const { store } = createSyncStore(makeTables());

    // Existing row
    store.send({
      type: 'sync.change',
      seq: 1,
      table: 'todos',
      op: 'INSERT',
      rowId: '1',
      row: { id: '1', title: 'Existing', done: 0 },
    });

    // Optimistic insert over existing
    store.send({
      type: 'optimistic.insert',
      table: 'todos',
      rowId: '1',
      row: { id: '1', title: 'Replaced', done: 0 },
      ref: 'ref-1',
    });

    const pending = getCtx(store)._sync.pending[0];
    expect(pending.previousState).toEqual({
      id: '1',
      title: 'Existing',
      done: 0,
    });
  });
});

describe('optimistic.update', () => {
  test('merges partial into existing row', () => {
    const { store } = createSyncStore(makeTables());

    // Insert first
    store.send({
      type: 'sync.change',
      seq: 1,
      table: 'todos',
      op: 'INSERT',
      rowId: '1',
      row: { id: '1', title: 'Original', done: 0 },
    });

    store.send({
      type: 'optimistic.update',
      table: 'todos',
      rowId: '1',
      partial: { done: 1 },
      ref: 'ref-1',
    });

    const row = (getCtx(store).todos as Record<string, Row>)['1'];
    expect(row.title).toBe('Original'); // preserved
    expect(row.done).toBe(1); // updated
  });

  test('no-ops when row does not exist', () => {
    const { store } = createSyncStore(makeTables());

    const before = getCtx(store);
    store.send({
      type: 'optimistic.update',
      table: 'todos',
      rowId: 'nonexistent',
      partial: { done: 1 },
      ref: 'ref-1',
    });

    // No pending entry created, no row added
    expect(getCtx(store)._sync.pending).toHaveLength(0);
  });

  test('previousState captures full row before merge', () => {
    const { store } = createSyncStore(makeTables());

    store.send({
      type: 'sync.change',
      seq: 1,
      table: 'todos',
      op: 'INSERT',
      rowId: '1',
      row: { id: '1', title: 'Original', done: 0 },
    });

    store.send({
      type: 'optimistic.update',
      table: 'todos',
      rowId: '1',
      partial: { title: 'Changed' },
      ref: 'ref-1',
    });

    const pending = getCtx(store)._sync.pending[0];
    expect(pending.previousState).toEqual({
      id: '1',
      title: 'Original',
      done: 0,
    });
    expect(pending.optimisticState).toEqual({
      id: '1',
      title: 'Changed',
      done: 0,
    });
  });
});

describe('optimistic.delete', () => {
  test('removes row and records previousState', () => {
    const { store } = createSyncStore(makeTables());

    store.send({
      type: 'sync.change',
      seq: 1,
      table: 'todos',
      op: 'INSERT',
      rowId: '1',
      row: { id: '1', title: 'To Delete', done: 0 },
    });

    store.send({
      type: 'optimistic.delete',
      table: 'todos',
      rowId: '1',
      ref: 'ref-1',
    });

    expect((getCtx(store).todos as Record<string, Row>)['1']).toBeUndefined();
    const pending = getCtx(store)._sync.pending[0];
    expect(pending.previousState).toEqual({
      id: '1',
      title: 'To Delete',
      done: 0,
    });
    expect(pending.optimisticState).toBeNull();
  });

  test('delete on non-existent row still creates pending with null previousState', () => {
    const { store } = createSyncStore(makeTables());

    store.send({
      type: 'optimistic.delete',
      table: 'todos',
      rowId: 'nonexistent',
      ref: 'ref-1',
    });

    expect(getCtx(store)._sync.pending).toHaveLength(1);
    expect(getCtx(store)._sync.pending[0].previousState).toBeNull();
  });
});

// ─── Slices ────────────────────────────────────────────────────────────────

describe('createTableSlice', () => {
  test('get() returns current table data', () => {
    const { store } = createSyncStore(makeTables());

    store.send({
      type: 'sync.change',
      seq: 1,
      table: 'todos',
      op: 'INSERT',
      rowId: '1',
      row: { id: '1', title: 'Test', done: 0 },
    });

    const slice = createTableSlice(store, 'todos');
    expect(slice.get()).toEqual({
      '1': { id: '1', title: 'Test', done: 0 },
    });
  });

  test('subscribe() fires on change, not on unrelated changes', () => {
    const { store } = createSyncStore(makeTables());
    const todosSlice = createTableSlice(store, 'todos');
    const emissions: Record<string, Row>[] = [];

    todosSlice.subscribe((value) => emissions.push(value));

    // Change to todos — should fire
    store.send({
      type: 'sync.change',
      seq: 1,
      table: 'todos',
      op: 'INSERT',
      rowId: '1',
      row: { id: '1', title: 'Test', done: 0 },
    });

    // Change to users — should NOT fire for todos slice
    store.send({
      type: 'sync.change',
      seq: 2,
      table: 'users',
      op: 'INSERT',
      rowId: 'u1',
      row: { id: 'u1', name: 'Alice' },
    });

    expect(emissions).toHaveLength(1);
    expect(emissions[0]).toEqual({
      '1': { id: '1', title: 'Test', done: 0 },
    });
  });

  test('unsubscribe stops notifications', () => {
    const { store } = createSyncStore(makeTables());
    const slice = createTableSlice(store, 'todos');
    const emissions: unknown[] = [];

    const unsub = slice.subscribe((value) => emissions.push(value));

    store.send({
      type: 'sync.change',
      seq: 1,
      table: 'todos',
      op: 'INSERT',
      rowId: '1',
      row: { id: '1', title: 'Test', done: 0 },
    });

    expect(emissions).toHaveLength(1);

    unsub();

    store.send({
      type: 'sync.change',
      seq: 2,
      table: 'todos',
      op: 'INSERT',
      rowId: '2',
      row: { id: '2', title: 'Second', done: 0 },
    });

    expect(emissions).toHaveLength(1); // No new emission
  });
});

describe('createSlice', () => {
  test('custom selector with referential stability', () => {
    const { store } = createSyncStore(makeTables());
    const connectedSlice = createSlice(
      store,
      (ctx) => ctx._sync.connected
    );

    expect(connectedSlice.get()).toBe(false);

    const emissions: boolean[] = [];
    connectedSlice.subscribe((v) => emissions.push(v));

    store.send({ type: 'sync.connected' });
    expect(emissions).toEqual([true]);

    // Change to a table — connected didn't change, shouldn't fire
    store.send({
      type: 'sync.change',
      seq: 1,
      table: 'todos',
      op: 'INSERT',
      rowId: '1',
      row: { id: '1', title: 'Test', done: 0 },
    });

    expect(emissions).toEqual([true]); // Still just one emission
  });
});

// ─── routeServerMessage ────────────────────────────────────────────────────

describe('routeServerMessage', () => {
  test('routes sync.snapshot', () => {
    const { store } = createSyncStore(makeTables());

    const msg: ServerMessage = {
      type: 'sync.snapshot',
      tables: {
        todos: { '1': { id: '1', title: 'Test', done: 0 } },
      },
      seq: 5,
    };

    routeServerMessage(store, msg);

    expect(getCtx(store)._sync.lastSeq).toBe(5);
    expect((getCtx(store).todos as Record<string, Row>)['1']).toBeDefined();
  });

  test('routes sync.change', () => {
    const { store } = createSyncStore(makeTables());

    routeServerMessage(store, {
      type: 'sync.change',
      seq: 1,
      table: 'todos',
      op: 'INSERT',
      rowId: '1',
      row: { id: '1', title: 'Test', done: 0 },
      origin: 'conn_1',
      ts: Date.now(),
    });

    expect((getCtx(store).todos as Record<string, Row>)['1']).toBeDefined();
  });

  test('routes sync.ack', () => {
    const { store } = createSyncStore(makeTables());

    store.send({
      type: 'optimistic.insert',
      table: 'todos',
      rowId: '1',
      row: { id: '1', title: 'Test', done: 0 },
      ref: 'ref-1',
    });

    routeServerMessage(store, {
      type: 'sync.ack',
      ref: 'ref-1',
      ok: true,
      seq: 1,
    });

    expect(getCtx(store)._sync.pending).toHaveLength(0);
  });

  test('routes sync.catchup', () => {
    const { store } = createSyncStore(makeTables());

    routeServerMessage(store, {
      type: 'sync.catchup',
      changes: [
        {
          seq: 1,
          table: 'todos',
          op: 'INSERT',
          rowId: '1',
          row: { id: '1', title: 'Test', done: 0 },
          origin: '',
          ts: Date.now(),
        },
      ],
      seq: 1,
    });

    expect((getCtx(store).todos as Record<string, Row>)['1']).toBeDefined();
    expect(getCtx(store)._sync.lastSeq).toBe(1);
  });
});

// ─── Multi-table isolation ─────────────────────────────────────────────────

describe('multi-table', () => {
  test('changes to one table do not affect another', () => {
    const { store } = createSyncStore(makeTables());

    store.send({
      type: 'sync.change',
      seq: 1,
      table: 'todos',
      op: 'INSERT',
      rowId: '1',
      row: { id: '1', title: 'Todo', done: 0 },
    });

    store.send({
      type: 'sync.change',
      seq: 2,
      table: 'users',
      op: 'INSERT',
      rowId: 'u1',
      row: { id: 'u1', name: 'Alice' },
    });

    expect(Object.keys(getCtx(store).todos as Record<string, Row>)).toHaveLength(1);
    expect(Object.keys(getCtx(store).users as Record<string, Row>)).toHaveLength(1);

    // Delete from todos doesn't affect users
    store.send({
      type: 'sync.change',
      seq: 3,
      table: 'todos',
      op: 'DELETE',
      rowId: '1',
      row: null,
    });

    expect(Object.keys(getCtx(store).todos as Record<string, Row>)).toHaveLength(0);
    expect(Object.keys(getCtx(store).users as Record<string, Row>)).toHaveLength(1);
  });
});

// ─── Complex scenarios ─────────────────────────────────────────────────────

describe('complex scenarios', () => {
  test('full optimistic cycle: insert → change → ack', () => {
    const { store } = createSyncStore(makeTables());
    store.send({ type: 'sync.connected' });

    // 1. Optimistic insert
    store.send({
      type: 'optimistic.insert',
      table: 'todos',
      rowId: '1',
      row: { id: '1', title: 'Optimistic', done: 0 },
      ref: 'ref-1',
    });

    expect((getCtx(store).todos as Record<string, Row>)['1'].title).toBe(
      'Optimistic'
    );
    expect(getCtx(store)._sync.pending).toHaveLength(1);

    // 2. Server broadcasts change (canonical, may have added timestamps)
    store.send({
      type: 'sync.change',
      seq: 1,
      table: 'todos',
      op: 'INSERT',
      rowId: '1',
      row: { id: '1', title: 'Optimistic', done: 0, createdAt: 1234 },
    });

    // Canonical state replaces optimistic
    expect((getCtx(store).todos as Record<string, Row>)['1'].createdAt).toBe(
      1234
    );
    // Still pending (sync.change doesn't clear pending)
    expect(getCtx(store)._sync.pending).toHaveLength(1);

    // 3. Server acks
    store.send({ type: 'sync.ack', ref: 'ref-1', ok: true });

    // Pending cleared
    expect(getCtx(store)._sync.pending).toHaveLength(0);
    // Row remains with canonical data
    expect((getCtx(store).todos as Record<string, Row>)['1'].createdAt).toBe(
      1234
    );
  });

  test('rejected mutation followed by new attempt', () => {
    const { store } = createSyncStore(makeTables());

    // Optimistic insert
    store.send({
      type: 'optimistic.insert',
      table: 'todos',
      rowId: '1',
      row: { id: '1', title: 'First Try', done: 0 },
      ref: 'ref-1',
    });

    // Rejected
    store.send({
      type: 'sync.ack',
      ref: 'ref-1',
      ok: false,
      error: 'Duplicate',
    });

    // Row rolled back (previousState was null → deleted)
    expect((getCtx(store).todos as Record<string, Row>)['1']).toBeUndefined();

    // Try again with different data
    store.send({
      type: 'optimistic.insert',
      table: 'todos',
      rowId: '2',
      row: { id: '2', title: 'Second Try', done: 0 },
      ref: 'ref-2',
    });

    expect((getCtx(store).todos as Record<string, Row>)['2']).toBeDefined();
    expect(getCtx(store)._sync.pending).toHaveLength(1);
  });

  test('multiple pending mutations for different rows', () => {
    const { store } = createSyncStore(makeTables());

    store.send({
      type: 'optimistic.insert',
      table: 'todos',
      rowId: '1',
      row: { id: '1', title: 'A', done: 0 },
      ref: 'ref-1',
    });

    store.send({
      type: 'optimistic.insert',
      table: 'todos',
      rowId: '2',
      row: { id: '2', title: 'B', done: 0 },
      ref: 'ref-2',
    });

    store.send({
      type: 'optimistic.insert',
      table: 'users',
      rowId: 'u1',
      row: { id: 'u1', name: 'Alice' },
      ref: 'ref-3',
    });

    expect(getCtx(store)._sync.pending).toHaveLength(3);

    // Ack middle one
    store.send({ type: 'sync.ack', ref: 'ref-2', ok: true });
    expect(getCtx(store)._sync.pending).toHaveLength(2);

    // Reject first one
    store.send({ type: 'sync.ack', ref: 'ref-1', ok: false });
    expect(getCtx(store)._sync.pending).toHaveLength(1);
    expect(getCtx(store)._sync.pending[0].ref).toBe('ref-3');
  });
});

describe('sync.reset', () => {
  test('clears table data, pending mutations, connection state, and sequence', () => {
    const { store } = createSyncStore(makeTables());

    store.send({
      type: 'sync.snapshot',
      tables: {
        todos: { '1': { id: '1', title: 'Sensitive', done: 0 } },
      },
      seq: 10,
    });
    store.send({
      type: 'optimistic.insert',
      table: 'users',
      rowId: 'u1',
      row: { id: 'u1', name: 'Alice' },
      ref: 'ref-1',
    });
    store.send({ type: 'sync.connected' });

    store.send({ type: 'sync.reset' });

    const ctx = getCtx(store);
    expect(ctx.todos).toEqual({});
    expect(ctx.users).toEqual({});
    expect(ctx._sync).toEqual({
      connected: false,
      lastSeq: 0,
      epoch: null,
      scope: null,
      pending: [],
    });
  });
});
