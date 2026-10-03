/**
 * storage-studio-lifecycle.ts
 *
 * Orchestrates authenticated Storage Studio lifecycle requests. Pure state
 * policy, cleanup workers, queue persistence, provider bytes, and transport
 * each live behind focused dependencies.
 */

import type { ReactiveDB } from '../sync/reactive-db';
import { StorageDomainError } from './storage-domain-error';
import type { StorageStudioAudit } from './storage-studio-audit';
import type { StorageStudioAuthority } from './storage-studio-authority';
import type { StorageStudioCatalog } from './storage-studio-catalog';
import {
  assertStorageStudioCommitAuthority,
  type StorageStudioCommitFence,
} from './storage-studio-commit-fence';
import type { StorageStudioCleanupCoordinator } from './storage-studio-cleanup-coordinator';
import type {
  StorageStudioDrive,
  StorageStudioLifecycleRequest,
  StorageStudioMutationReceipt,
} from './storage-studio-contracts';
import {
  normalizeStorageLifecycleCommand,
  requireStorageLifecycle,
  requireStorageLifecycleAuthority,
  storageCompletedOperationError,
  storageLifecycleMetadata,
  storageLifecycleReceipt,
  storageOperationInProgress,
  storageRevisionConflict,
  transitionStorageProfile,
  type NormalizedStorageLifecycleCommand,
} from './storage-studio-lifecycle-policy';
import {
  StorageStudioJobStore,
  type StorageStudioJobRecord,
} from './storage-studio-job-store';
import type { StorageStudioLifecycleStore } from './storage-studio-lifecycle-store';
export type { StorageStudioLifecycleStore } from './storage-studio-lifecycle-store';
import { STORAGE_STUDIO_OPERATION_TTL_MS } from './storage-studio-policy';
import type { StorageStudioRecoveryCoordinator } from './storage-studio-recovery-coordinator';
export type { StorageStudioLifecycleProvider } from './storage-studio-recovery-coordinator';
import type {
  StorageStudioDriveLifecycle,
  StorageStudioDriveProfile,
} from './storage-studio-schema';
import type { StorageStudioOperationRecord } from './storage-studio-store';

export interface StorageStudioLifecycleOptions {
  readonly db: Pick<ReactiveDB, 'transaction'>;
  readonly store: StorageStudioLifecycleStore;
  readonly jobs: StorageStudioJobStore;
  readonly catalog: Pick<StorageStudioCatalog, 'get' | 'requireProfile'>;
  readonly cleanup: StorageStudioCleanupCoordinator;
  readonly recovery: StorageStudioRecoveryCoordinator;
  readonly audit: StorageStudioAudit;
  readonly now?: () => number;
}

/** Idempotent request coordinator for managed-drive lifecycle commands. */
export class StorageStudioLifecycleCoordinator {
  private readonly now: () => number;

  constructor(private readonly options: StorageStudioLifecycleOptions) {
    this.now = options.now ?? Date.now;
  }

  async execute(
    authority: StorageStudioAuthority,
    userProperties: Record<string, string>,
    driveId: string,
    request: StorageStudioLifecycleRequest,
    commitFence?: StorageStudioCommitFence,
  ): Promise<StorageStudioMutationReceipt<StorageStudioDrive>> {
    const command = normalizeStorageLifecycleCommand(driveId, request);
    const profile = this.options.catalog.requireProfile(authority, driveId);
    requireStorageLifecycleAuthority(profile, authority, command.action);
    const existing = this.findOperation(profile, authority, command);
    let replayed = existing !== null;
    if (existing) {
      assertOperationHash(existing, command.requestHash);
      if (existing.status === 'succeeded') {
        return this.responseReceipt(
          authority, userProperties, driveId, command.operationId, true, commitFence,
        );
      }
      if (existing.status !== 'pending') throw storageCompletedOperationError(existing);
      await this.resumePending(authority, existing, command.action);
    } else {
      try {
        await this.start(authority, profile, command, commitFence);
      } catch (cause) {
        const raced = this.findOperation(profile, authority, command);
        if (!isOperationIdentityConflict(cause) || !raced) throw cause;
        replayed = true;
        assertOperationHash(raced, command.requestHash);
        if (raced.status === 'pending') {
          await this.resumePending(authority, raced, command.action);
        } else if (raced.status !== 'succeeded') {
          throw storageCompletedOperationError(raced);
        }
      }
    }
    return this.responseReceipt(
      authority, userProperties, driveId, command.operationId, replayed, commitFence,
    );
  }

  /** Execute one due cleanup job for startup/background recovery. */
  runNextCleanupJob() {
    return this.options.cleanup.runNext();
  }

  /** Execute one due provider continuation for startup/background recovery. */
  runNextProviderJob() {
    return this.options.recovery.runNext();
  }

  nextProviderJobAt(): number | null {
    return this.options.recovery.nextActionAt();
  }

  /** Cancel active provider waits; their durable leases remain recoverable. */
  stopProviderJobs(): void {
    this.options.recovery.stop();
    this.options.cleanup.stop();
  }

