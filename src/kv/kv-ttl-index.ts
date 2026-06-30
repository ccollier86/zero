/**
 * kv-ttl-index.ts
 *
 * Tracks KV expiration buckets for efficient pruning. This file owns TTL
 * scheduling only; it does not decide whether a key exists or mutate values.
 */

/** Bucketed TTL index used by the memory engine to avoid full-table scans. */
export class KvTtlIndex {
  private readonly expirations = new Map<string, number>();
  private readonly buckets = new Map<number, Set<string>>();

  constructor(private readonly bucketMs = 250) {}

  /** Schedule a key to be considered expired at or after the provided time. */
  schedule(key: string, expiresAt: number): void {
    this.cancel(key);
    const bucket = this.bucketFor(expiresAt);
    let keys = this.buckets.get(bucket);
    if (!keys) {
      keys = new Set();
      this.buckets.set(bucket, keys);
    }
    keys.add(key);
    this.expirations.set(key, expiresAt);
  }

  /** Cancel expiration tracking for a key. */
  cancel(key: string): void {
    const expiresAt = this.expirations.get(key);
    if (expiresAt === undefined) return;
    this.expirations.delete(key);

    const bucket = this.bucketFor(expiresAt);
    const keys = this.buckets.get(bucket);
    if (!keys) return;
    keys.delete(key);
    if (keys.size === 0) this.buckets.delete(bucket);
  }

  /** Remove all TTL tracking. */
  clear(): void {
    this.expirations.clear();
    this.buckets.clear();
  }

  /** Return keys whose TTL bucket is ready to prune at the given time. */
  collectReady(now: number): string[] {
    const ready: string[] = [];
    for (const [bucket, keys] of [...this.buckets.entries()]) {
      if (bucket > now) continue;
      this.buckets.delete(bucket);
      for (const key of keys) {
        this.expirations.delete(key);
        ready.push(key);
      }
    }
    return ready;
  }

  /** Return the tracked expiry time for a key, if one exists. */
  getExpiresAt(key: string): number | undefined {
    return this.expirations.get(key);
  }

  private bucketFor(expiresAt: number): number {
    return Math.floor(expiresAt / this.bucketMs) * this.bucketMs;
  }
}
