/** Validation and failure classification for the tenant Sync socket bridge. */

import { SyncSnapshotChunkLimitError } from './sync-snapshot-chunks';
import { DatabaseError } from '../databases/database-error';
import type {
  SyncTenantDataPlaneBinding,
  SyncTenantDataPlaneTable,
} from './sync-tenant-data-plane-contract';
import { SyncTenantSnapshotBudgetError } from './sync-tenant-snapshot-budget';
import {
  SyncTenantDataPlaneError,
  syncTenantDataPlaneError,
} from './sync-tenant-data-plane-error';
import type { SyncAuthContext, SyncSubscribeMessage } from './types';

/** Internal cancellation used when a newer subscription replaces old work. */
export class SyncTenantSubscriptionSupersededError extends SyncTenantDataPlaneError {
  constructor() {
    super(
      'SYNC_TENANT_SUBSCRIPTION_SUPERSEDED',
      'Tenant Sync subscription was superseded.',
    );
    this.name = 'SyncTenantSubscriptionSupersededError';
  }
}

/** Validate and detach the trusted tenant table catalog from app-owned input. */
export function validateTenantSyncTableCatalog(
  value: Readonly<Record<string, SyncTenantDataPlaneTable>>,
): Readonly<Record<string, SyncTenantDataPlaneTable>> {
  if (!plainRecord(value)) {
    throw syncTenantDataPlaneError(
      'SYNC_TENANT_CATALOG_INVALID',
      'Tenant Sync table catalog is invalid.',
    );
  }
  const output: Record<string, SyncTenantDataPlaneTable> = Object.create(null);
  for (const [table, definition] of Object.entries(value)) {
    if (!safeIdentifier(table)
      || !plainRecord(definition)
      || !safeIdentifier(definition.primaryKey)
      || !Array.isArray(definition.columns)
      || definition.columns.length === 0
      || definition.columns.some((field) => !safeIdentifier(field))
      || new Set(definition.columns).size !== definition.columns.length
      || !definition.columns.includes(definition.primaryKey)
      || (definition.identity !== undefined
        && (!Array.isArray(definition.identity)
          || definition.identity.some((field) => (
            !safeIdentifier(field) || !definition.columns.includes(field)
          ))
          || new Set(definition.identity).size !== definition.identity.length))) {
      throw syncTenantDataPlaneError(
        'SYNC_TENANT_CATALOG_INVALID',
        'Tenant Sync table catalog is invalid.',
      );
    }
    output[table] = Object.freeze({
      primaryKey: definition.primaryKey,
      columns: Object.freeze([...definition.columns]),
      ...(definition.identity === undefined
        ? {}
        : { identity: Object.freeze([...definition.identity]) }),
    });
  }
  return Object.freeze(output);
}

/** Reject a partial or already-released tenant database capability. */
export function validateTenantSyncBinding(binding: SyncTenantDataPlaneBinding): void {
  if (!binding
    || typeof binding !== 'object'
    || binding.released !== false
    || typeof binding.databaseRef !== 'string'
    || !binding.client
    || !binding.trustedWriter
    || typeof binding.client.get !== 'function'
    || typeof binding.client.mutate !== 'function'
    || typeof binding.client.batch !== 'function'
    || typeof binding.trustedWriter.findReceipt !== 'function'
    || typeof binding.trustedWriter.executeWrite !== 'function'
    || typeof binding.beginSnapshot !== 'function'
    || typeof binding.replay !== 'function'
    || typeof binding.onWakeup !== 'function'
    || typeof binding.release !== 'function') {
    throw syncTenantDataPlaneError(
      'SYNC_TENANT_BINDING_INVALID',
      'Tenant Sync data-plane binding is invalid.',
    );
  }
}

