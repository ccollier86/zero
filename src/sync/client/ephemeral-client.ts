import type { JsonValue } from '../types';
import type { EphemeralStore, EphemeralEntryClient } from './ephemeral-store';

// ─── Types ─────────────────────────────────────────────────────────────────

export interface EphemeralChangeEvent {
  topic: string;
  key: string;
  value: JsonValue | null;
  userId: string;
  op: 'set' | 'delete';
}

// ─── EphemeralClient ────────────────────────────────────────────────────────

/**
 * Client-side ephemeral KV API.
 *
 * Topic-scoped, multi-user, no persistence. Fire-and-forget.
 * Wraps the @xstate/store with a user-friendly interface.
 */
export class EphemeralClient {
  private subscribedTopics = new Set<string>();
  private topicListeners = new Map<string, Set<(entries: Record<string, EphemeralEntryClient>) => void>>();
  private throttleTimers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    private sendMessage: (msg: object) => void,
    private store: EphemeralStore
  ) {}

  // ─── Subscribe / Unsubscribe ──────────────────────────────────────────

  /**
   * Subscribe to a topic. Sends subscribe message to server.
   * Returns unsubscribe function.
   */
  subscribe(topic: string, callback: (entries: Record<string, EphemeralEntryClient>) => void): () => void {
    // Subscribe to server topic if not already
    if (!this.subscribedTopics.has(topic)) {
      this.subscribedTopics.add(topic);
      this.sendMessage({ type: 'ephemeral.subscribe', topic });
    }

    // Register callback
    let listeners = this.topicListeners.get(topic);
    if (!listeners) {
      listeners = new Set();
      this.topicListeners.set(topic, listeners);
    }
    listeners.add(callback);

    // Subscribe to store changes for this topic
    const sub = this.store.subscribe(() => {
      const topicState = this.store.getSnapshot().context.topics[topic];
      if (topicState) callback(topicState.entries);
    });

    return () => {
      listeners!.delete(callback);
      sub.unsubscribe();

      if (listeners!.size === 0) {
        this.topicListeners.delete(topic);
        this.subscribedTopics.delete(topic);
        this.sendMessage({ type: 'ephemeral.unsubscribe', topic });
      }
    };
  }

  // ─── Read ─────────────────────────────────────────────────────────────

  /** Get all entries in a topic. */
  getEntries(topic: string): Record<string, EphemeralEntryClient> {
    return this.store.getSnapshot().context.topics[topic]?.entries ?? {};
  }

  /** Get a single entry value. */
  get(topic: string, key: string): JsonValue | undefined {
    return this.getEntries(topic)[key]?.value;
  }

  // ─── Write ────────────────────────────────────────────────────────────

  /** Set a key in a topic. Fire-and-forget. */
  set(topic: string, key: string, value: JsonValue, ttl?: number): void {
    this.sendMessage({ type: 'ephemeral.set', topic, key, value, ttl });
  }

  /**
   * Set a key with throttle — at most once per `intervalMs`.
   * For high-frequency updates like cursor position.
   */
  setThrottled(topic: string, key: string, value: JsonValue, intervalMs: number, ttl?: number): void {
    const throttleKey = `${topic}:${key}`;
    if (this.throttleTimers.has(throttleKey)) return;

    this.set(topic, key, value, ttl);
    this.throttleTimers.set(
      throttleKey,
      setTimeout(() => this.throttleTimers.delete(throttleKey), intervalMs)
    );
  }

  /** Delete a key from a topic. */
  delete(topic: string, key: string): void {
    this.sendMessage({ type: 'ephemeral.delete', topic, key });
  }

  // ─── Cleanup ──────────────────────────────────────────────────────────

  dispose(): void {
    // Unsubscribe from all topics
    for (const topic of this.subscribedTopics) {
      this.sendMessage({ type: 'ephemeral.unsubscribe', topic });
    }
    this.subscribedTopics.clear();
    this.topicListeners.clear();

    // Clear throttle timers
    for (const timer of this.throttleTimers.values()) {
      clearTimeout(timer);
    }
    this.throttleTimers.clear();
  }
}
