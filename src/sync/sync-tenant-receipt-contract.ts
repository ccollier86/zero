/**
 * Stable tenant-Sync mutation and receipt identity contract.
 *
 * Receipt keys identify a principal request, logical fingerprints identify
 * immutable work, and recovery classifiers prevent an unknown outcome from
 * being converted into a false negative acknowledgement.
 */

import type {
  DatabaseMutation,
  DatabaseOperationRow,
} from '../databases/database-operations';
import type { DatabaseLogicalReceiptFingerprint } from '../databases/database-trusted-writer';
import type { SyncAuthContext, SyncMutateMessage } from './types';

/** Principal-scoped actor receipt key; request changes retain the same key. */
export function createTenantSyncIdempotencyKey(
  auth: SyncAuthContext,
  ref: string,
): string {
  const principal = JSON.stringify([
    auth.userId,
    auth.tenantId,
    auth.membershipId,
    auth.clientId ?? null,
    auth.sessionKind ?? null,
    ref,
  ]);
  return `sync:${new Bun.CryptoHasher('sha256').update(principal).digest('hex')}`;
}

/** Stable logical request identity; CAS snapshots never enter this hash. */
export function createTenantSyncLogicalReceiptFingerprint(
  message: Pick<SyncMutateMessage, 'table' | 'op' | 'rowId' | 'row'>,
): DatabaseLogicalReceiptFingerprint {
  const canonical = stableJson([
    message.table,
    message.op,
    message.rowId ?? null,
    message.row ?? null,
  ]);
  return `sha256:${new Bun.CryptoHasher('sha256')
    .update(canonical)
    .digest('hex')}`;
}

/** Translate the stable Sync operation vocabulary to actor CRUD. */
export function createTenantDatabaseMutation(
  message: Pick<SyncMutateMessage, 'table' | 'op' | 'rowId' | 'row'>,
  createOnly: boolean,
): DatabaseMutation {
  if (message.op === 'INSERT') {
    return {
      type: createOnly ? 'create' : 'upsert',
      table: message.table,
      row: message.row as DatabaseOperationRow,
    };
  }
  if (message.op === 'UPDATE') {
    return {
      type: 'update',
      table: message.table,
      id: message.rowId!,
      patch: message.row as DatabaseOperationRow,
    };
  }
  return { type: 'delete', table: message.table, id: message.rowId! };
}

/** True when no definitive negative acknowledgement may be sent. */
export function requiresTenantSyncMutationRecovery(error: unknown): boolean {
  if (isExpiredTenantSyncMutationReceipt(error)) return false;
  if (!plainRecord(error)) return false;
  if (error.code === 'SYNC_TENANT_MUTATION_RECOVERY_REQUIRED'
    || error.code === 'DATABASE_OUTCOME_UNKNOWN'
    || error.outcome === 'unknown') return true;
  return plainRecord(error.details)
    && error.details.retryWithSameKeyOnly === true;
}

/** Exact permanent receipt tombstone; safe to reject after a fresh baseline. */
export function isExpiredTenantSyncMutationReceipt(error: unknown): boolean {
  return plainRecord(error)
    && error.code === 'DATABASE_OUTCOME_UNKNOWN'
    && error.outcome === 'unknown'
    && plainRecord(error.details)
    && error.details.receiptState === 'expired';
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value) ?? 'null';
  }
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map(
    (key) => `${JSON.stringify(key)}:${stableJson(record[key])}`,
  ).join(',')}}`;
}

function plainRecord(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
