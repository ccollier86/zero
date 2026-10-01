/**
 * kv-memory-engine.ts
 *
 * Implements Zero's hot in-memory KV/cache engine. This file owns live entry
 * storage, TTL pruning, LRU eviction, CAS, counters, and batch helpers only;
 * it does not persist mutations, register plugins, or emit observability.
 */

import { systemKvClock } from './kv-clock';
import { KvError } from './kv-errors';
import { KvLruIndex } from './kv-lru-index';
import { estimateKvValueSize } from './kv-size';
import { KvTtlIndex } from './kv-ttl-index';
import { snapshotKvValue } from './kv-value';
import type {
  KvClock,
  KvCompareAndSetResult,
  KvCounterOptions,
  KvEvictionPolicy,
  KvMemoryEngineOptions,
  KvMemoryEngineStats,
  KvSetOptions,
  ZeroKvEntry,
  ZeroKvKind,
} from './kv-types';

const DEFAULT_TTL_BUCKET_MS = 250;

/** Memory-first KV engine used as the active path for Zero's platform cache. */
export class KvMemoryEngine {
  private readonly entriesByKey = new Map<string, ZeroKvEntry>();
  private readonly ttlIndex: KvTtlIndex;
  private readonly lruIndex = new KvLruIndex();
  private readonly clock: KvClock;
  private readonly defaultTtlMs: number | null | undefined;
  private readonly maxEntries: number | null;
  private readonly maxBytes: number | null;
  private readonly eviction: KvEvictionPolicy;
  private readRecencyAffectsEviction: boolean;
  private readPrunesExpired = true;

  private nextVersion = 1;
  private approximateBytes = 0;
  private readonly capacityReservations = new Map<string, number>();
  private expiredEntries = 0;
  private evictedEntries = 0;

  /** Create a memory-only KV engine with optional TTL and eviction bounds. */
  constructor(options: KvMemoryEngineOptions = {}) {
    this.clock = options.clock ?? systemKvClock;
    this.defaultTtlMs = normalizeOptionalTtl(options.defaultTtlMs, 'defaultTtlMs');
    this.maxEntries = normalizeOptionalLimit(options.maxEntries, 'maxEntries');
    this.maxBytes = normalizeOptionalLimit(options.maxBytes, 'maxBytes');
    this.eviction = options.eviction ?? 'lru';
    this.readRecencyAffectsEviction = (options.evictionRecency ?? 'access') === 'access';
    this.ttlIndex = new KvTtlIndex(normalizeBucketMs(options.ttlBucketMs));
  }

  /** Return a value when the key exists and has not expired. */
  get<T = unknown>(key: string): T | undefined {
    const entry = this.getEntry<T>(key);
    return entry?.value;
  }

  /** Return a cloned entry when the key exists and has not expired. */
  getEntry<T = unknown>(key: string): ZeroKvEntry<T> | null {
    validateKey(key);
    const entry = this.getFreshEntry(key);
    if (!entry) return null;

    const now = this.clock.now();
    entry.lastAccessedAt = now;
    if (this.readRecencyAffectsEviction) this.lruIndex.touch(key);
    return cloneEntry(entry) as ZeroKvEntry<T>;
  }

  /** @internal Select whether synchronous reads alter the eviction order. */
  setReadRecencyAffectsEviction(enabled: boolean): void {
    this.readRecencyAffectsEviction = enabled;
  }

  /** @internal Select whether reads physically remove logically expired entries. */
  setReadPrunesExpired(enabled: boolean): void {
    this.readPrunesExpired = enabled;
  }

  /** @internal Whether global capacity/eviction state requires serialized decisions. */
  requiresSerializedCapacityMutations(): boolean {
    return this.maxEntries !== null || this.maxBytes !== null;
  }

  /** @internal Return state as it existed at a mutation timestamp without changing live state. */
  getEntryAt<T = unknown>(key: string, timestamp: number): ZeroKvEntry<T> | null {
    validateKey(key);
    const entry = this.entriesByKey.get(key) as ZeroKvEntry<T> | undefined;
    if (!entry) return null;
    if (entry.expiresAt !== null && entry.expiresAt <= timestamp) return null;
    return cloneEntry(entry);
  }

  /** Return true when the key exists and has not expired. */
  has(key: string): boolean {
    validateKey(key);
    return this.getFreshEntry(key) !== null;
  }

