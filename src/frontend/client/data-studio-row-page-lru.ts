/** Bounded recency/size accounting for one authorization scope's row pages. */

import { DATA_STUDIO_RESULT_BYTE_BUDGET } from '../../data-studio/data-studio-operation-contracts';

export const DATA_STUDIO_ROW_PAGE_CACHE_MAX_ENTRIES = 16;
export const DATA_STUDIO_ROW_PAGE_CACHE_MAX_APPROXIMATE_BYTES =
  DATA_STUDIO_RESULT_BYTE_BUDGET * 4;

export interface DataStudioLruAdmission {
  readonly accepted: boolean;
  readonly evictedKeys: readonly string[];
}

/**
 * Track LRU order without owning cached values. Callers can therefore keep
 * immutable reactive snapshots while this helper owns only bounded metadata.
 */
export class DataStudioRowPageLru {
  private readonly entries = new Map<string, number>();
  private approximateBytes = 0;

  constructor(
    private readonly maxEntries = DATA_STUDIO_ROW_PAGE_CACHE_MAX_ENTRIES,
    private readonly maxApproximateBytes = DATA_STUDIO_ROW_PAGE_CACHE_MAX_APPROXIMATE_BYTES,
  ) {
    if (!Number.isSafeInteger(maxEntries) || maxEntries < 1
      || !Number.isSafeInteger(maxApproximateBytes) || maxApproximateBytes < 1) {
      throw new TypeError('Data Studio row-page cache budgets must be positive integers.');
    }
  }

  /** Admit and mark one page most-recent. The admitted key is never its own eviction victim. */
  record(key: string, approximateBytes: number): DataStudioLruAdmission {
    if (!Number.isSafeInteger(approximateBytes) || approximateBytes < 0) {
      throw new TypeError('Data Studio row-page cache size must be a non-negative integer.');
    }
    if (approximateBytes > this.maxApproximateBytes) {
      return Object.freeze({ accepted: false, evictedKeys: Object.freeze([]) });
    }

    this.remove(key);
    this.entries.set(key, approximateBytes);
    this.approximateBytes += approximateBytes;
    const evictedKeys: string[] = [];
    while (this.entries.size > this.maxEntries
      || this.approximateBytes > this.maxApproximateBytes) {
      const oldestKey = this.entries.keys().next().value as string | undefined;
      if (oldestKey === undefined || oldestKey === key) break;
      this.remove(oldestKey);
      evictedKeys.push(oldestKey);
    }
    return Object.freeze({
      accepted: true,
      evictedKeys: Object.freeze(evictedKeys),
    });
  }

  /** Mark a cached page as most-recent without changing its accounted size. */
  touch(key: string): boolean {
    const size = this.entries.get(key);
    if (size === undefined) return false;
    this.entries.delete(key);
    this.entries.set(key, size);
    return true;
  }

  remove(key: string): boolean {
    const size = this.entries.get(key);
    if (size === undefined) return false;
    this.entries.delete(key);
    this.approximateBytes -= size;
    return true;
  }

  clear(): void {
    this.entries.clear();
    this.approximateBytes = 0;
  }
}
