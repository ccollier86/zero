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
  readDatabaseBindingIdentity,
  type DatabaseBindingIdentity,
} from './database-binding-identity';
import type { DatabaseRef } from './database-file';
import { runDatabaseFind } from './database-find';
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
  /** Durable logical identity already admitted by the parent coordinator. */
  readonly databaseRef: DatabaseRef;
  readonly instanceId: string;
  readonly busyTimeoutMs?: number;
}

export interface DatabaseReaderRuntimeDiagnostics {
  readonly state: 'ready' | 'closed';
  readonly schemaVersion: number;
  readonly realmFingerprint: string;
}

/** @internal Deterministic handle-lifecycle seam; not package-exported. */
export interface DatabaseReaderRuntimeLifecycle {
  finalizeStatement(statement: Statement): void;
  closeDatabase(database: Database, throwOnError: boolean): void;
}

const PRODUCTION_READER_LIFECYCLE: DatabaseReaderRuntimeLifecycle = Object.freeze({
  finalizeStatement(statement: Statement) {
    statement.finalize();
  },
  closeDatabase(database: Database, throwOnError: boolean) {
    database.close(throwOnError);
  },
});

/** Readonly, query-only runtime for snapshot and read-your-writes operations. */
export class DatabaseReaderRuntime {
  readonly realm: DatabaseRealm;

  private readonly database: Database;
  private readonly catalog: DatabaseOperationCatalog;
  private readonly currentSequenceStatement: Statement;
  private readonly schemaVersion: number;
  private readonly lifecycle: DatabaseReaderRuntimeLifecycle;
  readonly bindingIdentity: DatabaseBindingIdentity;
  private sequenceStatementFinalized = false;
  private databaseClosed = false;
  private closed = false;

  private constructor(
    database: Database,
    realm: DatabaseRealm,
    catalog: DatabaseOperationCatalog,
    currentSequenceStatement: Statement,
    schemaVersion: number,
    bindingIdentity: DatabaseBindingIdentity,
    lifecycle: DatabaseReaderRuntimeLifecycle,
  ) {
    this.database = database;
    this.realm = realm;
    this.catalog = catalog;
    this.currentSequenceStatement = currentSequenceStatement;
    this.schemaVersion = schemaVersion;
    this.bindingIdentity = bindingIdentity;
    this.lifecycle = lifecycle;
  }

  /** Open and verify one existing writer-prepared file without mutating it. */
  static open(options: DatabaseReaderRuntimeOptions): DatabaseReaderRuntime {
    return DatabaseReaderRuntime.openWithLifecycle(
      options,
      PRODUCTION_READER_LIFECYCLE,
    );
  }

  /** @internal Deterministic cleanup-failure seam; not package-exported. */
  static openForTesting(
    options: DatabaseReaderRuntimeOptions,
    lifecycle: DatabaseReaderRuntimeLifecycle,
  ): DatabaseReaderRuntime {
    return DatabaseReaderRuntime.openWithLifecycle(options, lifecycle);
  }

