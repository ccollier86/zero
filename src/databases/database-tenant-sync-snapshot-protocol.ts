/**
 * Strict actor protocol for one materialized tenant-Sync snapshot session.
 *
 * Sessions are internal capabilities. Their opaque owner/session tokens never
 * enter public APIs, logs, observability metadata, or websocket frames.
 */

import { DatabaseError } from './database-error';
import {
  normalizeDatabaseRef,
  type DatabaseRef,
} from './database-file';
import {
  DATABASE_OPERATION_MAX_ID_BYTES,
  cloneDatabaseSerializableValue,
  createDatabaseSequenceToken,
  isDatabaseTableName,
  type DatabaseOperationCatalog,
  type DatabaseOperationRow,
  type DatabaseSequenceToken,
} from './database-operations';

/** Active immutable sessions admitted by one writer actor. */
export const DATABASE_TENANT_SYNC_SNAPSHOT_MAX_SESSIONS = 8 as const;

/** Rows materialized by one exact tenant baseline. */
export const DATABASE_TENANT_SYNC_SNAPSHOT_MAX_ROWS = 50_000 as const;

/** Exact UTF-8 JSON bytes retained across one materialized baseline. */
export const DATABASE_TENANT_SYNC_SNAPSHOT_MAX_SOURCE_BYTES =
  67_108_864 as const;

/** Exact UTF-8 JSON bytes retained for one source row. */
export const DATABASE_TENANT_SYNC_SNAPSHOT_MAX_SOURCE_ROW_BYTES =
  1_048_576 as const;

/** Value-tree nodes retained for one source row. */
export const DATABASE_TENANT_SYNC_SNAPSHOT_MAX_SOURCE_ROW_NODES = 10_000 as const;

/** Rows returned by one retry-safe actor page. */
export const DATABASE_TENANT_SYNC_SNAPSHOT_PAGE_MAX_ROWS = 100 as const;

/** Source-row bytes returned by one actor page. */
export const DATABASE_TENANT_SYNC_SNAPSHOT_PAGE_MAX_SOURCE_BYTES =
  4_194_304 as const;

/** Value-tree nodes returned by one actor page. */
export const DATABASE_TENANT_SYNC_SNAPSHOT_PAGE_MAX_NODES = 18_000 as const;

/** Absolute lifetime, including initial materialization and wire backpressure. */
export const DATABASE_TENANT_SYNC_SNAPSHOT_TTL_MS = 30_000 as const;

/** Realm tables represented by one snapshot session. */
export const DATABASE_TENANT_SYNC_MAX_SNAPSHOT_TABLES = 128 as const;

const BEGIN_FIELDS = new Set([
  'databaseRef',
  'generation',
  'ownerToken',
  'tables',
]);
const PAGE_FIELDS = new Set([
  'databaseRef',
  'generation',
  'ownerToken',
  'sessionId',
  'tables',
  'cursor',
]);
const ABORT_FIELDS = new Set([
  'databaseRef',
  'generation',
  'ownerToken',
  'sessionId',
  'tables',
]);
const BEGIN_RESULT_FIELDS = new Set([
  'sessionId',
  'syncEpoch',
  'sequence',
  'tables',
  'totalRows',
  'totalSourceBytes',
  'expiresAt',
]);
const PAGE_RESULT_FIELDS = new Set([
  'sessionId',
  'cursor',
  'rows',
  'nextCursor',
]);
const PAGE_ROW_FIELDS = new Set([
  'ordinal',
  'tableIndex',
  'rowId',
  'row',
]);
const ABORT_RESULT_FIELDS = new Set(['aborted']);
const SEQUENCE_FIELDS = new Set(['seq']);
const CAPABILITY_TOKEN_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const SAFE_EPOCH_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const textEncoder = new TextEncoder();

export interface DatabaseActorTenantSyncSnapshotBeginPayload {
  readonly databaseRef: DatabaseRef;
  readonly generation: number;
  readonly ownerToken: string;
  readonly tables: readonly string[];
}

export interface DatabaseActorTenantSyncSnapshotPagePayload
  extends DatabaseActorTenantSyncSnapshotBeginPayload {
  readonly sessionId: string;
  readonly cursor: number;
}

export interface DatabaseActorTenantSyncSnapshotAbortPayload
  extends DatabaseActorTenantSyncSnapshotBeginPayload {
  readonly sessionId: string;
}

