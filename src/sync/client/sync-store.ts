import { createStore } from '@xstate/store';
import type {
  Row,
  ChangeOp,
  PendingMutation,
  ClientTableDef,
  ServerMessage,
} from '../types';

// ─── Store Context ──────────────────────────────────────────────────────────

/**
 * The shape of the sync store's context.
 * Dynamic: one Record<string, Row> per table, plus _sync metadata.
 */
export interface SyncStoreContext {
  /** Dynamic table data: Record<primaryKey, Row> per table */
  [table: string]: Record<string, Row> | SyncMeta;

  /** Sync metadata — connection state, seq tracking, pending queue */
  _sync: SyncMeta;
}

export interface SyncMeta {
  connected: boolean;
  lastSeq: number;
  pending: PendingMutation[];
}

// ─── Store Events ───────────────────────────────────────────────────────────

type SyncStoreEvents = {
  // Server messages
  'sync.snapshot': { tables: Record<string, Record<string, Row>>; seq: number };
  'sync.change': {
    seq: number;
    table: string;
    op: ChangeOp;
    rowId: string;
    row: Row | null;
  };
  'sync.ack': { ref: string; ok: boolean; error?: string; seq?: number | null };
  'sync.catchup': {
    changes: Array<{
      seq: number;
      table: string;
      op: ChangeOp;
      rowId: string;
      row: Row | null;
    }>;
    seq: number;
  };

  // Bulk load rows into a table (for lazy tables loaded via REST)
  'sync.load': { table: string; rows: Record<string, Row>; replace?: boolean };

  // Connection events
  'sync.connected': Record<string, never>;
  'sync.disconnected': Record<string, never>;
  'sync.reset': Record<string, never>;

  // Optimistic mutations — generic (table name passed as field)
  'optimistic.insert': { table: string; rowId: string; row: Row; ref: string };
  'optimistic.update': {
    table: string;
    rowId: string;
    partial: Partial<Row>;
    ref: string;
  };
  'optimistic.delete': { table: string; rowId: string; ref: string };
};

// ─── Store Factory ──────────────────────────────────────────────────────────

/**
 * Create a sync store for the given table definitions.
 *
 * Returns an @xstate/store instance with:
 * - One Record<PK, Row> per table (initially empty)
 * - _sync metadata { connected, lastSeq, pending }
 * - Reducers for all server messages and optimistic mutations
 */
