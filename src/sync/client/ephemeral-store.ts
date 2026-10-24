import { createStore } from '@xstate/store';
import type { EphemeralFreshness, EphemeralWireEntry, JsonValue } from '../types';
import type { EphemeralErrorMessage } from '../ephemeral-policy';

// ─── Types ─────────────────────────────────────────────────────────────────

export interface EphemeralEntryClient extends EphemeralWireEntry {
  /** Local monotonic receipt time. Never accepted from the wire or publisher. */
  observedAt?: number;
}

export interface EphemeralTopicState {
  entries: Record<string, EphemeralEntryClient>;
}

export interface EphemeralStoreContext {
  topics: Record<string, EphemeralTopicState>;
}

// ─── Store Events ───────────────────────────────────────────────────────────

type EphemeralStoreEvents = {
  'ephemeral.snapshot': {
    topic: string;
    entries: Record<string, EphemeralWireEntry>;
  };
  'ephemeral.change': {
    topic: string;
    key: string;
    value: JsonValue | null;
    userId: string;
    op: 'set' | 'delete';
    freshness?: EphemeralFreshness;
  };
  'ephemeral.clear-topic': {
    topic: string;
  };
};

// ─── Factory ────────────────────────────────────────────────────────────────

export function createEphemeralStore() {
  return createStore({
    context: {
      topics: {} as Record<string, EphemeralTopicState>,
    },

    on: {
      'ephemeral.snapshot': (
        ctx,
        event: EphemeralStoreEvents['ephemeral.snapshot']
      ) => ({
        ...ctx,
        topics: {
          ...ctx.topics,
          [event.topic]: { entries: observeSnapshot(event.entries) },
        },
      }),

      'ephemeral.change': (
        ctx,
        event: EphemeralStoreEvents['ephemeral.change']
      ) => {
        const topicState = ctx.topics[event.topic] ?? { entries: {} };

        if (event.op === 'delete') {
          const { [event.key]: _, ...rest } = topicState.entries;
          return {
            ...ctx,
            topics: {
              ...ctx.topics,
              [event.topic]: { entries: rest },
            },
          };
        }

        return {
          ...ctx,
          topics: {
            ...ctx.topics,
            [event.topic]: {
              entries: {
                ...topicState.entries,
                [event.key]: observeEntry({ value: event.value!, userId: event.userId,
                  ...(event.freshness !== undefined ? { freshness: event.freshness } : {}) }),
              },
            },
          },
        };
      },

      'ephemeral.clear-topic': (
        ctx,
        event: EphemeralStoreEvents['ephemeral.clear-topic']
      ) => {
        const { [event.topic]: _, ...rest } = ctx.topics;
        return { ...ctx, topics: rest };
      },
    },
  });
}

export type EphemeralStore = ReturnType<typeof createEphemeralStore>;

function observeEntry(entry: EphemeralWireEntry): EphemeralEntryClient {
  return { value: entry.value, userId: entry.userId,
    ...(entry.freshness !== undefined ? { freshness: entry.freshness, observedAt: performance.now() } : {}) };
}

function observeSnapshot(entries: Record<string, EphemeralWireEntry>): Record<string, EphemeralEntryClient> {
  if (!entries || typeof entries !== 'object' || Array.isArray(entries)) return {};
  return Object.fromEntries(Object.entries(entries)
    .filter(([, entry]) => !!entry && typeof entry === 'object' && typeof entry.userId === 'string')
    .map(([key, entry]) => [key, observeEntry(entry)]));
}

// ─── Message Router ─────────────────────────────────────────────────────────

/**
 * Route a server message to the ephemeral store.
 * Returns true if the message was handled.
 */
export function routeEphemeralMessage<TMessage extends { type: string }>(
  store: EphemeralStore,
  msg: TMessage,
): boolean {
  const wire = msg as { type: string; [key: string]: unknown };
  switch (msg.type) {
    case 'ephemeral.snapshot':
      store.send({
        type: 'ephemeral.snapshot' as const,
        topic: wire.topic as string,
        entries: wire.entries as Record<string, EphemeralWireEntry>,
      });
      return true;

    case 'ephemeral.change':
      store.send({
        type: 'ephemeral.change' as const,
        topic: wire.topic as string,
        key: wire.key as string,
        value: wire.value as JsonValue | null,
        userId: wire.userId as string,
        op: wire.op as 'set' | 'delete',
        ...(wire.freshness !== undefined ? { freshness: wire.freshness as EphemeralFreshness } : {}),
      });
      return true;

    case 'ephemeral.error': {
      const error = wire as unknown as EphemeralErrorMessage;
      // A rejected/revoked subscription cannot leave an older authorized
      // snapshot visible in the browser cache.
      if (error.topic
        && (error.revoked || error.operation === 'subscribe')) {
        store.send({
          type: 'ephemeral.clear-topic' as const,
          topic: error.topic,
        });
      }
      return true;
    }

    default:
      return false;
  }
}