export interface DatabaseActorTenantSyncSnapshotBeginResult {
  readonly sessionId: string;
  readonly syncEpoch: string;
  readonly sequence: DatabaseSequenceToken;
  readonly tables: readonly string[];
  readonly totalRows: number;
  readonly totalSourceBytes: number;
  readonly expiresAt: number;
}

export interface DatabaseActorTenantSyncSnapshotPageRow {
  readonly ordinal: number;
  readonly tableIndex: number;
  readonly rowId: string;
  readonly row: DatabaseOperationRow;
}

export interface DatabaseActorTenantSyncSnapshotPageResult {
  readonly sessionId: string;
  readonly cursor: number;
  readonly rows: readonly DatabaseActorTenantSyncSnapshotPageRow[];
  readonly nextCursor: number | null;
}

export interface DatabaseActorTenantSyncSnapshotAbortResult {
  readonly aborted: boolean;
}

export function validateDatabaseActorTenantSyncSnapshotBeginPayload(
  value: unknown,
  catalog: DatabaseOperationCatalog,
): DatabaseActorTenantSyncSnapshotBeginPayload {
  const record = exactRecord(value, BEGIN_FIELDS, 'begin request');
  return Object.freeze({
    databaseRef: parseDatabaseRef(record.databaseRef),
    generation: parseGeneration(record.generation),
    ownerToken: parseCapabilityToken(record.ownerToken),
    tables: validateDatabaseTenantSyncTableSelection(record.tables, catalog),
  });
}

export function validateDatabaseActorTenantSyncSnapshotPagePayload(
  value: unknown,
  catalog: DatabaseOperationCatalog,
): DatabaseActorTenantSyncSnapshotPagePayload {
  const record = exactRecord(value, PAGE_FIELDS, 'page request');
  return Object.freeze({
    databaseRef: parseDatabaseRef(record.databaseRef),
    generation: parseGeneration(record.generation),
    ownerToken: parseCapabilityToken(record.ownerToken),
    sessionId: parseCapabilityToken(record.sessionId),
    tables: validateDatabaseTenantSyncTableSelection(record.tables, catalog),
    cursor: parseCursor(record.cursor),
  });
}

export function validateDatabaseActorTenantSyncSnapshotAbortPayload(
  value: unknown,
  catalog: DatabaseOperationCatalog,
): DatabaseActorTenantSyncSnapshotAbortPayload {
  const record = exactRecord(value, ABORT_FIELDS, 'abort request');
  return Object.freeze({
    databaseRef: parseDatabaseRef(record.databaseRef),
    generation: parseGeneration(record.generation),
    ownerToken: parseCapabilityToken(record.ownerToken),
    sessionId: parseCapabilityToken(record.sessionId),
    tables: validateDatabaseTenantSyncTableSelection(record.tables, catalog),
  });
}

export function validateDatabaseActorTenantSyncSnapshotBeginResult(
  value: unknown,
  expectedTables: readonly string[],
  catalog: DatabaseOperationCatalog,
): DatabaseActorTenantSyncSnapshotBeginResult {
  try {
    const tables = validateDatabaseTenantSyncTableSelection(
      expectedTables,
      catalog,
    );
    const record = exactRecord(value, BEGIN_RESULT_FIELDS, 'begin result');
    const returnedTables = validateDatabaseTenantSyncTableSelection(
      record.tables,
      catalog,
    );
    if (!sameTables(tables, returnedTables)
      || typeof record.syncEpoch !== 'string'
      || !SAFE_EPOCH_PATTERN.test(record.syncEpoch)
      || !isSafeCount(record.totalRows)
      || record.totalRows > DATABASE_TENANT_SYNC_SNAPSHOT_MAX_ROWS
      || !isSafeCount(record.totalSourceBytes)
      || record.totalSourceBytes > DATABASE_TENANT_SYNC_SNAPSHOT_MAX_SOURCE_BYTES
      || !Number.isSafeInteger(record.expiresAt)
      || (record.expiresAt as number) < 0) {
      throw new Error('invalid begin result');
    }
    return Object.freeze({
      sessionId: parseCapabilityToken(record.sessionId),
      syncEpoch: record.syncEpoch,
      sequence: parseSequence(record.sequence),
      tables,
      totalRows: record.totalRows,
      totalSourceBytes: record.totalSourceBytes,
      expiresAt: record.expiresAt as number,
    });
  } catch (cause) {
    throw actorProtocolFailure(cause);
  }
}

