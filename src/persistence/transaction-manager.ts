/**
 * transaction-manager.ts
 *
 * Provides safe synchronous SQLite transaction helpers. This file owns generic
 * transaction boundaries only; feature services own domain-specific SQL.
 */

import type { Database } from 'bun:sqlite';

/** SQLite transaction mode accepted by TransactionManager. */
export type IsolationLevel = 'DEFERRED' | 'IMMEDIATE' | 'EXCLUSIVE';

/** Generic transaction helper for platform services. */
export class TransactionManager {
  private depth = 0;

  /** Create a transaction manager for one SQLite handle. */
  constructor(private readonly db: Database) {}

  /**
   * Run a synchronous callback inside a SQLite transaction.
   *
   * Nested calls use SAVEPOINTs so platform services can compose helpers
   * without accidentally opening conflicting root transactions.
   */
  runSync<T>(fn: () => T, isolation: IsolationLevel = 'IMMEDIATE'): T {
    const savepointName = `zero_tx_${this.depth}`;
    const isRoot = this.depth === 0;
    this.depth += 1;

    this.db.run(isRoot ? `BEGIN ${isolation}` : `SAVEPOINT ${savepointName}`);
    try {
      const result = fn();
      this.db.run(isRoot ? 'COMMIT' : `RELEASE SAVEPOINT ${savepointName}`);
      return result;
    } catch (error) {
      if (isRoot) {
        this.db.run('ROLLBACK');
      } else {
        this.db.run(`ROLLBACK TO SAVEPOINT ${savepointName}`);
        this.db.run(`RELEASE SAVEPOINT ${savepointName}`);
      }
      throw error;
    } finally {
      this.depth -= 1;
    }
  }
}
