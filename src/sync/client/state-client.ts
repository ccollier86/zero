import type { StateStore } from './state-store';
import type { JsonValue, StateChangeEvent } from '../types';

function copyEntries(
  source: Readonly<Record<string, JsonValue>>,
  prefix?: string,
): Record<string, JsonValue> {
  const result = Object.create(null) as Record<string, JsonValue>;
  for (const key of Object.keys(source)) {
    if (prefix === undefined || key.startsWith(prefix)) {
      result[key] = source[key];
    }
  }
  return result;
}

function readEntry(
  entries: Readonly<Record<string, JsonValue>>,
  key: string,
): JsonValue | undefined {
  return Object.hasOwn(entries, key) ? entries[key] : undefined;
}

/**
 * Client-side state sync API.
 *
 * Wraps the @xstate/store with a user-friendly interface.
 * All writes are optimistic — applied locally first, then synced to server.
 * Reads are always local (no server round-trip).
 */
export class StateClient {
  private authorizationScopeTransition = false;
  private keyListeners = new Map<string, Set<(value: JsonValue | undefined) => void>>();
  private globalListeners = new Set<(event: StateChangeEvent) => void>();
  private unsubStore: () => void;

  constructor(
    private sendMessage: (msg: object) => void,
    private store: StateStore
  ) {
    // Listen for store changes to notify subscribers
    const sub = this.store.subscribe((snapshot) => {
      // This fires on every store event — we use it to drive key subscriptions
      // The actual key/value diffing happens in the subscribe implementation
    });
    this.unsubStore = () => sub.unsubscribe();
  }

  // ─── Write ───────────────────────────────────────────────────────────

  /**
   * Set a key-value pair. Optimistic — applies locally immediately,
   * then syncs to server. Value must be JSON-serializable.
   */
  set(key: string, value: JsonValue): void {
    this.assertScopeWritesAvailable();
    const ref = crypto.randomUUID();

    // Optimistic local apply
    this.store.send({
      type: 'state.optimistic-set' as const,
      ref,
      key,
      value,
    } as any);

    // Notify listeners
    this.notifyKeyListeners(key, value);
    this.notifyGlobalListeners({ type: 'set', key, value, source: 'local' });

    // Send to server
    this.sendMessage({ type: 'state.set', ref, key, value });
  }

  /**
   * Delete a key. Optimistic — removes locally immediately.
   */
  delete(key: string): void {
    this.assertScopeWritesAvailable();
    const ref = crypto.randomUUID();

    this.store.send({
      type: 'state.optimistic-delete' as const,
      ref,
      key,
    } as any);

    this.notifyKeyListeners(key, undefined);
    this.notifyGlobalListeners({ type: 'delete', key, value: undefined, source: 'local' });

    this.sendMessage({ type: 'state.delete', ref, key });
  }

  /**
   * Clear all state for the current user. Optimistic.
   */
  clear(): void {
    this.assertScopeWritesAvailable();
    const ref = crypto.randomUUID();

    // Get all current keys to notify listeners
    const entries = this.store.getSnapshot().context.entries;
    const keys = Object.keys(entries);

    this.store.send({
      type: 'state.optimistic-clear' as const,
      ref,
    } as any);

    // Notify all key listeners
    for (const key of keys) {
      this.notifyKeyListeners(key, undefined);
    }
    this.notifyGlobalListeners({ type: 'clear', key: null, value: undefined, source: 'local' });

    this.sendMessage({ type: 'state.clear', ref });
  }

  // ─── Read ────────────────────────────────────────────────────────────

  /**
   * Get a value by key. Local read — no server round-trip.
   */
  get(key: string): JsonValue | undefined;
  get<T extends JsonValue>(key: string, defaultValue: T): T;
  get(key: string, defaultValue?: JsonValue): JsonValue | undefined {
    const value = readEntry(this.store.getSnapshot().context.entries, key);
    return value !== undefined ? value : defaultValue;
  }