/** Require an internally verified, membership-bound tenant session. */
export function assertVerifiedTenantSyncAuthority(context: SyncAuthContext): void {
  if (!context
    || context.sessionScopeKind !== 'tenant'
    || typeof context.tenantId !== 'string'
    || context.tenantId.length === 0
    || context.sessionScopeId !== context.tenantId
    || typeof context.membershipId !== 'string'
    || context.membershipId.length === 0) {
    throw syncTenantDataPlaneError(
      'SYNC_TENANT_AUTHORITY_REQUIRED',
      'Tenant Sync requires a verified tenant-scoped authority.',
    );
  }
}

/** Snapshot the request authority so callers cannot mutate routing identity. */
export function freezeTenantSyncAuthContext(context: SyncAuthContext): SyncAuthContext {
  return Object.freeze({
    ...context,
    ...(context.scope === undefined
      ? {}
      : { scope: Object.freeze([...context.scope]) }),
  });
}

export function validTenantSyncSubscribe(message: SyncSubscribeMessage): boolean {
  return Array.isArray(message.tables)
    && Number.isSafeInteger(message.lastSeq)
    && message.lastSeq >= 0
    && (message.snapshot === undefined || Array.isArray(message.snapshot))
    && (message.epoch === undefined || typeof message.epoch === 'string')
    && (message.scope === undefined || message.scope === null
      || typeof message.scope === 'string')
    && validCursors(message.cursors);
}

export function uniqueTenantSyncStrings(values: readonly unknown[]): string[] {
  return [...new Set(values.filter((value): value is string => typeof value === 'string'))];
}

export function isTenantSyncHistoryGap(error: unknown): boolean {
  return plainRecord(error) && error.code === 'DATABASE_HISTORY_GAP';
}

export function isTenantSyncAuthorityFailure(error: unknown): boolean {
  return plainRecord(error) && error.code === 'DATABASE_AUTHORITY_CHANGED';
}

export function isTenantSyncDatabaseCapacityExhausted(error: unknown): boolean {
  return plainRecord(error) && error.code === 'DATABASE_CAPACITY_EXHAUSTED';
}

export function isTerminalTenantSyncSnapshotFailure(error: unknown): boolean {
  if (error instanceof SyncSnapshotChunkLimitError
    || error instanceof SyncTenantSnapshotBudgetError) return true;
  if (!plainRecord(error)) return false;
  return error.code === 'SYNC_TENANT_SNAPSHOT_INVALID'
    || error.code === 'DATABASE_PAYLOAD_LIMIT'
    || error.code === 'DATABASE_SCHEMA_MISMATCH'
    || (error.retryable === false && (
      error.code === 'DATABASE_PROTOCOL_ERROR'
      || error.code === 'DATABASE_RESULT_LIMIT'
    ));
}

export function tenantSyncAuthorityChangedError(): DatabaseError {
  return new DatabaseError(
    'DATABASE_AUTHORITY_CHANGED',
    'Tenant Sync authority changed.',
  );
}

export function tenantSyncMutationRecoveryError(): SyncTenantDataPlaneError {
  return syncTenantDataPlaneError(
    'SYNC_TENANT_MUTATION_RECOVERY_REQUIRED',
    'Tenant Sync mutation requires receipt recovery.',
  );
}

function validCursors(value: SyncSubscribeMessage['cursors']): boolean {
  if (value === undefined) return true;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  if (Object.keys(value).some(
    (key) => key !== 'default' && key !== 'system' && key !== 'tenant',
  )) {
    return false;
  }
  return Object.values(value).every((cursor) => cursor === undefined || (
    cursor !== null
    && typeof cursor === 'object'
    && Number.isSafeInteger(cursor.lastSeq)
    && cursor.lastSeq >= 0
    && (cursor.epoch === undefined || typeof cursor.epoch === 'string')
    && (cursor.scope === undefined || cursor.scope === null
      || typeof cursor.scope === 'string')
  ));
}

function safeIdentifier(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z_][A-Za-z0-9_]{0,127}$/u.test(value);
}

function plainRecord(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
