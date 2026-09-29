/**
 * Writer-actor ownership of immutable tenant-Sync snapshot sessions.
 *
 * A begin request copies one exact SQLite read snapshot into bounded TEMP
 * tables and commits before returning across IPC. Later pages read only that
 * immutable materialization, so concurrent application writes cannot mix
 * versions and no SQLite transaction remains open between actor requests.
 */

import type { Statement } from 'bun:sqlite';
import { quoteSqlIdentifier } from '../sync/identity';
import { DatabaseError } from './database-error';
import {
  DATABASE_OPERATION_MAX_ID_BYTES,
  cloneDatabaseSerializableValue,
  createDatabaseSequenceToken,
  type DatabaseOperationCatalog,
  type DatabaseOperationRow,
} from './database-operations';
import type { DatabaseRuntime } from './database-runtime';
import {
  DATABASE_TENANT_SYNC_SNAPSHOT_MAX_ROWS,
  DATABASE_TENANT_SYNC_SNAPSHOT_MAX_SESSIONS,
  DATABASE_TENANT_SYNC_SNAPSHOT_MAX_SOURCE_BYTES,
  DATABASE_TENANT_SYNC_SNAPSHOT_MAX_SOURCE_ROW_BYTES,
  DATABASE_TENANT_SYNC_SNAPSHOT_MAX_SOURCE_ROW_NODES,
  DATABASE_TENANT_SYNC_SNAPSHOT_PAGE_MAX_NODES,
  DATABASE_TENANT_SYNC_SNAPSHOT_PAGE_MAX_ROWS,
  DATABASE_TENANT_SYNC_SNAPSHOT_PAGE_MAX_SOURCE_BYTES,
  DATABASE_TENANT_SYNC_SNAPSHOT_TTL_MS,
  sameDatabaseTenantSyncTables,
  validateDatabaseActorTenantSyncSnapshotAbortResult,
  validateDatabaseActorTenantSyncSnapshotBeginResult,
  validateDatabaseActorTenantSyncSnapshotPageResult,
  type DatabaseActorTenantSyncSnapshotAbortPayload,
  type DatabaseActorTenantSyncSnapshotAbortResult,
  type DatabaseActorTenantSyncSnapshotBeginPayload,
  type DatabaseActorTenantSyncSnapshotBeginResult,
  type DatabaseActorTenantSyncSnapshotPagePayload,
  type DatabaseActorTenantSyncSnapshotPageResult,
  type DatabaseActorTenantSyncSnapshotPageRow,
} from './database-tenant-sync-snapshot-protocol';

const SESSION_TABLE = '_zero_tenant_sync_snapshot_sessions';
const ROW_TABLE = '_zero_tenant_sync_snapshot_rows';
const SESSION_INSERT_GUARD = '_zero_tenant_sync_snapshot_session_insert_guard';

