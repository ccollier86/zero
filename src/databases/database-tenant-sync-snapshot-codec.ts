/** Stored-row validation and canonical serialization for snapshot sessions. */

import {
  cloneDatabaseSerializableValue,
  type DatabaseOperationCatalog,
  type DatabaseOperationRow,
} from './database-operations';
import { DatabaseError } from './database-error';
import { canonicalDatabaseRowId } from '../sync/row-identity';
import {
  DATABASE_TENANT_SYNC_SNAPSHOT_MAX_ROWS,
  DATABASE_TENANT_SYNC_SNAPSHOT_MAX_SOURCE_BYTES,
  DATABASE_TENANT_SYNC_SNAPSHOT_MAX_SOURCE_ROW_BYTES,
  DATABASE_TENANT_SYNC_SNAPSHOT_MAX_SOURCE_ROW_NODES,
  type DatabaseActorTenantSyncSnapshotPageRow,
} from './database-tenant-sync-snapshot-protocol';
import {
  databaseTenantSyncSnapshotLimit,
  databaseTenantSyncSnapshotSchemaMismatch,
} from './database-tenant-sync-snapshot-errors';
import type { DatabaseTenantSyncSnapshotSessionLimits } from './database-tenant-sync-snapshot-limits';

export interface DatabaseTenantSyncStoredSessionRow {
  session_id?: unknown;
  owner_token?: unknown;
  generation?: unknown;
  table_selection_json?: unknown;
  sync_epoch?: unknown;
  head_seq?: unknown;
  created_at?: unknown;
  expires_at?: unknown;
  total_rows?: unknown;
  total_source_bytes?: unknown;
}

export interface DatabaseTenantSyncStoredPageRow {
  ordinal?: unknown;
  table_index?: unknown;
  row_id?: unknown;
  row_json?: unknown;
  source_bytes?: unknown;
  node_count?: unknown;
}

export interface DatabaseTenantSyncValidatedSession {
  readonly session_id: string;
  readonly owner_token: string;
  readonly generation: number;
  readonly table_selection_json: string;
  readonly expires_at: number;
  readonly total_rows: number;
}

export interface DatabaseTenantSyncEncodedSourceRow {
  readonly rowId: string;
  readonly rowJson: string;
  readonly sourceBytes: number;
  readonly nodeCount: number;
}

export interface DatabaseTenantSyncDecodedPageRow {
  readonly row: DatabaseActorTenantSyncSnapshotPageRow;
  readonly sourceBytes: number;
  readonly nodeCount: number;
}

export interface DatabaseTenantSyncValidatedStoredPageRow {
  readonly ordinal: number;
  readonly tableIndex: number;
  readonly rowId: string;
  readonly rowJson: string;
  readonly sourceBytes: number;
  readonly nodeCount: number;
}

export function validateDatabaseTenantSyncStoredSession(
  row: DatabaseTenantSyncStoredSessionRow,
): Readonly<DatabaseTenantSyncValidatedSession> {
  if (typeof row.session_id !== 'string'
    || typeof row.owner_token !== 'string'
    || !Number.isSafeInteger(row.generation)
    || (row.generation as number) < 1
    || typeof row.table_selection_json !== 'string'
    || typeof row.sync_epoch !== 'string'
    || !isSafeCount(row.head_seq)
    || !isSafeCount(row.created_at)
    || !isSafeCount(row.expires_at)
    || (row.expires_at as number) < (row.created_at as number)
    || !isSafeCount(row.total_rows)
    || (row.total_rows as number) > DATABASE_TENANT_SYNC_SNAPSHOT_MAX_ROWS
    || !isSafeCount(row.total_source_bytes)
    || (row.total_source_bytes as number)
      > DATABASE_TENANT_SYNC_SNAPSHOT_MAX_SOURCE_BYTES) {
    throw databaseTenantSyncSnapshotSchemaMismatch();
  }
  return Object.freeze(row as DatabaseTenantSyncValidatedSession);
}

export function encodeDatabaseTenantSyncSourceRow(
  candidate: unknown,
  columns: readonly string[],
  primaryKey: string,
  limits: DatabaseTenantSyncSnapshotSessionLimits,
): Readonly<DatabaseTenantSyncEncodedSourceRow> {
  let candidateJson: string | undefined;
  try {
    candidateJson = JSON.stringify(candidate);
  } catch {
    throw databaseTenantSyncSnapshotSchemaMismatch();
  }
  if (candidateJson === undefined) {
    throw databaseTenantSyncSnapshotSchemaMismatch();
  }
  if (textEncoder.encode(candidateJson).byteLength > limits.maxSourceRowBytes) {
    throw databaseTenantSyncSnapshotLimit('row-bytes');
  }

  const row = normalizeDatabaseTenantSyncSourceRow(candidate, columns);
  const rowId = canonicalDatabaseRowId(row[primaryKey]);
  if (rowId === null) throw databaseTenantSyncSnapshotSchemaMismatch();
  const rowJson = JSON.stringify(row);
  if (typeof rowJson !== 'string') {
    throw databaseTenantSyncSnapshotSchemaMismatch();
  }
  const sourceBytes = textEncoder.encode(rowJson).byteLength;
  if (sourceBytes > limits.maxSourceRowBytes) {
    throw databaseTenantSyncSnapshotLimit('row-bytes');
  }
  const nodeCount = countDatabaseTenantSyncSerializableNodes(row);
  if (nodeCount > limits.maxSourceRowNodes) {
    throw databaseTenantSyncSnapshotLimit('row-nodes');
  }
  return Object.freeze({ rowId, rowJson, sourceBytes, nodeCount });
}

