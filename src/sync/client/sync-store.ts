import { createStore } from '@xstate/store';
import type {
  Row,
  ChangeOp,
  PendingMutation,
  ClientTableDef,
  ServerMessage,
  SyncAckErrorCode,
  SyncDataPlaneName,
} from '../types';
import {
  DEFAULT_SYNC_DATA_PLANE,
  type SyncPlaneCursorState,
  messageSyncDataPlane,
  resolveSyncClientDataPlaneTopology,
  syncDataPlaneForTable,
} from './sync-data-planes';

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
  /** Legacy aliases for the default data-plane cursor. */
  lastSeq: number;
  epoch: string | null;
  scope: string | null;
  /** Independent durable stream cursor for each multiplexed data plane. */
  cursors: Readonly<{
    default: SyncPlaneCursorState;
    tenant: SyncPlaneCursorState;
    system?: SyncPlaneCursorState;
  }>;
  pending: PendingMutation[];
}

export interface SyncStoreOptions {
  /** Exact client table routing catalog. Omitted means legacy/default-only. */
  tableSyncPlanes?: Readonly<Record<string, SyncDataPlaneName>>;
}

// ─── Store Events ───────────────────────────────────────────────────────────

type SyncStoreEvents = {
  // Server messages
  'sync.snapshot': {
    plane?: SyncDataPlaneName;
    tables: Record<string, Record<string, Row>>;
    seq: number;
    epoch?: string;
    scope?: string | null;
    reset?: 'preserve-pending' | 'purge';
  };
  'sync.change': {
    plane?: SyncDataPlaneName;
    seq: number;
    table: string;
    op: ChangeOp;
    rowId: string;
    row: Row | null;
    epoch?: string;
    scope?: string | null;
  };
  'sync.ack': {
    plane?: SyncDataPlaneName;
    ref: string;
    ok: boolean;
    error?: string;
    errorCode?: SyncAckErrorCode;
    seq?: number | null;
    change?: { table: string; op: ChangeOp; rowId: string; row: Row | null };
  };
  'sync.catchup': {
    plane?: SyncDataPlaneName;
    changes: Array<{
      seq: number;
      table: string;
      op: ChangeOp;
      rowId: string;
      row: Row | null;
    }>;
    seq: number;
    epoch?: string;
    scope?: string | null;
  };

  // Bulk load rows into a table (for lazy tables loaded via REST)
  'sync.load': { table: string; rows: Record<string, Row>; replace?: boolean };

  // Connection events
  'sync.connected': Record<string, never>;
  'sync.disconnected': Record<string, never>;
  'sync.reset': Record<string, never>;
  'sync.mutation-sent': { ref: string; sentAt: number; attempt: number };

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

function createEmptyPlaneTables(
  context: SyncStoreContext,
  definitions: Record<string, ClientTableDef>,
  tablePlanes: Readonly<Record<string, SyncDataPlaneName>>,
  plane: SyncDataPlaneName,
): SyncStoreContext {
  const next: SyncStoreContext = { ...context };
  for (const table of Object.keys(definitions)) {
    if (tablePlanes[table] === plane) next[table] = {};
  }
  return next;
}

function reapplyPending(
  context: SyncStoreContext,
  pending: readonly PendingMutation[],
  matches: (mutation: PendingMutation) => boolean = () => true,
  showOptimistic: (mutation: PendingMutation) => boolean = (
    mutation,
  ) => mutation.attempts === 0,
): PendingMutation[] {
  return pending.map((mutation) => {
    if (!matches(mutation)) return mutation;
    const rows = { ...(context[mutation.table] as Record<string, Row> ?? {}) };
    const previousState = rows[mutation.rowId] ?? null;
    const optimisticState = mutation.op === 'DELETE'
      ? null
      : {
          ...(previousState ?? {}),
          ...(mutation.optimisticPatch ?? mutation.optimisticState ?? {}),
        } as Row;
    if (showOptimistic(mutation)) {
      if (optimisticState) rows[mutation.rowId] = optimisticState;
      else delete rows[mutation.rowId];
    }
    context[mutation.table] = rows;
    return { ...mutation, previousState, optimisticState };
  });
}

function restoreAttemptedPending(
  context: SyncStoreContext,
  pending: readonly PendingMutation[],
  matches: (mutation: PendingMutation) => boolean = () => true,
): void {
  for (const mutation of pending) {
    if (mutation.attempts === 0 || !matches(mutation)) continue;
    const rows = { ...(context[mutation.table] as Record<string, Row> ?? {}) };
    if (mutation.previousState) rows[mutation.rowId] = mutation.previousState;
    else delete rows[mutation.rowId];
    context[mutation.table] = rows;
  }
}

function createEmptyCursor(): SyncPlaneCursorState {
  return { lastSeq: 0, epoch: null, scope: null };
}

/** Read one plane cursor while accepting pre-multiplex test/consumer contexts. */
export function getSyncPlaneCursor(
  meta: SyncMeta,
  plane: SyncDataPlaneName,
): SyncPlaneCursorState {
  const cursor = meta.cursors?.[plane];
  if (cursor) return cursor;
  return plane === DEFAULT_SYNC_DATA_PLANE
    ? { lastSeq: meta.lastSeq, epoch: meta.epoch, scope: meta.scope }
    : createEmptyCursor();
}

function updateSyncPlaneCursor(
  meta: SyncMeta,
  plane: SyncDataPlaneName,
  update: Partial<SyncPlaneCursorState>,
): SyncMeta {
  const cursor = { ...getSyncPlaneCursor(meta, plane), ...update };
  const next: SyncMeta = {
    ...meta,
    cursors: {
      ...meta.cursors,
      default: { ...getSyncPlaneCursor(meta, 'default') },
      [plane]: cursor,
    },
  };
  if (plane === DEFAULT_SYNC_DATA_PLANE) {
    next.lastSeq = cursor.lastSeq;
    next.epoch = cursor.epoch;
    next.scope = cursor.scope;
  }
  return next;
}

// ─── Store Factory ──────────────────────────────────────────────────────────

/**
 * Create a sync store for the given table definitions.
 *
 * Returns an @xstate/store instance with:
 * - One Record<PK, Row> per table (initially empty)
 * - _sync metadata { connected, lastSeq, pending }
 * - Reducers for all server messages and optimistic mutations
 */
export function createSyncStore(
  tables: Record<string, ClientTableDef>,
  options: SyncStoreOptions = {},
) {
  // Build initial context: empty record per table + sync metadata
  const tableDefs = tables;
  const { tablePlanes } = resolveSyncClientDataPlaneTopology(
    tables,
    options.tableSyncPlanes,
  );
  const createInitialContext = (): SyncStoreContext => {
    const defaultCursor = createEmptyCursor();
    const context: SyncStoreContext = {
      _sync: {
        connected: false,
        lastSeq: defaultCursor.lastSeq,
        epoch: defaultCursor.epoch,
        scope: defaultCursor.scope,
        cursors: {
          default: defaultCursor,
          tenant: createEmptyCursor(),
        },
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
        const plane = messageSyncDataPlane(event) ?? DEFAULT_SYNC_DATA_PLANE;
        const newCtx = event.reset
          ? createEmptyPlaneTables(ctx, tableDefs, tablePlanes, plane)
          : { ...ctx };
        const snapshotTables = new Set(Object.keys(event.tables));
        // Replace table contents from snapshot
        for (const [table, rows] of Object.entries(event.tables)) {
          newCtx[table] = rows;
        }
        let pending = event.reset === 'purge'
          ? ctx._sync.pending.filter(
              (mutation) => tablePlanes[mutation.table] !== plane,
            )
          : event.reset === 'preserve-pending'
            ? ctx._sync.pending
            : ctx._sync.pending.filter(p => !snapshotTables.has(p.table));
        if (event.reset === 'preserve-pending') {
          pending = reapplyPending(
            newCtx,
            pending,
            (mutation) => tablePlanes[mutation.table] === plane,
          );
        }
        const cursor = getSyncPlaneCursor(ctx._sync, plane);
        newCtx._sync = {
          ...updateSyncPlaneCursor(ctx._sync, plane, {
            lastSeq: event.seq,
            epoch: event.epoch ?? cursor.epoch,
            scope: event.scope === undefined ? cursor.scope : event.scope,
          }),
          pending,
        };
        return newCtx;
      },

      // ─── Server: Single change ─────────────────────────────
      // Applies server's canonical row state regardless of origin.
      // The origin field is NOT checked — every change updates the row.
      // sync.ack handles clearing pending separately.
      'sync.change': (ctx, event: SyncStoreEvents['sync.change']) => {
        const { seq, table, op, rowId, row } = event;
        const plane = messageSyncDataPlane(event) ?? DEFAULT_SYNC_DATA_PLANE;
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

        const next = {
          ...ctx,
          [table]: tableData,
          _sync: updateSyncPlaneCursor(ctx._sync, plane, {
            lastSeq: seq,
            epoch: event.epoch ?? getSyncPlaneCursor(ctx._sync, plane).epoch,
            scope: event.scope === undefined
              ? getSyncPlaneCursor(ctx._sync, plane).scope
              : event.scope,
          }),
        };
        next._sync.pending = reapplyPending(
          next,
          ctx._sync.pending,
          (mutation) => mutation.table === table && mutation.rowId === rowId,
          () => false,
        );
        return next;
      },

      // ─── Server: Ack (confirm or rollback) ─────────────────
      'sync.ack': (ctx, event: SyncStoreEvents['sync.ack']) => {
        const { ref, ok } = event;
        const mutation = ctx._sync.pending.find((pending) => pending.ref === ref);
        if (!mutation) return ctx;

        if (ok) {
          const change = event.change;
          const plane = messageSyncDataPlane(event);
          const mutationPlane = syncDataPlaneForTable(
            tablePlanes,
            mutation.table,
          );
          const cursor = plane === null
            ? null
            : getSyncPlaneCursor(ctx._sync, plane);
          const canonicalIsNewer = plane !== null
            && plane === mutationPlane
            && Number.isSafeInteger(event.seq)
            && (event.seq as number) > cursor!.lastSeq;
          const matches = canonicalIsNewer
            && change
            && change.table === mutation.table
            && change.rowId === mutation.rowId;
          const tableData = { ...(ctx[mutation.table] as Record<string, Row>) };
          if (matches && change) {
            if (change.op === 'DELETE' || !change.row) delete tableData[change.rowId];
            else tableData[change.rowId] = change.row;
          }
          return {
            ...ctx,
            ...(matches ? { [mutation.table]: tableData } : {}),
            _sync: {
              ...ctx._sync,
              pending: ctx._sync.pending.filter((p) => p.ref !== ref),
            },
          };
        }

        // Rejected — rollback to previous state
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
      // Applies authoritative changes; only a receipt/ack settles pending work.
      'sync.catchup': (ctx, event: SyncStoreEvents['sync.catchup']) => {
        const plane = messageSyncDataPlane(event) ?? DEFAULT_SYNC_DATA_PLANE;
        let newCtx = { ...ctx };
        let pending = [...ctx._sync.pending];
        const changedRows = new Set(
          event.changes.map((change) => `${change.table}:${change.rowId}`),
        );
        restoreAttemptedPending(
          newCtx,
          pending,
          (mutation) => tablePlanes[mutation.table] === plane,
        );

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

        }

        pending = reapplyPending(
          newCtx,
          pending,
          (mutation) => tablePlanes[mutation.table] === plane,
          (mutation) => mutation.attempts === 0
            || !changedRows.has(`${mutation.table}:${mutation.rowId}`),
        );

        const cursor = getSyncPlaneCursor(newCtx._sync, plane);

        return {
          ...newCtx,
          _sync: {
            ...updateSyncPlaneCursor(newCtx._sync, plane, {
              lastSeq: event.seq,
              epoch: event.epoch ?? cursor.epoch,
              scope: event.scope === undefined ? cursor.scope : event.scope,
            }),
            pending,
          },
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

      'sync.mutation-sent': (
        ctx,
        event: SyncStoreEvents['sync.mutation-sent'],
      ) => ({
        ...ctx,
        _sync: {
          ...ctx._sync,
          pending: ctx._sync.pending.map((mutation) => mutation.ref === event.ref
            ? { ...mutation, sentAt: event.sentAt, attempts: event.attempt }
            : mutation),
        },
      }),

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
                optimisticPatch: row,
                sentAt: Date.now(),
                attempts: 0,
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
                optimisticPatch: partial,
                sentAt: Date.now(),
                attempts: 0,
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
                attempts: 0,
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
      store.send({
        type: 'sync.snapshot', plane: msg.plane, tables: msg.tables, seq: msg.seq,
        epoch: msg.epoch, scope: msg.scope, reset: msg.reset,
      });
      break;

    case 'sync.change':
      store.send({
        type: 'sync.change',
        plane: msg.plane,
        seq: msg.seq,
        table: msg.table,
        op: msg.op,
        rowId: msg.rowId,
        row: msg.row,
        epoch: msg.epoch,
        scope: msg.scope,
      });
      break;

    case 'sync.ack':
      store.send({
        type: 'sync.ack',
        plane: msg.plane,
        ref: msg.ref,
        ok: msg.ok,
        error: msg.error,
        errorCode: msg.errorCode,
        seq: msg.seq,
        change: msg.change,
      });
      break;

    case 'sync.catchup':
      store.send({
        type: 'sync.catchup',
        plane: msg.plane,
        changes: msg.changes,
        seq: msg.seq,
        epoch: msg.epoch,
        scope: msg.scope,
      });
      break;
  }
}