  /** Store a value and return the stored entry. */
  set<T = unknown>(key: string, value: T, options: KvSetOptions = {}): ZeroKvEntry<T> {
    validateKey(key);
    const now = this.clock.now();
    const existing = this.getFreshEntry(key);
    const expiresAt = this.resolveWriteExpiry(options.ttlMs, null);
    const entry: ZeroKvEntry<T> = {
      key,
      kind: options.kind ?? 'value',
      value,
      expiresAt,
      version: this.allocateVersion(),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      lastAccessedAt: now,
      sizeBytes: estimateKvValueSize(value),
    };

    this.writeEntry(entry);
    return cloneEntry(entry);
  }

  /** Store many values and return the resulting entries. */
  setMany(entries: Iterable<readonly [string, unknown]>, options: KvSetOptions = {}): ZeroKvEntry[] {
    const result: ZeroKvEntry[] = [];
    for (const [key, value] of entries) {
      result.push(this.set(key, value, options));
    }
    return result;
  }

  /** Return a map of requested keys to existing values. Missing keys are absent. */
  getMany<T = unknown>(keys: Iterable<string>): Map<string, T> {
    const result = new Map<string, T>();
    for (const key of keys) {
      const entry = this.getEntry<T>(key);
      if (entry) result.set(key, entry.value);
    }
    return result;
  }

  /** Delete one key and return whether it existed. */
  delete(key: string): boolean {
    validateKey(key);
    return this.removeEntry(key);
  }

  /** Delete many keys and return the number removed. */
  deleteMany(keys: Iterable<string>): number {
    let removed = 0;
    for (const key of keys) {
      if (this.delete(key)) removed += 1;
    }
    return removed;
  }

  /** Remove all entries and indexes from the memory engine. */
  clear(): void {
    this.entriesByKey.clear();
    this.ttlIndex.clear();
    this.lruIndex.clear();
    this.capacityReservations.clear();
    this.approximateBytes = 0;
  }

  /** Set or replace a key expiry relative to the current clock. */
  expire(key: string, ttlMs: number): boolean {
    validateKey(key);
    const ttl = normalizeRequiredTtl(ttlMs, 'ttlMs');
    const entry = this.getFreshEntry(key);
    if (!entry) return false;

    const now = this.clock.now();
    entry.expiresAt = now + ttl;
    entry.updatedAt = now;
    entry.version = this.allocateVersion();
    this.ttlIndex.schedule(key, entry.expiresAt);
    this.lruIndex.touch(key);
    return true;
  }

  /** Remove expiry from a key while preserving its value. */
  persist(key: string): boolean {
    validateKey(key);
    const entry = this.getFreshEntry(key);
    if (!entry) return false;

    const now = this.clock.now();
    entry.expiresAt = null;
    entry.updatedAt = now;
    entry.version = this.allocateVersion();
    this.ttlIndex.cancel(key);
    this.lruIndex.touch(key);
    return true;
  }

  /** Atomically replace a key only when its current version matches. */
  compareAndSet<T = unknown>(
    key: string,
    expectedVersion: number | null,
    value: T,
    options: KvSetOptions = {}
  ): KvCompareAndSetResult<T> {
    validateKey(key);
    const current = this.getFreshEntry<T>(key);
    const currentVersion = current?.version ?? null;
    const currentValue = current?.value ?? null;

    if (currentVersion !== expectedVersion) {
      return {
        ok: false,
        value: currentValue,
        current: currentValue,
        version: currentVersion,
      };
    }

    const next = this.set(key, value, options);
    return {
      ok: true,
      value: next.value,
      current: currentValue,
      version: next.version,
    };
  }

  /** Increment a numeric counter and return the next value. */
  increment(key: string, delta = 1, options: KvCounterOptions = {}): number {
    validateKey(key);
    if (!Number.isFinite(delta)) {
      throw new KvError('KV_VALUE_INVALID', 'Counter delta must be a finite number.', { key, delta });
    }

    const now = this.clock.now();
    const current = this.getFreshEntry<number>(key);
    if (current && typeof current.value !== 'number') {
      throw new KvError('KV_COUNTER_TYPE_MISMATCH', `KV key "${key}" does not hold a numeric counter.`, {
        key,
        kind: current.kind,
      });
    }

    const nextValue = (current?.value ?? 0) + delta;
    if (!Number.isFinite(nextValue)) {
      throw new KvError('KV_VALUE_INVALID', 'Counter result must be a finite number.', {
        key,
        delta,
      });
    }
    const expiresAt = options.ttlMs === undefined
      ? current?.expiresAt ?? this.resolveWriteExpiry(undefined, null)
      : this.resolveWriteExpiry(options.ttlMs, null);
    const entry: ZeroKvEntry<number> = {
      key,
      kind: 'counter',
      value: nextValue,
      expiresAt,
      version: this.allocateVersion(),
      createdAt: current?.createdAt ?? now,
      updatedAt: now,
      lastAccessedAt: now,
      sizeBytes: estimateKvValueSize(nextValue),
    };

    this.writeEntry(entry);
    return nextValue;
  }

