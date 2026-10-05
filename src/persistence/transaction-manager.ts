/**
 * transaction-manager.ts
 *
 * Provides safe synchronous SQLite transaction helpers. This file owns generic
 * transaction boundaries only; feature services own domain-specific SQL.
 */

import type { Database } from 'bun:sqlite';
import { OBS_CODES } from '../observability/codes';
import { emitPlatformCode, emitPlatformCodeTo } from '../observability/sink';
import type { PlatformObservabilityRuntime } from '../observability/types';

/** SQLite transaction mode accepted by TransactionManager. */
export type IsolationLevel = 'DEFERRED' | 'IMMEDIATE' | 'EXCLUSIVE';

/** App-local diagnostics for exceptional transaction cleanup failure. */
export interface TransactionManagerOptions {
  readonly emitTelemetry?: boolean;
  readonly observability?: PlatformObservabilityRuntime;
}

/** Generic transaction helper for platform services. */
export class TransactionManager {
  private depth = 0;
  private readonly options: TransactionManagerOptions;

  /** Create a transaction manager for one SQLite handle. */
  constructor(
    private readonly db: Database,
    options: TransactionManagerOptions = {},
  ) {
    this.options = Object.freeze({ ...options });
  }

  /**
   * Run a synchronous callback inside a SQLite transaction.
   *
   * Nested calls use SAVEPOINTs so platform services can compose helpers
   * without accidentally opening conflicting root transactions.
   */
  runSync<T>(
    fn: () => T & (T extends PromiseLike<unknown> ? never : unknown),
    isolation: IsolationLevel = 'IMMEDIATE',
  ): T {
    const savepointName = `zero_tx_${this.depth}`;
    const isRoot = this.depth === 0;
    this.depth += 1;

    let opened = false;
    try {
      this.db.run(isRoot ? `BEGIN ${isolation}` : `SAVEPOINT ${savepointName}`);
      opened = true;
      const result = fn();
      if (isThenable(result)) {
        void Promise.resolve(result).catch(() => {});
        throw new TypeError('SQLite transaction callbacks must be synchronous.');
      }
      this.db.run(isRoot ? 'COMMIT' : `RELEASE SAVEPOINT ${savepointName}`);
      return result;
    } catch (error) {
      // A failed BEGIN owns no transaction and must not roll back an unrelated
      // caller boundary. Depth still retires through finally.
      if (opened) {
        try {
          if (isRoot) {
            this.db.run('ROLLBACK');
          } else {
            this.db.run(`ROLLBACK TO SAVEPOINT ${savepointName}`);
            this.db.run(`RELEASE SAVEPOINT ${savepointName}`);
          }
        } catch (rollbackError) {
          this.reportRollbackFailure();
          throw new AggregateError(
            [error, rollbackError],
            'SQLite transaction failed and rollback could not complete.',
          );
        }
      }
      throw error;
    } finally {
      this.depth -= 1;
    }
  }

  private reportRollbackFailure(): void {
    if (this.options.emitTelemetry === false) return;
    try {
      const code = OBS_CODES.PERSISTENCE_SQL_TRANSACTION_ROLLBACK_FAILED;
      if (this.options.observability) emitPlatformCodeTo(this.options.observability, code);
      else emitPlatformCode(code);
    } catch { /* Diagnostics cannot replace the original/rollback failures. */ }
  }
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return value !== null
    && (typeof value === 'object' || typeof value === 'function')
    && typeof Reflect.get(value, 'then') === 'function';
}