  private async start(
    authority: StorageStudioAuthority,
    profile: StorageStudioDriveProfile,
    command: NormalizedStorageLifecycleCommand,
    commitFence?: StorageStudioCommitFence,
  ): Promise<void> {
    if (command.action === 'suspend' || command.action === 'resume') {
      this.applyImmediate(authority, profile, command, commitFence);
    } else if (command.action === 'delete') {
      await this.startDelete(authority, profile, command, commitFence);
    } else if (command.action === 'restore') {
      const operation = this.beginStage(
        authority, profile, command, ['deleted'], 'restored', 'restoring', true,
        'storage.drive-restore-requested', 'restore', commitFence,
      );
      await this.options.recovery.finishRestore(authority, operation);
    } else if (profile.lifecycle === 'deleting') {
      await this.retryCleanup(authority, profile, command, commitFence);
    } else {
      const operation = this.beginStage(
        authority, profile, command, ['failed', 'degraded'], 'retried', 'provisioning', true,
        'storage.drive-retry-requested', 'reconcile', commitFence,
      );
      await this.options.recovery.finishProvisioningRetry(authority, operation);
    }
  }

  private applyImmediate(
    authority: StorageStudioAuthority,
    profile: StorageStudioDriveProfile,
    command: NormalizedStorageLifecycleCommand,
    commitFence?: StorageStudioCommitFence,
  ): void {
    this.options.db.transaction(() => {
      assertStorageStudioCommitAuthority(commitFence);
      const current = this.requireCurrent(authority, profile.drive_id, command.expectedRevision);
      const now = this.now();
      const operation = this.insertOperation(authority, current, command, now);
      const next = transitionStorageProfile(
        current,
        authority,
        command.action === 'suspend' ? 'suspended' : 'ready',
        now,
        { incrementGeneration: command.action === 'suspend' },
      );
      this.replace(current, next);
      this.options.store.completeOperation(operation.operation_id, current.drive_id, next.revision, now);
      this.options.audit.append(
        authority,
        command.action === 'suspend' ? 'storage.drive-suspended' : 'storage.drive-resumed',
        'succeeded',
        current.drive_id,
        storageLifecycleMetadata(next),
      );
    });
  }

  private async startDelete(
    authority: StorageStudioAuthority,
    profile: StorageStudioDriveProfile,
    command: NormalizedStorageLifecycleCommand,
    commitFence?: StorageStudioCommitFence,
  ): Promise<void> {
    const job = this.options.db.transaction(() => {
      assertStorageStudioCommitAuthority(commitFence);
      const current = this.requireCurrent(authority, profile.drive_id, command.expectedRevision);
      requireStorageLifecycle(current.lifecycle, ['ready', 'degraded', 'suspended'], 'deleted');
      const now = this.now();
      const operation = this.insertOperation(authority, current, command, now);
      const deleting = transitionStorageProfile(current, authority, 'deleting', now, {
        incrementGeneration: true,
      });
      this.replace(current, deleting);
      const queued = this.options.jobs.enqueue({
        operationId: operation.operation_id,
        driveId: current.drive_id,
        kind: 'cleanup',
        generation: deleting.generation,
        availableAt: now,
      });
      this.options.audit.append(authority, 'storage.drive-delete-requested', 'succeeded',
        current.drive_id, storageLifecycleMetadata(deleting));
      return queued;
    });
    await this.requireCleanupSuccess(job, authority);
  }

  private beginStage(
    authority: StorageStudioAuthority,
    profile: StorageStudioDriveProfile,
    command: NormalizedStorageLifecycleCommand,
    allowed: readonly StorageStudioDriveLifecycle[],
    verb: string,
    target: StorageStudioDriveLifecycle,
    incrementGeneration: boolean,
    auditAction: string,
    jobKind: Extract<StorageStudioJobRecord['job_kind'], 'restore' | 'reconcile'>,
    commitFence?: StorageStudioCommitFence,
  ): StorageStudioOperationRecord {
    return this.options.db.transaction(() => {
      assertStorageStudioCommitAuthority(commitFence);
      const current = this.requireCurrent(authority, profile.drive_id, command.expectedRevision);
      requireStorageLifecycle(current.lifecycle, allowed, verb);
      const now = this.now();
      const operation = this.insertOperation(authority, current, command, now);
      const staged = transitionStorageProfile(current, authority, target, now, { incrementGeneration });
      this.replace(current, staged);
      this.options.jobs.enqueue({
        operationId: operation.operation_id,
        driveId: current.drive_id,
        kind: jobKind,
        generation: staged.generation,
        availableAt: now,
      });
      this.options.audit.append(authority, auditAction, 'succeeded', current.drive_id,
        storageLifecycleMetadata(staged));
      return operation;
    });
  }

