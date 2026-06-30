/**
 * kv-lru-index.ts
 *
 * Tracks KV key recency for bounded memory eviction. This file owns recency
 * ordering only; it does not store values, TTLs, or persistence records.
 */

/** Insertion-ordered LRU index used by the memory engine. */
export class KvLruIndex {
  private readonly keys = new Map<string, true>();

  /** Mark a key as recently used. */
  touch(key: string): void {
    this.keys.delete(key);
    this.keys.set(key, true);
  }

  /** Remove a key from recency tracking. */
  delete(key: string): void {
    this.keys.delete(key);
  }

  /** Remove all tracked keys. */
  clear(): void {
    this.keys.clear();
  }

  /** Return least-recently used keys up to the requested count. */
  oldest(count = 1): string[] {
    const result: string[] = [];
    for (const key of this.keys.keys()) {
      result.push(key);
      if (result.length >= count) break;
    }
    return result;
  }
}
