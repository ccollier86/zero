/**
 * storage-studio-job-store.ts
 *
 * Persists and leases Storage Studio provider jobs in the system database.
 * This store owns queue mechanics only; lifecycle policy, provider I/O,
 * authorization, audit, and worker scheduling belong to the coordinator.
 */

import type { ReactiveDB } from '../sync/reactive-db';
import { StorageDomainError, type StorageErrorCode } from './storage-domain-error';
import {
  STORAGE_JOBS_TABLE,
  STORAGE_STUDIO_OPERATIONS_TABLE,
  type StorageJobStatus,
} from './storage-studio-schema';

export type StorageStudioJobKind =
  | 'provision'
  | 'delete'
  | 'restore'
  | 'transfer'
  | 'reconcile'
  | 'cleanup';

/** Canonical private job row. It is never returned directly to a browser. */
export interface StorageStudioJobRecord {
  readonly job_id: string;
  readonly operation_id: string | null;
  readonly drive_id: string;
  readonly job_kind: StorageStudioJobKind;
  readonly status: StorageJobStatus;
  readonly generation: number;
  readonly attempt_count: number;
  readonly max_attempts: number;
  readonly available_at: number;
  readonly lease_owner: string | null;
  readonly lease_expires_at: number | null;
  readonly failure_code: string | null;
  readonly created_at: number;
  readonly updated_at: number;
  readonly completed_at: number | null;
}

export interface StorageStudioJobInsert {
  readonly operationId: string;
  readonly driveId: string;
  readonly kind: StorageStudioJobKind;
  readonly generation: number;
  readonly availableAt: number;
  readonly maxAttempts?: number;
}

export interface StorageStudioJobRecoveryResult {
  readonly requeued: number;
  readonly failed: readonly StorageStudioJobRecord[];
  /** True when another ordered recovery pass can make immediate progress. */
  readonly hasMore: boolean;
}

const MAX_JOB_ATTEMPTS = 20;
const MAX_LEASE_MS = 30 * 60_000;
const MAX_RECOVERY_BATCH = 32;

/** Durable lease queue over `_storage_jobs`. */
export class StorageStudioJobStore {
  private readonly leaseOwner: string;
  private queueChangeListener: (() => void) | null = null;

  constructor(
    private readonly db: ReactiveDB,
    leaseOwner = `storage-worker:${crypto.randomUUID()}`,
  ) {
    const normalized = leaseOwner.trim();
    if (!normalized || normalized.length > 200) {
      throw new TypeError('Storage job lease owner is invalid.');
    }
    this.leaseOwner = normalized;
  }

  /** Notify the managed worker after queue state changes commit. */
  setQueueChangeListener(listener: (() => void) | null): void {
    this.queueChangeListener = listener;
  }

  /** Enqueue one operation-bound job and return its persisted row. */
  enqueue(input: StorageStudioJobInsert): StorageStudioJobRecord {
    const now = normalizeTime(input.availableAt, 'available time');
    const generation = normalizePositiveInteger(input.generation, 'generation');
    const maxAttempts = normalizeAttempts(input.maxAttempts ?? 5);
    const jobId = `stjob_${crypto.randomUUID()}`;
    this.db.prepare(`
      INSERT INTO ${STORAGE_JOBS_TABLE} (
        job_id, operation_id, drive_id, job_kind, status, generation,
        attempt_count, max_attempts, available_at, lease_owner,
        lease_expires_at, failure_code, created_at, updated_at, completed_at
      ) VALUES (?, ?, ?, ?, 'queued', ?, 0, ?, ?, NULL, NULL, NULL, ?, ?, NULL)
    `).run(
      jobId,
      input.operationId,
      input.driveId,
      input.kind,
      generation,
      maxAttempts,
      now,
      now,
      now,
    );
    const job = this.require(jobId);
    this.notifyQueueChanged();
    return job;
  }

  get(jobId: string): StorageStudioJobRecord | null {
    return this.db.prepare(
      `SELECT * FROM ${STORAGE_JOBS_TABLE} WHERE job_id = ?`,
    ).get(jobId) as StorageStudioJobRecord | null;
  }