  /** Decrement a numeric counter and return the next value. */
  decrement(key: string, delta = 1, options: KvCounterOptions = {}): number {
    return this.increment(key, -delta, options);
  }

  /** Return cloned entries suitable for snapshots and diagnostics. */
  entries(options: { pruneExpired?: boolean } = {}): ZeroKvEntry[] {
    if (options.pruneExpired !== false) this.pruneExpired();
    return this.lruIndex.orderedKeys()
      .map((key) => this.entriesByKey.get(key))
      .filter((entry): entry is ZeroKvEntry => entry !== undefined)
      .map((entry) => cloneEntry(entry));
  }

  /** @internal Return the physical entry count, including retained logical expiry state. */
  storedEntryCount(): number {
    return this.entriesByKey.size;
  }

  /** @internal Count physical entries logically expired at one cleanup boundary. */
  expiredEntryCountAt(timestamp: number): number {
    let count = 0;
    for (const entry of this.entriesByKey.values()) {
      if (entry.expiresAt !== null && entry.expiresAt <= timestamp) count += 1;
    }
    return count;
  }

  /** Restore checkpointed entries into the memory engine. */
  restoreEntries(
    entries: Iterable<ZeroKvEntry>,
    options: { clear?: boolean; retainExpired?: boolean; capacityTime?: number } = {}
  ): void {
    if (options.clear) this.clear();
    const now = options.capacityTime ?? this.clock.now();

    for (const input of entries) {
      validateKey(input.key);
      if (!Number.isSafeInteger(input.version) || input.version < 0) {
        throw new KvError('KV_VALUE_INVALID', 'KV entry version must be a non-negative safe integer.', {
          key: input.key,
          version: input.version,
        });
      }
      if (!options.retainExpired && input.expiresAt !== null && input.expiresAt <= now) {
        this.expiredEntries += 1;
        continue;
      }

      const entry: ZeroKvEntry = {
        ...input,
        sizeBytes: estimateKvValueSize(input.value),
      };
      this.writeRestoredEntry(entry, options.capacityTime);
      if (entry.version >= this.nextVersion) this.nextVersion = entry.version + 1;
    }

    this.enforceLimits('', now);
  }

  /** Reject a write that cannot fit when automatic eviction is disabled. */
  assertCanStore(key: string, value: unknown, capacityTime = this.clock.now()): void {
    validateKey(key);
    if (this.eviction !== 'none') return;
    const { entries: projectedEntries, bytes: projectedBytes } = this.projectedCapacity(
      key,
      estimateKvValueSize(value),
      capacityTime
    );
    if (
      (this.maxEntries !== null && projectedEntries > this.maxEntries)
      || (this.maxBytes !== null && projectedBytes > this.maxBytes)
    ) {
      throw new KvError('KV_EVICTION_REQUIRED', 'KV memory engine exceeded configured limits.', {
        maxEntries: this.maxEntries,
        maxBytes: this.maxBytes,
      });
    }
  }

