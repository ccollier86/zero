import type { ClientTableDef, Row, SyncMutateMessage } from '../types';
import { ensureRowSyncPrimaryKey } from '../identity';
import type {
  SyncMutationQueue,
  SyncOptimisticEvent,
} from './sync-mutation-queue';
import {
  SYNC_MUTATION_ERROR_CODES,
  SyncMutationError,
  type SyncMutationWaitOptions,
} from './sync-mutation-receipts';

interface SyncMutationActionInput {
  tables: Record<string, ClientTableDef>;
  queue: SyncMutationQueue;
  stopped: () => boolean;
}

interface SyncMutationSubmission {
  readonly message: SyncMutateMessage;
  readonly event: SyncOptimisticEvent;
}

/** Builds the public mutation methods around the same-row queue. */
export function createSyncMutationActions(input: SyncMutationActionInput) {
  function prepare(
    table: string,
    rowId: string,
    operation: SyncMutateMessage['op'],
    row?: Row | Partial<Row>,
  ): SyncMutationSubmission {
    const ref = crypto.randomUUID();
    const message: SyncMutateMessage = {
      type: 'sync.mutate', ref, table, op: operation,
      ...(operation === 'INSERT' ? { row } : { rowId, ...(row ? { row } : {}) }),
    };
    const event = optimisticEvent(operation, table, rowId, ref, row);
    return { message, event };
  }

  function submit(submission: SyncMutationSubmission): void {
    input.queue.submit(submission.message, submission.event);
  }

  function submitAsync(
    submission: SyncMutationSubmission,
    options?: SyncMutationWaitOptions,
  ): Promise<void> {
    if (input.stopped()) {
      return Promise.reject(new SyncMutationError(
        SYNC_MUTATION_ERROR_CODES.clientDisconnected,
        {
          ref: submission.message.ref,
          table: submission.event.table,
          op: submission.message.op,
          rowId: submission.event.rowId,
        },
      ));
    }
    return input.queue.submitAsync(submission.message, submission.event, options);
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
      submit(prepare(table, String(keyedRow[primaryKey]), 'INSERT', keyedRow));
    },
    async insertAsync(
      table: string,
      row: Row,
      options?: SyncMutationWaitOptions,
    ): Promise<void> {
      const primaryKey = requirePrimaryKey(table);
      const keyedRow = ensureRowSyncPrimaryKey(table, input.tables[table], row);
      return submitAsync(
        prepare(table, String(keyedRow[primaryKey]), 'INSERT', keyedRow),
        options,
      );
    },
    update(table: string, id: string, partial: Partial<Row>): void {
      if (input.stopped()) return;
      requirePrimaryKey(table);
      submit(prepare(table, id, 'UPDATE', partial));
    },
    async updateAsync(
      table: string,
      id: string,
      partial: Partial<Row>,
      options?: SyncMutationWaitOptions,
    ): Promise<void> {
      requirePrimaryKey(table);
      return submitAsync(prepare(table, id, 'UPDATE', partial), options);
    },
    delete(table: string, id: string): void {
      if (input.stopped()) return;
      requirePrimaryKey(table);
      submit(prepare(table, id, 'DELETE'));
    },
    async deleteAsync(
      table: string,
      id: string,
      options?: SyncMutationWaitOptions,
    ): Promise<void> {
      requirePrimaryKey(table);
      return submitAsync(prepare(table, id, 'DELETE'), options);
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
