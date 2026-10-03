/**
 * storage-studio-cleanup-coordinator.ts
 *
 * Executes and recovers durable Storage Studio cleanup jobs. It owns provider
 * cleanup orchestration only; request authorization, transition selection,
 * SQL queue mechanics, and HTTP behavior live in separate modules.
 */

import type { AuthAuditService } from '../auth/auth-audit-service';
import { OBS_CODES } from '../observability/codes';
import { emitPlatformCode } from '../observability/sink';
import type {
  PlatformCodeDefinition,
  PlatformCodeEmitOptions,
} from '../observability/types';
import type { ReactiveDB } from '../sync/reactive-db';
import {
  StorageDomainError,
  normalizeStorageError,
  type StorageErrorCode,
} from './storage-domain-error';
import type { StorageService } from './storage-service';
import type { StorageStudioAudit } from './storage-studio-audit';
import type { StorageStudioAuthority } from './storage-studio-authority';
import { storageDriveNotFound } from './storage-studio-catalog';
import type { StorageStudioLifecycleStore } from './storage-studio-lifecycle-store';
import {
  storageLifecycleMetadata,
  storageOperationInProgress,
  storageUnknownOutcome,
  transitionStorageProfile,
} from './storage-studio-lifecycle-policy';
import {
  StorageStudioJobStore,
  type StorageStudioJobRecord,
} from './storage-studio-job-store';
import type { StorageStudioDriveProfile } from './storage-studio-schema';
import { storageStudioContinuationAuthority } from './storage-studio-continuation-authority';

const CLEANUP_LEASE_MS = 30_000;
const CLEANUP_RENEW_MS = 10_000;
const CLEANUP_RETRY_BASE_MS = 1_000;
const CLEANUP_RETRY_MAX_MS = 5 * 60_000;
// The maintenance worker invokes runNext at most 32 times per pass. Recovering
// one lease per invocation keeps lease recovery inside that same pass budget.
const CLEANUP_LEASE_RECOVERY_PER_RUN = 1;

type StoragePlatformCodeEmitter = (
  definition: PlatformCodeDefinition,
  options?: PlatformCodeEmitOptions,
) => unknown;

export interface StorageStudioCleanupCoordinatorOptions {
  readonly db: Pick<ReactiveDB, 'transaction'>;
  readonly storage: Pick<StorageService, 'purgeDriveContentsBatch'>;
  readonly store: StorageStudioLifecycleStore;
  readonly jobs: StorageStudioJobStore;
  readonly audit: StorageStudioAudit;
  readonly systemAudit?: Pick<AuthAuditService, 'append'> | null;
  readonly emitCode?: StoragePlatformCodeEmitter;
  readonly now?: () => number;
  readonly leaseMs?: number;
  readonly renewIntervalMs?: number;
}

export type StorageStudioCleanupRunResult =
  | 'idle'
  | 'succeeded'
  | 'retrying'
  | 'failed';

/** Retryable cleanup worker for tombstone-preserving drive deletion. */
export class StorageStudioCleanupCoordinator {
  private readonly emitCode: StoragePlatformCodeEmitter;
  private readonly now: () => number;
  private readonly leaseMs: number;
  private readonly renewIntervalMs: number;
  private readonly active = new Set<AbortController>();
  private stopping = false;

  constructor(private readonly options: StorageStudioCleanupCoordinatorOptions) {
    this.emitCode = options.emitCode ?? emitPlatformCode;
    this.now = options.now ?? Date.now;
    this.leaseMs = cleanupDuration(options.leaseMs, CLEANUP_LEASE_MS, 'lease');
    this.renewIntervalMs = cleanupDuration(
      options.renewIntervalMs,
      Math.min(CLEANUP_RENEW_MS, Math.max(1, Math.floor(this.leaseMs / 3))),
      'renewal interval',
    );
    if (this.renewIntervalMs >= this.leaseMs) {
      throw new TypeError('Storage cleanup renewal interval must be shorter than its lease.');
    }
  }