  getByOperation(
    operationId: string,
    kind: StorageStudioJobKind,
  ): StorageStudioJobRecord | null {
    return this.db.prepare(`
      SELECT * FROM ${STORAGE_JOBS_TABLE}
      WHERE operation_id = ? AND job_kind = ?
      ORDER BY generation DESC, created_at DESC, job_id DESC
      LIMIT 1
    `).get(operationId, kind) as StorageStudioJobRecord | null;
  }

  getLatestForDrive(
    driveId: string,
    kind: StorageStudioJobKind,
  ): StorageStudioJobRecord | null {
    return this.db.prepare(`
      SELECT * FROM ${STORAGE_JOBS_TABLE}
      WHERE drive_id = ? AND job_kind = ?
      ORDER BY created_at DESC, job_id DESC
      LIMIT 1
    `).get(driveId, kind) as StorageStudioJobRecord | null;
  }

  /** Bounded repair scan for terminal jobs whose operation was not finalized. */
  getFailedWithPendingOperation(
    kind: StorageStudioJobKind,
    limit = 1,
  ): readonly StorageStudioJobRecord[] {
    const batchSize = normalizeRecoveryLimit(limit);
    return this.db.prepare(`
      SELECT jobs.* FROM ${STORAGE_JOBS_TABLE} AS jobs
      INNER JOIN ${STORAGE_STUDIO_OPERATIONS_TABLE} AS operations
        ON operations.operation_id = jobs.operation_id
      WHERE jobs.job_kind = ? AND jobs.status = 'failed'
        AND operations.status = 'pending'
      ORDER BY jobs.completed_at ASC, jobs.updated_at ASC, jobs.job_id ASC
      LIMIT ?
    `).all(kind, batchSize) as StorageStudioJobRecord[];
  }

  /** Claim a specific due job for immediate request-path execution. */
  claim(jobId: string, now: number, leaseMs: number): StorageStudioJobRecord | null {
    const at = normalizeTime(now, 'claim time');
    const leaseUntil = at + normalizeLease(leaseMs);
    return this.db.transaction(() => {
      const claimed = this.db.prepare(`
        UPDATE ${STORAGE_JOBS_TABLE}
        SET status = 'running', attempt_count = attempt_count + 1,
          lease_owner = ?, lease_expires_at = ?, updated_at = ?
        WHERE job_id = ?
          AND attempt_count < max_attempts
          AND ((status = 'queued' AND available_at <= ?)
            OR (status = 'running' AND lease_expires_at <= ?))
      `).run(this.leaseOwner, leaseUntil, at, jobId, at, at);
      return claimed.changes === 1 ? this.require(jobId) : null;
    });
  }

  /** Claim the oldest due job of one kind for background recovery. */
  claimNext(
    kind: StorageStudioJobKind,
    now: number,
    leaseMs: number,
  ): StorageStudioJobRecord | null {
    const at = normalizeTime(now, 'claim time');
    const candidate = this.db.prepare(`
      SELECT job_id FROM ${STORAGE_JOBS_TABLE}
      WHERE job_kind = ? AND attempt_count < max_attempts
        AND ((status = 'queued' AND available_at <= ?)
          OR (status = 'running' AND lease_expires_at <= ?))
      ORDER BY available_at ASC, created_at ASC, job_id ASC
      LIMIT 1
    `).get(kind, at, at) as { job_id: string } | null;
    return candidate ? this.claim(candidate.job_id, at, leaseMs) : null;
  }

  /** Earliest queued availability or running-lease recovery deadline. */
  nextActionAt(kind: StorageStudioJobKind): number | null {
    const row = this.db.prepare(`
      SELECT MIN(
        CASE WHEN status = 'queued' THEN available_at ELSE lease_expires_at END
      ) AS next_at
      FROM ${STORAGE_JOBS_TABLE}
      WHERE job_kind = ?
        AND ((status = 'queued' AND attempt_count < max_attempts)
          OR (status = 'running' AND lease_expires_at IS NOT NULL))
    `).get(kind) as { next_at: number | null };
    return row.next_at;
  }

  /** Complete only the caller's live lease. */
  complete(job: StorageStudioJobRecord, now: number): boolean {
    const at = normalizeTime(now, 'completion time');
    return this.db.prepare(`
      UPDATE ${STORAGE_JOBS_TABLE}
      SET status = 'succeeded', lease_owner = NULL, lease_expires_at = NULL,
        failure_code = NULL, completed_at = ?, updated_at = ?
      WHERE job_id = ? AND status = 'running' AND lease_owner = ?
        AND attempt_count = ? AND generation = ? AND lease_expires_at > ?
    `).run(
      at,
      at,
      job.job_id,
      this.leaseOwner,
      job.attempt_count,
      job.generation,
      at,
    ).changes === 1;
  }

