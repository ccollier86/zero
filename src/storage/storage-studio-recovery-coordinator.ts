/** Durable leased execution for restore and provisioning-reconciliation work. */

import type { ReactiveDB } from '../sync/reactive-db';
import {
  StorageDomainError,
  isStorageDomainError,
  normalizeStorageError,
} from './storage-domain-error';
import type { StorageStudioAudit } from './storage-studio-audit';
import type { StorageStudioAuthority } from './storage-studio-authority';
import type { StorageStudioCatalog } from './storage-studio-catalog';
import {
  StorageStudioJobStore,
  type StorageStudioJobKind,
  type StorageStudioJobRecord,
} from './storage-studio-job-store';
import type { StorageStudioLifecycleStore } from './storage-studio-lifecycle-store';
import {
  storageLifecycleMetadata,
  storageOperationInProgress,
  storageRevisionConflict,
  storageUnknownOutcome,
  transitionStorageProfile,
} from './storage-studio-lifecycle-policy';
import type {
  StorageStudioDriveLifecycle,
  StorageStudioDriveProfile,
} from './storage-studio-schema';
import type { StorageStudioOperationRecord } from './storage-studio-store';
import { storageStudioContinuationAuthority } from './storage-studio-continuation-authority';
import { StorageStudioProviderExecution } from './storage-studio-provider-execution';

const PROVIDER_JOB_KINDS = Object.freeze(['restore', 'reconcile'] as const);
const PROVIDER_LEASE_MS = 30_000;
const PROVIDER_RENEW_MS = 10_000;
const PROVIDER_RETRY_BASE_MS = 1_000;
const PROVIDER_RETRY_MAX_MS = 5 * 60_000;
const DEFAULT_PROVIDER_TIMEOUT_MS = 2 * 60_000;
const MAX_PROVIDER_TIMEOUT_MS = 30 * 60_000;

/** Provider hooks must be idempotent because an expired lease may be resumed. */
export interface StorageStudioLifecycleProvider {
  retryProvisioning(input: {
    readonly profile: StorageStudioDriveProfile;
    readonly authority: StorageStudioAuthority;
    readonly signal: AbortSignal;
  }): void | Promise<void>;
  restoreDrive(input: {
    readonly profile: StorageStudioDriveProfile;
    readonly authority: StorageStudioAuthority;
    readonly signal: AbortSignal;
  }): void | Promise<void>;
}

export type StorageStudioRecoveryRunResult =
  | 'idle'
  | 'succeeded'
  | 'retrying'
  | 'failed';

export interface StorageStudioRecoveryCoordinatorOptions {
  readonly db: Pick<ReactiveDB, 'transaction'>;
  readonly provider: StorageStudioLifecycleProvider;
  readonly store: StorageStudioLifecycleStore;
  readonly jobs: StorageStudioJobStore;
  readonly catalog: Pick<StorageStudioCatalog, 'requireProfile'>;
  readonly audit: StorageStudioAudit;
  readonly now?: () => number;
  readonly providerTimeoutMs?: number;
}

/** Runs durable, cross-runtime leased provider continuations. */
export class StorageStudioRecoveryCoordinator {
  private readonly now: () => number;
  private readonly providerTimeoutMs: number;
  private readonly providerExecution: StorageStudioProviderExecution;
  private stopping = false;

  constructor(private readonly options: StorageStudioRecoveryCoordinatorOptions) {
    this.now = options.now ?? Date.now;
    this.providerTimeoutMs = normalizeProviderTimeout(options.providerTimeoutMs);
    this.providerExecution = new StorageStudioProviderExecution({
      renew: (job) => this.options.jobs.renew(job, this.now(), PROVIDER_LEASE_MS),
      renewEveryMs: PROVIDER_RENEW_MS,
      timeoutMs: this.providerTimeoutMs,
    });
  }

  finishRestore(
    _authority: StorageStudioAuthority,
    operation: StorageStudioOperationRecord,
  ): Promise<Exclude<StorageStudioRecoveryRunResult, 'idle'>> {
    return this.claimOperation(operation, 'restore');
  }

  finishProvisioningRetry(
    _authority: StorageStudioAuthority,
    operation: StorageStudioOperationRecord,
  ): Promise<Exclude<StorageStudioRecoveryRunResult, 'idle'>> {
    return this.claimOperation(operation, 'reconcile');
  }