export function decodeDatabaseTenantSyncStoredPageRow(
  stored: DatabaseTenantSyncValidatedStoredPageRow,
  tables: readonly string[],
  catalog: DatabaseOperationCatalog,
): Readonly<DatabaseTenantSyncDecodedPageRow> {
  try {
    const table = tables[stored.tableIndex];
    const columns = table === undefined
      ? undefined
      : catalog.columns?.[table];
    const primaryKey = table === undefined
      ? undefined
      : catalog.primaryKeys?.[table];
    if (!columns?.length || !primaryKey) {
      throw databaseTenantSyncSnapshotSchemaMismatch();
    }
    const row = normalizeDatabaseTenantSyncSourceRow(
      JSON.parse(stored.rowJson),
      columns,
    );
    if (canonicalDatabaseRowId(row[primaryKey]) !== stored.rowId
      || countDatabaseTenantSyncSerializableNodes(row) !== stored.nodeCount
      || textEncoder.encode(JSON.stringify(row)).byteLength !== stored.sourceBytes) {
      throw databaseTenantSyncSnapshotSchemaMismatch();
    }
    return Object.freeze({
      row: Object.freeze({
        ordinal: stored.ordinal,
        tableIndex: stored.tableIndex,
        rowId: stored.rowId,
        row,
      }),
      sourceBytes: stored.sourceBytes,
      nodeCount: stored.nodeCount,
    });
  } catch (cause) {
    if (cause instanceof DatabaseError) throw cause;
    throw databaseTenantSyncSnapshotSchemaMismatch(cause);
  }
}

export function validateDatabaseTenantSyncStoredPageRow(
  row: DatabaseTenantSyncStoredPageRow,
  expectedOrdinal: number,
): Readonly<DatabaseTenantSyncValidatedStoredPageRow> {
  const rowId = canonicalDatabaseRowId(row.row_id);
  if (row.ordinal !== expectedOrdinal
    || !Number.isSafeInteger(row.table_index)
    || (row.table_index as number) < 0
    || rowId === null
    || typeof row.row_json !== 'string'
    || !isSafeCount(row.source_bytes)
    || (row.source_bytes as number)
      > DATABASE_TENANT_SYNC_SNAPSHOT_MAX_SOURCE_ROW_BYTES
    || !Number.isSafeInteger(row.node_count)
    || (row.node_count as number) < 1
    || (row.node_count as number)
      > DATABASE_TENANT_SYNC_SNAPSHOT_MAX_SOURCE_ROW_NODES) {
    throw databaseTenantSyncSnapshotSchemaMismatch();
  }
  return Object.freeze({
    ordinal: expectedOrdinal,
    tableIndex: row.table_index as number,
    rowId,
    rowJson: row.row_json,
    sourceBytes: row.source_bytes as number,
    nodeCount: row.node_count as number,
  });
}

function normalizeDatabaseTenantSyncSourceRow(
  value: unknown,
  columns: readonly string[],
): DatabaseOperationRow {
  try {
    const clone = cloneDatabaseSerializableValue(value);
    if (typeof clone !== 'object' || clone === null || Array.isArray(clone)) {
      throw new Error('snapshot row is not an object');
    }
    const keys = Object.keys(clone);
    const expected = new Set(columns);
    if (keys.length !== expected.size || keys.some((key) => !expected.has(key))) {
      throw new Error('snapshot row columns differ');
    }
    return clone as DatabaseOperationRow;
  } catch (cause) {
    throw databaseTenantSyncSnapshotSchemaMismatch(cause);
  }
}

function countDatabaseTenantSyncSerializableNodes(value: unknown): number {
  let count = 0;
  const pending: unknown[] = [value];
  while (pending.length > 0) {
    const current = pending.pop();
    count += 1;
    if (Array.isArray(current)) pending.push(...current);
    else if (typeof current === 'object' && current !== null) {
      pending.push(...Object.values(current));
    }
  }
  return count;
}

function isSafeCount(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

const textEncoder = new TextEncoder();
