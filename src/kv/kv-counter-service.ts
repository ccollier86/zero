/**
 * kv-counter-service.ts
 *
 * Exposes counter-focused helpers over KvService. This file owns counter
 * ergonomics only; durable mutation ordering remains in KvService.
 */

import type { KvService } from './kv-service';

/** Counter helpers exposed as `zero.counter` in later runtime wiring. */
export class KvCounterService {
  constructor(private readonly service: KvService) {}

  /** Increment a counter by a positive or negative delta. */
  increment(key: string, delta = 1, options?: { ttlMs?: number | null }): Promise<number> {
    return this.service.increment(key, delta, options);
  }

  /** Decrement a counter by a positive delta. */
  decrement(key: string, delta = 1, options?: { ttlMs?: number | null }): Promise<number> {
    return this.service.decrement(key, delta, options);
  }

  /** Return the current counter value, or zero when missing. */
  value(key: string): number {
    return this.service.get<number>(key) ?? 0;
  }

  /** Reset a counter by deleting the backing key. */
  reset(key: string): Promise<boolean> {
    return this.service.delete(key);
  }
}
