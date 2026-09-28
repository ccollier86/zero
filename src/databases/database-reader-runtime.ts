/**
 * database-reader-runtime.ts
 *
 * Owns one readonly WAL connection inside a reader actor. Every operation
 * reads the durable ReactiveDB cursor first, then application rows, in the
 * same deferred SQLite snapshot.
 */

import { Database, type Statement } from 'bun:sqlite';
import { lstatSync, realpathSync } from 'node:fs';

import { quoteSqlIdentifier } from '../sync/identity';
import { DatabaseError } from './database-error';
import {
  cloneDatabaseSerializableValue,
  createDatabaseSequenceToken,
  validateDatabaseOperation,
  validateDatabaseReadResult,
  type DatabaseListOperation,
  type DatabaseOperation,
  type DatabaseOperationCatalog,
  type DatabaseOperationRow,
  type DatabaseReadOperation,
  type DatabaseReadResult,
  type DatabaseSerializableValue,
} from './database-operations';
import {
  createDatabaseRealmOperationCatalog,
  runDatabaseRealmQuery,
  type DatabaseRealm,
} from './database-realm';

const DEFAULT_READER_BUSY_TIMEOUT_MS = 5_000;

interface ChangeLogStateRow {
  readonly seq: number;
}

interface TableInfoRow {
  readonly name: string;
  readonly pk: number;
}

export interface DatabaseReaderRuntimeOptions {
  /** Canonical prepared file path supplied only by the trusted actor binder. */
  readonly filePath: string;
  /** Actor-local realm imported from the application server entry. */
  readonly realm: DatabaseRealm;
  readonly busyTimeoutMs?: number;
}

export interface DatabaseReaderRuntimeDiagnostics {
  readonly state: 'ready' | 'closed';
  readonly schemaVersion: number;
  readonly realmFingerprint: string;
}

/** Readonly, query-only runtime for snapshot and read-your-writes operations. */
export class DatabaseReaderRuntime {
  readonly realm: DatabaseRealm;

  private readonly database: Database;
  private readonly catalog: DatabaseOperationCatalog;
  private readonly currentSequenceStatement: Statement;
  private readonly schemaVersion: number;
  private closed = false;

  private constructor(
    database: Database,
    realm: DatabaseRealm,
    catalog: DatabaseOperationCatalog,
    currentSequenceStatement: Statement,
    schemaVersion: number,
  ) {
    this.database = database;
    this.realm = realm;
    this.catalog = catalog;
    this.currentSequenceStatement = currentSequenceStatement;
    this.schemaVersion = schemaVersion;
  }

  /** Open and verify one existing writer-prepared file without mutating it. */
  static open(options: DatabaseReaderRuntimeOptions): DatabaseReaderRuntime {
    const busyTimeoutMs = normalizePositiveSafeInteger(
      options.busyTimeoutMs ?? DEFAULT_READER_BUSY_TIMEOUT_MS,
      'busyTimeoutMs',
    );
    assertRegularCanonicalFile(options.filePath);

    let database: Database | null = null;
    let currentSequenceStatement: Statement | null = null;
    let phase = 'open';
    try {
      database = new Database(options.filePath, {
        readonly: true,
        strict: true,
      });
      phase = 'configure';
      database.run(`PRAGMA busy_timeout = ${busyTimeoutMs}`);
      database.run('PRAGMA query_only = ON');
      phase = 'schema';
      assertRealmSchema(database, options.realm);
      phase = 'sequence';
      currentSequenceStatement = database.prepare(`
        SELECT seq
        FROM main._zero_sync_log_state
        WHERE singleton = 1
      `);
      const sequence = readSequence(currentSequenceStatement);
      void sequence;
      phase = 'schema-version';
      const schemaVersion = readSchemaVersion(database);
      return new DatabaseReaderRuntime(
        database,
        options.realm,
        createDatabaseRealmOperationCatalog(options.realm),
        currentSequenceStatement,
        schemaVersion,
      );
    } catch (error) {
      try { currentSequenceStatement?.finalize(); } catch { /* Best-effort startup cleanup. */ }
      try { database?.close(); } catch { /* Preserve the safe open failure. */ }
      if (error instanceof DatabaseError) throw error;
      throw new DatabaseError(
        'DATABASE_OPEN_FAILED',
        'Readonly database actor could not open the database.',
        {
          cause: error,
          details: {
            phase,
            ...safeSQLiteErrorCode(error),
          },
        },
      );
    }
  }

