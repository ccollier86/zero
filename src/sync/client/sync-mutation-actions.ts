import type { ClientTableDef, Row, SyncMutateMessage } from '../types';
import { ensureRowSyncPrimaryKey } from '../identity';
import type {
  SyncMutationQueue,
  SyncOptimisticEvent,
} from './sync-mutation-queue';

interface SyncMutationActionInput {
  tables: Record<string, ClientTableDef>;
  queue: SyncMutationQueue;
  stopped: () => boolean;
}

/** Builds the public mutation methods around the same-row queue. */
export function createSyncMutationActions(input: SyncMutationActionInput) {
  function submit(
    table: string,
    rowId: string,
    operation: SyncMutateMessage['op'],
    row?: Row | Partial<Row>,
  ): void {
    const ref = crypto.randomUUID();
    const message: SyncMutateMessage = {
      type: 'sync.mutate', ref, table, op: operation,
      ...(operation === 'INSERT' ? { row } : { rowId, ...(row ? { row } : {}) }),
    };
    const event = optimisticEvent(operation, table, rowId, ref, row);
    input.queue.submit(message, event);
  }

  function requirePrimaryKey(table: string): string {
    const primaryKey = input.tables[table]?._pk;
    if (!primaryKey) throw new Error(`Unknown table: ${table}`);
    return primaryKey;
  }

  return {
    insert(table: string, row: Row): void {
      if (input.stopped()) return;
      const primaryKey = requirePrimaryKey(table);
      const keyedRow = ensureRowSyncPrimaryKey(table, input.tables[table], row);
      submit(table, String(keyedRow[primaryKey]), 'INSERT', keyedRow);
    },
    update(table: string, id: string, partial: Partial<Row>): void {
      if (input.stopped()) return;
      requirePrimaryKey(table);
      submit(table, id, 'UPDATE', partial);
    },
    delete(table: string, id: string): void {
      if (input.stopped()) return;
      requirePrimaryKey(table);
      submit(table, id, 'DELETE');
    },
  };
}

function optimisticEvent(
  operation: SyncMutateMessage['op'],
  table: string,
  rowId: string,
  ref: string,
  row?: Row | Partial<Row>,
): SyncOptimisticEvent {
  if (operation === 'INSERT') {
    return { type: 'optimistic.insert', table, rowId, ref, row: row as Row };
  }
  if (operation === 'UPDATE') {
    return { type: 'optimistic.update', table, rowId, ref, partial: row };
  }
  return { type: 'optimistic.delete', table, rowId, ref };
}
