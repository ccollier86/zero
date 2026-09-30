/** SQLite TEMP schema and prepared-statement ownership for snapshot sessions. */

import type { Statement } from 'bun:sqlite';
import { DatabaseError } from './database-error';
import type { DatabaseRuntime } from './database-runtime';
import type {
  DatabaseTenantSyncStoredPageRow,
  DatabaseTenantSyncStoredSessionRow,
} from './database-tenant-sync-snapshot-codec';
import { databaseTenantSyncSnapshotSchemaMismatch } from './database-tenant-sync-snapshot-errors';
import {
  DATABASE_TENANT_SYNC_SNAPSHOT_MAX_ROWS,
  DATABASE_TENANT_SYNC_SNAPSHOT_MAX_SESSIONS,
  DATABASE_TENANT_SYNC_SNAPSHOT_MAX_SOURCE_BYTES,
  DATABASE_TENANT_SYNC_SNAPSHOT_MAX_SOURCE_ROW_BYTES,
  DATABASE_TENANT_SYNC_SNAPSHOT_MAX_SOURCE_ROW_NODES,
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

interface SnapshotStatements {
  readonly insertSession: Statement;
  readonly insertRow: Statement;
  readonly getSession: Statement;
  readonly getPage: Statement;
  readonly deleteRows: Statement;
  readonly deleteSession: Statement;
  readonly expiredSessions: Statement;
  readonly activeStats: Statement;
  readonly all: readonly Statement[];
}

export interface DatabaseTenantSyncSnapshotStoredRowInput {
  readonly sessionId: string;
  readonly ordinal: number;
  readonly tableIndex: number;
  readonly rowId: string;
  readonly rowJson: string;
  readonly sourceBytes: number;
  readonly nodeCount: number;
}

export interface DatabaseTenantSyncSnapshotStoredSessionInput {
  readonly sessionId: string;
  readonly ownerToken: string;
  readonly generation: number;
  readonly tableSelectionJson: string;
  readonly syncEpoch: string;
  readonly headSeq: number;
  readonly createdAt: number;
  readonly expiresAt: number;
  readonly totalRows: number;
  readonly totalSourceBytes: number;
}

export class DatabaseTenantSyncSnapshotStorage {
  readonly #runtime: DatabaseRuntime;
  readonly #prepared: SnapshotStatements;
  readonly #finalizeStatement: (statement: Statement) => void;
  readonly #finalizedStatements = new Set<Statement>();
  #contentsCleared = false;
  #closed = false;

  constructor(
    runtime: DatabaseRuntime,
    finalizeStatement: (statement: Statement) => void,
  ) {
    this.#runtime = runtime;
    this.#finalizeStatement = finalizeStatement;
    initializeSchema(runtime);
    this.#prepared = prepareStatements(runtime, finalizeStatement);
  }

  insertRow(input: DatabaseTenantSyncSnapshotStoredRowInput): void {
    if (this.#prepared.insertRow.run(
      input.sessionId,
      input.ordinal,
      input.tableIndex,
      input.rowId,
      input.rowJson,
      input.sourceBytes,
      input.nodeCount,
    ).changes !== 1) throw databaseTenantSyncSnapshotSchemaMismatch();
  }

  insertSession(input: DatabaseTenantSyncSnapshotStoredSessionInput): void {
    if (this.#prepared.insertSession.run(
      input.sessionId,
      input.ownerToken,
      input.generation,
      input.tableSelectionJson,
      input.syncEpoch,
      input.headSeq,
      input.createdAt,
      input.expiresAt,
      input.totalRows,
      input.totalSourceBytes,
    ).changes !== 1) throw databaseTenantSyncSnapshotSchemaMismatch();
  }

  getSession(sessionId: string): DatabaseTenantSyncStoredSessionRow | null {
    return this.#prepared.getSession.get(sessionId) as
      DatabaseTenantSyncStoredSessionRow | null;
  }

  getPage(
    sessionId: string,
    cursor: number,
    limit: number,
  ): DatabaseTenantSyncStoredPageRow[] {
    return this.#prepared.getPage.all(sessionId, cursor, limit) as
      DatabaseTenantSyncStoredPageRow[];
  }

  expiredSessionIds(now: number): readonly string[] {
    const rows = this.#prepared.expiredSessions.all(now) as
      Array<{ session_id?: unknown }>;
    return rows.map((row) => {
      if (typeof row.session_id !== 'string') {
        throw databaseTenantSyncSnapshotSchemaMismatch();
      }
      return row.session_id;
    });
  }

  deleteSessionRows(sessionId: string): void {
    this.#runTempTransaction(() => {
      this.#prepared.deleteRows.run(sessionId);
      this.#prepared.deleteSession.run(sessionId);
    });
  }

  readActiveStats(): {
    readonly sessionCount: number;
    readonly sourceBytes: number;
  } {
    const row = this.#prepared.activeStats.get() as {
      session_count?: unknown;
      source_bytes?: unknown;
    } | null;
    if (!isSafeCount(row?.session_count)
      || !isSafeCount(row?.source_bytes)
      || row.session_count > DATABASE_TENANT_SYNC_SNAPSHOT_MAX_SESSIONS
      || row.source_bytes > DATABASE_TENANT_SYNC_SNAPSHOT_MAX_SOURCE_BYTES) {
      throw databaseTenantSyncSnapshotSchemaMismatch();
    }
    return Object.freeze({
      sessionCount: row.session_count,
      sourceBytes: row.source_bytes,
    });
  }

  /** Retry-safe: successful clearing/finalization is never repeated. */
  close(): void {
    if (this.#closed) return;
    const failures: unknown[] = [];
    if (!this.#contentsCleared) {
      try {
        this.#runTempTransaction(() => {
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
        this.#prepared.all,
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

  /**
   * Snapshot sessions exist only in actor-local TEMP tables. Their lifecycle
   * must stay transactional, but it must not enter ReactiveDB's durable-main
   * commit guard: cleanup changes no application row or durable authority.
   */
  #runTempTransaction(operation: () => void): void {
    this.#runtime.sqlite.raw.transaction(operation).deferred();
  }
}

function initializeSchema(runtime: DatabaseRuntime): void {
  try {
    runtime.db.transaction(() => {
      ensureSchemaObject(
        runtime,
        SESSION_TABLE,
        'table',
        SESSION_CREATE_SQL,
        SESSION_STORED_SQL,
        'snapshot session table differs',
      );
      ensureSchemaObject(
        runtime,
        ROW_TABLE,
        'table',
        ROW_CREATE_SQL,
        ROW_STORED_SQL,
        'snapshot row table differs',
      );
      ensureSchemaObject(
        runtime,
        SESSION_INSERT_GUARD,
        'trigger',
        SESSION_INSERT_GUARD_SQL,
        SESSION_INSERT_GUARD_STORED_SQL,
        'snapshot session guard differs',
      );
    });
  } catch (cause) {
    throw databaseTenantSyncSnapshotSchemaMismatch(cause);
  }
}

function ensureSchemaObject(
  runtime: DatabaseRuntime,
  name: string,
  type: 'table' | 'trigger',
  createSql: string,
  storedSql: string,
  mismatchMessage: string,
): void {
  if (readTempSchema(runtime, name) === null) runtime.sqlite.raw.run(createSql);
  const stored = readTempSchema(runtime, name);
  if (!stored
    || stored.type !== type
    || !stored.sql
    || normalizeSql(stored.sql) !== normalizeSql(storedSql)) {
    throw new Error(mismatchMessage);
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

function prepareStatements(
  runtime: DatabaseRuntime,
  finalizeStatement: (statement: Statement) => void,
): SnapshotStatements {
  const statements: Statement[] = [];
  try {
    const prepared = {
      insertSession: prepare(runtime, statements, `
        INSERT INTO temp.${SESSION_TABLE} (
          session_id, owner_token, generation, table_selection_json,
          sync_epoch, head_seq, created_at, expires_at,
          total_rows, total_source_bytes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `),
      insertRow: prepare(runtime, statements, `
        INSERT INTO temp.${ROW_TABLE} (
          session_id, ordinal, table_index, row_id,
          row_json, source_bytes, node_count
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `),
      getSession: prepare(runtime, statements, `
        SELECT
          session_id, owner_token, generation, table_selection_json,
          sync_epoch, head_seq, created_at, expires_at,
          total_rows, total_source_bytes
        FROM temp.${SESSION_TABLE}
        WHERE session_id = ?
      `),
      getPage: prepare(runtime, statements, `
        SELECT ordinal, table_index, row_id, row_json, source_bytes, node_count
        FROM temp.${ROW_TABLE}
        WHERE session_id = ? AND ordinal >= ?
        ORDER BY ordinal ASC
        LIMIT ?
      `),
      deleteRows: prepare(runtime, statements, `
        DELETE FROM temp.${ROW_TABLE} WHERE session_id = ?
      `),
      deleteSession: prepare(runtime, statements, `
        DELETE FROM temp.${SESSION_TABLE} WHERE session_id = ?
      `),
      expiredSessions: prepare(runtime, statements, `
        SELECT session_id FROM temp.${SESSION_TABLE}
        WHERE expires_at <= ?
        ORDER BY expires_at ASC
      `),
      activeStats: prepare(runtime, statements, `
        SELECT
          COUNT(*) AS session_count,
          COALESCE(SUM(total_source_bytes), 0) AS source_bytes
        FROM temp.${SESSION_TABLE}
      `),
    };
    return Object.freeze({ ...prepared, all: Object.freeze([...statements]) });
  } catch (cause) {
    const cleanupFailures = finalizeAll(statements, finalizeStatement);
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
    throw databaseTenantSyncSnapshotSchemaMismatch(cause);
  }
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
  finalizeStatement: (statement: Statement) => void,
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

function normalizeSql(sql: string): string {
  return sql.trim().replace(/\s+/gu, ' ').replace(/\s*,\s*/gu, ', ').toLowerCase();
}

function isSafeCount(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}