export function validateDatabaseActorTenantSyncSnapshotPageResult(
  value: unknown,
  expected: Readonly<{
    sessionId: string;
    cursor: number;
    totalRows: number;
    tables: readonly string[];
  }>,
  catalog: DatabaseOperationCatalog,
): DatabaseActorTenantSyncSnapshotPageResult {
  try {
    const record = exactRecord(value, PAGE_RESULT_FIELDS, 'page result');
    if (parseCapabilityToken(record.sessionId) !== expected.sessionId
      || parseCursor(record.cursor) !== expected.cursor
      || !Array.isArray(record.rows)
      || record.rows.length > DATABASE_TENANT_SYNC_SNAPSHOT_PAGE_MAX_ROWS) {
      throw new Error('invalid page correlation');
    }
    const rows: DatabaseActorTenantSyncSnapshotPageRow[] = [];
    let sourceBytes = 0;
    let nodes = 4;
    let nextOrdinal = expected.cursor;
    for (const candidate of record.rows) {
      const entry = exactRecord(candidate, PAGE_ROW_FIELDS, 'page row');
      if (entry.ordinal !== nextOrdinal
        || !Number.isSafeInteger(entry.tableIndex)
        || (entry.tableIndex as number) < 0
        || (entry.tableIndex as number) >= expected.tables.length) {
        throw new Error('invalid page order');
      }
      const tableIndex = entry.tableIndex as number;
      const table = expected.tables[tableIndex]!;
      const row = validateSnapshotRow(entry.row, table, catalog);
      const rowId = canonicalRowId(entry.rowId);
      const primaryKey = catalog.primaryKeys?.[table];
      if (rowId === null || !primaryKey
        || canonicalRowId(row[primaryKey]) !== rowId) {
        throw new Error('invalid page identity');
      }
      const bytes = serializedByteLength(row);
      if (bytes > DATABASE_TENANT_SYNC_SNAPSHOT_MAX_SOURCE_ROW_BYTES) {
        throw new Error('page row too large');
      }
      sourceBytes += bytes;
      nodes += countSerializableNodes(row) + 5;
      if (sourceBytes > DATABASE_TENANT_SYNC_SNAPSHOT_PAGE_MAX_SOURCE_BYTES
        || nodes > DATABASE_TENANT_SYNC_SNAPSHOT_PAGE_MAX_NODES) {
        throw new Error('page too large');
      }
      rows.push(Object.freeze({
        ordinal: nextOrdinal,
        tableIndex,
        rowId,
        row,
      }));
      nextOrdinal += 1;
    }
    const nextCursor = record.nextCursor === null
      ? null
      : parseCursor(record.nextCursor);
    if (expected.cursor > expected.totalRows
      || nextOrdinal > expected.totalRows
      || (nextOrdinal === expected.totalRows
        ? nextCursor !== null
        : nextCursor !== nextOrdinal)
      || (rows.length === 0 && expected.cursor !== expected.totalRows)) {
      throw new Error('invalid page continuation');
    }
    return Object.freeze({
      sessionId: expected.sessionId,
      cursor: expected.cursor,
      rows: Object.freeze(rows),
      nextCursor,
    });
  } catch (cause) {
    throw actorProtocolFailure(cause);
  }
}

export function validateDatabaseActorTenantSyncSnapshotAbortResult(
  value: unknown,
): DatabaseActorTenantSyncSnapshotAbortResult {
  try {
    const record = exactRecord(value, ABORT_RESULT_FIELDS, 'abort result');
    if (typeof record.aborted !== 'boolean') throw new Error('invalid abort result');
    return Object.freeze({ aborted: record.aborted });
  } catch (cause) {
    throw actorProtocolFailure(cause);
  }
}

/** Validate a bounded, unique realm-table selection; empty is an exact head. */
export function validateDatabaseTenantSyncTableSelection(
  value: unknown,
  catalog: DatabaseOperationCatalog,
): readonly string[] {
  if (!Array.isArray(value)
    || value.length > DATABASE_TENANT_SYNC_MAX_SNAPSHOT_TABLES) {
    throw payloadInvalid();
  }
  const allowed = new Set(catalog.tables ?? []);
  const selected = new Set<string>();
  const tables: string[] = [];
  for (const table of value) {
    if (!isDatabaseTableName(table) || selected.has(table)) throw payloadInvalid();
    if (!allowed.has(table)) {
      throw new DatabaseError(
        'DATABASE_OPERATION_UNSUPPORTED',
        'Database tenant snapshot table is not declared by the realm.',
      );
    }
    if (!catalog.columns?.[table]?.length || !catalog.primaryKeys?.[table]) {
      throw new DatabaseError(
        'DATABASE_SCHEMA_MISMATCH',
        'Database tenant snapshot table schema is unavailable.',
      );
    }
    selected.add(table);
    tables.push(table);
  }
  return Object.freeze(tables);
}

