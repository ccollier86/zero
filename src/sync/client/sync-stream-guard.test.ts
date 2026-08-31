import { describe, expect, test } from 'bun:test';
import type { SyncStoreContext } from './sync-store';
import { createSyncStore, routeServerMessage } from './sync-store';
import { acceptSyncStreamMessage } from './sync-stream-guard';

function context(): SyncStoreContext {
  const { store } = createSyncStore({ todos: { _pk: 'id', id: 'string' } });
  routeServerMessage(store, {
    type: 'sync.snapshot', tables: { todos: {} }, seq: 5,
    epoch: 'epoch-a', scope: 'scope-a', reset: 'preserve-pending',
  });
  return store.getSnapshot().context as SyncStoreContext;
}

describe('Sync stream continuity guard', () => {
  test('accepts global sequence jumps when the per-socket predecessor matches', () => {
    expect(acceptSyncStreamMessage(context(), {
      type: 'sync.change', seq: 9, prevSeq: 5,
      epoch: 'epoch-a', scope: 'scope-a', table: 'todos', op: 'UPDATE',
      rowId: '1', row: { id: '1' }, origin: '', ts: 1,
    })).toBe(true);
  });

  test('rejects a missed projected change and a changed epoch', () => {
    expect(acceptSyncStreamMessage(context(), {
      type: 'sync.change', seq: 9, prevSeq: 8,
      epoch: 'epoch-a', scope: 'scope-a', table: 'todos', op: 'DELETE',
      rowId: '1', row: null, origin: '', ts: 1,
    })).toBe(false);
    expect(acceptSyncStreamMessage(context(), {
      type: 'sync.catchup', changes: [], seq: 5, prevSeq: 5,
      epoch: 'epoch-b', scope: 'scope-a',
    })).toBe(false);
  });

  test('requires ordered atomic catchup changes', () => {
    expect(acceptSyncStreamMessage(context(), {
      type: 'sync.catchup', seq: 12, prevSeq: 5,
      epoch: 'epoch-a', scope: 'scope-a',
      changes: [
        { seq: 8, table: 'todos', op: 'UPDATE', rowId: '1', row: {}, origin: '', ts: 1 },
        { seq: 7, table: 'todos', op: 'DELETE', rowId: '1', row: null, origin: '', ts: 2 },
      ],
    })).toBe(false);
  });

  test('accepts an explicit replacement across epochs but not an ambiguous snapshot', () => {
    const replacement = {
      type: 'sync.snapshot' as const, tables: { todos: {} }, seq: 0,
      epoch: 'epoch-b', scope: 'scope-a', reset: 'preserve-pending' as const,
    };
    expect(acceptSyncStreamMessage(context(), replacement)).toBe(true);
    expect(acceptSyncStreamMessage(context(), { ...replacement, reset: undefined })).toBe(false);
  });
});
