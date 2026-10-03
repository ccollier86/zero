/**
 * storage-studio-lifecycle-policy.ts
 *
 * Defines pure Storage Studio lifecycle validation and transition helpers.
 * It has no database, provider, audit, HTTP, or worker responsibilities.
 */

import { StorageDomainError } from './storage-domain-error';
import type { StorageStudioAuthority } from './storage-studio-authority';
import { requireStorageStudioCapability } from './storage-studio-authority';
import { isStoragePersonalOwner } from './storage-studio-catalog';
import type {
  StorageStudioLifecycleRequest,
  StorageStudioMutationReceipt,
} from './storage-studio-contracts';
import {
  normalizeStorageOperationId,
  normalizeStorageRevision,
  storageStudioRequestHash,
} from './storage-studio-policy';
import type {
  StorageStudioDriveLifecycle,
  StorageStudioDriveProfile,
  StorageStudioOperationKind,
} from './storage-studio-schema';
import type { StorageStudioOperationRecord } from './storage-studio-store';

const LIFECYCLE_ACTIONS = new Set<StorageStudioLifecycleRequest['action']>([
  'suspend',
  'resume',
  'delete',
  'restore',
  'retry',
]);

export interface NormalizedStorageLifecycleCommand {
  readonly operationId: string;
  readonly expectedRevision: number;
  readonly action: StorageStudioLifecycleRequest['action'];
  readonly kind: StorageStudioOperationKind;
  readonly requestHash: string;
}

/** Normalize and hash one drive-bound lifecycle command. */
export function normalizeStorageLifecycleCommand(
  driveId: string,
  request: StorageStudioLifecycleRequest,
): NormalizedStorageLifecycleCommand {
  if (!LIFECYCLE_ACTIONS.has(request.action)) {
    throw new StorageDomainError(
      'STORAGE_INPUT_INVALID',
      'Storage lifecycle action is invalid.',
    );
  }
  const command = {
    operationId: normalizeStorageOperationId(request.operationId),
    expectedRevision: normalizeStorageRevision(request.expectedRevision),
    action: request.action,
    kind: request.action === 'retry' ? 'reconcile' as const : request.action,
  };
  return Object.freeze({
    ...command,
    requestHash: storageStudioRequestHash({ driveId, ...command }),
  });
}

/** Require the control capability associated with a lifecycle action. */
export function requireStorageLifecycleAuthority(
  profile: StorageStudioDriveProfile,
  authority: StorageStudioAuthority,
  action: StorageStudioLifecycleRequest['action'],
): void {
  if (isStoragePersonalOwner(profile, authority)) return;
  requireStorageStudioCapability(
    authority,
    action === 'delete' || action === 'restore' ? 'delete' : 'manage',
  );
}

/** Produce one monotonic lifecycle revision without mutating the source row. */
export function transitionStorageProfile(
  profile: StorageStudioDriveProfile,
  authority: StorageStudioAuthority | null,
  lifecycle: StorageStudioDriveLifecycle,
  now: number,
  options: {
    readonly incrementGeneration?: boolean;
    readonly failureCode?: string | null;
  } = {},
): StorageStudioDriveProfile {
  assertStorageLifecycleTransition(profile.lifecycle, lifecycle);
  const failureCode = options.failureCode === undefined
    ? clearedFailureCode(lifecycle, profile.failure_code)
    : options.failureCode;
  return {
    ...profile,
    lifecycle,
    revision: profile.revision + 1,
    generation: profile.generation + (options.incrementGeneration ? 1 : 0),
    updated_by_user_id: authority?.actor.userId ?? profile.updated_by_user_id,
    updated_by_membership_id: authority
      ? authority.actor.membershipId ?? null
      : profile.updated_by_membership_id,
    updated_at: now,
    ready_at: lifecycle === 'ready' ? now : profile.ready_at,
    degraded_at: lifecycle === 'degraded' ? now : profile.degraded_at,
    suspended_at: lifecycle === 'suspended' ? now : profile.suspended_at,
    deleting_at: lifecycle === 'deleting' ? now : profile.deleting_at,
    deleted_at: lifecycle === 'deleted' ? now : profile.deleted_at,
    restoring_at: lifecycle === 'restoring' ? now : profile.restoring_at,
    failed_at: lifecycle === 'failed' ? now : profile.failed_at,
    failure_code: failureCode,
  };
}

/** Reject a command when the profile is outside its allowed source states. */
export function requireStorageLifecycle(
  current: StorageStudioDriveLifecycle,
  allowed: readonly StorageStudioDriveLifecycle[],
  verb: string,
): void {
  if (!allowed.includes(current)) {
    throw new StorageDomainError(
      'STORAGE_CONFLICT',
      `Storage drive cannot be ${verb} in its current lifecycle.`,
    );
  }
}

/** Safe audit metadata for a completed profile revision. */
export function storageLifecycleMetadata(
  profile: StorageStudioDriveProfile,
): Record<string, string | number> {
  return {
    lifecycle: profile.lifecycle,
    profile_revision: profile.revision,
    generation: profile.generation,
  };
}

export function storageLifecycleReceipt<T>(
  operationId: string,
  replayed: boolean,
  value: T,
): StorageStudioMutationReceipt<T> {
  return Object.freeze({ operationId, replayed, value });
}

export function storageRevisionConflict(): StorageDomainError {
  return new StorageDomainError(
    'STORAGE_REVISION_CONFLICT',
    'Storage drive revision changed.',
  );
}

export function storageOperationInProgress(): StorageDomainError {
  return new StorageDomainError(
    'STORAGE_OPERATION_IN_PROGRESS',
    'Storage lifecycle operation is already in progress.',
  );
}

export function storageUnknownOutcome(): StorageDomainError {
  return new StorageDomainError(
    'STORAGE_OPERATION_OUTCOME_UNKNOWN',
    'Storage lifecycle outcome is unknown.',
    { outcome: 'unknown' },
  );
}

export function storageCompletedOperationError(
  operation: StorageStudioOperationRecord,
): StorageDomainError {
  if (operation.status === 'outcome_unknown') return storageUnknownOutcome();
  return new StorageDomainError(
    'STORAGE_CONFLICT',
    'Storage lifecycle operation did not complete.',
    { outcome: 'not-committed' },
  );
}

function assertStorageLifecycleTransition(
  from: StorageStudioDriveLifecycle,
  to: StorageStudioDriveLifecycle,
): void {
  const valid = (from === 'ready' || from === 'degraded') && to === 'suspended'
    || from === 'suspended' && to === 'ready'
    || (from === 'ready' || from === 'degraded' || from === 'suspended') && to === 'deleting'
    || from === 'deleting' && (to === 'deleting' || to === 'deleted')
    || from === 'deleted' && to === 'restoring'
    || from === 'restoring' && (to === 'ready' || to === 'deleted' || to === 'degraded')
    || (from === 'failed' || from === 'degraded') && to === 'provisioning'
    || from === 'provisioning' && (to === 'ready' || to === 'failed' || to === 'degraded');
  if (!valid) {
    throw new StorageDomainError(
      'STORAGE_CONFLICT',
      'Storage drive lifecycle transition is not allowed.',
    );
  }
}

function clearedFailureCode(
  lifecycle: StorageStudioDriveLifecycle,
  existing: string | null,
): string | null {
  return lifecycle === 'ready'
    || lifecycle === 'provisioning'
    || lifecycle === 'restoring'
    || lifecycle === 'deleting'
    ? null
    : existing;
}
