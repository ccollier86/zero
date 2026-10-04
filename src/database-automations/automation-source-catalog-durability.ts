/** Hot-system durability boundary for automation source-catalog mutations. */

import { DatabaseError } from '../databases/database-error';
import type { DatabaseRuntime } from '../databases/database-runtime';

/**
 * Publish committed catalog authority before it can be used to discover work.
 * File mode already commits through SQLite; ephemeral mode deliberately has no
 * restart contract. Hot mode requires an exact post-commit snapshot.
 */
export class DatabaseAutomationSourceCatalogDurability {
  readonly #runtime: DatabaseRuntime;
  #failure: DatabaseError | null = null;

  constructor(runtime: DatabaseRuntime) {
    this.#runtime = runtime;
    if (runtime.sqlite.mode === 'hot'
      && !runtime.sqlite.snapshot?.isEnabled) {
      throw new DatabaseError(
        'DATABASE_CONFIG_INVALID',
        'Durable automation source discovery requires enabled system hot snapshots.',
        {
          retryable: false,
          outcome: 'not-started',
          details: { component: 'database-automation-source-catalog' },
        },
      );
    }
  }

  /** Fence the current transaction only if its catalog mutation commits. */
  afterMutation(): void {
    if (this.#runtime.sqlite.mode !== 'hot') return;
    this.#runtime.db.afterCommitFence(() => this.#publishHotImage());
  }

  /** Refuse reads or writes after an acknowledged catalog image is uncertain. */
  assertHealthy(): void {
    if (this.#failure) throw this.#failure;
  }

  #publishHotImage(): void {
    if (this.#failure) return;
    try {
      const snapshot = this.#runtime.sqlite.snapshot;
      if (!snapshot?.isEnabled || !snapshot.isHealthy) {
        throw new Error('System hot snapshot boundary is unavailable.');
      }
      snapshot.recordPeriodicCommit();
      const result = snapshot.snapshotSyncDetailed();
      if (result.status !== 'written' || !snapshot.isHealthy) {
        throw result.status === 'failed'
          ? result.error
          : new Error('System hot snapshot did not publish the catalog mutation.');
      }
    } catch (cause) {
      const failure = new DatabaseError(
        'DATABASE_OUTCOME_UNKNOWN',
        'Hot system automation source catalog durability is unknown.',
        {
          cause,
          retryable: false,
          outcome: 'unknown',
          details: { component: 'database-automation-source-catalog' },
        },
      );
      this.#failure = failure;
      throw failure;
    }
  }
}
