/** Actor-local Guardian anchor validation and timestamp helpers. */

import type { DatabaseWriteCommandCapability } from '../databases/database-realm';
import { DataStudioError } from './data-studio-error';
import type { DataStudioActorInput } from './data-studio-operation-contracts';

/**
 * Prove that the two attribution ids are the same projected membership.
 * Independent foreign keys prove existence, but cannot prove that pairing.
 */
export function assertDataStudioActor(
  db: DatabaseWriteCommandCapability,
  actor: DataStudioActorInput,
): void {
  const membership = db.get('tenant_memberships', actor.membershipId);
  if (!membership || membership.user_id !== actor.userId) {
    throw new DataStudioError(
      'DATA_STUDIO_AUTHORITY_REQUIRED',
      'Data Studio actor is not a projected tenant member.',
    );
  }
}

/** Keep persisted timestamps valid across a backwards wall-clock adjustment. */
export function dataStudioMutationTimestamp(previous = 0): number {
  return Math.max(Date.now(), previous);
}