  /** Stop admitting provider work and hand active leases back to recovery. */
  stop(): void {
    this.stopping = true;
    this.providerExecution.stop();
  }

  /** Recover expired provider leases and run at most one due continuation. */
  async runNext(): Promise<StorageStudioRecoveryRunResult> {
    if (this.stopping) return 'idle';
    let recoveryProgress = false;
    for (const kind of PROVIDER_JOB_KINDS) {
      // Lease recovery and terminal operation repair are one transaction. A
      // crash can therefore never leave a failed job paired with a pending
      // operation/profile. The second query also repairs split state written
      // by an older process that crashed before this invariant existed.
      const recovery = this.options.db.transaction(() => {
        const result = this.options.jobs.recoverExpiredAmbiguous(kind, this.now(), 1);
        const repairCandidates = this.options.jobs.getFailedWithPendingOperation(kind, 2);
        const terminal = new Map(
          [...result.failed, ...repairCandidates]
            .map((job) => [job.job_id, job]),
        );
        const repair = terminal.values().next().value as StorageStudioJobRecord | undefined;
        if (repair) this.finalizeAmbiguousLeaseExpiry(repair);
        return {
          result,
          repaired: repair !== undefined,
          repairHasMore: terminal.size > 1 || repairCandidates.length > 1,
        };
      });
      recoveryProgress ||= recovery.result.requeued > 0 || recovery.result.hasMore;
      recoveryProgress ||= recovery.repaired || recovery.repairHasMore;
    }

    const now = this.now();
    const dueKinds = PROVIDER_JOB_KINDS
      .map((kind) => ({ kind, at: this.options.jobs.nextActionAt(kind) }))
      .filter((entry): entry is { kind: typeof PROVIDER_JOB_KINDS[number]; at: number } => (
        entry.at !== null && entry.at <= now
      ))
      .sort((left, right) => left.at - right.at);
    for (const { kind } of dueKinds) {
      const job = this.options.jobs.claimNext(kind, now, PROVIDER_LEASE_MS);
      if (!job) continue;
      const operation = this.requireOperation(job);
      try {
        return await this.runClaimed(
          job,
          storageStudioContinuationAuthority(operation),
          operation,
        );
      } catch {
        return 'failed';
      }
    }
    return recoveryProgress ? 'retrying' : 'idle';
  }

  nextActionAt(): number | null {
    const actions = PROVIDER_JOB_KINDS
      .map((kind) => this.options.jobs.nextActionAt(kind))
      .filter((value): value is number => value !== null);
    return actions.length > 0 ? Math.min(...actions) : null;
  }

  private async claimOperation(
    operation: StorageStudioOperationRecord,
    kind: Extract<StorageStudioJobKind, 'restore' | 'reconcile'>,
  ): Promise<Exclude<StorageStudioRecoveryRunResult, 'idle'>> {
    if (this.stopping) return 'retrying';
    if (operation.status === 'succeeded') return 'succeeded';
    const job = this.options.jobs.getByOperation(operation.operation_id, kind);
    if (!job) throw storageOperationInProgress();
    if (job.status === 'succeeded') return 'succeeded';
    if (job.status === 'failed') throw completedProviderJobError(operation);
    const claimed = this.options.jobs.claim(job.job_id, this.now(), PROVIDER_LEASE_MS);
    if (!claimed) return 'retrying';
    return this.runClaimed(
      claimed,
      storageStudioContinuationAuthority(operation),
      operation,
    );
  }

