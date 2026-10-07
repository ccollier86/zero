import type { JsonValue } from '../types';
import type { EphemeralStore, EphemeralEntryClient } from './ephemeral-store';
import type { EphemeralErrorMessage } from '../ephemeral-policy';

// ─── Types ─────────────────────────────────────────────────────────────────

export interface EphemeralChangeEvent {
  topic: string;
  key: string;
  value: JsonValue | null;
  userId: string;
  op: 'set' | 'delete';
}

export type EphemeralErrorListener = (error: EphemeralErrorMessage) => void;

// ─── EphemeralClient ────────────────────────────────────────────────────────

/**
 * Client-side ephemeral KV API.
 *
 * Topic-scoped, multi-user, no persistence. Fire-and-forget.
 * Wraps the @xstate/store with a user-friendly interface.
 */
export class EphemeralClient {
  private disposed = false;
  private authorizationScopeTransition = false;
  private subscribedTopics = new Set<string>();
  private topicListeners = new Map<string, Set<(entries: Record<string, EphemeralEntryClient>) => void>>();
  private throttleTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private errorListeners = new Set<EphemeralErrorListener>();

  constructor(
    private sendMessage: (msg: object) => void,
    private store: EphemeralStore,
    private sendTransientMessage?: (msg: object) => boolean,
  ) {}

  // ─── Subscribe / Unsubscribe ──────────────────────────────────────────

  /**
   * Subscribe to a topic. Sends subscribe message to server.
   * Returns unsubscribe function.
   */
  subscribe(topic: string, callback: (entries: Record<string, EphemeralEntryClient>) => void): () => void {
    this.assertScopeWritesAvailable();
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
        // The scope lifecycle has already closed the Sync write barrier while
        // React tears down subscriptions. There is no old-scope server
        // subscription left to notify, and sending here would throw through
        // SyncClient.sendRaw().
        if (!this.authorizationScopeTransition) {
          this.sendMessage({ type: 'ephemeral.unsubscribe', topic });
        }
        this.store.send({ type: 'ephemeral.clear-topic', topic });
      }
    };
  }

  /** Observe stable server-side authorization and validation failures. */
  onError(listener: EphemeralErrorListener): () => void {
    this.errorListeners.add(listener);
    return () => { this.errorListeners.delete(listener); };
  }

  /** @internal Route an `ephemeral.error` wire message from the SDK. */
  handleError(error: EphemeralErrorMessage): void {
    if (error.topic && error.operation === 'subscribe') {
      this.subscribedTopics.delete(error.topic);
    }
    for (const listener of this.errorListeners) listener(error);
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
    this.assertScopeWritesAvailable();
    this.sendMessage({ type: 'ephemeral.set', topic, key, value, ttl });
  }
  /** Best-effort current-connection observation; deliberately drops instead of queuing. */
  setTransient(topic: string, key: string, value: JsonValue): boolean {
    if (this.disposed || this.authorizationScopeTransition || !this.sendTransientMessage) return false;
    return this.sendTransientMessage({ type: 'ephemeral.set', topic, key, value });
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
    this.assertScopeWritesAvailable();
    this.sendMessage({ type: 'ephemeral.delete', topic, key });
  }

  // ─── Cleanup ──────────────────────────────────────────────────────────

  dispose(): void {
    this.disposed = true;
    // Unsubscribe from all topics
    for (const topic of this.subscribedTopics) {
      if (!this.authorizationScopeTransition) {
        this.sendMessage({ type: 'ephemeral.unsubscribe', topic });
      }
      this.store.send({ type: 'ephemeral.clear-topic', topic });
    }
    this.subscribedTopics.clear();
    this.topicListeners.clear();
    this.errorListeners.clear();

    // Clear throttle timers
    for (const timer of this.throttleTimers.values()) {
      clearTimeout(timer);
    }
    this.throttleTimers.clear();
  }

  /** @internal Purge values and freeze topic operations during scope replacement. */
  beginAuthorizationScopeTransition(): void {
    this.authorizationScopeTransition = true;
    for (const topic of this.subscribedTopics) {
      this.store.send({ type: 'ephemeral.clear-topic', topic });
    }
    for (const timer of this.throttleTimers.values()) clearTimeout(timer);
    this.throttleTimers.clear();
  }

  /** @internal Resume and re-prove retained topic subscriptions in the new scope. */
  completeAuthorizationScopeTransition(): void {
    this.authorizationScopeTransition = false;
    for (const topic of this.subscribedTopics) {
      this.sendMessage({ type: 'ephemeral.subscribe', topic });
    }
  }

  private assertScopeWritesAvailable(): void {
    if (this.authorizationScopeTransition) {
      throw new Error(
        '[ephemeral] Operations are unavailable during an authorization scope transition.',
      );
    }
  }
}