const SESSION_COLUMNS_SQL = `(
  session_id TEXT PRIMARY KEY,
  owner_token TEXT NOT NULL,
  generation INTEGER NOT NULL CHECK (generation > 0),
  table_selection_json TEXT NOT NULL,
  sync_epoch TEXT NOT NULL,
  head_seq INTEGER NOT NULL CHECK (head_seq >= 0),
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  expires_at INTEGER NOT NULL CHECK (expires_at >= created_at),
  total_rows INTEGER NOT NULL CHECK (
    total_rows >= 0
    AND total_rows <= ${DATABASE_TENANT_SYNC_SNAPSHOT_MAX_ROWS}
  ),
  total_source_bytes INTEGER NOT NULL CHECK (
    total_source_bytes >= 0
    AND total_source_bytes <= ${DATABASE_TENANT_SYNC_SNAPSHOT_MAX_SOURCE_BYTES}
  )
) STRICT, WITHOUT ROWID`;
const ROW_COLUMNS_SQL = `(
  session_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL CHECK (
    ordinal >= 0
    AND ordinal < ${DATABASE_TENANT_SYNC_SNAPSHOT_MAX_ROWS}
  ),
  table_index INTEGER NOT NULL CHECK (table_index >= 0 AND table_index < 128),
  row_id TEXT NOT NULL,
  row_json TEXT NOT NULL,
  source_bytes INTEGER NOT NULL CHECK (
    source_bytes >= 0
    AND source_bytes <= ${DATABASE_TENANT_SYNC_SNAPSHOT_MAX_SOURCE_ROW_BYTES}
  ),
  node_count INTEGER NOT NULL CHECK (
    node_count > 0
    AND node_count <= ${DATABASE_TENANT_SYNC_SNAPSHOT_MAX_SOURCE_ROW_NODES}
  ),
  PRIMARY KEY (session_id, ordinal)
) STRICT, WITHOUT ROWID`;
const SESSION_STORED_SQL = `CREATE TABLE ${SESSION_TABLE} ${SESSION_COLUMNS_SQL}`;
const ROW_STORED_SQL = `CREATE TABLE ${ROW_TABLE} ${ROW_COLUMNS_SQL}`;
const SESSION_CREATE_SQL = `CREATE TEMP TABLE ${SESSION_TABLE} ${SESSION_COLUMNS_SQL}`;
const ROW_CREATE_SQL = `CREATE TEMP TABLE ${ROW_TABLE} ${ROW_COLUMNS_SQL}`;
const SESSION_INSERT_GUARD_STORED_SQL = `CREATE TRIGGER ${SESSION_INSERT_GUARD}
BEFORE INSERT ON ${SESSION_TABLE}
WHEN (SELECT COUNT(*) FROM ${SESSION_TABLE}) >= ${DATABASE_TENANT_SYNC_SNAPSHOT_MAX_SESSIONS}
  OR (SELECT COALESCE(SUM(total_source_bytes), 0) FROM ${SESSION_TABLE})
    + NEW.total_source_bytes > ${DATABASE_TENANT_SYNC_SNAPSHOT_MAX_SOURCE_BYTES}
BEGIN
  SELECT RAISE(ABORT, 'zero tenant snapshot session capacity reached');
END`;
const SESSION_INSERT_GUARD_SQL = SESSION_INSERT_GUARD_STORED_SQL.replace(
  'CREATE TRIGGER',
  'CREATE TEMP TRIGGER',
);

interface StoredSessionRow {
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

interface StoredPageRow {
  ordinal?: unknown;
  table_index?: unknown;
  row_id?: unknown;
  row_json?: unknown;
  source_bytes?: unknown;
  node_count?: unknown;
}

export interface DatabaseTenantSyncSnapshotSessionStoreOptions {
  readonly runtime: DatabaseRuntime;
  readonly catalog: DatabaseOperationCatalog;
  /** Test seam for deterministic expiry. */
  readonly now?: () => number;
  /** Test-only lower bounds; production defaults remain hard protocol limits. */
  readonly limits?: Partial<DatabaseTenantSyncSnapshotSessionLimits>;
  /** @internal Deterministic statement-cleanup failure seam. */
  readonly finalizeStatement?: (statement: Statement) => void;
}

export interface DatabaseTenantSyncSnapshotSessionLimits {
  readonly maxSessions: number;
  readonly maxRows: number;
  readonly maxSourceBytes: number;
  readonly maxSourceRowBytes: number;
  readonly maxSourceRowNodes: number;
  readonly pageMaxRows: number;
  readonly pageMaxSourceBytes: number;
  readonly pageMaxNodes: number;
  readonly ttlMs: number;
}

/**
 * Epoch-shaped time for wire diagnostics, advanced by elapsed monotonic time.
 * Snapshot sessions are actor-local TEMP state, so one anchor is sufficient
 * for the store lifetime and wall-clock corrections cannot extend their TTL.
 */
export function createDatabaseTenantSyncSnapshotEpochClock(
  wallNow: () => number = Date.now,
  monotonicNow: () => number = () => performance.now(),
): () => number {
  const epochAnchor = wallNow();
  const monotonicAnchor = monotonicNow();
  return () => Math.floor(
    epochAnchor + (monotonicNow() - monotonicAnchor),
  );
}

/** One actor owns one store for the lifetime of its writer binding. */
export class DatabaseTenantSyncSnapshotSessionStore implements Disposable {
  readonly #runtime: DatabaseRuntime;
  readonly #catalog: DatabaseOperationCatalog;
  readonly #now: () => number;
  readonly #limits: DatabaseTenantSyncSnapshotSessionLimits;
  readonly #insertSession: Statement;
  readonly #insertRow: Statement;
  readonly #getSession: Statement;
  readonly #getPage: Statement;
  readonly #deleteRows: Statement;
  readonly #deleteSession: Statement;
  readonly #expiredSessions: Statement;
  readonly #activeStats: Statement;
  readonly #statements: readonly Statement[];
  readonly #finalizeStatement: (statement: Statement) => void;
  readonly #finalizedStatements = new Set<Statement>();
  #contentsCleared = false;
  #closing = false;
  #closed = false;