  /** Extend only the caller's still-live lease. */
  renew(job: StorageStudioJobRecord, now: number, leaseMs: number): boolean {
    const at = normalizeTime(now, 'renewal time');
    const leaseUntil = at + normalizeLease(leaseMs);
    return this.db.prepare(`
      UPDATE ${STORAGE_JOBS_TABLE}
      SET lease_expires_at = ?, updated_at = ?
      WHERE job_id = ? AND status = 'running' AND lease_owner = ?
        AND attempt_count = ? AND generation = ? AND lease_expires_at > ?
    `).run(
      leaseUntil,
      at,
      job.job_id,
      this.leaseOwner,
      job.attempt_count,
      job.generation,
      at,
    ).changes === 1;
  }

  /** Assert exact live ownership from inside another system-DB transaction. */
  assertCurrent(job: StorageStudioJobRecord, now: number): void {
    const at = normalizeTime(now, 'lease assertion time');
    const row = this.db.prepare(`
      SELECT 1 AS current FROM ${STORAGE_JOBS_TABLE}
      WHERE job_id = ? AND status = 'running' AND lease_owner = ?
        AND attempt_count = ? AND generation = ? AND lease_expires_at > ?
    `).get(
      job.job_id,
      this.leaseOwner,
      job.attempt_count,
      job.generation,
      at,
    ) as { current: 1 } | null;
    if (!row) throw staleLease();
  }

  /** Release a successful partial batch without consuming retry budget. */
  continue(job: StorageStudioJobRecord, now: number): boolean {
    const at = normalizeTime(now, 'continuation time');
    const changed = this.db.prepare(`
      UPDATE ${STORAGE_JOBS_TABLE}
      SET status = 'queued', attempt_count = attempt_count - 1,
        available_at = ?, lease_owner = NULL, lease_expires_at = NULL,
        failure_code = NULL, updated_at = ?
      WHERE job_id = ? AND status = 'running' AND lease_owner = ?
        AND attempt_count = ? AND generation = ? AND attempt_count > 0
        AND lease_expires_at > ?
    `).run(
      at,
      at,
      job.job_id,
      this.leaseOwner,
      job.attempt_count,
      job.generation,
      at,
    ).changes === 1;
    if (changed) this.notifyQueueChanged();
    return changed;
  }

  /** Retry or terminally fail only the caller's live lease. */
  fail(
    job: StorageStudioJobRecord,
    errorCode: StorageErrorCode,
    retryAt: number | null,
    now: number,
  ): StorageStudioJobRecord {
    const at = normalizeTime(now, 'failure time');
    const shouldRetry = retryAt !== null && job.attempt_count < job.max_attempts;
    const result = shouldRetry
      ? this.db.prepare(`
          UPDATE ${STORAGE_JOBS_TABLE}
          SET status = 'queued', available_at = ?, lease_owner = NULL,
            lease_expires_at = NULL, failure_code = ?, updated_at = ?
          WHERE job_id = ? AND status = 'running' AND lease_owner = ?
            AND attempt_count = ? AND generation = ? AND lease_expires_at > ?
        `).run(
          normalizeTime(retryAt!, 'retry time'),
          errorCode,
          at,
          job.job_id,
          this.leaseOwner,
          job.attempt_count,
          job.generation,
          at,
        )
      : this.db.prepare(`
          UPDATE ${STORAGE_JOBS_TABLE}
          SET status = 'failed', lease_owner = NULL, lease_expires_at = NULL,
            failure_code = ?, completed_at = ?, updated_at = ?
          WHERE job_id = ? AND status = 'running' AND lease_owner = ?
            AND attempt_count = ? AND generation = ? AND lease_expires_at > ?
        `).run(
          errorCode,
          at,
          at,
          job.job_id,
          this.leaseOwner,
          job.attempt_count,
          job.generation,
          at,
        );
    if (result.changes !== 1) throw staleLease();
    const failed = this.require(job.job_id);
    if (failed.status === 'queued') this.notifyQueueChanged();
    return failed;
  }

