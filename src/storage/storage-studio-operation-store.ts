/**
 * storage-studio-operation-store.ts
 *
 * Persists idempotency receipts for Storage Studio mutations. Drive profiles
 * and provider lifecycle jobs use separate persistence adapters.
 */

import type { ReactiveDB } from '../sync/reactive-db';
import type { StorageStudioScopeKind } from './storage-studio-ownership';
import {
  STORAGE_STUDIO_OPERATIONS_TABLE,
  type StorageStudioOperationKind,
  type StorageStudioOperationStatus,
} from './storage-studio-schema';

export interface StorageStudioOperationRecord {
  operation_id: string;
  idempotency_key: string;
  operation_kind: StorageStudioOperationKind;
  scope_kind: StorageStudioScopeKind;
  scope_id: string;
  actor_user_id: string;
  actor_membership_id: string | null;
  request_hash: string;
  status: StorageStudioOperationStatus;
  drive_id: string | null;
  profile_revision: number | null;
  error_code: string | null;
  created_at: number;
  updated_at: number;
  completed_at: number | null;
  expires_at: number;
}

export interface StorageStudioOperationInsert {
  readonly operationId: string;
  readonly idempotencyKey: string;
  readonly kind: StorageStudioOperationKind;
  readonly scopeKind: StorageStudioScopeKind;
  readonly scopeId: string;
  readonly actorUserId: string;
  readonly actorMembershipId: string | null;
  readonly requestHash: string;
  readonly driveId: string | null;
  readonly createdAt: number;
  readonly expiresAt: number;
}

/** Idempotency-receipt persistence adapter. */
export class StorageStudioOperationStore {
  private readonly getStatement;
  private readonly getByIdStatement;

  constructor(private readonly db: ReactiveDB) {
    this.getStatement = db.prepare(`
      SELECT * FROM ${STORAGE_STUDIO_OPERATIONS_TABLE}
      WHERE scope_kind = ? AND scope_id = ? AND actor_user_id = ?
        AND operation_kind = ? AND idempotency_key = ?
    `);
    this.getByIdStatement = db.prepare(`
      SELECT * FROM ${STORAGE_STUDIO_OPERATIONS_TABLE} WHERE operation_id = ?
    `);
  }

  get(
    scopeKind: StorageStudioScopeKind,
    scopeId: string,
    actorUserId: string,
    kind: StorageStudioOperationKind,
    idempotencyKey: string,
  ): StorageStudioOperationRecord | null {
    return this.getStatement.get(
      scopeKind,
      scopeId,
      actorUserId,
      kind,
      idempotencyKey,
    ) as StorageStudioOperationRecord | null;
  }

  getById(operationId: string): StorageStudioOperationRecord | null {
    return this.getByIdStatement.get(operationId) as StorageStudioOperationRecord | null;
  }

  insert(input: StorageStudioOperationInsert): StorageStudioOperationRecord {
    this.db.prepare(`
      INSERT INTO ${STORAGE_STUDIO_OPERATIONS_TABLE} (
        operation_id, idempotency_key, operation_kind, scope_kind, scope_id,
        actor_user_id, actor_membership_id, request_hash, status, drive_id,
        profile_revision, error_code, created_at, updated_at, completed_at,
        expires_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, NULL, NULL, ?, ?, NULL, ?)
    `).run(
      input.operationId,
      input.idempotencyKey,
      input.kind,
      input.scopeKind,
      input.scopeId,
      input.actorUserId,
      input.actorMembershipId,
      input.requestHash,
      input.driveId,
      input.createdAt,
      input.createdAt,
      input.expiresAt,
    );
    return this.get(
      input.scopeKind,
      input.scopeId,
      input.actorUserId,
      input.kind,
      input.idempotencyKey,
    )!;
  }

  complete(
    operationId: string,
    driveId: string,
    profileRevision: number,
    completedAt: number,
  ): void {
    this.db.prepare(`
      UPDATE ${STORAGE_STUDIO_OPERATIONS_TABLE}
      SET status = 'succeeded', drive_id = ?, profile_revision = ?,
        error_code = NULL, updated_at = ?, completed_at = ?
      WHERE operation_id = ?
    `).run(driveId, profileRevision, completedAt, completedAt, operationId);
  }

  fail(
    operationId: string,
    status: Extract<StorageStudioOperationStatus, 'failed' | 'outcome_unknown'>,
    errorCode: string,
    completedAt: number,
  ): void {
    this.db.prepare(`
      UPDATE ${STORAGE_STUDIO_OPERATIONS_TABLE}
      SET status = ?, error_code = ?, updated_at = ?, completed_at = ?
      WHERE operation_id = ?
    `).run(status, errorCode, completedAt, completedAt, operationId);
  }

  /** Settle a still-pending receipt without overwriting a concurrent winner. */
  failPending(
    operationId: string,
    status: Extract<StorageStudioOperationStatus, 'failed' | 'outcome_unknown'>,
    errorCode: string,
    completedAt: number,
  ): boolean {
    return this.db.prepare(`
      UPDATE ${STORAGE_STUDIO_OPERATIONS_TABLE}
      SET status = ?, error_code = ?, updated_at = ?, completed_at = ?
      WHERE operation_id = ? AND status = 'pending'
    `).run(status, errorCode, completedAt, completedAt, operationId).changes === 1;
  }

  /**
   * Prune expired terminal idempotency receipts in bounded batches.
   * Pending/unknown outcomes and receipts referenced by active jobs survive.
   */
  pruneExpiredTerminal(now: number, limit = 100): number {
    if (!Number.isSafeInteger(now) || now < 0) {
      throw new TypeError('Storage operation prune time is invalid.');
    }
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1_000) {
      throw new TypeError('Storage operation prune limit is invalid.');
    }
    return this.db.prepare(`
      DELETE FROM ${STORAGE_STUDIO_OPERATIONS_TABLE}
      WHERE operation_id IN (
        SELECT operation.operation_id
        FROM ${STORAGE_STUDIO_OPERATIONS_TABLE} operation
        WHERE operation.expires_at <= ?
          AND operation.status IN ('succeeded', 'failed')
          AND NOT EXISTS (
            SELECT 1 FROM _storage_jobs job
            WHERE job.operation_id = operation.operation_id
              AND job.status IN ('queued', 'running')
          )
        ORDER BY operation.expires_at, operation.operation_id
        LIMIT ?
      )
    `).run(now, limit).changes;
  }
}
