/**
 * statement-cache.ts
 *
 * Caches prepared SQLite statements for cross-cutting platform SQL helpers.
 * This file owns statement reuse/finalization only; feature-specific prepared
 * statements may still live beside their owning services.
 */

import type { Database, Statement } from 'bun:sqlite';

interface CachedStatement {
  statement: Statement;
  lastUsed: number;
  useCount: number;
}

/** Small LRU-ish prepared statement cache. */
export class StatementCache {
  private readonly cache = new Map<string, CachedStatement>();

  /** Create a statement cache for one SQLite handle. */
  constructor(
    private readonly db: Database,
    private readonly maxSize = 1000,
    private readonly ttlMs = 300_000
  ) {}

  /** Return a cached prepared statement for SQL, preparing it on miss. */
  prepare(sql: string): Statement {
    const cached = this.cache.get(sql);
    if (cached) {
      cached.lastUsed = Date.now();
      cached.useCount += 1;
      return cached.statement;
    }

    if (this.cache.size >= this.maxSize) this.evict();
    const statement = this.db.prepare(sql);
    this.cache.set(sql, {
      statement,
      lastUsed: Date.now(),
      useCount: 1,
    });
    return statement;
  }

  /** Finalize every cached statement. */
  clear(): void {
    for (const cached of this.cache.values()) cached.statement.finalize();
    this.cache.clear();
  }

  /** Return statement cache diagnostics. */
  stats(): { size: number; maxSize: number; hitRate: number } {
    let totalUses = 0;
    for (const cached of this.cache.values()) totalUses += cached.useCount;
    return {
      size: this.cache.size,
      maxSize: this.maxSize,
      hitRate: totalUses > 0 ? (totalUses - this.cache.size) / totalUses : 0,
    };
  }

  private evict(): void {
    const now = Date.now();
    const expired: string[] = [];
    for (const [sql, cached] of this.cache.entries()) {
      if (now - cached.lastUsed > this.ttlMs) expired.push(sql);
    }

    if (expired.length === 0) {
      let oldestSql: string | null = null;
      let oldestTime = Number.POSITIVE_INFINITY;
      for (const [sql, cached] of this.cache.entries()) {
        if (cached.lastUsed < oldestTime) {
          oldestSql = sql;
          oldestTime = cached.lastUsed;
        }
      }
      if (oldestSql) expired.push(oldestSql);
    }

    for (const sql of expired) {
      const cached = this.cache.get(sql);
      if (!cached) continue;
      cached.statement.finalize();
      this.cache.delete(sql);
    }
  }
}