  /** Execute one validated read in a single deferred SQLite snapshot. */
  execute(value: unknown): DatabaseReadResult {
    this.assertOpen();
    const operation = validateDatabaseOperation(value, this.catalog);
    if (!isReadOperation(operation)) {
      throw new DatabaseError(
        'DATABASE_OPERATION_UNSUPPORTED',
        'Readonly database actors do not execute mutations.',
      );
    }
    if (operation.consistency?.mode === 'strong') {
      throw new DatabaseError(
        'DATABASE_OPERATION_UNSUPPORTED',
        'Strong reads must execute through the database writer lane.',
      );
    }

    try {
      return this.database.transaction(() => {
        // This first SELECT establishes the WAL snapshot represented by every
        // application row read below.
        const seq = readSequence(this.currentSequenceStatement);
        if (operation.consistency?.mode === 'read-your-writes'
          && seq < operation.consistency.minSeq.seq) {
          throw new DatabaseError(
            'DATABASE_TRANSACTION_STALE',
            'Readonly database snapshot has not reached the required sequence.',
            {
              retryable: true,
              outcome: 'not-started',
              details: {
                currentSeq: seq,
                requiredSeq: operation.consistency.minSeq.seq,
              },
            },
          );
        }

        const result = {
          value: this.executeAtSnapshot(operation),
          sequence: createDatabaseSequenceToken(seq),
        };
        try {
          return validateDatabaseReadResult(result);
        } catch (error) {
          if (error instanceof DatabaseError
            && (error.code === 'DATABASE_PAYLOAD_INVALID'
              || error.code === 'DATABASE_PAYLOAD_LIMIT')) {
            throw new DatabaseError(
              'DATABASE_RESULT_LIMIT',
              'Database read result is outside the supported result contract.',
              { outcome: null, cause: error },
            );
          }
          throw error;
        }
      }).deferred();
    } catch (error) {
      if (error instanceof DatabaseError) throw error;
      throw new DatabaseError(
        'DATABASE_EXECUTOR_FAILED',
        'Readonly database operation failed.',
        { outcome: null, cause: error },
      );
    }
  }

  close(): void {
    if (this.closed) return;
    try {
      this.currentSequenceStatement.finalize();
    } finally {
      this.database.close();
      this.closed = true;
    }
  }

  /** Read the durable head used by the actor's bind-readiness proof. */
  get currentSeq(): number {
    this.assertOpen();
    return readSequence(this.currentSequenceStatement);
  }

  diagnostics(): DatabaseReaderRuntimeDiagnostics {
    return Object.freeze({
      state: this.closed ? 'closed' : 'ready',
      schemaVersion: this.schemaVersion,
      realmFingerprint: this.realm.fingerprint,
    });
  }

  private executeAtSnapshot(
    operation: DatabaseReadOperation,
  ): DatabaseSerializableValue {
    switch (operation.type) {
      case 'get':
        return this.get(operation.table, operation.id);
      case 'list':
        return this.list(operation);
      case 'query':
        return runDatabaseRealmQuery(
          this.realm,
          { database: this.database },
          operation.name,
          operation.input,
        );
    }
  }

  private get(table: string, id: string): DatabaseOperationRow | null {
    const primaryKey = this.requirePrimaryKey(table);
    const statement = this.database.prepare(
      `SELECT * FROM main.${quoteSqlIdentifier(table)} ` +
      `WHERE ${quoteSqlIdentifier(primaryKey)} = ? LIMIT 1`,
    );
    try {
      const row = statement.get(id);
      return row == null
        ? null
        : cloneDatabaseSerializableValue(row) as DatabaseOperationRow;
    } finally {
      statement.finalize();
    }
  }

