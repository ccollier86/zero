/**
 * kv-types.ts
 *
 * Defines framework-neutral contracts for Zero's memory-first KV/cache
 * runtime. This file owns public types only; it does not persist data, start
 * timers, register Elysia plugins, or emit observability events.
 */

/** KV entry families supported by the current engine and future data types. */
export type ZeroKvKind =
  | 'value'
  | 'counter'
  | 'hash'
  | 'set'
  | 'list'
  | 'lease'
  | 'rate-limit';

/** Eviction strategy used when the memory engine exceeds configured bounds. */
export type KvEvictionPolicy = 'none' | 'lru';

/** Recency signal used by bounded LRU eviction. */
export type KvEvictionRecency = 'access' | 'mutation';

/** Clock boundary used to keep TTL and recovery tests deterministic. */
export interface KvClock {
  /** Return the current epoch time in milliseconds. */
  now(): number;
}

/** Options accepted when creating a memory-only KV engine. */
export interface KvMemoryEngineOptions {
  /** Clock used for timestamps and TTL checks. Defaults to Date.now(). */
  clock?: KvClock;
  /** Default TTL used by writes that omit ttlMs. Undefined means no default. */
  defaultTtlMs?: number | null;
  /** Maximum number of live entries before eviction. Undefined means unbounded. */
  maxEntries?: number;
  /** Maximum approximate live value bytes before eviction. Undefined means unbounded. */
  maxBytes?: number;
  /** Eviction policy used when maxEntries or maxBytes is exceeded. Default: lru. */
  eviction?: KvEvictionPolicy;
  /** Recency signal for LRU eviction. Standalone memory engines default to access. */
  evictionRecency?: KvEvictionRecency;
  /** Bucket size for TTL scheduling. Default: 250ms. */
  ttlBucketMs?: number;
}

/** Options accepted by value writes. */
export interface KvSetOptions {
  /** Entry kind stored for future data-type-aware behavior. Default: value. */
  kind?: ZeroKvKind;
  /** TTL in milliseconds. Null means no expiry. Undefined uses engine default. */
  ttlMs?: number | null;
}

/** Options accepted by counter mutations. */
export interface KvCounterOptions {
  /** TTL in milliseconds. Undefined preserves the current TTL when present. */
  ttlMs?: number | null;
}

/** Live entry stored by the memory engine. */
export interface ZeroKvEntry<T = unknown> {
  key: string;
  kind: ZeroKvKind;
  value: T;
  expiresAt: number | null;
  version: number;
  createdAt: number;
  updatedAt: number;
  lastAccessedAt: number;
  sizeBytes: number;
}

/** Result returned from compare-and-set writes. */
export interface KvCompareAndSetResult<T = unknown> {
  ok: boolean;
  value: T | null;
  current: T | null;
  version: number | null;
}

/** Runtime counters exposed for tests, doctor checks, and future diagnostics. */
export interface KvMemoryEngineStats {
  entries: number;
  approximateBytes: number;
  maxEntries: number | null;
  maxBytes: number | null;
  expiredEntries: number;
  evictedEntries: number;
  version: number;
}
