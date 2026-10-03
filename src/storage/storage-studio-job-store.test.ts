import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createReactiveDB, type ReactiveDB } from '../sync/reactive-db';
import { StorageStudioJobStore } from './storage-studio-job-store';
import { defineStorageStudioTables } from './storage-studio-schema';
import { StorageStudioStore } from './storage-studio-store';

let db: ReactiveDB;
let operations: StorageStudioStore;

beforeEach(() => {
  db = createReactiveDB({ mode: 'memory' });
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE users (user_id TEXT PRIMARY KEY);
    CREATE TABLE _auth_tenant_memberships (membership_id TEXT PRIMARY KEY);
    CREATE TABLE storage_drives (drive_id TEXT PRIMARY KEY);
    INSERT INTO users (user_id) VALUES ('user_one');
    INSERT INTO storage_drives (drive_id) VALUES ('drive_one');
  `);
  defineStorageStudioTables(db);
  operations = new StorageStudioStore(db);
});

afterEach(() => db.dispose());

describe('StorageStudioJobStore', () => {
  test('leases, retries, and completes a job without allowing a competing worker', () => {
    const operation = insertOperation('delete', 'delete-one');
    const first = new StorageStudioJobStore(db, 'worker-one');
    const competitor = new StorageStudioJobStore(db, 'worker-two');
    const queued = first.enqueue({
      operationId: operation.operation_id,
      driveId: 'drive_one',
      kind: 'cleanup',
      generation: 2,
      maxAttempts: 2,
      availableAt: 100,
    });

    const attemptOne = first.claim(queued.job_id, 100, 50)!;
    expect(attemptOne).toMatchObject({
      status: 'running',
      attempt_count: 1,
      lease_owner: 'worker-one',
    });
    expect(competitor.claim(queued.job_id, 120, 50)).toBeNull();

    const retry = first.fail(
      attemptOne,
      'STORAGE_PROVIDER_UNAVAILABLE',
      200,
      125,
    );
    expect(retry).toMatchObject({ status: 'queued', attempt_count: 1, available_at: 200 });
    expect(first.claim(queued.job_id, 199, 50)).toBeNull();

    const attemptTwo = competitor.claim(queued.job_id, 200, 50)!;
    expect(attemptTwo).toMatchObject({
      status: 'running',
      attempt_count: 2,
      lease_owner: 'worker-two',
    });
    expect(first.complete(attemptOne, 205)).toBe(false);
    expect(competitor.complete(attemptTwo, 210)).toBe(true);
    expect(first.get(queued.job_id)).toMatchObject({
      status: 'succeeded',
      attempt_count: 2,
      completed_at: 210,
      lease_owner: null,
    });
  });

  test('terminally fails at the budget and permits an explicit operation-bound retry', () => {
    const deleteOperation = insertOperation('delete', 'delete-terminal');
    const jobs = new StorageStudioJobStore(db, 'worker-one');
    const queued = jobs.enqueue({
      operationId: deleteOperation.operation_id,
      driveId: 'drive_one',
      kind: 'cleanup',
      generation: 3,
      maxAttempts: 1,
      availableAt: 100,
    });
    const claimed = jobs.claim(queued.job_id, 100, 50)!;
    const failed = jobs.fail(
      claimed,
      'STORAGE_PROVIDER_UNAVAILABLE',
      200,
      125,
    );
    expect(failed).toMatchObject({
      status: 'failed',
      attempt_count: 1,
      completed_at: 125,
    });

    const retryOperation = insertOperation('reconcile', 'cleanup-retry');
    const retried = jobs.requeueFailed(
      failed.job_id,
      retryOperation.operation_id,
      3,
      300,
    );
    expect(retried).toMatchObject({
      status: 'queued',
      operation_id: retryOperation.operation_id,
      attempt_count: 0,
      failure_code: null,
      completed_at: null,
    });
    expect(jobs.claim(retried.job_id, 300, 50)).toMatchObject({ attempt_count: 1 });
  });

  test('recovers only expired leases for the requested job kind', () => {
    const cleanupOperation = insertOperation('delete', 'cleanup-expiry');
    const restoreOperation = insertOperation('restore', 'restore-expiry');
    const jobs = new StorageStudioJobStore(db, 'worker-one');
    const cleanup = jobs.enqueue({
      operationId: cleanupOperation.operation_id,
      driveId: 'drive_one',
      kind: 'cleanup',
      generation: 4,
      maxAttempts: 1,
      availableAt: 100,
    });
    const restore = jobs.enqueue({
      operationId: restoreOperation.operation_id,
      driveId: 'drive_one',
      kind: 'restore',
      generation: 4,
      maxAttempts: 1,
      availableAt: 100,
    });
    jobs.claim(cleanup.job_id, 100, 10);
    jobs.claim(restore.job_id, 100, 10);

    const recovered = jobs.recoverExpired('cleanup', 111);
    expect(recovered.requeued).toBe(0);
    expect(recovered.failed).toHaveLength(1);
    expect(recovered.hasMore).toBe(false);
    expect(recovered.failed[0]).toMatchObject({
      job_id: cleanup.job_id,
      status: 'failed',
      failure_code: 'STORAGE_PROVIDER_UNAVAILABLE',
    });
    expect(jobs.get(restore.job_id)).toMatchObject({
      status: 'running',
      lease_owner: 'worker-one',
    });
  });

  test('bounds ordered expired-lease recovery and signals immediate backlog progress', async () => {
    const operation = insertOperation('delete', 'bounded-expiry');
    const jobs = new StorageStudioJobStore(db, 'worker-one');
    const claimed = Array.from({ length: 35 }, (_, index) => {
      const availableAt = 100 + index;
      const queued = jobs.enqueue({
        operationId: operation.operation_id,
        driveId: 'drive_one',
        kind: 'cleanup',
        generation: index + 1,
        maxAttempts: index % 2 === 0 ? 1 : 2,
        availableAt,
      });
      return jobs.claim(queued.job_id, availableAt, 10)!;
    });
    let wakes = 0;
    jobs.setQueueChangeListener(() => { wakes += 1; });

    const first = jobs.recoverExpired('cleanup', 1_000);
    expect(first.requeued).toBe(16);
    expect(first.failed).toHaveLength(16);
    expect(first.hasMore).toBe(true);
    expect(first.failed.map((job) => job.job_id)).toEqual(
      claimed.filter((job) => job.max_attempts === 1).slice(0, 16)
        .map((job) => job.job_id),
    );
    expect(countJobs(db, "status = 'running'")).toBe(3);
    expect(countJobs(db, "status IN ('queued', 'failed')")).toBe(32);
    expect((db.prepare(`
      SELECT job_id FROM _storage_jobs
      WHERE status = 'running'
      ORDER BY lease_expires_at, available_at, created_at, job_id
    `).all() as Array<{ job_id: string }>).map((row) => row.job_id)).toEqual(
      claimed.slice(32).map((job) => job.job_id),
    );
    expect(jobs.nextActionAt('cleanup')).toBeLessThanOrEqual(1_000);
    await Promise.resolve();
    expect(wakes).toBe(1);

    const second = jobs.recoverExpired('cleanup', 1_000);
    expect(second.requeued).toBe(1);
    expect(second.failed).toHaveLength(2);
    expect(second.hasMore).toBe(false);
    expect(countJobs(db, "status = 'running'")).toBe(0);
    await Promise.resolve();
    expect(wakes).toBe(2);
  });

  test('rejects unsafe lease and attempt configuration', () => {
    const operation = insertOperation('delete', 'validation');
    const jobs = new StorageStudioJobStore(db, 'worker-one');
    expect(() => jobs.enqueue({
      operationId: operation.operation_id,
      driveId: 'drive_one',
      kind: 'cleanup',
      generation: 1,
      maxAttempts: 0,
      availableAt: 100,
    })).toThrow('attempt limit');

    const queued = jobs.enqueue({
      operationId: operation.operation_id,
      driveId: 'drive_one',
      kind: 'delete',
      generation: 1,
      availableAt: 100,
    });
    expect(() => jobs.claim(queued.job_id, 100, 0)).toThrow('lease duration');
    expect(() => jobs.recoverExpired('cleanup', 100, 33)).toThrow(
      'recovery batch cannot exceed 32',
    );
  });

  test('prunes terminal jobs only after receipt detachment and in bounded batches', () => {
    const jobs = new StorageStudioJobStore(db, 'prune-worker');
    const operation = insertOperation('delete', 'prune-terminal');
    const referenced = jobs.enqueue({
      operationId: operation.operation_id,
      driveId: 'drive_one',
      kind: 'cleanup',
      generation: 1,
      availableAt: 10,
    });
    const claimed = jobs.claim(referenced.job_id, 10, 100)!;
    expect(jobs.complete(claimed, 20)).toBe(true);
    expect(jobs.pruneDetachedTerminal(1_000, 100)).toBe(0);

    db.prepare('UPDATE _storage_jobs SET operation_id = NULL WHERE job_id = ?')
      .run(referenced.job_id);
    for (let index = 0; index < 2; index += 1) {
      db.prepare(`
        INSERT INTO _storage_jobs (
          job_id, operation_id, drive_id, job_kind, status, generation,
          attempt_count, max_attempts, available_at, lease_owner,
          lease_expires_at, failure_code, created_at, updated_at, completed_at
        ) VALUES (?, NULL, 'drive_one', 'cleanup', 'failed', 1,
          1, 1, 1, NULL, NULL, 'STORAGE_PROVIDER_UNAVAILABLE', 1, 20, 20)
      `).run(`detached_${index}`);
    }
    const queuedOperation = insertOperation('delete', 'prune-queued');
    const queued = jobs.enqueue({
      operationId: queuedOperation.operation_id,
      driveId: 'drive_one',
      kind: 'cleanup',
      generation: 1,
      availableAt: 10,
    });
    db.prepare('UPDATE _storage_jobs SET operation_id = NULL WHERE job_id = ?')
      .run(queued.job_id);

    expect(jobs.pruneDetachedTerminal(1_000, 2)).toBe(2);
    expect(countJobs(db, "operation_id IS NULL AND status IN ('succeeded', 'failed')")).toBe(1);
    expect(jobs.get(queued.job_id)?.status).toBe('queued');
    expect(jobs.pruneDetachedTerminal(1_000, 2)).toBe(1);
  });
});

function countJobs(db: ReactiveDB, where: string): number {
  return (db.prepare(`SELECT COUNT(*) AS count FROM _storage_jobs WHERE ${where}`).get() as {
    count: number;
  }).count;
}

function insertOperation(
  kind: 'delete' | 'restore' | 'reconcile',
  idempotencyKey: string,
) {
  return operations.insertOperation({
    operationId: `operation_${crypto.randomUUID()}`,
    idempotencyKey,
    kind,
    scopeKind: 'application',
    scopeId: 'application',
    actorUserId: 'user_one',
    actorMembershipId: null,
    requestHash: 'a'.repeat(64),
    driveId: 'drive_one',
    createdAt: 10,
    expiresAt: 1_000_000,
  });
}