  /** Claim and execute one known cleanup job. */
  async claimAndRun(
    jobId: string,
    authority: StorageStudioAuthority,
  ): Promise<Exclude<StorageStudioCleanupRunResult, 'idle'>> {
    if (this.stopping) return 'retrying';
    const existing = this.options.jobs.get(jobId);
    if (!existing) throw storageDriveNotFound();
    if (existing.status === 'succeeded') return 'succeeded';
    if (existing.status === 'failed') return 'failed';
    const job = this.options.jobs.claim(jobId, this.now(), this.leaseMs);
    if (!job) return 'retrying';
    return this.runClaimed(job, authority);
  }

  /** Recover leases and execute the oldest due cleanup job. */
  async runNext(): Promise<StorageStudioCleanupRunResult> {
    if (this.stopping) return 'idle';
    const recovered = this.options.db.transaction(() => {
      const result = this.options.jobs.recoverExpired(
        'cleanup',
        this.now(),
        CLEANUP_LEASE_RECOVERY_PER_RUN,
      );
      for (const job of result.failed) {
        this.markTerminalFailure(
          job,
          null,
          'STORAGE_PROVIDER_UNAVAILABLE',
          this.now(),
        );
      }
      return result;
    });
    const job = this.options.jobs.claimNext('cleanup', this.now(), this.leaseMs);
    if (!job) {
      if (recovered.failed.length > 0) return 'failed';
      if (recovered.requeued > 0 || recovered.hasMore) return 'retrying';
      return 'idle';
    }
    return this.runClaimed(job, null);
  }

  private async runClaimed(
    job: StorageStudioJobRecord,
    authority: StorageStudioAuthority | null,
  ): Promise<Exclude<StorageStudioCleanupRunResult, 'idle'>> {
    const continuation = this.continuationAuthority(job) ?? authority;
    const controller = new AbortController();
    let leaseLost = false;
    const renewal = setInterval(() => {
      try {
        if (this.options.jobs.renew(job, this.now(), this.leaseMs)) return;
      } catch {
        // Treat renewal uncertainty as lost ownership.
      }
      leaseLost = true;
      controller.abort(storageOperationInProgress());
    }, this.renewIntervalMs);
    renewal.unref?.();
    this.active.add(controller);
    try {
      const batch = await this.options.storage.purgeDriveContentsBatch(
        job.drive_id,
        undefined,
        () => this.options.jobs.assertCurrent(job, this.now()),
        controller.signal,
      );
      if (leaseLost) return 'retrying';
      if (!batch.exists) throw storageDriveNotFound();
      if (batch.remaining) {
        const continued = this.options.db.transaction(() => (
          this.options.jobs.continue(job, this.now())
        ));
        if (!continued) throw storageOperationInProgress();
        return 'retrying';
      }
    } catch (cause) {
      if (controller.signal.aborted) {
        this.options.db.transaction(() => {
          this.options.jobs.continue(job, this.now());
        });
        return 'retrying';
      }
      return this.recordFailure(job, continuation, cause);
    } finally {
      clearInterval(renewal);
      this.active.delete(controller);
    }

    try {
      this.options.db.transaction(() => {
        const current = this.requireDeletingProfile(job);
        const now = this.now();
        const deleted = transitionStorageProfile(current, continuation, 'deleted', now);
        this.replace(current, deleted);
        if (!this.options.jobs.complete(job, now)) throw storageOperationInProgress();
        if (job.operation_id) {
          this.options.store.completeOperation(
            job.operation_id,
            job.drive_id,
            deleted.revision,
            now,
          );
        }
        this.appendAudit(
          continuation,
          deleted,
          'storage.drive-deleted',
          'succeeded',
          storageLifecycleMetadata(deleted),
        );
      });
    } catch {
      throw storageUnknownOutcome();
    }
    this.emitCode(OBS_CODES.STORAGE_BLOB_CLEANUP_COMPLETED, {
      metadata: { driveId: job.drive_id, attemptCount: job.attempt_count },
    });
    return 'succeeded';
  }

  /** Abort active bounded batches; jobs requeue only after cancellation acknowledgment. */
  stop(): void {
    this.stopping = true;
    for (const controller of this.active) {
      controller.abort(new StorageDomainError(
        'STORAGE_PROVIDER_UNAVAILABLE',
        'Storage cleanup is stopping.',
        { retryable: true, outcome: 'not-committed' },
      ));
    }
  }