  /** Reserve bounded no-eviction capacity across an asynchronous WAL append. */
  reserveStoreCapacity(
    key: string,
    value: unknown,
    capacityTime = this.clock.now()
  ): () => void {
    validateKey(key);
    if (this.eviction !== 'none') return () => undefined;
    if (this.capacityReservations.has(key)) {
      throw new KvError('KV_RECOVERY_FAILED', 'KV key already has an active capacity reservation.', { key });
    }

    const sizeBytes = estimateKvValueSize(value);
    const { entries: projectedEntries, bytes: projectedBytes } = this.projectedCapacity(
      key,
      sizeBytes,
      capacityTime
    );
    if (
      (this.maxEntries !== null && projectedEntries > this.maxEntries)
      || (this.maxBytes !== null && projectedBytes > this.maxBytes)
    ) {
      throw new KvError('KV_EVICTION_REQUIRED', 'KV memory engine exceeded configured limits.', {
        maxEntries: this.maxEntries,
        maxBytes: this.maxBytes,
      });
    }

    this.capacityReservations.set(key, sizeBytes);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.capacityReservations.delete(key);
    };
  }

  /** Remove expired keys and return the number pruned. */
  pruneExpired(now = this.clock.now()): number {
    let removed = 0;
    for (const key of this.ttlIndex.collectReady(now)) {
      const entry = this.entriesByKey.get(key);
      if (!entry) continue;
      if (entry.expiresAt !== null && entry.expiresAt <= now) {
        this.removeEntry(key);
        this.expiredEntries += 1;
        removed += 1;
      } else if (entry.expiresAt !== null) {
        this.ttlIndex.schedule(key, entry.expiresAt);
      }
    }
    return removed;
  }

  /** Return diagnostic counters for the memory engine. */
  stats(options: { pruneExpired?: boolean } = {}): KvMemoryEngineStats {
    if (options.pruneExpired !== false) this.pruneExpired();
    const capacity = options.pruneExpired === false
      ? this.liveCapacity()
      : { entries: this.entriesByKey.size, bytes: this.approximateBytes };
    return {
      entries: capacity.entries,
      approximateBytes: capacity.bytes,
      maxEntries: this.maxEntries,
      maxBytes: this.maxBytes,
      expiredEntries: this.expiredEntries,
      evictedEntries: this.evictedEntries,
      version: this.nextVersion - 1,
    };
  }

  private getFreshEntry<T = unknown>(key: string): ZeroKvEntry<T> | null {
    const entry = this.entriesByKey.get(key) as ZeroKvEntry<T> | undefined;
    if (!entry) return null;

    const now = this.clock.now();
    // Reads treat expired entries as absent without physically deleting them.
    // A durable mutation may already have made a decision at an earlier clock
    // value while its journal append is still pending; destructive reads would
    // remove the historical state that mutation and recovery both need.
    if (entry.expiresAt !== null && entry.expiresAt <= now) {
      if (this.readPrunesExpired) {
        this.removeEntry(key);
        this.expiredEntries += 1;
      }
      return null;
    }

    return entry;
  }

  private allocateVersion(): number {
    if (!Number.isSafeInteger(this.nextVersion) || this.nextVersion <= 0) {
      throw new KvError('KV_LIMIT_INVALID', 'KV entry version space is exhausted.', {
        version: this.nextVersion,
      });
    }
    return this.nextVersion++;
  }

  private writeEntry(entry: ZeroKvEntry): void {
    const stored = { ...entry, value: snapshotKvValue(entry.value) };
    this.assertCanStore(stored.key, stored.value);
    const existing = this.entriesByKey.get(stored.key);
    if (existing) this.approximateBytes -= existing.sizeBytes;

    this.entriesByKey.set(stored.key, stored);
    this.approximateBytes += stored.sizeBytes;
    this.lruIndex.touch(stored.key);

    if (stored.expiresAt === null) this.ttlIndex.cancel(stored.key);
    else this.ttlIndex.schedule(stored.key, stored.expiresAt);

    this.enforceLimits(stored.key);
  }

  private writeRestoredEntry(entry: ZeroKvEntry, capacityTime?: number): void {
    const stored = { ...entry, value: snapshotKvValue(entry.value) };
    this.assertCanStore(stored.key, stored.value, capacityTime);
    const existing = this.entriesByKey.get(stored.key);
    if (existing) this.approximateBytes -= existing.sizeBytes;

    this.entriesByKey.set(stored.key, stored);
    this.approximateBytes += stored.sizeBytes;
    this.lruIndex.touch(stored.key);

    if (stored.expiresAt === null) this.ttlIndex.cancel(stored.key);
    else this.ttlIndex.schedule(stored.key, stored.expiresAt);
  }

  private removeEntry(key: string): boolean {
    const entry = this.entriesByKey.get(key);
    if (!entry) return false;

    this.entriesByKey.delete(key);
    this.ttlIndex.cancel(key);
    this.lruIndex.delete(key);
    this.approximateBytes -= entry.sizeBytes;
    if (this.approximateBytes < 0) this.approximateBytes = 0;
    return true;
  }

  private enforceLimits(protectedKey: string, capacityTime = this.clock.now()): void {
    if (this.eviction === 'none') {
      if (this.isOverLimit(capacityTime)) {
        throw new KvError('KV_EVICTION_REQUIRED', 'KV memory engine exceeded configured limits.', {
          maxEntries: this.maxEntries,
          maxBytes: this.maxBytes,
        });
      }
      return;
    }

    while (this.isOverLimit(capacityTime)) {
      const candidate = this.oldestLiveKey(capacityTime);
      if (!candidate) break;
      if (candidate === protectedKey && this.liveCapacity(capacityTime).entries === 1) {
        this.removeEntry(candidate);
        this.evictedEntries += 1;
        break;
      }
      if (candidate === protectedKey) {
        this.lruIndex.touch(candidate);
        continue;
      }
      this.removeEntry(candidate);
      this.evictedEntries += 1;
    }
  }

  private isOverLimit(capacityTime = this.clock.now()): boolean {
    const capacity = this.liveCapacity(capacityTime);
    return (
      (this.maxEntries !== null && capacity.entries > this.maxEntries) ||
      (this.maxBytes !== null && capacity.bytes > this.maxBytes)
    );
  }

  private oldestLiveKey(now = this.clock.now()): string | undefined {
    for (const key of this.lruIndex.orderedKeys()) {
      const entry = this.entriesByKey.get(key);
      if (!entry) continue;
      if (entry.expiresAt !== null && entry.expiresAt <= now) continue;
      return key;
    }
    return undefined;
  }

  private liveCapacity(now = this.clock.now()): { entries: number; bytes: number } {
    let entries = 0;
    let bytes = 0;
    for (const entry of this.entriesByKey.values()) {
      if (entry.expiresAt !== null && entry.expiresAt <= now) continue;
      entries += 1;
      bytes += entry.sizeBytes;
    }
    return { entries, bytes };
  }

  private projectedCapacity(key: string, sizeBytes: number, capacityTime = this.clock.now()): {
    entries: number;
    bytes: number;
  } {
    let entries = 1;
    let bytes = sizeBytes;

    for (const entry of this.entriesByKey.values()) {
      if (entry.key === key || this.capacityReservations.has(entry.key)) continue;
      if (entry.expiresAt !== null && entry.expiresAt <= capacityTime) continue;
      entries += 1;
      bytes += entry.sizeBytes;
    }
    for (const [reservedKey, reservedSize] of this.capacityReservations) {
      if (reservedKey === key) continue;
      entries += 1;
      bytes += reservedSize;
    }
    return { entries, bytes };
  }

  private resolveWriteExpiry(ttlMs: number | null | undefined, fallback: number | null): number | null {
    const normalized = normalizeOptionalTtl(ttlMs, 'ttlMs');
    if (normalized === null) return null;
    if (typeof normalized === 'number') return this.clock.now() + normalized;

    if (this.defaultTtlMs === null) return null;
    if (typeof this.defaultTtlMs === 'number') return this.clock.now() + this.defaultTtlMs;
    return fallback;
  }
}