  /** Get all entries as a shallow, prototype-free dictionary. */
  getAll(): Record<string, JsonValue> {
    return copyEntries(this.store.getSnapshot().context.entries);
  }

  /**
   * Get all entries matching a prefix.
   */
  getByPrefix(prefix: string): Record<string, JsonValue> {
    return copyEntries(this.store.getSnapshot().context.entries, prefix);
  }

  /** Number of keys in the state. */
  get size(): number {
    return Object.keys(this.store.getSnapshot().context.entries).length;
  }

  /** Whether the initial snapshot has been received from the server. */
  get ready(): boolean {
    return this.store.getSnapshot().context.ready;
  }

  // ─── Subscribe ───────────────────────────────────────────────────────

  /**
   * Subscribe to changes on a specific key.
   * Returns an unsubscribe function.
   */
  subscribe(key: string, callback: (value: JsonValue | undefined) => void): () => void;

  /**
   * Subscribe to all state changes.
   * Returns an unsubscribe function.
   */
  subscribe(callback: (event: StateChangeEvent) => void): () => void;

  subscribe(
    keyOrCallback: string | ((event: StateChangeEvent) => void),
    callback?: (value: JsonValue | undefined) => void
  ): () => void {
    if (typeof keyOrCallback === 'string' && callback) {
      // Key-specific subscription
      const key = keyOrCallback;
      let listeners = this.keyListeners.get(key);
      if (!listeners) {
        listeners = new Set();
        this.keyListeners.set(key, listeners);
      }
      listeners.add(callback);

      return () => {
        listeners!.delete(callback);
        if (listeners!.size === 0) {
          this.keyListeners.delete(key);
        }
      };
    } else if (typeof keyOrCallback === 'function') {
      // Global subscription
      const cb = keyOrCallback;
      this.globalListeners.add(cb);
      return () => {
        this.globalListeners.delete(cb);
      };
    }

    return () => {};
  }

  // ─── Remote Change Handling ──────────────────────────────────────────

  /**
   * Called when a remote state.change arrives (from another device).
   * The store has already been updated — this notifies subscribers.
   */
  handleRemoteChange(op: 'set' | 'delete' | 'clear', key: string | null, value: JsonValue | undefined): void {
    if (op === 'clear') {
      // Notify all key listeners with undefined
      for (const [k, listeners] of this.keyListeners) {
        for (const cb of listeners) cb(undefined);
      }
    } else if (key !== null) {
      this.notifyKeyListeners(key, value);
    }

    this.notifyGlobalListeners({ type: op, key, value, source: 'remote' });
  }

  /**
   * Called when a snapshot arrives — notify all listeners.
   */
  handleSnapshot(): void {
    const entries = this.store.getSnapshot().context.entries;
    for (const [key, listeners] of this.keyListeners) {
      const value = readEntry(entries, key);
      for (const cb of listeners) cb(value);
    }
  }

  // ─── Cleanup ─────────────────────────────────────────────────────────

  dispose(): void {
    this.unsubStore();
    this.keyListeners.clear();
    this.globalListeners.clear();
  }

  /** @internal Purge user state and freeze writes across a scope replacement. */
  beginAuthorizationScopeTransition(): void {
    this.authorizationScopeTransition = true;
    this.store.send({ type: 'state.reset' } as any);
  }

  /** @internal Resume state operations after replacement credentials install. */
  completeAuthorizationScopeTransition(): void {
    this.authorizationScopeTransition = false;
  }

  // ─── Internal ────────────────────────────────────────────────────────

  private notifyKeyListeners(key: string, value: JsonValue | undefined): void {
    const listeners = this.keyListeners.get(key);
    if (!listeners) return;
    for (const cb of listeners) cb(value);
  }

  private assertScopeWritesAvailable(): void {
    if (this.authorizationScopeTransition) {
      throw new Error(
        '[state] Writes are unavailable during an authorization scope transition.',
      );
    }
  }

  private notifyGlobalListeners(event: StateChangeEvent): void {
    for (const cb of this.globalListeners) cb(event);
  }
}
