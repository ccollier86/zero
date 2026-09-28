import { createStore } from '@xstate/store';
import type { JsonValue } from '../types';
import type { EphemeralErrorMessage } from '../ephemeral-policy';

// ─── Types ─────────────────────────────────────────────────────────────────

export interface EphemeralEntryClient {
  value: JsonValue;
  userId: string;
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
    entries: Record<string, { value: JsonValue; userId: string }>;
  };
  'ephemeral.change': {
    topic: string;
    key: string;
    value: JsonValue | null;
    userId: string;
    op: 'set' | 'delete';
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
          [event.topic]: { entries: { ...event.entries } },
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
                [event.key]: { value: event.value!, userId: event.userId },
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
        entries: wire.entries as Record<string, { value: JsonValue; userId: string }>,
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