export function createSyncStore(tables: Record<string, ClientTableDef>) {
  // Build initial context: empty record per table + sync metadata
  const tableDefs = tables;
  const createInitialContext = (): SyncStoreContext => {
    const context: SyncStoreContext = {
      _sync: {
        connected: false,
        lastSeq: 0,
        pending: [],
      },
    };

    for (const tableName of Object.keys(tableDefs)) {
      context[tableName] = {} as Record<string, Row>;
    }

    return context;
  };

  const store = createStore({
    context: createInitialContext(),

    on: {
      // ─── Server: Full snapshot ──────────────────────────────
      'sync.snapshot': (ctx, event: SyncStoreEvents['sync.snapshot']) => {
        const newCtx = { ...ctx };
        const snapshotTables = new Set(Object.keys(event.tables));
        // Replace table contents from snapshot
        for (const [table, rows] of Object.entries(event.tables)) {
          newCtx[table] = rows;
        }
        // Only clear pending mutations for tables included in the snapshot
        newCtx._sync = {
          ...ctx._sync,
          lastSeq: event.seq,
          pending: ctx._sync.pending.filter(p => !snapshotTables.has(p.table)),
        };
        return newCtx;
      },

      // ─── Server: Single change ─────────────────────────────
      // Applies server's canonical row state regardless of origin.
      // The origin field is NOT checked — every change updates the row.
      // sync.ack handles clearing pending separately.
      'sync.change': (ctx, event: SyncStoreEvents['sync.change']) => {
        const { seq, table, op, rowId, row } = event;
        const tableData = { ...(ctx[table] as Record<string, Row>) };

        switch (op) {
          case 'INSERT':
          case 'UPDATE':
            if (row) tableData[rowId] = row;
            break;
          case 'DELETE':
            delete tableData[rowId];
            break;
        }

        return {
          ...ctx,
          [table]: tableData,
          _sync: { ...ctx._sync, lastSeq: seq },
        };
      },

      // ─── Server: Ack (confirm or rollback) ─────────────────
      'sync.ack': (ctx, event: SyncStoreEvents['sync.ack']) => {
        const { ref, ok } = event;

        if (ok) {
          // Confirmed — remove from pending
          return {
            ...ctx,
            _sync: {
              ...ctx._sync,
              pending: ctx._sync.pending.filter((p) => p.ref !== ref),
            },
          };
        }

        // Rejected — rollback to previous state
        const mutation = ctx._sync.pending.find((p) => p.ref === ref);
        if (!mutation) return ctx;

        const tableData = { ...(ctx[mutation.table] as Record<string, Row>) };
        if (mutation.previousState) {
          tableData[mutation.rowId] = mutation.previousState;
        } else {
          delete tableData[mutation.rowId];
        }

        return {
          ...ctx,
          [mutation.table]: tableData,
          _sync: {
            ...ctx._sync,
            pending: ctx._sync.pending.filter((p) => p.ref !== ref),
          },
        };
      },

      // ─── Server: Catchup (array of missed changes) ────────
      // Applies each change AND prunes matching pending mutations
      'sync.catchup': (ctx, event: SyncStoreEvents['sync.catchup']) => {
        let newCtx = { ...ctx };
        let pending = [...ctx._sync.pending];

        for (const change of event.changes) {
          const tableData = { ...(newCtx[change.table] as Record<string, Row>) };

          switch (change.op) {
            case 'INSERT':
            case 'UPDATE':
              if (change.row) tableData[change.rowId] = change.row;
              break;
            case 'DELETE':
              delete tableData[change.rowId];
              break;
          }

          newCtx = { ...newCtx, [change.table]: tableData };

          // If a pending mutation matches table + rowId, it was
          // confirmed by the server — remove from pending
          pending = pending.filter(
            (p) => !(p.table === change.table && p.rowId === change.rowId)
          );
        }

        return {
          ...newCtx,
          _sync: { ...newCtx._sync, lastSeq: event.seq, pending },
        };
      },

      // ─── Bulk load rows (for lazy tables) ───────────────────
      'sync.load': (ctx, event: SyncStoreEvents['sync.load']) => {
        const { table, rows, replace } = event;
        const existing = ctx[table] as Record<string, Row>;
        const baseData = replace ? { ...rows } : { ...existing, ...rows };

        // Re-apply pending optimistic mutations for this table
        for (const p of ctx._sync.pending) {
          if (p.table === table && p.optimisticState) {
            baseData[p.rowId] = p.optimisticState;
          }
        }

        return {
          ...ctx,
          [table]: baseData,
        };
      },

      // ─── Connection events ─────────────────────────────────
      'sync.connected': (ctx) => ({
        ...ctx,
        _sync: { ...ctx._sync, connected: true },
      }),

      'sync.disconnected': (ctx) => ({
        ...ctx,
        _sync: { ...ctx._sync, connected: false },
      }),

      'sync.reset': () => createInitialContext(),

      // ─── Optimistic: Insert ────────────────────────────────
      'optimistic.insert': (ctx, event: SyncStoreEvents['optimistic.insert']) => {
        const { table, rowId, row, ref } = event;
        const tableData = { ...(ctx[table] as Record<string, Row>) };
        const previousState = tableData[rowId] ?? null;
        tableData[rowId] = row;

        return {
          ...ctx,
          [table]: tableData,
          _sync: {
            ...ctx._sync,
            pending: [
              ...ctx._sync.pending,
              {
                ref,
                table,
                op: 'INSERT' as const,
                rowId,
                previousState,
                optimisticState: row,
                sentAt: Date.now(),
              },
            ],
          },
        };
      },

      // ─── Optimistic: Update ────────────────────────────────
      'optimistic.update': (
        ctx,
        event: SyncStoreEvents['optimistic.update']
      ) => {
        const { table, rowId, partial, ref } = event;
        const tableData = { ...(ctx[table] as Record<string, Row>) };
        const previousState = tableData[rowId] ?? null;

        if (!previousState) return ctx; // Can't update non-existent row

        const merged = { ...previousState, ...partial };
        tableData[rowId] = merged;

        return {
          ...ctx,
          [table]: tableData,
          _sync: {
            ...ctx._sync,
            pending: [
              ...ctx._sync.pending,
              {
                ref,
                table,
                op: 'UPDATE' as const,
                rowId,
                previousState,
                optimisticState: merged,
                sentAt: Date.now(),
              },
            ],
          },
        };
      },

      // ─── Optimistic: Delete ────────────────────────────────
      'optimistic.delete': (ctx, event: SyncStoreEvents['optimistic.delete']) => {
        const { table, rowId, ref } = event;
        const tableData = { ...(ctx[table] as Record<string, Row>) };
        const previousState = tableData[rowId] ?? null;
        delete tableData[rowId];

        return {
          ...ctx,
          [table]: tableData,
          _sync: {
            ...ctx._sync,
            pending: [
              ...ctx._sync.pending,
              {
                ref,
                table,
                op: 'DELETE' as const,
                rowId,
                previousState,
                optimisticState: null,
                sentAt: Date.now(),
              },
            ],
          },
        };
      },
    },
  });

  return { store, tables: tableDefs };
}