export function sameDatabaseTenantSyncTables(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return sameTables(left, right);
}

function validateSnapshotRow(
  value: unknown,
  table: string,
  catalog: DatabaseOperationCatalog,
): DatabaseOperationRow {
  const columns = catalog.columns?.[table];
  if (!columns) throw new Error('missing snapshot schema');
  const clone = cloneDatabaseSerializableValue(value);
  const record = exactRecord(clone, new Set(columns), 'page row value');
  return Object.freeze(record) as DatabaseOperationRow;
}

function exactRecord(
  value: unknown,
  fields: ReadonlySet<string>,
  _boundary: string,
): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw payloadInvalid();
  }
  try {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new Error('invalid prototype');
    }
    if (Object.getOwnPropertySymbols(value).length > 0) {
      throw new Error('symbol property');
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const entries = Object.entries(descriptors);
    if (entries.length !== fields.size
      || entries.some(([key, descriptor]) => !fields.has(key)
        || !descriptor.enumerable
        || !('value' in descriptor))) {
      throw new Error('invalid fields');
    }
    const record: Record<string, unknown> = Object.create(null);
    for (const [key, descriptor] of entries) {
      record[key] = (descriptor as PropertyDescriptor & { value: unknown }).value;
    }
    return record;
  } catch (cause) {
    if (cause instanceof DatabaseError) throw cause;
    throw payloadInvalid(cause);
  }
}

function parseDatabaseRef(value: unknown): DatabaseRef {
  try {
    return normalizeDatabaseRef(value as string);
  } catch (cause) {
    throw payloadInvalid(cause);
  }
}

function parseCapabilityToken(value: unknown): string {
  if (typeof value !== 'string' || !CAPABILITY_TOKEN_PATTERN.test(value)) {
    throw payloadInvalid();
  }
  return value.toLowerCase();
}

function parseGeneration(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw payloadInvalid();
  }
  return value as number;
}

function parseCursor(value: unknown): number {
  if (!isSafeCount(value) || value > DATABASE_TENANT_SYNC_SNAPSHOT_MAX_ROWS) {
    throw payloadInvalid();
  }
  return value;
}

function parseSequence(value: unknown): DatabaseSequenceToken {
  const record = exactRecord(value, SEQUENCE_FIELDS, 'sequence');
  return createDatabaseSequenceToken(record.seq as number);
}

function canonicalRowId(value: unknown): string | null {
  if (typeof value !== 'string'
    && (typeof value !== 'number' || !Number.isSafeInteger(value))) return null;
  const canonical = String(value);
  return canonical.length > 0
    && canonical.length <= DATABASE_OPERATION_MAX_ID_BYTES
    && textEncoder.encode(canonical).byteLength <= DATABASE_OPERATION_MAX_ID_BYTES
    ? canonical
    : null;
}

function serializedByteLength(value: unknown): number {
  const serialized = JSON.stringify(value);
  if (typeof serialized !== 'string') throw new Error('invalid serialized row');
  return textEncoder.encode(serialized).byteLength;
}

function countSerializableNodes(value: unknown): number {
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

function sameTables(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length
    && left.every((table, index) => table === right[index]);
}

function isSafeCount(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function payloadInvalid(cause?: unknown): DatabaseError {
  return new DatabaseError(
    'DATABASE_PAYLOAD_INVALID',
    'Database tenant snapshot-session payload is invalid.',
    cause === undefined ? undefined : { cause },
  );
}

function actorProtocolFailure(cause: unknown): DatabaseError {
  if (cause instanceof DatabaseError
    && cause.code === 'DATABASE_PROTOCOL_ERROR') return cause;
  return new DatabaseError(
    'DATABASE_PROTOCOL_ERROR',
    'Database actor returned an invalid tenant snapshot-session result.',
    { retryable: false, outcome: null, cause },
  );
}
