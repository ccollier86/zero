/**
 * kv-clock.ts
 *
 * Provides clock implementations for the KV/cache runtime. This file owns
 * time-source boundaries only; it does not store KV entries or schedule work.
 */

import type { KvClock } from './kv-types';

/** System clock backed by Date.now(). */
export const systemKvClock: KvClock = {
  now: () => Date.now(),
};

/** Deterministic mutable clock intended for KV/cache tests. */
export class ManualKvClock implements KvClock {
  constructor(private currentTimeMs = 0) {}

  /** Return the current manual epoch time in milliseconds. */
  now(): number {
    return this.currentTimeMs;
  }

  /** Set the current manual epoch time in milliseconds. */
  set(nowMs: number): void {
    this.currentTimeMs = nowMs;
  }

  /** Move the current manual time forward by a number of milliseconds. */
  advance(ms: number): void {
    this.currentTimeMs += ms;
  }
}
