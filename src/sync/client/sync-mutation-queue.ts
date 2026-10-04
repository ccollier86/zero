import type {
  PendingMutation,
  Row,
  SyncAckMessage,
  SyncDataPlaneName,
  SyncMutationRejection,
  SyncMutateMessage,
} from '../types';
import {
  SYNC_MUTATION_ERROR_CODES,
  SyncMutationReceipts,
  type SyncMutationReceiptDropCode,
  type SyncMutationWaitOptions,
} from './sync-mutation-receipts';
export type SyncOptimisticEvent = {
  type: 'optimistic.insert' | 'optimistic.update' | 'optimistic.delete';
  table: string;
  rowId: string;
  ref: string;
  row?: Row;
  partial?: Partial<Row>;
};
type SyncMutationEvent = SyncOptimisticEvent | {
  type: 'sync.ack'; ref: string; ok: false; error: string;
} | {
  type: 'sync.mutation-sent'; ref: string; sentAt: number; attempt: number;
};
interface QueuedMutation {
  message: SyncMutateMessage;
  event: SyncOptimisticEvent;
  attempts: number;
}
interface SyncMutationQueueInput {
  apply: (event: SyncMutationEvent) => void;
  send: (message: string) => boolean;
  route: (table: string) => {
    epoch: string | null;
    plane?: SyncDataPlaneName;
  };
  rejected: (rejection: SyncMutationRejection) => void;
}
/** Serializes optimistic mutations that target the same row. */
export class SyncMutationQueue {
  private readonly queued = new Map<string, QueuedMutation[]>();
  private readonly inFlight = new Map<string, QueuedMutation>();
  private readonly receipts = new SyncMutationReceipts();
  constructor(private readonly input: SyncMutationQueueInput) {}
  submit(message: SyncMutateMessage, event: SyncOptimisticEvent): void {
    const key = rowKey(event.table, event.rowId);
    if (this.inFlight.has(key)) {
      const queue = this.queued.get(key) ?? [];
      queue.push({ message, event, attempts: 0 });
      this.queued.set(key, queue);
      return;
    }
    this.dispatch(key, { message, event, attempts: 0 });
  }
  submitAsync(
    message: SyncMutateMessage,
    event: SyncOptimisticEvent,
    options?: SyncMutationWaitOptions,
  ): Promise<void> {
    const receipt = this.receipts.register({
      ref: message.ref,
      table: event.table,
      op: message.op,
      rowId: event.rowId,
    }, options);
    if (!receipt.accepted) return receipt.promise;
    try {
      this.submit(message, event);
    } catch {
      this.receipts.reject(
        message.ref,
        SYNC_MUTATION_ERROR_CODES.submissionFailed,
      );
    }
    return receipt.promise;
  }
  acknowledge(message: SyncAckMessage): void {
    for (const [key, pending] of this.inFlight) {
      if (pending.message.ref !== message.ref) continue;
      this.inFlight.delete(key);
      this.flush(key);
      if (message.ok) this.receipts.resolve(message.ref);
      else {
        this.receipts.reject(
          message.ref,
          SYNC_MUTATION_ERROR_CODES.serverRejected,
          message.errorCode ?? null,
        );
      }
      return;
    }
  }
  snapshot(tables: Set<string>, preservePending = false): void {
    if (preservePending) return;
    if (tables.size === 0) return;
    for (const [key, queue] of this.queued) {
      if (!tables.has(tableFromKey(key))) continue;
      for (const mutation of queue) {
        this.receipts.reject(
          mutation.message.ref,
          SYNC_MUTATION_ERROR_CODES.snapshotReplaced,
        );
      }
      this.queued.delete(key);
    }
    for (const [key, mutation] of this.inFlight) {
      if (!tables.has(tableFromKey(key))) continue;
      this.receipts.reject(
        mutation.message.ref,
        SYNC_MUTATION_ERROR_CODES.snapshotReplaced,
      );
      this.inFlight.delete(key);
    }
  }
  timeout(mutation: PendingMutation): void {
    const key = rowKey(mutation.table, mutation.rowId);
    if (this.inFlight.get(key)?.message.ref !== mutation.ref) return;
    this.input.apply({
      type: 'sync.ack', ref: mutation.ref, ok: false, error: 'Mutation timeout',
    });
    this.input.rejected({
      ref: mutation.ref,
      table: mutation.table,
      op: mutation.op,
      rowId: mutation.rowId,
      plane: this.input.route(mutation.table).plane,
      error: 'Mutation timeout',
      source: 'timeout',
    });
    this.inFlight.delete(key);
    this.flush(key);
    this.receipts.reject(
      mutation.ref,
      SYNC_MUTATION_ERROR_CODES.acknowledgmentTimeout,
    );
  }
  clear(reason: SyncMutationReceiptDropCode): void {
    this.receipts.rejectAll(reason);
    this.queued.clear();
    this.inFlight.clear();
  }
  /** Retry uncertain writes only after a new authoritative baseline arrives. */
  resume(): void {
    for (const mutation of this.inFlight.values()) this.transmit(mutation);
  }
  private dispatch(key: string, mutation: QueuedMutation): void {
    this.input.apply(mutation.event);
    this.inFlight.set(key, mutation);
    this.transmit(mutation);
  }
  private transmit(mutation: QueuedMutation): void {
    const route = this.input.route(mutation.message.table);
    const epoch = mutation.message.epoch ?? route.epoch ?? undefined;
    const plane = mutation.message.plane ?? route.plane;
    const message = {
      ...mutation.message,
      ...(plane === undefined ? {} : { plane }),
      epoch,
      attempt: mutation.attempts + 1,
    };
    if (!this.input.send(JSON.stringify(message))) return;
    mutation.message = message;
    mutation.attempts += 1;
    this.input.apply({ type: 'sync.mutation-sent', ref: message.ref,
      sentAt: Date.now(), attempt: mutation.attempts });
  }
  private flush(key: string): void {
    const queue = this.queued.get(key);
    const next = queue?.shift();
    if (!queue || !next) return void this.queued.delete(key);
    if (queue.length === 0) this.queued.delete(key);
    this.dispatch(key, next);
  }
}
const rowKey = (table: string, rowId: string) => `${table}:${rowId}`;
const tableFromKey = (key: string) => key.split(':', 1)[0];