  private async runClaimed(
    job: StorageStudioJobRecord,
    authority: StorageStudioAuthority,
    operation: StorageStudioOperationRecord,
  ): Promise<Exclude<StorageStudioRecoveryRunResult, 'idle'>> {
    if (this.stopping) return 'retrying';
    const shape = providerJobShape(job.job_kind);
    let profile: StorageStudioDriveProfile;
    try {
      profile = this.admitProviderWork(authority, operation, shape.expected);
    } catch (cause) {
      return this.recordFailure(job, authority, operation, shape, cause, false);
    }

    try {
      const outcome = await this.providerExecution.run(job, (signal) => (
        shape.kind === 'restore'
          ? this.options.provider.restoreDrive({ profile, authority, signal })
          : this.options.provider.retryProvisioning({ profile, authority, signal })
      ));
      if (outcome === 'stopping') {
        // The provider acknowledged cancellation, so the live lease can be
        // handed back without overlapping an external side effect.
        this.options.jobs.continue(job, this.now());
        return 'retrying';
      }
      if (outcome === 'lease-lost' || outcome === 'timed-out') {
        // Never requeue a provider call whose cancellation was not proven.
        // Expiry recovery terminally marks it outcome-unknown.
        return 'retrying';
      }
    } catch (cause) {
      return this.recordFailure(job, authority, operation, shape, cause, true);
    }
    if (this.stopping || !this.options.jobs.renew(job, this.now(), PROVIDER_LEASE_MS)) {
      return 'retrying';
    }
    this.finishReady(job, authority, operation, shape);
    return 'succeeded';
  }

  private admitProviderWork(
    authority: StorageStudioAuthority,
    operation: StorageStudioOperationRecord,
    expected: StorageStudioDriveLifecycle,
  ): StorageStudioDriveProfile {
    return this.options.db.transaction(() => {
      const currentOperation = this.options.store.getOperationById(operation.operation_id);
      if (!currentOperation || currentOperation.status !== 'pending') {
        throw currentOperation?.status === 'outcome_unknown'
          ? storageUnknownOutcome()
          : storageOperationInProgress();
      }
      return this.requireProfile(authority, operation, expected);
    });
  }

  private finishReady(
    job: StorageStudioJobRecord,
    authority: StorageStudioAuthority,
    operation: StorageStudioOperationRecord,
    shape: ProviderJobShape,
  ): void {
    try {
      this.options.db.transaction(() => {
        if (!this.options.jobs.renew(job, this.now(), PROVIDER_LEASE_MS)) {
          throw storageOperationInProgress();
        }
        const currentOperation = this.options.store.getOperationById(operation.operation_id);
        if (currentOperation?.status === 'succeeded') {
          if (!this.options.jobs.complete(job, this.now())) throw storageOperationInProgress();
          return;
        }
        if (!currentOperation || currentOperation.status !== 'pending') {
          throw storageOperationInProgress();
        }
        const current = this.requireProfile(authority, operation, shape.expected);
        const now = this.now();
        const ready = transitionStorageProfile(current, authority, 'ready', now);
        this.replace(current, ready);
        this.options.store.completeOperation(
          operation.operation_id,
          current.drive_id,
          ready.revision,
          now,
        );
        if (!this.options.jobs.complete(job, now)) throw storageOperationInProgress();
        this.options.audit.appendContinuation(
          authority,
          shape.successAudit,
          'succeeded',
          current.drive_id,
          storageLifecycleMetadata(ready),
        );
      });
    } catch {
      throw storageUnknownOutcome();
    }
  }

  private recordFailure(
    job: StorageStudioJobRecord,
    authority: StorageStudioAuthority,
    operation: StorageStudioOperationRecord,
    shape: ProviderJobShape,
    cause: unknown,
    providerStarted: boolean,
  ): 'retrying' | 'failed' {
    const canonical = providerFailure(cause);
    const ambiguous = providerStarted && (
      !isStorageDomainError(cause)
      || canonical.outcome === 'committed'
      || canonical.outcome === 'unknown'
    );
    const retryAt = !ambiguous
      && canonical.retryable && job.attempt_count < job.max_attempts
      ? this.now() + providerRetryDelay(job.attempt_count)
      : null;
    if (retryAt !== null) {
      this.options.jobs.fail(job, canonical.code, retryAt, this.now());
      return 'retrying';
    }
    this.options.db.transaction(() => {
      const now = this.now();
      const failedJob = this.options.jobs.fail(job, canonical.code, null, now);
      if (failedJob.status !== 'failed') throw storageOperationInProgress();
      this.finalizeFailure(
        failedJob,
        authority,
        operation,
        shape,
        canonical.code,
        ambiguous || canonical.outcome === 'unknown',
        now,
      );
    });
    if (ambiguous || canonical.outcome === 'unknown') throw storageUnknownOutcome();
    throw canonical;
  }

  private finalizeAmbiguousLeaseExpiry(job: StorageStudioJobRecord): void {
    const operation = this.requireOperation(job);
    const authority = storageStudioContinuationAuthority(operation);
    this.finalizeFailure(
      job,
      authority,
      operation,
      providerJobShape(job.job_kind),
      'STORAGE_PROVIDER_UNAVAILABLE',
      true,
      this.now(),
    );
  }

