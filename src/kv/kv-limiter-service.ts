/**
 * kv-limiter-service.ts
 *
 * Implements rate limiter helpers over KvService. This file owns limiter
 * algorithms only; durable writes and lifecycle remain in KvService.
 */

import type { KvService } from './kv-service';
import { KvError } from './kv-errors';
import type { KvClock } from './kv-types';

/** Options for fixed-window limiting. */
export interface KvFixedWindowOptions {
  limit: number;
  windowMs: number;
  cost?: number;
}

/** Options for token-bucket limiting. */
export interface KvTokenBucketOptions {
  capacity: number;
  refillPerSec: number;
  cost?: number;
  ttlMs?: number;
}

/** Options for sliding-window limiting. */
export interface KvSlidingWindowOptions {
  limit: number;
  windowMs: number;
  cost?: number;
}

/** Result returned by limiter helpers. */
export interface KvLimiterResult {
  allowed: boolean;
  remaining: number;
  resetAt: number | null;
  retryAfterMs: number | null;
  value: number;
}

interface TokenBucketState {
  tokens: number;
  updatedAt: number;
}

interface SlidingWindowState {
  windowStart: number;
  current: number;
  previous: number;
}

/** Rate limiter helpers exposed as `zero.limiter` in later runtime wiring. */
export class KvLimiterService {
  constructor(
    private readonly service: KvService,
    private readonly clock: KvClock
  ) {}

  /** Apply a fixed-window rate limit. */
  async fixedWindow(key: string, options: KvFixedWindowOptions): Promise<KvLimiterResult> {
    const limit = normalizePositive(options.limit, 'limit');
    const windowMs = normalizePositive(options.windowMs, 'windowMs');
    const cost = normalizeCost(options.cost);
    const now = this.clock.now();
    const windowStart = Math.floor(now / windowMs) * windowMs;
    const resetAt = windowStart + windowMs;
    const value = await this.service.increment(`limiter:fixed:${key}:${windowStart}`, cost, {
      ttlMs: windowMs * 2,
    });
    const allowed = value <= limit;

    return {
      allowed,
      remaining: Math.max(0, limit - value),
      resetAt,
      retryAfterMs: allowed ? null : Math.max(0, resetAt - now),
      value,
    };
  }

  /** Apply a token-bucket rate limit. */
  async tokenBucket(key: string, options: KvTokenBucketOptions): Promise<KvLimiterResult> {
    const capacity = normalizePositive(options.capacity, 'capacity');
    const refillPerSec = normalizePositive(options.refillPerSec, 'refillPerSec');
    const cost = normalizeCost(options.cost);
    const now = this.clock.now();
    const stateKey = `limiter:bucket:${key}`;
    const current = this.service.get<TokenBucketState>(stateKey);
    const elapsedSec = current ? Math.max(0, (now - current.updatedAt) / 1000) : 0;
    let tokens = Math.min(capacity, (current?.tokens ?? capacity) + elapsedSec * refillPerSec);
    const allowed = tokens >= cost;
    if (allowed) tokens -= cost;

    const ttlMs = options.ttlMs ?? Math.max(1000, Math.ceil((capacity / refillPerSec) * 2000));
    await this.service.set(stateKey, { tokens, updatedAt: now }, { kind: 'rate-limit', ttlMs });

    return {
      allowed,
      remaining: Math.floor(tokens),
      resetAt: allowed ? null : now + Math.ceil(((cost - tokens) / refillPerSec) * 1000),
      retryAfterMs: allowed ? null : Math.ceil(((cost - tokens) / refillPerSec) * 1000),
      value: tokens,
    };
  }

  /** Apply a weighted sliding-window rate limit. */
  async slidingWindow(key: string, options: KvSlidingWindowOptions): Promise<KvLimiterResult> {
    const limit = normalizePositive(options.limit, 'limit');
    const windowMs = normalizePositive(options.windowMs, 'windowMs');
    const cost = normalizeCost(options.cost);
    const now = this.clock.now();
    const stateKey = `limiter:sliding:${key}`;
    const windowStart = Math.floor(now / windowMs) * windowMs;
    const current = normalizeSlidingState(this.service.get<SlidingWindowState>(stateKey), windowStart, windowMs);
    const elapsed = now - current.windowStart;
    const weight = Math.max(0, (windowMs - elapsed) / windowMs);
    const weightedValue = current.current + current.previous * weight;
    const allowed = weightedValue + cost <= limit;
    if (allowed) current.current += cost;
    await this.service.set(stateKey, current, { kind: 'rate-limit', ttlMs: windowMs * 2 });

    const resetAt = current.windowStart + windowMs;
    return {
      allowed,
      remaining: Math.max(0, Math.floor(limit - (allowed ? weightedValue + cost : weightedValue))),
      resetAt,
      retryAfterMs: allowed ? null : Math.max(0, resetAt - now),
      value: allowed ? weightedValue + cost : weightedValue,
    };
  }
}

function normalizeSlidingState(
  state: SlidingWindowState | undefined,
  windowStart: number,
  windowMs: number
): SlidingWindowState {
  if (!state) return { windowStart, current: 0, previous: 0 };
  if (state.windowStart === windowStart) return { ...state };

  const windowsPassed = Math.max(1, Math.floor((windowStart - state.windowStart) / windowMs));
  return {
    windowStart,
    current: 0,
    previous: windowsPassed === 1 ? state.current : 0,
  };
}

function normalizePositive(value: number, label: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new KvError('KV_LIMIT_INVALID', `KV limiter ${label} must be positive.`, { value });
  }
  return value;
}

function normalizeCost(value: number | undefined): number {
  return normalizePositive(value ?? 1, 'cost');
}