  private async retryCleanup(
    authority: StorageStudioAuthority,
    profile: StorageStudioDriveProfile,
    command: NormalizedStorageLifecycleCommand,
    commitFence?: StorageStudioCommitFence,
  ): Promise<void> {
    const job = this.options.db.transaction(() => {
      assertStorageStudioCommitAuthority(commitFence);
      const current = this.requireCurrent(authority, profile.drive_id, command.expectedRevision);
      const failed = this.options.jobs.getLatestForDrive(current.drive_id, 'cleanup');
      if (!failed || failed.status !== 'failed' || failed.generation !== current.generation) {
        throw storageOperationInProgress();
      }
      const now = this.now();
      const operation = this.insertOperation(authority, current, command, now);
      const retried = transitionStorageProfile(current, authority, 'deleting', now);
      this.replace(current, retried);
      const queued = this.options.jobs.requeueFailed(
        failed.job_id, operation.operation_id, current.generation, now,
      );
      this.options.audit.append(authority, 'storage.drive-delete-retried', 'succeeded',
        current.drive_id, storageLifecycleMetadata(retried));
      return queued;
    });
    await this.requireCleanupSuccess(job, authority);
  }

  private async resumePending(
    authority: StorageStudioAuthority,
    operation: StorageStudioOperationRecord,
    action: StorageStudioLifecycleRequest['action'],
  ): Promise<void> {
    const profile = operation.drive_id ? this.options.store.getProfile(operation.drive_id) : null;
    if (action === 'delete' || (action === 'retry' && profile?.lifecycle === 'deleting')) {
      const job = this.options.jobs.getByOperation(operation.operation_id, 'cleanup');
      if (!job) throw storageOperationInProgress();
      await this.requireCleanupSuccess(job, authority);
    } else if (action === 'restore') {
      await this.options.recovery.finishRestore(authority, operation);
    } else if (action === 'retry') {
      await this.options.recovery.finishProvisioningRetry(authority, operation);
    } else {
      throw storageOperationInProgress();
    }
  }

  private async requireCleanupSuccess(
    job: StorageStudioJobRecord,
    authority: StorageStudioAuthority,
  ): Promise<void> {
    const result = await this.options.cleanup.claimAndRun(job.job_id, authority);
    if (result === 'succeeded' || result === 'retrying') return;
    throw new StorageDomainError(
      'STORAGE_PROVIDER_UNAVAILABLE',
      'The drive entered deleting state, but cleanup requires an explicit retry.',
      { retryable: false, outcome: 'committed' },
    );
  }

  private findOperation(
    profile: StorageStudioDriveProfile,
    authority: StorageStudioAuthority,
    command: NormalizedStorageLifecycleCommand,
  ): StorageStudioOperationRecord | null {
    return this.options.store.getOperation(
      profile.scope_kind, profile.scope_id, authority.actor.userId,
      command.kind, command.operationId,
    );
  }

  private requireCurrent(
    authority: StorageStudioAuthority,
    driveId: string,
    expectedRevision: number,
  ): StorageStudioDriveProfile {
    const profile = this.options.catalog.requireProfile(authority, driveId);
    if (profile.revision !== expectedRevision) throw storageRevisionConflict();
    return profile;
  }

  private replace(current: StorageStudioDriveProfile, next: StorageStudioDriveProfile): void {
    if (!this.options.store.updateProfileAtRevision(next, current.revision)) {
      throw storageRevisionConflict();
    }
  }

  private insertOperation(
    authority: StorageStudioAuthority,
    profile: StorageStudioDriveProfile,
    command: NormalizedStorageLifecycleCommand,
    now: number,
  ): StorageStudioOperationRecord {
    return this.options.store.insertOperation({
      operationId: `stlop_${crypto.randomUUID()}`,
      idempotencyKey: command.operationId,
      kind: command.kind,
      scopeKind: profile.scope_kind,
      scopeId: profile.scope_id,
      actorUserId: authority.actor.userId,
      actorMembershipId: authority.actor.membershipId ?? null,
      requestHash: command.requestHash,
      driveId: profile.drive_id,
      createdAt: now,
      expiresAt: now + STORAGE_STUDIO_OPERATION_TTL_MS,
    });
  }

  private responseReceipt(
    authority: StorageStudioAuthority,
    userProperties: Record<string, string>,
    driveId: string,
    operationId: string,
    replayed: boolean,
    commitFence?: StorageStudioCommitFence,
  ): StorageStudioMutationReceipt<StorageStudioDrive> {
    try {
      assertStorageStudioCommitAuthority(commitFence);
    } catch (cause) {
      // Lifecycle intent is already durable before provider continuation. A
      // revoked caller must not receive private catalog data, but the error
      // must truthfully state that retrying under a new id can duplicate work.
      throw new StorageDomainError(
        'STORAGE_AUTHORITY_CHANGED',
        'Storage Studio authority changed before response delivery.',
        { cause, outcome: 'committed' },
      );
    }
    return storageLifecycleReceipt(
      operationId,
      replayed,
      this.options.catalog.get(authority, userProperties, driveId),
    );
  }
}

function assertOperationHash(
  operation: StorageStudioOperationRecord,
  expectedHash: string,
): void {
  if (operation.request_hash === expectedHash) return;
  throw new StorageDomainError(
    'STORAGE_IDEMPOTENCY_CONFLICT',
    'Storage operation id was already used for different input.',
  );
}

function isOperationIdentityConflict(value: unknown): boolean {
  return value instanceof Error
    && /UNIQUE constraint failed: _storage_studio_operations\./iu.test(value.message);
}
