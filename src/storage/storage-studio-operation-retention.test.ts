import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createReactiveDB, type ReactiveDB } from '../sync/reactive-db';
import { defineStorageTables } from './storage-service';
import { StorageStudioJobStore } from './storage-studio-job-store';
import { StorageStudioOperationStore } from './storage-studio-operation-store';
import { defineStorageStudioTables } from './storage-studio-schema';

let db: ReactiveDB;

beforeEach(() => {
  db = createReactiveDB({ mode: 'memory' });
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE users (user_id TEXT PRIMARY KEY);
    CREATE TABLE _auth_tenant_memberships (membership_id TEXT PRIMARY KEY);
    INSERT INTO users (user_id) VALUES ('user_one');
  `);
  defineStorageTables(db);
  defineStorageStudioTables(db);
  db.exec(`
    INSERT INTO storage_drives (
      drive_id, tenant_id, name, owner_id, max_size_bytes,
      max_file_size_bytes, allowed_mime_types, public, created_at
    ) VALUES ('drv_retention', NULL, 'Retention', 'user_one', 0, 0, '*', 0, 1)
  `);
});

afterEach(() => db.dispose());

describe('Storage Studio operation retention', () => {
  test('prunes only expired terminal receipts without active job references', () => {
    const operations = new StorageStudioOperationStore(db);
    const jobs = new StorageStudioJobStore(db, 'retention-worker');
    insert(operations, 'expired-success', 'suspend');
    operations.complete('expired-success', 'drv_retention', 1, 100);
    insert(operations, 'expired-failed', 'resume');
    operations.fail('expired-failed', 'failed', 'STORAGE_CONFLICT', 100);
    insert(operations, 'expired-pending', 'update');
    insert(operations, 'expired-unknown', 'restore');
    operations.fail(
      'expired-unknown',
      'outcome_unknown',
      'STORAGE_OPERATION_OUTCOME_UNKNOWN',
      100,
    );
    insert(operations, 'active-job', 'delete');
    operations.complete('active-job', 'drv_retention', 1, 100);
    jobs.enqueue({
      operationId: 'active-job',
      driveId: 'drv_retention',
      kind: 'cleanup',
      generation: 1,
      availableAt: 100,
    });
    insert(operations, 'not-expired', 'reconcile', 2_000);
    operations.complete('not-expired', 'drv_retention', 1, 100);

    expect(operations.pruneExpiredTerminal(1_000, 100)).toBe(2);
    expect(operations.getById('expired-success')).toBeNull();
    expect(operations.getById('expired-failed')).toBeNull();
    expect(operations.getById('expired-pending')?.status).toBe('pending');
    expect(operations.getById('expired-unknown')?.status).toBe('outcome_unknown');
    expect(operations.getById('active-job')?.status).toBe('succeeded');
    expect(operations.getById('not-expired')?.status).toBe('succeeded');
  });
});

function insert(
  operations: StorageStudioOperationStore,
  operationId: string,
  kind: 'suspend' | 'resume' | 'update' | 'restore' | 'delete' | 'reconcile',
  expiresAt = 500,
): void {
  operations.insert({
    operationId,
    idempotencyKey: operationId,
    kind,
    scopeKind: 'application',
    scopeId: 'application',
    actorUserId: 'user_one',
    actorMembershipId: null,
    requestHash: 'a'.repeat(64),
    driveId: 'drv_retention',
    createdAt: 1,
    expiresAt,
  });
}
