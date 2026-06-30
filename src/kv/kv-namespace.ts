/**
 * kv-namespace.ts
 *
 * Provides a prefixed KV service view for app and platform subsystems. This
 * file owns key prefixing only; it does not persist mutations or manage
 * service lifecycle.
 */

import { KvError } from './kv-errors';
import type { KvService } from './kv-service';
import type { KvCompareAndSetResult, KvSetOptions, ZeroKvEntry } from './kv-types';

/** Prefix-scoped facade over a KvService. */
export class KvNamespace {
  /** Create a namespace wrapper with a stable key prefix. */
  constructor(
    private readonly service: KvService,
    private readonly prefix: string
  ) {
    if (!prefix.trim()) {
      throw new KvError('KV_KEY_INVALID', 'KV namespace prefix must be a non-empty string.');
    }
  }

  /** Return a namespaced value. */
  get<T = unknown>(key: string): T | undefined {
    return this.service.get<T>(this.key(key));
  }

  /** Return a namespaced entry. */
  getEntry<T = unknown>(key: string): ZeroKvEntry<T> | null {
    return this.service.getEntry<T>(this.key(key));
  }

  /** Persist a namespaced value. */
  set<T = unknown>(key: string, value: T, options?: KvSetOptions): Promise<ZeroKvEntry<T>> {
    return this.service.set(this.key(key), value, options);
  }

  /** Delete a namespaced key. */
  delete(key: string): Promise<boolean> {
    return this.service.delete(this.key(key));
  }

  /** Increment a namespaced counter. */
  increment(key: string, delta?: number, options?: { ttlMs?: number | null }): Promise<number> {
    return this.service.increment(this.key(key), delta, options);
  }

  /** Compare and set a namespaced key. */
  compareAndSet<T = unknown>(
    key: string,
    expectedVersion: number | null,
    value: T,
    options?: KvSetOptions
  ): Promise<KvCompareAndSetResult<T>> {
    return this.service.compareAndSet(this.key(key), expectedVersion, value, options);
  }

  /** Return a nested namespace. */
  namespace(prefix: string): KvNamespace {
    return new KvNamespace(this.service, this.key(prefix));
  }

  /** Convert a local key into the full backing key. */
  key(key: string): string {
    if (!key.trim()) {
      throw new KvError('KV_KEY_INVALID', 'KV namespace key must be a non-empty string.');
    }
    return `${this.prefix}:${key}`;
  }
}
