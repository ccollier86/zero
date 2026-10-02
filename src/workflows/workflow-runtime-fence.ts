/**
 * Transaction-time workflow runtime fencing contract.
 *
 * Persistence collaborators use this tiny interface to prove that the same
 * runtime generation still owns the database immediately before commit. The
 * lease implementation remains outside stores and domain coordinators.
 */

import type { ReactiveDB } from '../sync/reactive-db';
import { WorkflowError } from './workflow-error';
import { WorkflowRuntimeLeaseStore } from './workflow-runtime-lease-store';

export interface WorkflowRuntimeFence {
  /** Throw unless this exact owner and generation still hold an active lease. */
  assertCurrent(): void;
}

/**
 * Backward-compatible fence for public low-level workflow helpers.
 *
 * Unmanaged helpers retain their historical behavior while no managed owner
 * is live. Once WorkflowService acquires a generation, their next mutation is
 * rejected under the same writer transaction instead of bypassing ownership.
 */
export function createUnmanagedWorkflowRuntimeFence(
  db: ReactiveDB,
  now: () => number = Date.now,
): WorkflowRuntimeFence {
  const leases = new WorkflowRuntimeLeaseStore(db);
  let lastObservedAt = 0;
  return Object.freeze({
    assertCurrent(): void {
      const observedAt = now();
      if (!Number.isSafeInteger(observedAt) || observedAt < 0) {
        throw new WorkflowError(
          'Workflow runtime ownership clock returned an invalid time',
          'WORKFLOW_CONFIG_INVALID',
          500,
        );
      }
      // A regressing wall clock may delay unmanaged access, but can never
      // revive it while a generation previously observed as live still owns.
      lastObservedAt = Math.max(lastObservedAt, observedAt);
      leases.assertUnmanaged(lastObservedAt);
    },
  });
}

/**
 * Run a synchronous mutation with ownership checks under the writer lock.
 * ReactiveDB rejects thenables, rolls the transaction back, and poisons their
 * async continuation so this boundary can never commit before work settles.
 */
export function workflowRuntimeTransaction<T>(
  db: Pick<ReactiveDB, 'transaction'>,
  fence: WorkflowRuntimeFence | null | undefined,
  operation: () => T,
): T {
  return db.transaction(() => {
    fence?.assertCurrent();
    const result = operation();
    fence?.assertCurrent();
    return result;
  });
}