  private static openWithLifecycle(
    options: DatabaseReaderRuntimeOptions,
    lifecycle: DatabaseReaderRuntimeLifecycle,
  ): DatabaseReaderRuntime {
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
      phase = 'identity';
      const bindingIdentity = readDatabaseBindingIdentity(
        database,
        options.databaseRef,
        options.realm.name,
      );
      if (bindingIdentity.instanceId !== options.instanceId) {
        throw new DatabaseError(
          'DATABASE_SCHEMA_MISMATCH',
          'Readonly database binding identity does not match.',
          { retryable: false, outcome: 'not-started' },
        );
      }
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
        bindingIdentity,
        lifecycle,
      );
    } catch (error) {
      const cleanupFailures: unknown[] = [];
      if (currentSequenceStatement) {
        try {
          lifecycle.finalizeStatement(currentSequenceStatement);
        } catch (cleanupError) {
          cleanupFailures.push(cleanupError);
        }
      }
      if (database) {
        try {
          lifecycle.closeDatabase(database, true);
        } catch (cleanupError) {
          cleanupFailures.push(cleanupError);
          // Request deferred close as a resource fallback, but do not treat it
          // as proof that actor-local SQLite authority was released now.
          try {
            lifecycle.closeDatabase(database, false);
          } catch (fallbackError) {
            cleanupFailures.push(fallbackError);
          }
        }
      }
      if (cleanupFailures.length > 0) {
        throw readerCleanupFailed(error, cleanupFailures);
      }
      if (error instanceof DatabaseError) throw error;
      const sqliteDetails = safeSQLiteErrorCode(error);
      throw new DatabaseError(
        'DATABASE_OPEN_FAILED',
        'Readonly database actor could not open the database.',
        {
          cause: error,
          retryable: isRetryableReaderOpenFailure(
            error,
            sqliteDetails.sqliteCode ?? null,
          ),
          outcome: 'not-started',
          details: {
            phase,
            ...sqliteDetails,
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
    const failures: unknown[] = [];
    if (!this.sequenceStatementFinalized) {
      try {
        this.lifecycle.finalizeStatement(this.currentSequenceStatement);
        this.sequenceStatementFinalized = true;
      } catch (error) {
        failures.push(error);
      }
    }
    // Keep the handle available for a later cleanup retry if statement
    // finalization failed. Actor process exit remains the ultimate release.
    if (this.sequenceStatementFinalized && !this.databaseClosed) {
      try {
        this.lifecycle.closeDatabase(this.database, true);
        this.databaseClosed = true;
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length > 0) {
      throw new DatabaseError(
        'DATABASE_EXECUTOR_FAILED',
        'Readonly database actor cleanup failed.',
        {
          cause: failures.length === 1
            ? failures[0]
            : new AggregateError(failures, 'Readonly database cleanup failed.'),
          retryable: false,
          outcome: 'unknown',
        },
      );
    }
    this.closed = true;
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
      case 'find':
        return runDatabaseFind(this.database, operation, this.catalog);
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

function readerCleanupFailed(
  primaryFailure: unknown,
  cleanupFailures: readonly unknown[],
): DatabaseError {
  return new DatabaseError(
    'DATABASE_EXECUTOR_FAILED',
    'Readonly database actor startup cleanup failed.',
    {
      cause: new AggregateError(
        [primaryFailure, ...cleanupFailures],
        'Readonly database startup and cleanup failed.',
      ),
      retryable: false,
      outcome: 'unknown',
    },
  );
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
    || operation.type === 'find'
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
      {
        cause: error,
        retryable: false,
        outcome: 'not-started',
        details: { phase: 'verify' },
      },
    );
  }
}

function isRetryableReaderOpenFailure(
  error: unknown,
  sqliteCode: string | null,
): boolean {
  if (sqliteCode !== null) {
    return !/^SQLITE_(CORRUPT|FORMAT|MISMATCH|MISUSE|NOTADB|RANGE)(?:_|$)/u
      .test(sqliteCode);
  }
  const systemCode = safeSystemErrorCode(error);
  return systemCode === null || ![
    'EACCES',
    'EINVAL',
    'EISDIR',
    'ENOTDIR',
    'EPERM',
  ].includes(systemCode);
}

function safeSystemErrorCode(error: unknown): string | null {
  try {
    if (!error || typeof error !== 'object') return null;
    const descriptor = Object.getOwnPropertyDescriptor(error, 'code');
    return descriptor
      && 'value' in descriptor
      && typeof descriptor.value === 'string'
      && /^[A-Z][A-Z0-9_]{0,63}$/u.test(descriptor.value)
      ? descriptor.value
      : null;
  } catch {
    return null;
  }
}

function assertRealmSchema(database: Database, realm: DatabaseRealm): void {
  for (const [table, schema] of Object.entries(realm.tables)) {
    const statement = database.prepare(
      `PRAGMA main.table_info(${quoteSqlIdentifier(table)})`,
    );
    let rows: TableInfoRow[];
    try {
      rows = statement.all() as TableInfoRow[];
    } finally {
      statement.finalize();
    }
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
  const statement = database.prepare('PRAGMA main.schema_version');
  let row: { schema_version?: unknown } | null;
  try {
    row = statement.get() as { schema_version?: unknown } | null;
  } finally {
    statement.finalize();
  }
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
