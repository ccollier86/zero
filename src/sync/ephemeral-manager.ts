import type { JsonValue } from './types';

// ─── Types ─────────────────────────────────────────────────────────────────

export interface EphemeralEntry {
  value: JsonValue;
  userId: string;
  expiresAt: number;
}

// ─── EphemeralStateManager ──────────────────────────────────────────────────

/**
 * RAM-only topic-scoped KV store with TTL auto-cleanup.
 *
 * No SQLite, no ring buffer — state is gone on server restart (by design).
 * Used for cursors, typing indicators, presence, drag positions, live scores.
 */
export class EphemeralStateManager {
  /** topic → (key → entry) */
  private topics = new Map<string, Map<string, EphemeralEntry>>();
  /** topic → Set<connectionId> */
  private subscribers = new Map<string, Set<string>>();
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor(private cleanupIntervalMs = 5_000) {
    this.cleanupTimer = setInterval(() => this.sweep(), this.cleanupIntervalMs);
  }

  /** Subscribe a connection to a topic. */
  subscribe(topic: string, connectionId: string): void {
    let subs = this.subscribers.get(topic);
    if (!subs) {
      subs = new Set();
      this.subscribers.set(topic, subs);
    }
    subs.add(connectionId);
  }

  /** Unsubscribe a connection from a topic. */
  unsubscribe(topic: string, connectionId: string): void {
    const subs = this.subscribers.get(topic);
    if (!subs) return;
    subs.delete(connectionId);
    if (subs.size === 0) this.subscribers.delete(topic);
  }

  /** Unsubscribe a connection from all topics. */
  unsubscribeAll(connectionId: string): void {
    for (const [topic, subs] of this.subscribers) {
      subs.delete(connectionId);
      if (subs.size === 0) this.subscribers.delete(topic);
    }
  }

  /** Get all subscriber connection IDs for a topic. */
  getSubscribers(topic: string): Set<string> {
    return this.subscribers.get(topic) ?? new Set();
  }

  /** Set a key in a topic. Default TTL: 30 seconds. */
  set(topic: string, key: string, value: JsonValue, userId: string, ttl = 30_000): void {
    let entries = this.topics.get(topic);
    if (!entries) {
      entries = new Map();
      this.topics.set(topic, entries);
    }
    entries.set(key, { value, userId, expiresAt: Date.now() + ttl });
  }

  /** Delete a key from a topic. Returns true if it existed. */
  delete(topic: string, key: string): boolean {
    const entries = this.topics.get(topic);
    if (!entries) return false;
    const deleted = entries.delete(key);
    if (entries.size === 0) this.topics.delete(topic);
    return deleted;
  }

  /** Delete all keys owned by a userId in a topic. Returns deleted keys. */
  deleteByUser(topic: string, userId: string): string[] {
    const entries = this.topics.get(topic);
    if (!entries) return [];
    const deleted: string[] = [];
    for (const [key, entry] of entries) {
      if (entry.userId === userId) {
        entries.delete(key);
        deleted.push(key);
      }
    }
    if (entries.size === 0) this.topics.delete(topic);
    return deleted;
  }

  /** Get a snapshot of all entries in a topic. */
  getSnapshot(topic: string): Record<string, { value: JsonValue; userId: string }> {
    const entries = this.topics.get(topic);
    if (!entries) return {};
    const now = Date.now();
    const result: Record<string, { value: JsonValue; userId: string }> = {};
    for (const [key, entry] of entries) {
      if (entry.expiresAt > now) {
        result[key] = { value: entry.value, userId: entry.userId };
      }
    }
    return result;
  }

  /** Get all topic names that match a prefix. */
  getTopicsByPrefix(prefix: string): string[] {
    const result: string[] = [];
    for (const topic of this.topics.keys()) {
      if (topic.startsWith(prefix)) result.push(topic);
    }
    return result;
  }

  /** Sweep expired entries. Returns number of entries removed. */
  sweep(): number {
    const now = Date.now();
    let count = 0;
    for (const [topic, entries] of this.topics) {
      for (const [key, entry] of entries) {
        if (entry.expiresAt <= now) {
          entries.delete(key);
          count++;
        }
      }
      if (entries.size === 0) this.topics.delete(topic);
    }
    return count;
  }

  /** Dispose — clear all data and stop cleanup timer. */
  dispose(): void {
    if (this.cleanupTimer !== null) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    this.topics.clear();
    this.subscribers.clear();
  }
}
