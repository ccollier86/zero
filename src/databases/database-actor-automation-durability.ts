/** Hot-database durability fence required before exposing a claimed effect. */

import type { DatabaseActorWriterBinding } from './database-actor-binding';
import { DatabaseError } from './database-error';

/**
 * Publish a complete synchronous hot image before a claimed command leaves
 * the actor. This intentionally overrides periodic/final acknowledgement
 * policy because an external effect must never begin from RAM-only state.
 */
export function establishHotAutomationClaimDurability(
  binding: DatabaseActorWriterBinding,
): void {
  if (binding.placement.mode !== 'hot') return;
  try {
    const snapshot = binding.runtime.sqlite.snapshot;
    if (!snapshot) {
      throw new Error('Hot database automation claim has no snapshot boundary.');
    }
    if (binding.placement.durability === 'periodic') {
      snapshot.recordPeriodicCommit();
    }
    const result = snapshot.snapshotSyncDetailed();
    if (result.status !== 'written') {
      throw result.status === 'failed'
        ? result.error
        : new Error('Hot database automation claim was not published.');
    }
  } catch (cause) {
    throw new DatabaseError(
      'DATABASE_OUTCOME_UNKNOWN',
      'Hot database automation claim durability is unknown.',
      { cause, retryable: false, outcome: 'unknown' },
    );
  }
}
