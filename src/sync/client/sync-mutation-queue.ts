import type {
  PendingMutation,
  Row,
  SyncDataPlaneName,
  SyncMutationRejection,
  SyncMutateMessage,
} from '../types';
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
  acknowledge(ref: string): void {
    for (const [key, pending] of this.inFlight) {
      if (pending.message.ref !== ref) continue;
      this.inFlight.delete(key);
      this.flush(key);
      return;
    }
  }
  snapshot(tables: Set<string>, preservePending = false): void {
    if (preservePending) return;
    if (tables.size === 0) return;
    for (const key of this.queued.keys()) {
      if (tables.has(tableFromKey(key))) this.queued.delete(key);
    }
    for (const key of this.inFlight.keys()) {
      if (tables.has(tableFromKey(key))) this.inFlight.delete(key);
    }
  }
  timeout(mutation: PendingMutation): void {
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
    const key = rowKey(mutation.table, mutation.rowId);
    if (this.inFlight.get(key)?.message.ref !== mutation.ref) return;
    this.inFlight.delete(key);
    this.flush(key);
  }
  clear(): void {
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