  /** Explicitly retry a terminal job under a fresh idempotent operation. */
  requeueFailed(
    jobId: string,
    operationId: string,
    expectedGeneration: number,
    now: number,
  ): StorageStudioJobRecord {
    const at = normalizeTime(now, 'retry time');
    const changed = this.db.prepare(`
      UPDATE ${STORAGE_JOBS_TABLE}
      SET operation_id = ?, status = 'queued', attempt_count = 0,
        available_at = ?, lease_owner = NULL, lease_expires_at = NULL,
        failure_code = NULL, completed_at = NULL, updated_at = ?
      WHERE job_id = ? AND status = 'failed' AND generation = ?
    `).run(operationId, at, at, jobId, expectedGeneration).changes;
    if (changed !== 1) {
      throw new StorageDomainError(
        'STORAGE_CONFLICT',
        'Storage cleanup job is no longer retryable.',
      );
    }
    const job = this.require(jobId);
    this.notifyQueueChanged();
    return job;
  }

  /** Recover expired leases without giving jobs more than their configured attempts. */
  recoverExpired(
    kind: StorageStudioJobKind,
    now: number,
    limit = MAX_RECOVERY_BATCH,
  ): StorageStudioJobRecoveryResult {
    const at = normalizeTime(now, 'recovery time');
    const batchSize = normalizeRecoveryLimit(limit);
    return this.db.transaction(() => {
      const expired = this.db.prepare(`
        SELECT * FROM ${STORAGE_JOBS_TABLE}
        WHERE job_kind = ? AND status = 'running' AND lease_expires_at <= ?
        ORDER BY lease_expires_at ASC, available_at ASC, created_at ASC, job_id ASC
        LIMIT ?
      `).all(kind, at, batchSize) as StorageStudioJobRecord[];
      const fail = this.db.prepare(`
        UPDATE ${STORAGE_JOBS_TABLE}
        SET status = 'failed', lease_owner = NULL, lease_expires_at = NULL,
          failure_code = 'STORAGE_PROVIDER_UNAVAILABLE', completed_at = ?, updated_at = ?
        WHERE job_id = ? AND status = 'running' AND lease_expires_at <= ?
          AND attempt_count >= max_attempts
      `);
      const requeue = this.db.prepare(`
        UPDATE ${STORAGE_JOBS_TABLE}
        SET status = 'queued', available_at = ?, lease_owner = NULL,
          lease_expires_at = NULL, failure_code = 'STORAGE_PROVIDER_UNAVAILABLE',
          updated_at = ?
        WHERE job_id = ? AND status = 'running' AND lease_expires_at <= ?
          AND attempt_count < max_attempts
      `);
      let requeued = 0;
      const failed: StorageStudioJobRecord[] = [];
      for (const job of expired) {
        if (job.attempt_count >= job.max_attempts) {
          if (fail.run(at, at, job.job_id, at).changes !== 1) continue;
          failed.push({
            ...job,
            status: 'failed',
            lease_owner: null,
            lease_expires_at: null,
            failure_code: 'STORAGE_PROVIDER_UNAVAILABLE',
            completed_at: at,
            updated_at: at,
          });
        } else {
          requeued += requeue.run(at, at, job.job_id, at).changes;
        }
      }
      const hasMore = this.db.prepare(`
        SELECT 1 AS present FROM ${STORAGE_JOBS_TABLE}
        WHERE job_kind = ? AND status = 'running' AND lease_expires_at <= ?
        LIMIT 1
      `).get(kind, at) !== null;
      const result = Object.freeze({
        requeued,
        failed: Object.freeze(failed.map((job) => Object.freeze(job))),
        hasMore,
      });
      if (requeued > 0 || failed.length > 0) this.notifyQueueChanged();
      return result;
    });
  }

