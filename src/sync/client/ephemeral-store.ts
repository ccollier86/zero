import { createStore } from '@xstate/store';
import type { JsonValue } from '../types';

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
export function routeEphemeralMessage(
  store: EphemeralStore,
  msg: { type: string; [key: string]: unknown }
): boolean {
  switch (msg.type) {
    case 'ephemeral.snapshot':
      store.send({
        type: 'ephemeral.snapshot' as const,
        topic: msg.topic as string,
        entries: msg.entries as Record<string, { value: JsonValue; userId: string }>,
      });
      return true;

    case 'ephemeral.change':
      store.send({
        type: 'ephemeral.change' as const,
        topic: msg.topic as string,
        key: msg.key as string,
        value: msg.value as JsonValue | null,
        userId: msg.userId as string,
        op: msg.op as 'set' | 'delete',
      });
      return true;

    default:
      return false;
  }
}