  private recordFailure(
    job: StorageStudioJobRecord,
    authority: StorageStudioAuthority | null,
    cause: unknown,
  ): 'retrying' | 'failed' {
    const error = providerCleanupError(cause);
    const retryAt = error.retryable && job.attempt_count < job.max_attempts
      ? this.now() + cleanupRetryDelay(job.attempt_count)
      : null;
    const result = this.options.db.transaction(() => {
      const now = this.now();
      const failedJob = this.options.jobs.fail(job, error.code, retryAt, now);
      if (failedJob.status === 'queued') return 'retrying' as const;
      this.markTerminalFailure(failedJob, authority, error.code, now);
      return 'failed' as const;
    });
    this.emitCode(OBS_CODES.STORAGE_BLOB_CLEANUP_FAILED, {
      error,
      metadata: {
        driveId: job.drive_id,
        attemptCount: job.attempt_count,
        retrying: result === 'retrying',
        errorCode: error.code,
      },
    });
    return result;
  }

  private markTerminalFailure(
    job: StorageStudioJobRecord,
    authority: StorageStudioAuthority | null,
    errorCode: StorageErrorCode,
    now: number,
  ): void {
    const current = this.options.store.getProfile(job.drive_id);
    if (!current || current.lifecycle !== 'deleting'
      || current.generation !== job.generation) return;
    const marked = transitionStorageProfile(current, authority, 'deleting', now, {
      failureCode: errorCode,
    });
    this.replace(current, marked);
    if (job.operation_id) {
      this.options.store.failOperation(job.operation_id, 'failed', errorCode, now);
    }
    this.appendAudit(
      authority,
      marked,
      'storage.drive-delete-failed',
      'failed',
      { error_code: errorCode, attempt_count: job.attempt_count },
    );
  }

  private requireDeletingProfile(job: StorageStudioJobRecord): StorageStudioDriveProfile {
    const profile = this.options.store.getProfile(job.drive_id);
    if (!profile || profile.lifecycle !== 'deleting'
      || profile.generation !== job.generation) throw storageDriveNotFound();
    return profile;
  }

  private replace(
    current: StorageStudioDriveProfile,
    next: StorageStudioDriveProfile,
  ): void {
    if (!this.options.store.updateProfileAtRevision(next, current.revision)) {
      throw storageOperationInProgress();
    }
  }

  private appendAudit(
    authority: StorageStudioAuthority | null,
    profile: StorageStudioDriveProfile,
    action: string,
    outcome: 'succeeded' | 'failed',
    metadata: Record<string, string | number | boolean | null>,
  ): void {
    if (authority) {
      this.options.audit.appendContinuation(
        authority,
        action,
        outcome,
        profile.drive_id,
        metadata,
      );
      return;
    }
    this.options.systemAudit?.append({
      action,
      outcome,
      scope: profile.scope_kind === 'tenant'
        ? { kind: 'tenant', tenantId: profile.scope_id }
        : { kind: 'application' },
      actor: { provenance: 'system' },
      target: { type: 'storage-drive', id: profile.drive_id },
      metadata,
    });
  }

  private continuationAuthority(
    job: StorageStudioJobRecord,
  ): StorageStudioAuthority | null {
    if (!job.operation_id) return null;
    const operation = this.options.store.getOperationById(job.operation_id);
    return operation ? storageStudioContinuationAuthority(operation) : null;
  }
}

function providerCleanupError(cause: unknown): StorageDomainError {
  const normalized = normalizeStorageError(cause);
  if (normalized.code !== 'STORAGE_INTERNAL') return normalized;
  return new StorageDomainError(
    'STORAGE_PROVIDER_UNAVAILABLE',
    'Storage cleanup did not complete.',
    { retryable: true, outcome: 'not-committed', cause: normalized },
  );
}

function cleanupRetryDelay(attempt: number): number {
  return Math.min(
    CLEANUP_RETRY_BASE_MS * 2 ** Math.max(0, attempt - 1),
    CLEANUP_RETRY_MAX_MS,
  );
}

function cleanupDuration(
  value: number | undefined,
  fallback: number,
  label: string,
): number {
  const normalized = value ?? fallback;
  if (!Number.isSafeInteger(normalized) || normalized < 1) {
    throw new TypeError(`Storage cleanup ${label} is invalid.`);
  }
  return normalized;
}
