/**
 * kv-atomic-update.ts
 *
 * Defines the private service capability used by compound KV helpers to make
 * one read/decision/write operation participate in normal key serialization.
 */

import type { KvSetOptions } from './kv-types';

/** Internal symbol intentionally omitted from the public KV barrel. */
export const KV_ATOMIC_SET = Symbol('zero.kv.atomic-set');

/** State and caller result produced by one atomic set decision. */
export interface KvAtomicSetDecision<TState, TResult> {
  value: TState;
  options?: KvSetOptions;
  /** Absolute expiry used by helpers that maintain their own monotonic time. */
  expiresAt?: number | null;
  result: TResult;
}

/** One timestamp-consistent view supplied to a compound atomic decision. */
export interface KvAtomicSetContext {
  /** Timestamp persisted on the resulting mutation. */
  evaluatedAt: number;
  /** Read another key as it existed at the same mutation timestamp. */
  get<T = unknown>(key: string): T | undefined;
}