  /**
   * Terminally fence expired provider executions. Once an external hook was
   * admitted, a crashed/lost worker cannot prove whether its side effect
   * completed, so automatic re-execution would be unsafe.
   */
  recoverExpiredAmbiguous(
    kind: Extract<StorageStudioJobKind, 'restore' | 'reconcile'>,
    now: number,
    limit = MAX_RECOVERY_BATCH,
  ): StorageStudioJobRecoveryResult {
    const at = normalizeTime(now, 'recovery time');
    const batchSize = normalizeRecoveryLimit(limit);
    return this.db.transaction(() => {
      const expired = this.db.prepare(`
        SELECT * FROM ${STORAGE_JOBS_TABLE}
        WHERE job_kind = ? AND status = 'running' AND lease_expires_at <= ?
        ORDER BY lease_expires_at, available_at, created_at, job_id
        LIMIT ?
      `).all(kind, at, batchSize) as StorageStudioJobRecord[];
      const failed: StorageStudioJobRecord[] = [];
      for (const job of expired) {
        const changed = this.db.prepare(`
          UPDATE ${STORAGE_JOBS_TABLE}
          SET status = 'failed', lease_owner = NULL, lease_expires_at = NULL,
            failure_code = 'STORAGE_OPERATION_OUTCOME_UNKNOWN',
            completed_at = ?, updated_at = ?
          WHERE job_id = ? AND status = 'running' AND lease_expires_at <= ?
        `).run(at, at, job.job_id, at).changes;
        if (changed !== 1) continue;
        failed.push(Object.freeze({
          ...job,
          status: 'failed',
          lease_owner: null,
          lease_expires_at: null,
          failure_code: 'STORAGE_OPERATION_OUTCOME_UNKNOWN',
          completed_at: at,
          updated_at: at,
        }));
      }
      const hasMore = this.db.prepare(`
        SELECT 1 AS present FROM ${STORAGE_JOBS_TABLE}
        WHERE job_kind = ? AND status = 'running' AND lease_expires_at <= ?
        LIMIT 1
      `).get(kind, at) !== null;
      if (failed.length > 0) this.notifyQueueChanged();
      return Object.freeze({
        requeued: 0,
        failed: Object.freeze(failed),
        hasMore,
      });
    });
  }

  /**
   * Prune bounded terminal job history only after its operation receipt has
   * already expired and detached through the schema's SET NULL relationship.
   * Queued/running jobs and terminal jobs still referenced by a receipt are
   * never maintenance candidates.
   */
  pruneDetachedTerminal(before: number, limit = 100): number {
    const cutoff = normalizeTime(before, 'terminal retention cutoff');
    const batchSize = normalizePruneLimit(limit);
    return this.db.prepare(`
      DELETE FROM ${STORAGE_JOBS_TABLE}
      WHERE job_id IN (
        SELECT job_id FROM ${STORAGE_JOBS_TABLE}
        WHERE operation_id IS NULL
          AND status IN ('succeeded', 'failed', 'cancelled')
          AND completed_at IS NOT NULL AND completed_at <= ?
        ORDER BY completed_at ASC, job_id ASC
        LIMIT ?
      )
    `).run(cutoff, batchSize).changes;
  }

  private notifyQueueChanged(): void {
    const listener = this.queueChangeListener;
    if (listener) queueMicrotask(listener);
  }

  private require(jobId: string): StorageStudioJobRecord {
    const row = this.get(jobId);
    if (!row) throw new StorageDomainError('STORAGE_INTERNAL', 'Storage job was not found.');
    return row;
  }
}

function normalizeTime(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`Storage job ${label} is invalid.`);
  }
  return value;
}

function normalizePositiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TypeError(`Storage job ${label} is invalid.`);
  }
  return value;
}

function normalizeAttempts(value: number): number {
  const attempts = normalizePositiveInteger(value, 'attempt limit');
  if (attempts > MAX_JOB_ATTEMPTS) throw new TypeError('Storage job attempt limit is too large.');
  return attempts;
}

function normalizeLease(value: number): number {
  const lease = normalizePositiveInteger(value, 'lease duration');
  if (lease > MAX_LEASE_MS) throw new TypeError('Storage job lease duration is too large.');
  return lease;
}

function normalizeRecoveryLimit(value: number): number {
  const limit = normalizePositiveInteger(value, 'recovery batch');
  if (limit > MAX_RECOVERY_BATCH) {
    throw new TypeError(`Storage job recovery batch cannot exceed ${MAX_RECOVERY_BATCH}.`);
  }
  return limit;
}

function normalizePruneLimit(value: number): number {
  const limit = normalizePositiveInteger(value, 'prune batch');
  if (limit > 1_000) throw new TypeError('Storage job prune batch cannot exceed 1000.');
  return limit;
}

function staleLease(): StorageDomainError {
  return new StorageDomainError(
    'STORAGE_CONFLICT',
    'Storage job lease is no longer current.',
  );
}
