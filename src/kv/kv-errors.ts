/**
 * kv-errors.ts
 *
 * Defines stable KV/cache error types. This file owns error shape only; it
 * does not log, recover, serialize, or map errors to HTTP responses.
 */

/** Stable error codes used by the Zero KV/cache runtime. */
export type KvErrorCode =
  | 'KV_KEY_INVALID'
  | 'KV_TTL_INVALID'
  | 'KV_LIMIT_INVALID'
  | 'KV_VALUE_INVALID'
  | 'KV_COUNTER_TYPE_MISMATCH'
  | 'KV_EVICTION_REQUIRED'
  | 'KV_JOURNAL_CORRUPT'
  | 'KV_PERSISTENCE_FAILED'
  | 'KV_CHECKPOINT_INVALID'
  | 'KV_RECOVERY_FAILED';

/** Domain error thrown by KV config validation and memory engine operations. */
export class KvError extends Error {
  /** Create a KV-domain error with a stable code and optional metadata. */
  constructor(
    public readonly code: KvErrorCode,
    message: string,
    public readonly metadata: Record<string, unknown> = {}
  ) {
    super(message);
    this.name = 'KvError';
  }
}