function validateKey(key: string): void {
  if (typeof key !== 'string' || key.trim().length === 0) {
    throw new KvError('KV_KEY_INVALID', 'KV key must be a non-empty string.', { key });
  }
}

function normalizeOptionalTtl(value: number | null | undefined, label: string): number | null | undefined {
  if (value === undefined || value === null) return value;
  return normalizeRequiredTtl(value, label);
}

function normalizeRequiredTtl(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new KvError('KV_TTL_INVALID', `KV ${label} must be a finite positive number or zero.`, { value });
  }
  return value;
}

function normalizeOptionalLimit(value: number | undefined, label: string): number | null {
  if (value === undefined) return null;
  if (!Number.isInteger(value) || value <= 0) {
    throw new KvError('KV_LIMIT_INVALID', `KV ${label} must be a positive integer.`, { value });
  }
  return value;
}

function normalizeBucketMs(value: number | undefined): number {
  if (value === undefined) return DEFAULT_TTL_BUCKET_MS;
  if (!Number.isInteger(value) || value <= 0) {
    throw new KvError('KV_LIMIT_INVALID', 'KV ttlBucketMs must be a positive integer.', { value });
  }
  return value;
}

function cloneEntry<T>(entry: ZeroKvEntry<T>): ZeroKvEntry<T> {
  return { ...entry, value: snapshotKvValue(entry.value) };
}