  constructor(options: DatabaseTenantSyncSnapshotSessionStoreOptions) {
    this.#runtime = options.runtime;
    this.#catalog = options.catalog;
    this.#now = options.now ?? createDatabaseTenantSyncSnapshotEpochClock();
    this.#limits = normalizeLimits(options.limits);
    this.#finalizeStatement = options.finalizeStatement
      ?? ((statement) => statement.finalize());
    initializeSchema(this.#runtime);
    const statements: Statement[] = [];
    try {
      this.#insertSession = prepare(this.#runtime, statements, `
        INSERT INTO temp.${SESSION_TABLE} (
          session_id, owner_token, generation, table_selection_json,
          sync_epoch, head_seq, created_at, expires_at,
          total_rows, total_source_bytes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      this.#insertRow = prepare(this.#runtime, statements, `
        INSERT INTO temp.${ROW_TABLE} (
          session_id, ordinal, table_index, row_id,
          row_json, source_bytes, node_count
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      this.#getSession = prepare(this.#runtime, statements, `
        SELECT
          session_id, owner_token, generation, table_selection_json,
          sync_epoch, head_seq, created_at, expires_at,
          total_rows, total_source_bytes
        FROM temp.${SESSION_TABLE}
        WHERE session_id = ?
      `);
      this.#getPage = prepare(this.#runtime, statements, `
        SELECT ordinal, table_index, row_id, row_json, source_bytes, node_count
        FROM temp.${ROW_TABLE}
        WHERE session_id = ? AND ordinal >= ?
        ORDER BY ordinal ASC
        LIMIT ?
      `);
      this.#deleteRows = prepare(this.#runtime, statements, `
        DELETE FROM temp.${ROW_TABLE} WHERE session_id = ?
      `);
      this.#deleteSession = prepare(this.#runtime, statements, `
        DELETE FROM temp.${SESSION_TABLE} WHERE session_id = ?
      `);
      this.#expiredSessions = prepare(this.#runtime, statements, `
        SELECT session_id FROM temp.${SESSION_TABLE}
        WHERE expires_at <= ?
        ORDER BY expires_at ASC
      `);
      this.#activeStats = prepare(this.#runtime, statements, `
        SELECT
          COUNT(*) AS session_count,
          COALESCE(SUM(total_source_bytes), 0) AS source_bytes
        FROM temp.${SESSION_TABLE}
      `);
    } catch (cause) {
      const cleanupFailures = finalizeAll(
        statements,
        this.#finalizeStatement,
      );
      if (cleanupFailures.length > 0) {
        throw new DatabaseError(
          'DATABASE_EXECUTOR_FAILED',
          'Database tenant snapshot-session statement cleanup failed.',
          {
            cause: new AggregateError(
              [cause, ...cleanupFailures],
              'Database tenant snapshot-session preparation and cleanup failed.',
            ),
            retryable: false,
            outcome: 'unknown',
          },
        );
      }
      throw schemaMismatch(cause);
    }
    this.#statements = Object.freeze([...statements]);
  }

  begin(
    payload: DatabaseActorTenantSyncSnapshotBeginPayload,
  ): DatabaseActorTenantSyncSnapshotBeginResult {
    this.#assertOpen();
    const createdAt = this.#now();
    const expiresAt = createdAt + this.#limits.ttlMs;
    if (!Number.isSafeInteger(createdAt)
      || createdAt < 0
      || !Number.isSafeInteger(expiresAt)) {
      throw snapshotLimit('deadline');
    }
    this.#cleanupExpired(createdAt);
    const active = this.#readActiveStats();
    if (active.sessionCount >= this.#limits.maxSessions) {
      throw snapshotCapacity();
    }

    const sessionId = crypto.randomUUID().toLowerCase();
    const tableSelectionJson = JSON.stringify(payload.tables);
    try {
      const materialized = this.#runtime.db.readAtCurrentSequence(() => {
        let totalRows = 0;
        let totalSourceBytes = 0;
        for (let tableIndex = 0; tableIndex < payload.tables.length; tableIndex += 1) {
          const table = payload.tables[tableIndex]!;
          const columns = this.#catalog.columns?.[table];
          const primaryKey = this.#catalog.primaryKeys?.[table];
          if (!columns?.length || !primaryKey) throw schemaMismatch();
          const statement = this.#runtime.db.prepare(
            `SELECT ${columns.map(quoteSqlIdentifier).join(', ')} `
            + `FROM main.${quoteSqlIdentifier(table)} `
            + `ORDER BY ${quoteSqlIdentifier(primaryKey)} COLLATE BINARY ASC`,
          );
          try {
            for (const candidate of statement.iterate() as Iterable<unknown>) {
              if (this.#now() >= expiresAt) throw snapshotExpired('deadline');
              let candidateJson: string | undefined;
              try {
                candidateJson = JSON.stringify(candidate);
              } catch {
                throw schemaMismatch();
              }
              if (candidateJson === undefined) throw schemaMismatch();
              if (textEncoder.encode(candidateJson).byteLength
                > this.#limits.maxSourceRowBytes) {
                throw snapshotLimit('row-bytes');
              }
              const row = normalizeSourceRow(candidate, columns);
              const rowId = canonicalRowId(row[primaryKey]);
              if (rowId === null) throw schemaMismatch();
              const rowJson = JSON.stringify(row);
              if (typeof rowJson !== 'string') throw schemaMismatch();
              const sourceBytes = textEncoder.encode(rowJson).byteLength;
              if (sourceBytes > this.#limits.maxSourceRowBytes) {
                throw snapshotLimit('row-bytes');
              }
              const nodeCount = countSerializableNodes(row);
              if (nodeCount > this.#limits.maxSourceRowNodes) {
                throw snapshotLimit('row-nodes');
              }
              totalRows += 1;
              totalSourceBytes += sourceBytes;
              if (!Number.isSafeInteger(totalRows)
                || totalRows > this.#limits.maxRows) {
                throw snapshotLimit('rows');
              }
              if (!Number.isSafeInteger(totalSourceBytes)
                || totalSourceBytes > this.#limits.maxSourceBytes) {
                throw snapshotLimit('bytes');
              }
              if (active.sourceBytes + totalSourceBytes
                > this.#limits.maxSourceBytes) {
                throw snapshotCapacity('bytes');
              }
              if (this.#insertRow.run(
                sessionId,
                totalRows - 1,
                tableIndex,
                rowId,
                rowJson,
                sourceBytes,
                nodeCount,
              ).changes !== 1) throw schemaMismatch();
            }
          } finally {
            statement.finalize();
          }
        }
        if (this.#now() >= expiresAt) throw snapshotExpired('deadline');
        if (this.#insertSession.run(
          sessionId,
          payload.ownerToken,
          payload.generation,
          tableSelectionJson,
          this.#runtime.db.syncEpoch,
          this.#runtime.db.currentSeq,
          createdAt,
          expiresAt,
          totalRows,
          totalSourceBytes,
        ).changes !== 1) throw schemaMismatch();
        return { totalRows, totalSourceBytes };
      });
      const result = {
        sessionId,
        syncEpoch: this.#runtime.db.syncEpoch,
        sequence: createDatabaseSequenceToken(materialized.seq),
        tables: payload.tables,
        totalRows: materialized.value.totalRows,
        totalSourceBytes: materialized.value.totalSourceBytes,
        expiresAt,
      };
      return validateDatabaseActorTenantSyncSnapshotBeginResult(
        result,
        payload.tables,
        this.#catalog,
      );
    } catch (cause) {
      if (cause instanceof DatabaseError) throw cause;
      throw new DatabaseError(
        'DATABASE_EXECUTOR_FAILED',
        'Database tenant snapshot materialization failed.',
        { retryable: false, outcome: null, cause },
      );
    }
  }

  page(
    payload: DatabaseActorTenantSyncSnapshotPagePayload,
  ): DatabaseActorTenantSyncSnapshotPageResult {
    this.#assertOpen();
    const session = this.#requireSession(payload);
    if (payload.cursor > session.total_rows) throw snapshotExpired('cursor');
    const candidates = this.#getPage.all(
      payload.sessionId,
      payload.cursor,
      this.#limits.pageMaxRows + 1,
    ) as StoredPageRow[];
    const rows: DatabaseActorTenantSyncSnapshotPageRow[] = [];
    let pageBytes = 0;
    let pageNodes = 4;
    for (const candidate of candidates) {
      const stored = validateStoredPageRow(candidate, payload.cursor + rows.length);
      if (rows.length >= this.#limits.pageMaxRows
        || pageBytes + stored.sourceBytes
          > this.#limits.pageMaxSourceBytes
        || pageNodes + stored.nodeCount + 5
          > this.#limits.pageMaxNodes) break;
      let row: DatabaseOperationRow;
      try {
        const table = payload.tables[stored.tableIndex];
        const columns = table === undefined
          ? undefined
          : this.#catalog.columns?.[table];
        const primaryKey = table === undefined
          ? undefined
          : this.#catalog.primaryKeys?.[table];
        if (!columns?.length || !primaryKey) throw schemaMismatch();
        row = normalizeSourceRow(
          JSON.parse(stored.rowJson),
          columns,
        );
        if (canonicalRowId(row[primaryKey]) !== stored.rowId
          || countSerializableNodes(row) !== stored.nodeCount) {
          throw schemaMismatch();
        }
      } catch (cause) {
        if (cause instanceof DatabaseError) throw cause;
        throw schemaMismatch(cause);
      }
      if (textEncoder.encode(JSON.stringify(row)).byteLength !== stored.sourceBytes) {
        throw schemaMismatch();
      }
      rows.push(Object.freeze({
        ordinal: stored.ordinal,
        tableIndex: stored.tableIndex,
        rowId: stored.rowId,
        row,
      }));
      pageBytes += stored.sourceBytes;
      pageNodes += stored.nodeCount + 5;
    }
    if (this.#now() >= session.expires_at) {
      this.#deleteSessionRows(payload.sessionId);
      throw snapshotExpired('deadline');
    }
    const next = payload.cursor + rows.length;
    const result = {
      sessionId: payload.sessionId,
      cursor: payload.cursor,
      rows: Object.freeze(rows),
      nextCursor: next === session.total_rows ? null : next,
    };
    return validateDatabaseActorTenantSyncSnapshotPageResult(result, {
      sessionId: payload.sessionId,
      cursor: payload.cursor,
      totalRows: session.total_rows,
      tables: payload.tables,
    }, this.#catalog);
  }

  abort(
    payload: DatabaseActorTenantSyncSnapshotAbortPayload,
  ): DatabaseActorTenantSyncSnapshotAbortResult {
    this.#assertOpen();
    const candidate = this.#getSession.get(payload.sessionId) as StoredSessionRow | null;
    if (!candidate) {
      return validateDatabaseActorTenantSyncSnapshotAbortResult({ aborted: false });
    }
    const session = validateStoredSession(candidate);
    this.#assertSessionIdentity(session, payload);
    this.#deleteSessionRows(payload.sessionId);
    return validateDatabaseActorTenantSyncSnapshotAbortResult({ aborted: true });
  }

  close(): void {
    if (this.#closed) return;
    this.#closing = true;
    const failures: unknown[] = [];
    if (!this.#contentsCleared) {
      try {
        this.#runtime.db.transaction(() => {
          this.#runtime.sqlite.raw.run(`DELETE FROM temp.${ROW_TABLE}`);
          this.#runtime.sqlite.raw.run(`DELETE FROM temp.${SESSION_TABLE}`);
        });
        this.#contentsCleared = true;
      } catch (error) {
        failures.push(error);
      }
    }
    if (this.#contentsCleared) {
      failures.push(...finalizeRemaining(
        this.#statements,
        this.#finalizedStatements,
        this.#finalizeStatement,
      ));
    }
    if (failures.length > 0) {
      throw new AggregateError(
        failures,
        'Database tenant snapshot sessions failed to close.',
      );
    }
    this.#closed = true;
  }

  [Symbol.dispose](): void {
    this.close();
  }

  #requireSession(
    payload: DatabaseActorTenantSyncSnapshotPagePayload,
  ): ReturnType<typeof validateStoredSession> {
    const candidate = this.#getSession.get(payload.sessionId) as StoredSessionRow | null;
    if (!candidate) throw snapshotExpired('missing');
    const session = validateStoredSession(candidate);
    this.#assertSessionIdentity(session, payload);
    if (this.#now() >= session.expires_at) {
      this.#deleteSessionRows(payload.sessionId);
      throw snapshotExpired('deadline');
    }
    return session;
  }

  #assertSessionIdentity(
    session: ReturnType<typeof validateStoredSession>,
    payload: DatabaseActorTenantSyncSnapshotAbortPayload,
  ): void {
    let tables: unknown;
    try {
      tables = JSON.parse(session.table_selection_json);
    } catch (cause) {
      throw schemaMismatch(cause);
    }
    if (session.owner_token !== payload.ownerToken
      || session.generation !== payload.generation
      || !Array.isArray(tables)
      || !sameDatabaseTenantSyncTables(tables, payload.tables)) {
      throw new DatabaseError(
        'DATABASE_AUTHORITY_CHANGED',
        'Database tenant snapshot-session capability changed.',
        { retryable: false, outcome: null },
      );
    }
  }

  #cleanupExpired(now: number): void {
    const rows = this.#expiredSessions.all(now) as Array<{ session_id?: unknown }>;
    for (const row of rows) {
      if (typeof row.session_id !== 'string') throw schemaMismatch();
      this.#deleteSessionRows(row.session_id);
    }
  }

  #deleteSessionRows(sessionId: string): void {
    this.#runtime.db.transaction(() => {
      this.#deleteRows.run(sessionId);
      this.#deleteSession.run(sessionId);
    });
  }

  #readActiveStats(): { readonly sessionCount: number; readonly sourceBytes: number } {
    const row = this.#activeStats.get() as {
      session_count?: unknown;
      source_bytes?: unknown;
    } | null;
    if (!isSafeCount(row?.session_count)
      || !isSafeCount(row?.source_bytes)
      || row.session_count > DATABASE_TENANT_SYNC_SNAPSHOT_MAX_SESSIONS
      || row.source_bytes > DATABASE_TENANT_SYNC_SNAPSHOT_MAX_SOURCE_BYTES) {
      throw schemaMismatch();
    }
    return Object.freeze({
      sessionCount: row.session_count,
      sourceBytes: row.source_bytes,
    });
  }

  #assertOpen(): void {
    if (this.#closing || this.#closed || this.#runtime.diagnostics().closed) {
      throw new DatabaseError(
        'DATABASE_CLOSED',
        'Database tenant snapshot-session store is closed.',
      );
    }
  }
}

function initializeSchema(runtime: DatabaseRuntime): void {
  try {
    runtime.db.transaction(() => {
      if (readTempSchema(runtime, SESSION_TABLE) === null) {
        runtime.sqlite.raw.run(SESSION_CREATE_SQL);
      }
      const session = readTempSchema(runtime, SESSION_TABLE);
      if (!session
        || session.type !== 'table'
        || !session.sql
        || normalizeSql(session.sql) !== normalizeSql(SESSION_STORED_SQL)) {
        throw new Error('snapshot session table differs');
      }
      if (readTempSchema(runtime, ROW_TABLE) === null) {
        runtime.sqlite.raw.run(ROW_CREATE_SQL);
      }
      const rows = readTempSchema(runtime, ROW_TABLE);
      if (!rows
        || rows.type !== 'table'
        || !rows.sql
        || normalizeSql(rows.sql) !== normalizeSql(ROW_STORED_SQL)) {
        throw new Error('snapshot row table differs');
      }
      if (readTempSchema(runtime, SESSION_INSERT_GUARD) === null) {
        runtime.sqlite.raw.run(SESSION_INSERT_GUARD_SQL);
      }
      const guard = readTempSchema(runtime, SESSION_INSERT_GUARD);
      if (!guard
        || guard.type !== 'trigger'
        || !guard.sql
        || normalizeSql(guard.sql)
          !== normalizeSql(SESSION_INSERT_GUARD_STORED_SQL)) {
        throw new Error('snapshot session guard differs');
      }
    });
  } catch (cause) {
    throw schemaMismatch(cause);
  }
}

function readTempSchema(
  runtime: DatabaseRuntime,
  name: string,
): { readonly type: string; readonly sql: string | null } | null {
  const statement = runtime.sqlite.raw.prepare(
    'SELECT type, sql FROM temp.sqlite_schema WHERE name = ?',
  );
  try {
    return statement.get(name) as {
      readonly type: string;
      readonly sql: string | null;
    } | null;
  } finally {
    statement.finalize();
  }
}

function validateStoredSession(row: StoredSessionRow): Readonly<{
  session_id: string;
  owner_token: string;
  generation: number;
  table_selection_json: string;
  expires_at: number;
  total_rows: number;
}> {
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
    throw schemaMismatch();
  }
  return Object.freeze(row as {
    session_id: string;
    owner_token: string;
    generation: number;
    table_selection_json: string;
    expires_at: number;
    total_rows: number;
  });
}

function validateStoredPageRow(
  row: StoredPageRow,
  expectedOrdinal: number,
): Readonly<{
  ordinal: number;
  tableIndex: number;
  rowId: string;
  rowJson: string;
  sourceBytes: number;
  nodeCount: number;
}> {
  const rowId = canonicalRowId(row.row_id);
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
    throw schemaMismatch();
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

function normalizeSourceRow(
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
    throw schemaMismatch(cause);
  }
}

function canonicalRowId(value: unknown): string | null {
  if (typeof value !== 'string'
    && (typeof value !== 'number' || !Number.isSafeInteger(value))) return null;
  const result = String(value);
  return result.length > 0
    && textEncoder.encode(result).byteLength <= DATABASE_OPERATION_MAX_ID_BYTES
    ? result
    : null;
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

function prepare(
  runtime: DatabaseRuntime,
  statements: Statement[],
  sql: string,
): Statement {
  const statement = runtime.sqlite.raw.prepare(sql);
  statements.push(statement);
  return statement;
}

function finalizeAll(
  statements: readonly Statement[],
  finalizeStatement: (statement: Statement) => void = (statement) => statement.finalize(),
): unknown[] {
  const failures: unknown[] = [];
  for (const statement of statements) {
    try { finalizeStatement(statement); } catch (error) { failures.push(error); }
  }
  return failures;
}

function finalizeRemaining(
  statements: readonly Statement[],
  finalized: Set<Statement>,
  finalizeStatement: (statement: Statement) => void,
): unknown[] {
  const failures: unknown[] = [];
  for (const statement of statements) {
    if (finalized.has(statement)) continue;
    try {
      finalizeStatement(statement);
      finalized.add(statement);
    } catch (error) {
      failures.push(error);
    }
  }
  return failures;
}

function normalizeLimits(
  value: Partial<DatabaseTenantSyncSnapshotSessionLimits> | undefined,
): DatabaseTenantSyncSnapshotSessionLimits {
  const limits = {
    maxSessions: value?.maxSessions
      ?? DATABASE_TENANT_SYNC_SNAPSHOT_MAX_SESSIONS,
    maxRows: value?.maxRows ?? DATABASE_TENANT_SYNC_SNAPSHOT_MAX_ROWS,
    maxSourceBytes: value?.maxSourceBytes
      ?? DATABASE_TENANT_SYNC_SNAPSHOT_MAX_SOURCE_BYTES,
    maxSourceRowBytes: value?.maxSourceRowBytes
      ?? DATABASE_TENANT_SYNC_SNAPSHOT_MAX_SOURCE_ROW_BYTES,
    maxSourceRowNodes: value?.maxSourceRowNodes
      ?? DATABASE_TENANT_SYNC_SNAPSHOT_MAX_SOURCE_ROW_NODES,
    pageMaxRows: value?.pageMaxRows
      ?? DATABASE_TENANT_SYNC_SNAPSHOT_PAGE_MAX_ROWS,
    pageMaxSourceBytes: value?.pageMaxSourceBytes
      ?? DATABASE_TENANT_SYNC_SNAPSHOT_PAGE_MAX_SOURCE_BYTES,
    pageMaxNodes: value?.pageMaxNodes
      ?? DATABASE_TENANT_SYNC_SNAPSHOT_PAGE_MAX_NODES,
    ttlMs: value?.ttlMs ?? DATABASE_TENANT_SYNC_SNAPSHOT_TTL_MS,
  };
  const maxima: DatabaseTenantSyncSnapshotSessionLimits = {
    maxSessions: DATABASE_TENANT_SYNC_SNAPSHOT_MAX_SESSIONS,
    maxRows: DATABASE_TENANT_SYNC_SNAPSHOT_MAX_ROWS,
    maxSourceBytes: DATABASE_TENANT_SYNC_SNAPSHOT_MAX_SOURCE_BYTES,
    maxSourceRowBytes: DATABASE_TENANT_SYNC_SNAPSHOT_MAX_SOURCE_ROW_BYTES,
    maxSourceRowNodes: DATABASE_TENANT_SYNC_SNAPSHOT_MAX_SOURCE_ROW_NODES,
    pageMaxRows: DATABASE_TENANT_SYNC_SNAPSHOT_PAGE_MAX_ROWS,
    pageMaxSourceBytes: DATABASE_TENANT_SYNC_SNAPSHOT_PAGE_MAX_SOURCE_BYTES,
    pageMaxNodes: DATABASE_TENANT_SYNC_SNAPSHOT_PAGE_MAX_NODES,
    ttlMs: DATABASE_TENANT_SYNC_SNAPSHOT_TTL_MS,
  };
  for (const key of Object.keys(maxima) as Array<keyof typeof maxima>) {
    if (!Number.isSafeInteger(limits[key])
      || limits[key] < 1
      || limits[key] > maxima[key]) {
      throw new TypeError('Database tenant snapshot-session limits are invalid.');
    }
  }
  if (limits.maxSourceRowBytes > limits.maxSourceBytes
    || limits.pageMaxSourceBytes < limits.maxSourceRowBytes
    || limits.pageMaxNodes < limits.maxSourceRowNodes + 5) {
    throw new TypeError('Database tenant snapshot-session limits are inconsistent.');
  }
  return Object.freeze(limits);
}

function normalizeSql(sql: string): string {
  return sql.trim().replace(/\s+/gu, ' ').replace(/\s*,\s*/gu, ', ').toLowerCase();
}

function isSafeCount(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

type SnapshotLimitReason =
  | 'bytes'
  | 'cursor'
  | 'deadline'
  | 'missing'
  | 'row-bytes'
  | 'row-nodes'
  | 'rows'
  | 'sessions';

function snapshotCapacity(
  reason: 'bytes' | 'sessions' = 'sessions',
): DatabaseError {
  return new DatabaseError(
    'DATABASE_BACKPRESSURE',
    'Database tenant snapshot-session capacity is exhausted.',
    {
      retryable: true,
      outcome: 'not-started',
      details: { snapshotReason: reason },
    },
  );
}

function snapshotLimit(reason: SnapshotLimitReason): DatabaseError {
  return new DatabaseError(
    'DATABASE_PAYLOAD_LIMIT',
    'Database tenant snapshot exceeds its bounded source contract.',
    { retryable: false, outcome: null, details: { snapshotReason: reason } },
  );
}

function snapshotExpired(reason: SnapshotLimitReason): DatabaseError {
  return new DatabaseError(
    'DATABASE_TRANSACTION_EXPIRED',
    'Database tenant snapshot session expired.',
    { retryable: false, outcome: null, details: { snapshotReason: reason } },
  );
}

function schemaMismatch(cause?: unknown): DatabaseError {
  return new DatabaseError(
    'DATABASE_SCHEMA_MISMATCH',
    'Database tenant snapshot-session state is incompatible.',
    cause === undefined ? undefined : { cause },
  );
}

const textEncoder = new TextEncoder();