  private list(operation: DatabaseListOperation): DatabaseSerializableValue {
    const primaryKey = this.requirePrimaryKey(operation.table);
    const quotedPrimaryKey = quoteSqlIdentifier(primaryKey);
    const statement = this.database.prepare(
      `SELECT * FROM main.${quoteSqlIdentifier(operation.table)} ` +
      (operation.after === undefined
        ? ''
        : `WHERE ${quotedPrimaryKey} COLLATE BINARY > ? `) +
      `ORDER BY ${quotedPrimaryKey} COLLATE BINARY ASC LIMIT ?`,
    );
    try {
      const values = operation.after === undefined
        ? [operation.limit + 1]
        : [operation.after, operation.limit + 1];
      const fetched = statement.all(...values) as Record<string, unknown>[];
      const hasNext = fetched.length > operation.limit;
      const pageRows = hasNext ? fetched.slice(0, operation.limit) : fetched;
      const rows = cloneDatabaseSerializableValue(pageRows) as readonly DatabaseOperationRow[];
      const last = pageRows.at(-1);
      const cursorValue = last?.[primaryKey];
      if (hasNext && (cursorValue === null || cursorValue === undefined)) {
        throw new DatabaseError(
          'DATABASE_SCHEMA_MISMATCH',
          'Database list row is missing its declared primary key.',
        );
      }
      return Object.freeze({
        rows,
        nextCursor: hasNext ? String(cursorValue) : null,
      });
    } finally {
      statement.finalize();
    }
  }

  private requirePrimaryKey(table: string): string {
    const primaryKey = this.catalog.primaryKeys?.[table];
    if (!primaryKey) {
      throw new DatabaseError(
        'DATABASE_SCHEMA_MISMATCH',
        'Database realm table has no usable primary key.',
      );
    }
    return primaryKey;
  }

  private assertOpen(): void {
    if (this.closed) {
      throw new DatabaseError(
        'DATABASE_CLOSED',
        'Readonly database actor is closed.',
      );
    }
  }
}

function safeSQLiteErrorCode(error: unknown): { sqliteCode?: string } {
  if (!error || typeof error !== 'object') return {};
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' && /^SQLITE_[A-Z0-9_]{1,64}$/u.test(code)
    ? { sqliteCode: code }
    : {};
}

function isReadOperation(
  operation: DatabaseOperation,
): operation is DatabaseReadOperation {
  return operation.type === 'get'
    || operation.type === 'list'
    || operation.type === 'query';
}

function assertRegularCanonicalFile(filePath: string): void {
  try {
    const details = lstatSync(filePath);
    if (details.isSymbolicLink()
      || !details.isFile()
      || realpathSync.native(filePath) !== filePath) {
      throw new Error('Unsafe database file');
    }
  } catch (error) {
    throw new DatabaseError(
      'DATABASE_OPEN_FAILED',
      'Readonly database actor could not verify the database file.',
      { cause: error },
    );
  }
}

function assertRealmSchema(database: Database, realm: DatabaseRealm): void {
  for (const [table, schema] of Object.entries(realm.tables)) {
    const rows = database
      .prepare(`PRAGMA main.table_info(${quoteSqlIdentifier(table)})`)
      .all() as TableInfoRow[];
    const expectedColumns = Object.keys(schema).filter((key) => key !== '_identity');
    const actualColumns = rows.map((row) => row.name);
    const expectedPrimaryKey = expectedColumns.find((column) => {
      const definition = schema[column];
      return typeof definition === 'string' && /\bprimary\s+key\b/iu.test(definition);
    });
    const actualPrimaryKeys = rows
      .filter((row) => row.pk > 0)
      .sort((left, right) => left.pk - right.pk)
      .map((row) => row.name);
    if (actualColumns.length !== expectedColumns.length
      || actualColumns.some((column, index) => column !== expectedColumns[index])
      || actualPrimaryKeys.length !== 1
      || actualPrimaryKeys[0] !== expectedPrimaryKey) {
      throw new DatabaseError(
        'DATABASE_SCHEMA_MISMATCH',
        'Readonly database schema does not match its configured realm.',
      );
    }
  }
}

function readSequence(statement: Statement): number {
  const row = statement.get() as ChangeLogStateRow | null;
  if (!row || !Number.isSafeInteger(row.seq) || row.seq < 0) {
    throw new DatabaseError(
      'DATABASE_SCHEMA_MISMATCH',
      'Database durable sequence is unavailable.',
    );
  }
  return row.seq;
}

function readSchemaVersion(database: Database): number {
  const row = database.query('PRAGMA main.schema_version').get() as {
    schema_version?: unknown;
  } | null;
  if (!row || !Number.isSafeInteger(row.schema_version)
    || (row.schema_version as number) < 0) {
    throw new DatabaseError(
      'DATABASE_SCHEMA_MISMATCH',
      'Database schema generation is unavailable.',
    );
  }
  return row.schema_version as number;
}

function normalizePositiveSafeInteger(value: unknown, name: string): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    throw new DatabaseError(
      'DATABASE_CONFIG_INVALID',
      `Database reader ${name} must be a positive safe integer.`,
    );
  }
  return value as number;
}