// ─── Slice Utilities ────────────────────────────────────────────────────────

export interface Slice<T> {
  get(): T;
  subscribe(fn: (value: T) => void): () => void;
}

/**
 * Create a slice that selects a specific table's data from the store.
 * Only notifies subscribers when the selected value changes (by reference).
 */
export function createTableSlice<T extends Row>(
  store: ReturnType<typeof createSyncStore>['store'],
  tableName: string
): Slice<Record<string, T>> {
  return createSlice(store, (ctx) => ctx[tableName] as Record<string, T>);
}

/**
 * Create a slice with a custom selector.
 * Only notifies subscribers when the selected value changes (by reference).
 */
export function createSlice<T>(
  store: ReturnType<typeof createSyncStore>['store'],
  selector: (ctx: SyncStoreContext) => T
): Slice<T> {
  return {
    get() {
      return selector(store.getSnapshot().context as SyncStoreContext);
    },
    subscribe(fn: (value: T) => void) {
      let prev = selector(store.getSnapshot().context as SyncStoreContext);
      const subscription = store.subscribe(() => {
        const next = selector(store.getSnapshot().context as SyncStoreContext);
        if (next !== prev) {
          prev = next;
          fn(next);
        }
      });
      return () => subscription.unsubscribe();
    },
  };
}

// ─── Message Router ─────────────────────────────────────────────────────────

/**
 * Route a server message into the store.
 * Called by SyncClient when a message arrives over WebSocket.
 */
export function routeServerMessage(
  store: ReturnType<typeof createSyncStore>['store'],
  msg: ServerMessage
): void {
  switch (msg.type) {
    case 'sync.snapshot':
      store.send({ type: 'sync.snapshot', tables: msg.tables, seq: msg.seq });
      break;

    case 'sync.change':
      store.send({
        type: 'sync.change',
        seq: msg.seq,
        table: msg.table,
        op: msg.op,
        rowId: msg.rowId,
        row: msg.row,
      });
      break;

    case 'sync.ack':
      store.send({
        type: 'sync.ack',
        ref: msg.ref,
        ok: msg.ok,
        error: msg.error,
        seq: msg.seq,
      });
      break;

    case 'sync.catchup':
      store.send({
        type: 'sync.catchup',
        changes: msg.changes,
        seq: msg.seq,
      });
      break;
  }
}