  private finalizeFailure(
    job: StorageStudioJobRecord,
    authority: StorageStudioAuthority,
    operation: StorageStudioOperationRecord,
    shape: ProviderJobShape,
    errorCode: string,
    ambiguous: boolean,
    now: number,
  ): void {
    const currentOperation = this.options.store.getOperationById(operation.operation_id);
    if (!currentOperation || currentOperation.status !== 'pending') return;
    const current = this.requireProfile(authority, operation, shape.expected);
    const failed = transitionStorageProfile(
      current,
      authority,
      ambiguous ? 'degraded' : shape.fallback,
      now,
      { failureCode: errorCode },
    );
    this.replace(current, failed);
    this.options.store.failOperation(
      operation.operation_id,
      ambiguous ? 'outcome_unknown' : 'failed',
      errorCode,
      now,
    );
    this.options.audit.appendContinuation(
      authority,
      'storage.drive-lifecycle-failed',
      'failed',
      job.drive_id,
      { error_code: errorCode, lifecycle: shape.expected },
    );
  }

  private requireOperation(job: StorageStudioJobRecord): StorageStudioOperationRecord {
    const operation = job.operation_id
      ? this.options.store.getOperationById(job.operation_id)
      : null;
    if (!operation || operation.drive_id !== job.drive_id) throw storageOperationInProgress();
    return operation;
  }

  private requireProfile(
    authority: StorageStudioAuthority,
    operation: StorageStudioOperationRecord,
    lifecycle: StorageStudioDriveLifecycle,
  ): StorageStudioDriveProfile {
    if (!operation.drive_id) throw storageOperationInProgress();
    const profile = this.options.catalog.requireProfile(authority, operation.drive_id);
    if (profile.lifecycle !== lifecycle) throw storageOperationInProgress();
    return profile;
  }

  private replace(current: StorageStudioDriveProfile, next: StorageStudioDriveProfile): void {
    if (!this.options.store.updateProfileAtRevision(next, current.revision)) {
      throw storageRevisionConflict();
    }
  }
}

interface ProviderJobShape {
  readonly kind: 'restore' | 'reconcile';
  readonly expected: 'restoring' | 'provisioning';
  readonly fallback: 'deleted' | 'failed';
  readonly successAudit: 'storage.drive-restored' | 'storage.drive-recovered';
}

function providerJobShape(kind: StorageStudioJobKind): ProviderJobShape {
  if (kind === 'restore') {
    return {
      kind,
      expected: 'restoring',
      fallback: 'deleted',
      successAudit: 'storage.drive-restored',
    };
  }
  if (kind === 'reconcile') {
    return {
      kind,
      expected: 'provisioning',
      fallback: 'failed',
      successAudit: 'storage.drive-recovered',
    };
  }
  throw new StorageDomainError('STORAGE_INTERNAL', 'Storage provider job kind is invalid.');
}

function providerFailure(cause: unknown): StorageDomainError {
  if (isStorageDomainError(cause)) return normalizeStorageError(cause);
  return new StorageDomainError(
    'STORAGE_PROVIDER_UNAVAILABLE',
    'Storage provider continuation did not complete.',
    { retryable: true, outcome: 'not-committed' },
  );
}

function providerRetryDelay(attempt: number): number {
  return Math.min(
    PROVIDER_RETRY_BASE_MS * 2 ** Math.max(0, attempt - 1),
    PROVIDER_RETRY_MAX_MS,
  );
}

function completedProviderJobError(operation: StorageStudioOperationRecord): StorageDomainError {
  return operation.status === 'outcome_unknown'
    ? storageUnknownOutcome()
    : new StorageDomainError(
        'STORAGE_PROVIDER_UNAVAILABLE',
        'Storage provider continuation requires an explicit retry.',
        { retryable: false, outcome: 'committed' },
      );
}

function normalizeProviderTimeout(value: number | undefined): number {
  const timeout = value ?? DEFAULT_PROVIDER_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > MAX_PROVIDER_TIMEOUT_MS) {
    throw new TypeError('Storage lifecycle provider timeout is invalid.');
  }
  return timeout;
}
