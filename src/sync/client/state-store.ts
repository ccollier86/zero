import { createStore } from '@xstate/store';
import type { JsonValue, PendingStateOp } from '../types';

// ─── Store Context ──────────────────────────────────────────────────────────

export interface StateStoreContext {
  entries: Record<string, JsonValue>;
  ready: boolean;
  pending: PendingStateOp[];
}

// ─── Store Events ───────────────────────────────────────────────────────────

type StateStoreEvents = {
  'state.snapshot': { entries: Record<string, JsonValue> };
  'state.change': {
    key: string | null;
    value: JsonValue | undefined;
    op: 'set' | 'delete' | 'clear';
  };
  'state.optimistic-set': { ref: string; key: string; value: JsonValue };
  'state.optimistic-delete': { ref: string; key: string };
  'state.optimistic-clear': { ref: string };
  'state.ack': { ref: string; ok: boolean; error?: string };
};

// ─── Factory ────────────────────────────────────────────────────────────────

/**
 * Create a state sync @xstate/store.
 *
 * Handles server messages (snapshot, change) and optimistic operations
 * (set, delete, clear) with pending queue and rollback.
 *
 * All reducers return full context spread ({ ...ctx, ... }) as required
 * by @xstate/store's type system.
 */
export function createStateStore() {
  return createStore({
    context: {
      entries: {} as Record<string, JsonValue>,
      ready: false as boolean,
      pending: [] as PendingStateOp[],
    },

    on: {
      // ─── Server Messages ──────────────────────────────────────────

      'state.snapshot': (
        ctx,
        event: StateStoreEvents['state.snapshot']
      ) => ({
        ...ctx,
        entries: { ...event.entries },
        ready: true,
        pending: [] as PendingStateOp[],
      }),

      'state.change': (
        ctx,
        event: StateStoreEvents['state.change']
      ) => {
        switch (event.op) {
          case 'set': {
            if (event.key === null) return ctx;
            return {
              ...ctx,
              entries: { ...ctx.entries, [event.key]: event.value! },
            };
          }
          case 'delete': {
            if (event.key === null) return ctx;
            const { [event.key]: _, ...rest } = ctx.entries;
            return { ...ctx, entries: rest };
          }
          case 'clear':
            return { ...ctx, entries: {} as Record<string, JsonValue> };
          default:
            return ctx;
        }
      },

      // ─── Optimistic Operations ────────────────────────────────────

      'state.optimistic-set': (
        ctx,
        event: StateStoreEvents['state.optimistic-set']
      ) => ({
        ...ctx,
        entries: { ...ctx.entries, [event.key]: event.value },
        pending: [
          ...ctx.pending,
          {
            ref: event.ref,
            op: 'set' as const,
            key: event.key,
            previousValue: ctx.entries[event.key],
            previousEntries: null,
          },
        ],
      }),

      'state.optimistic-delete': (
        ctx,
        event: StateStoreEvents['state.optimistic-delete']
      ) => {
        const { [event.key]: _, ...rest } = ctx.entries;
        return {
          ...ctx,
          entries: rest,
          pending: [
            ...ctx.pending,
            {
              ref: event.ref,
              op: 'delete' as const,
              key: event.key,
              previousValue: ctx.entries[event.key],
              previousEntries: null,
            },
          ],
        };
      },

      'state.optimistic-clear': (
        ctx,
        event: StateStoreEvents['state.optimistic-clear']
      ) => ({
        ...ctx,
        entries: {} as Record<string, JsonValue>,
        pending: [
          ...ctx.pending,
          {
            ref: event.ref,
            op: 'clear' as const,
            key: null,
            previousValue: undefined,
            previousEntries: { ...ctx.entries },
          },
        ],
      }),

      // ─── Ack / Rollback ───────────────────────────────────────────

      'state.ack': (
        ctx,
        event: StateStoreEvents['state.ack']
      ) => {
        const idx = ctx.pending.findIndex((p) => p.ref === event.ref);
        if (idx === -1) return ctx;

        const op = ctx.pending[idx];
        const newPending = [
          ...ctx.pending.slice(0, idx),
          ...ctx.pending.slice(idx + 1),
        ];

        if (event.ok) {
          return { ...ctx, pending: newPending };
        }

        // Failure — rollback
        let entries = ctx.entries;

        switch (op.op) {
          case 'set':
            if (op.previousValue !== undefined) {
              entries = { ...entries, [op.key!]: op.previousValue };
            } else {
              const { [op.key!]: _, ...rest } = entries;
              entries = rest;
            }
            break;

          case 'delete':
            if (op.previousValue !== undefined) {
              entries = { ...entries, [op.key!]: op.previousValue };
            }
            break;

          case 'clear':
            if (op.previousEntries) {
              entries = { ...op.previousEntries };
            }
            break;
        }

        return { ...ctx, entries, pending: newPending };
      },
    },
  });
}

/** Type of the state store instance. */
export type StateStore = ReturnType<typeof createStateStore>;

// ─── Message Router ─────────────────────────────────────────────────────────

/**
 * Route a server message to the state store.
 * Returns true if the message was handled, false if not a state message.
 */
export function routeStateMessage(
  store: StateStore,
  msg: { type: string; [key: string]: unknown }
): boolean {
  switch (msg.type) {
    case 'state.snapshot':
      store.send({
        type: 'state.snapshot' as const,
        entries: msg.entries as Record<string, JsonValue>,
      });
      return true;

    case 'state.change':
      store.send({
        type: 'state.change' as const,
        key: msg.key as string | null,
        value: msg.value as JsonValue | undefined,
        op: msg.op as 'set' | 'delete' | 'clear',
      });
      return true;

    case 'state.ack':
      store.send({
        type: 'state.ack' as const,
        ref: msg.ref as string,
        ok: msg.ok as boolean,
        error: msg.error as string | undefined,
      });
      return true;

    default:
      return false;
  }
}
