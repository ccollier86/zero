import type { JsonValue } from './types';

// ─── Types ─────────────────────────────────────────────────────────────────

export interface EphemeralEntry {
  value: JsonValue;
  userId: string;
  expiresAt: number;
  /** UTF-8 JSON wire size used for process-local capacity accounting. */
  byteSize?: number;
}

export interface EphemeralUsage {
  totalEntries: number;
  totalBytes: number;
  namespaceEntries: number;
  namespaceBytes: number;
  actorEntries: number;
  actorBytes: number;
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
  private topicBytes = new Map<string, number>();
  private actorUsage = new Map<string, { entries: number; bytes: number }>();
  private totalEntries = 0;
  private totalBytes = 0;
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
  set(
    topic: string,
    key: string,
    value: JsonValue,
    userId: string,
    ttl = 30_000,
    byteSize = measureJsonValue(value),
  ): void {
    let entries = this.topics.get(topic);
    if (!entries) {
      entries = new Map();
      this.topics.set(topic, entries);
    }
    const previous = entries.get(key);
    if (previous) this.removeUsage(topic, previous);
    const entry = { value, userId, expiresAt: Date.now() + ttl, byteSize };
    entries.set(key, entry);
    this.addUsage(topic, entry);
  }

  /** Delete a key from a topic. Returns true if it existed. */
  delete(topic: string, key: string): boolean {
    const entries = this.topics.get(topic);
    if (!entries) return false;
    const entry = entries.get(key);
    const deleted = entries.delete(key);
    if (deleted && entry) this.removeUsage(topic, entry);
    if (entries.size === 0) this.topics.delete(topic);
    return deleted;
  }

  /** Return one live entry for ownership checks, pruning it if expired. */
  getEntry(topic: string, key: string): EphemeralEntry | null {
    const entries = this.topics.get(topic);
    const entry = entries?.get(key);
    if (!entry) return null;
    if (entry.expiresAt > Date.now()) return entry;
    entries!.delete(key);
    this.removeUsage(topic, entry);
    if (entries!.size === 0) this.topics.delete(topic);
    return null;
  }

  /** Delete all keys owned by a userId in a topic. Returns deleted keys. */
  deleteByUser(topic: string, userId: string): string[] {
    const entries = this.topics.get(topic);
    if (!entries) return [];
    const deleted: string[] = [];
    for (const [key, entry] of entries) {
      if (entry.userId === userId) {
        entries.delete(key);
        this.removeUsage(topic, entry);
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

  /** Current bounded-memory usage for a proposed namespace/actor write. */
  getUsage(topic: string, userId: string): EphemeralUsage {
    const actor = this.actorUsage.get(userId);
    return {
      totalEntries: this.totalEntries,
      totalBytes: this.totalBytes,
      namespaceEntries: this.topics.get(topic)?.size ?? 0,
      namespaceBytes: this.topicBytes.get(topic) ?? 0,
      actorEntries: actor?.entries ?? 0,
      actorBytes: actor?.bytes ?? 0,
    };
  }

  /** Sweep expired entries. Returns number of entries removed. */
  sweep(): number {
    const now = Date.now();
    let count = 0;
    for (const [topic, entries] of this.topics) {
      for (const [key, entry] of entries) {
        if (entry.expiresAt <= now) {
          entries.delete(key);
          this.removeUsage(topic, entry);
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
    this.topicBytes.clear();
    this.actorUsage.clear();
    this.totalEntries = 0;
    this.totalBytes = 0;
  }

  private addUsage(topic: string, entry: EphemeralEntry): void {
    const byteSize = entry.byteSize ?? measureJsonValue(entry.value);
    this.totalEntries += 1;
    this.totalBytes += byteSize;
    this.topicBytes.set(topic, (this.topicBytes.get(topic) ?? 0) + byteSize);
    const actor = this.actorUsage.get(entry.userId) ?? { entries: 0, bytes: 0 };
    actor.entries += 1;
    actor.bytes += byteSize;
    this.actorUsage.set(entry.userId, actor);
  }

  private removeUsage(topic: string, entry: EphemeralEntry): void {
    const byteSize = entry.byteSize ?? measureJsonValue(entry.value);
    this.totalEntries = Math.max(0, this.totalEntries - 1);
    this.totalBytes = Math.max(0, this.totalBytes - byteSize);

    const topicBytes = Math.max(0, (this.topicBytes.get(topic) ?? 0) - byteSize);
    if (topicBytes === 0) this.topicBytes.delete(topic);
    else this.topicBytes.set(topic, topicBytes);

    const actor = this.actorUsage.get(entry.userId);
    if (!actor) return;
    actor.entries = Math.max(0, actor.entries - 1);
    actor.bytes = Math.max(0, actor.bytes - byteSize);
    if (actor.entries === 0) this.actorUsage.delete(entry.userId);
    else this.actorUsage.set(entry.userId, actor);
  }
}

function measureJsonValue(value: JsonValue): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}
