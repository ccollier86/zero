/**
 * buffer-pool.ts
 *
 * Provides reusable binary buffers for platform serialization helpers. This
 * file owns buffer pooling only; it does not represent SQLite page cache or
 * persistence durability.
 */

import type { BufferPoolConfig } from './storage-types';

/** Reusable Uint8Array pool with fixed standard buckets and custom powers. */
export class BufferPool {
  private readonly pools = new Map<number, Uint8Array[]>();
  private readonly inUse = new WeakSet<Uint8Array>();
  private readonly maxPoolSize: number;

  static readonly SIZES = {
    TINY: 256,
    SMALL: 1024,
    MEDIUM: 4096,
    LARGE: 65_536,
    HUGE: 262_144,
  } as const;

  /** Create a buffer pool and optionally preallocate standard buckets. */
  constructor(config: BufferPoolConfig = {}) {
    this.maxPoolSize = config.maxPoolSize ?? 100;
    if (config.preallocate ?? true) this.warmup();
  }

  /** Acquire a zeroable buffer of at least the requested size. */
  acquire(minSize: number): Uint8Array {
    const size = this.findSuitableSize(minSize);
    let pool = this.pools.get(size);
    if (!pool) {
      pool = [];
      this.pools.set(size, pool);
    }

    const buffer = pool.pop() ?? new Uint8Array(size);
    this.inUse.add(buffer);
    return buffer;
  }

  /** Return a buffer to the pool after zeroing it. Unknown buffers are ignored. */
  release(buffer: Uint8Array): void {
    if (!this.inUse.has(buffer)) return;
    this.inUse.delete(buffer);

    const pool = this.pools.get(buffer.length);
    if (!pool || pool.length >= this.maxPoolSize) return;

    buffer.fill(0);
    pool.push(buffer);
  }

  /** Return pool occupancy diagnostics. */
  stats(): Record<string, { pooled: number; size: number }> {
    const result: Record<string, { pooled: number; size: number }> = {};
    for (const [size, pool] of this.pools.entries()) {
      const name = Object.entries(BufferPool.SIZES).find(([, value]) => value === size)?.[0] ?? `CUSTOM_${size}`;
      result[name] = { pooled: pool.length, size };
    }
    return result;
  }

  private warmup(): void {
    for (const size of Object.values(BufferPool.SIZES)) {
      this.pools.set(
        size,
        Array.from({ length: 10 }, () => new Uint8Array(size))
      );
    }
  }

  private findSuitableSize(minSize: number): number {
    for (const size of Object.values(BufferPool.SIZES)) {
      if (size >= minSize) return size;
    }
    return Math.pow(2, Math.ceil(Math.log2(minSize)));
  }
}

