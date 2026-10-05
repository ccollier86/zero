import type { Database, Statement } from 'bun:sqlite';
import { AsyncLocalStorage } from 'node:async_hooks';
import {
  canonicalDatabaseRowId,
  databaseColumnDefinitionAffinity,
  databaseColumnDefinitionDeclaresPrimaryKey,
  isSupportedDatabaseRowIdentityAffinity,
  isIsolatedDatabaseColumnDefinition,
} from './row-identity';
import {
  createIdentityId,
  getIdentityValues,
  hasIdentity,
  quoteSqlIdentifier,
  type IdentityKey,
} from './identity';
import { OBS_CODES } from '../observability/codes';
import { emitPlatformCode, emitPlatformCodeTo } from '../observability/sink';
import type {
  PlatformCodeDefinition,
  PlatformCodeEmitOptions,
} from '../observability/types';
import { createPlatformSQLiteService, type PlatformSQLiteService } from '../persistence';
import {
  canonicalizeChangeRow,
  cloneChange,
  deserializeChangeRow,
  isChangeLogFormatIncompatibleError,
  isSerializableRowObject,
} from './reactive-db-change-codec';
import {
  CHANGE_LOG_STATE_TABLE,
  LEGACY_CHANGE_SEQUENCE_TABLE,
  ReactiveDBChangeLog,
  type SQLiteSchemaVersions,
} from './reactive-db-change-log';
import {
  assertIdentityUnchanged,
  assertManagedForeignKeyActionsSafe,
  assertNoIdentityConflict,
  assertValidRowScope,
  ensurePrimaryKeyFromIdentity,
  exactSqlValueBindings,
  exactSqlValuePredicate,
  finalizeTableStatements,
  getTableDef,
  queryOneScoped,
  quoteMainTable,
  readManagedTableSchemaContract,
  requireIdentityStatement,
  rowExactlyMatchesColumns,
  validateIdentity,
  validateManagedTableSchemaContracts,
  type ManagedTableSchemaContract,
} from './reactive-db-table-contract';
import {
  createExternalChangeDispatcher,
  type ExternalChangeDispatcher,
  type ExternalChangePollingOptions,
} from './reactive-db-external-poller';
import { isReactiveDBPromiseLike } from './reactive-db-synchronous-boundary';
import {
  beginReactiveDBRollbackRecoveryScope,
  discardReactiveDBRollbackRecoveries,
  runReactiveDBRollbackRecoveries,
} from './reactive-db-rollback-recovery';
import {
  bindReactiveDBLocalChangeOrigin,
  clearAllReactiveDBLocalChangeOrigins,
  clearReactiveDBLocalChangeOrigin,
  clearReactiveDBLocalChangeOriginsThrough,
  takeReactiveDBLocalChangeOrigin,
} from './reactive-db-local-change-origin';
import {
  disposeReactiveDBMutationInterceptorHost,
  initializeReactiveDBMutationInterceptorHost,
  invokeReactiveDBMutationInterceptor,
} from './reactive-db-mutation-interceptor';
import {
  createReactiveDBTransactionToken,
  retireReactiveDBTransactionToken,
  type ReactiveDBTransactionToken,
} from './reactive-db-transaction-token';
import type {
  ReactiveDBConfig,
  TableSchema,
  Row,
  Change,
  ChangeOp,
  ChangeListener,
  ChangeDeliveryMetadata,
  TableDef,
  ReactiveDBPlatformCodeEmitter,
} from './types';

export type { ExternalChangePollingOptions } from './reactive-db-external-poller';
export {
  getReactiveDBLocalChangeOrigin,
  withReactiveDBLocalChangeOrigin,
} from './reactive-db-local-change-origin';
export { registerReactiveDBMutationInterceptor } from './reactive-db-mutation-interceptor';
export type {
  ReactiveDBMutationChange,
  ReactiveDBMutationInterception,
  ReactiveDBMutationInterceptor,
  ReactiveDBReadOnlyRow,
  ReactiveDBReadOnlyValue,
} from './reactive-db-mutation-interceptor';
export type { ReactiveDBTransactionToken } from './reactive-db-transaction-token';

const DEFAULT_RING_BUFFER_DEPTH = 1000;

interface ReactiveDBRuntime {
  database: Database;
  sqlite: PlatformSQLiteService | null;
  ownsSQLiteService: boolean;
  ownsDatabase: boolean;
  clearChangesOnStart: boolean;
}

interface TransactionExecutionContext {
  rollbackOnlyError: Error | null;
  snapshotReaderDepth: number;
}

export type ReactiveDBCommitGuardSnapshot =
  | string
  | number
  | boolean
  | null
  | undefined;

/**
 * Synchronous last-moment fence for commits coordinated with another durable
 * database. The guard runs inside the SQLite transaction immediately before
 * commit and may return a lease release callback held until commit/rollback is
 * known. It must never wait while SQLite locks are held.
 */
export interface ReactiveDBCommitGuard {
  capture(): ReactiveDBCommitGuardSnapshot;
  beforeCommit(
    snapshot: ReactiveDBCommitGuardSnapshot,
  ): (() => undefined) | undefined;
}

const reactiveDBCommitGuards = new WeakMap<ReactiveDB, ReactiveDBCommitGuard>();

/** Install one app-local commit fence and return an identity-safe remover. */
export function registerReactiveDBCommitGuard(
  db: ReactiveDB,
  guard: ReactiveDBCommitGuard,
): () => void {
  if (!(db instanceof ReactiveDB)
    || !guard
    || typeof guard !== 'object'
    || typeof guard.capture !== 'function'
    || typeof guard.beforeCommit !== 'function'
    || reactiveDBCommitGuards.has(db)) {
    throw new TypeError('ReactiveDB commit guard configuration is invalid');
  }
  const detached = Object.freeze({
    capture: guard.capture,
    beforeCommit: guard.beforeCommit,
  });
  reactiveDBCommitGuards.set(db, detached);
  let removed = false;
  return () => {
    if (removed) return;
    removed = true;
    if (reactiveDBCommitGuards.get(db) === detached) {
      reactiveDBCommitGuards.delete(db);
    }
  };
}

/**
 * Trusted equality predicate enforced with exact JS, SQLite storage-class, and
 * BINARY comparison semantics. Declared column affinity/collation cannot widen it.
 */
export interface ReactiveDBRowScope {
  field: string;
  value: string | number;
}

/**
 * ReactiveDB — SQLite wrapper that makes managed row writes observable.
 *
 * Define a table, get prepared CRUD statements and change events for free.
 * Each instance belongs to one concrete data plane; Fabric may own many.
 *
 * File-backed instances share durable sequence allocation through SQLite.
 * Listeners and sync epochs remain instance-local, while the opt-in external
 * change poller can relay the durable log into each runtime's local listeners.
 * `createSyncPlugin()` enables that relay automatically for file mode.
 *
 * Every write:
 *  1. Executes the prepared statement
 *  2. Allocates the next database-wide seq value
 *  3. Records in the _changes ring buffer
 *  4. Invokes the optional same-transaction mutation interceptor
 *  5. Emits to change listeners after commit
 */
export class ReactiveDB {
  private readonly epoch = crypto.randomUUID();
  private db: Database;
  private sqlite: PlatformSQLiteService | null;
  private ownsSQLiteService: boolean;
  private ownsDatabase: boolean;
  private tables: Map<string, TableDef> = new Map();
  private listeners: ChangeListener[] = [];
  private changeLog: ReactiveDBChangeLog;
  private readonly emitCode: ReactiveDBPlatformCodeEmitter;
  private managedTableSchemaContracts = new Map<string, ManagedTableSchemaContract>();
  private lifecycleState: 'active' | 'releasing' | 'released' | 'closing' | 'disposed' = 'active';
  private changeLogInvalid = false;
  private externalChangeDispatcher: ExternalChangeDispatcher | null = null;
  private readonly localDeliveryQueue: Change[] = [];
  private drainingLocalDeliveryQueue = false;
  private changeDeliveryDepth = 0;
  private activeTransactionChangeOrigin: string | null = null;
  private activeTransactionToken: ReactiveDBTransactionToken | null = null;
  private readonly transactionDomain: object = Object.freeze({});

  // Transaction support: when true, changes are accumulated and emitted after commit
  private inTransaction = false;
  private deferredChanges: Change[] | null = null;
  private postCommitCallbacks: Array<() => unknown> | null = null;
  private postCommitFences: Array<() => unknown> | null = null;
  private readonly transactionExecution = new AsyncLocalStorage<TransactionExecutionContext>();

  constructor(config: ReactiveDBConfig) {
    const ringBufferDepth = config.ringBufferDepth ?? DEFAULT_RING_BUFFER_DEPTH;
    if (!Number.isSafeInteger(ringBufferDepth) || ringBufferDepth < 1) {
      throw new Error('ReactiveDB ringBufferDepth must be a positive safe integer');
    }
    const runtime = createReactiveDBRuntime(config);
    this.db = runtime.database;
    this.sqlite = runtime.sqlite;
    this.ownsSQLiteService = runtime.ownsSQLiteService;
    this.ownsDatabase = runtime.ownsDatabase;
    this.emitCode = config.emitCode
      ?? (config.observability
        ? (definition, options) => emitPlatformCodeTo(
          config.observability!,
          definition,
          options,
        )
        : emitPlatformCode);

    try {
      this.changeLog = new ReactiveDBChangeLog(this.db, {
        clearChangesOnStart: runtime.clearChangesOnStart,
        ringBufferDepth,
        validateManagedTableSchemas: () => validateManagedTableSchemaContracts(
          this.db,
          this.managedTableSchemaContracts,
        ),
      });
      initializeReactiveDBMutationInterceptorHost(this);
    } catch (error) {
      if (this.ownsSQLiteService) {
        this.sqlite?.close();
      } else if (this.ownsDatabase) {
        this.db.close();
      }
      throw error;
    }
  }

  // ─── Table Definition ───────────────────────────────────────────────────

  /**
   * Define a table schema and prepare all CRUD statements.
   *
   * Table DDL, foreign-key validation, identity-index creation, and statement
   * preparation succeed or roll back as one immediate schema boundary.
   * Calling with the same name atomically replaces the prepared statement set.
   * This method cannot run inside a managed ReactiveDB transaction.
   * Table names starting with `_` are allowed but the sync plugin will
   * exclude them from pub/sub broadcasts.
   */
  defineTable(name: string, schema: TableSchema): void {
    this.assertNotDisposed();
    this.assertNotInSnapshotReader();
    if (this.inTransaction) {
      throw new Error('defineTable() cannot run inside a ReactiveDB transaction');
    }

    const identity = Array.isArray(schema._identity) ? [...schema._identity] : undefined;
    const columns = Object.keys(schema).filter((key) => key !== '_identity');
    if (columns.length === 0) {
      throw new Error(`defineTable('${name}'): schema must have at least one column`);
    }

    const primaryKeys: string[] = [];
    for (const col of columns) {
      const def = schema[col];
      if (typeof def !== 'string') {
        throw new Error(`defineTable('${name}'): column '${col}' must have a SQL definition string`);
      }
      if (!isIsolatedDatabaseColumnDefinition(def)) {
        throw new Error(
          `defineTable('${name}'): column '${col}' must describe exactly one isolated SQL column`,
        );
      }
      if (databaseColumnDefinitionDeclaresPrimaryKey(def)) primaryKeys.push(col);
    }
    if (primaryKeys.length !== 1) {
      throw new Error(
        `defineTable('${name}'): schema must declare exactly one primary-key column`,
      );
    }
    const primaryKey = primaryKeys[0]!;
    const primaryKeyAffinity = databaseColumnDefinitionAffinity(
      schema[primaryKey],
    );
    if (!isSupportedDatabaseRowIdentityAffinity(primaryKeyAffinity)) {
      throw new Error(
        `defineTable('${name}'): primary key '${primaryKey}' must declare TEXT or INTEGER affinity`,
      );
    }

    validateIdentity(name, columns, primaryKey, identity);

    // Build all SQL before entering the atomic schema-definition boundary.
    const columnDefs = columns
      .map((col) => `${quoteSqlIdentifier(col)} ${schema[col]}`)
      .join(', ');
    const mainTable = quoteMainTable(name);

    // Prepare CRUD statements
    const nonPkColumns = columns.filter((c) => c !== primaryKey);

    // A primary-key-targeted upsert preserves the legacy duplicate-PK API
    // without SQLite REPLACE's hidden delete of a different UNIQUE row.
    // Statement-level ABORT also overrides schema-declared IGNORE/REPLACE
    // conflict algorithms on every non-PK constraint.
    const insertPlaceholders = columns.map(() => '?').join(', ');
    const quotedColumns = columns.map(quoteSqlIdentifier);
    const quotedPrimaryKey = quoteSqlIdentifier(primaryKey);
    const upsertAssignments = nonPkColumns.length > 0
      ? nonPkColumns.map((column) => {
        const quoted = quoteSqlIdentifier(column);
        return `${quoted} = excluded.${quoted}`;
      }).join(', ')
      : `${quotedPrimaryKey} = ${quotedPrimaryKey}`;
    const insertSQL = `INSERT OR ABORT INTO ${mainTable} ` +
      `(${quotedColumns.join(', ')}) VALUES (${insertPlaceholders}) ` +
      `ON CONFLICT (${quotedPrimaryKey}) DO UPDATE SET ${upsertAssignments} ` +
      `RETURNING ${quotedPrimaryKey}`;

    // UPDATE — set non-PK columns, WHERE pk = ?
    let updateSQL: string;
    if (nonPkColumns.length > 0) {
      const setClauses = nonPkColumns
        .map((column) => `${quoteSqlIdentifier(column)} = ?`)
        .join(', ');
      updateSQL = `UPDATE OR ABORT ${mainTable} SET ${setClauses} ` +
        `WHERE ${quoteSqlIdentifier(primaryKey)} = ? ` +
        `RETURNING ${quoteSqlIdentifier(primaryKey)}`;
    } else {
      // Table with only a PK column — update is effectively a no-op
      // Use a self-referencing SET to satisfy SQL syntax
      const quotedPrimaryKey = quoteSqlIdentifier(primaryKey);
      updateSQL = `UPDATE OR ABORT ${mainTable} ` +
        `SET ${quotedPrimaryKey} = ${quotedPrimaryKey} ` +
        `WHERE ${quotedPrimaryKey} = ? RETURNING ${quotedPrimaryKey}`;
    }

    const deleteSQL = `DELETE FROM ${mainTable} ` +
      `WHERE ${quoteSqlIdentifier(primaryKey)} = ? ` +
      `RETURNING ${quoteSqlIdentifier(primaryKey)}`;
    const getOneSQL = `SELECT * FROM ${mainTable} WHERE ${quoteSqlIdentifier(primaryKey)} = ?`;
    const getAllSQL = `SELECT * FROM ${mainTable}`;
    const getByIdentitySQL = hasIdentity(identity)
      ? `SELECT * FROM ${mainTable} WHERE ${identity.map((field) =>
        `${quoteSqlIdentifier(field)} = ?`).join(' AND ')}`
      : null;

    const prepared: Statement[] = [];
    const prepare = (sql: string): Statement => {
      const statement = this.db.prepare(sql);
      prepared.push(statement);
      return statement;
    };
    let tableDef: TableDef | null = null;
    let schemaContract: ManagedTableSchemaContract | null = null;
    try {
      this.db.transaction(() => {
        this.db.run(`CREATE TABLE IF NOT EXISTS ${mainTable} (${columnDefs})`);
        assertManagedForeignKeyActionsSafe(this.db, name);

        if (hasIdentity(identity)) {
          const indexName = `idx_${name}_identity`;
          const identityColumns = identity.map(quoteSqlIdentifier).join(', ');
          this.db.run(
            `CREATE UNIQUE INDEX IF NOT EXISTS main.${quoteSqlIdentifier(indexName)} ` +
            `ON ${quoteSqlIdentifier(name)} (${identityColumns})`
          );
        }

        tableDef = {
          name,
          columns,
          primaryKey,
          identity: hasIdentity(identity) ? [...identity] : undefined,
          stmts: {
            insert: prepare(insertSQL),
            update: prepare(updateSQL),
            delete: prepare(deleteSQL),
            getOne: prepare(getOneSQL),
            getAll: prepare(getAllSQL),
            getByIdentity: getByIdentitySQL ? prepare(getByIdentitySQL) : undefined,
          },
        };
        schemaContract = readManagedTableSchemaContract(this.db, name);
      }).immediate();
    } catch (error) {
      for (const statement of prepared.reverse()) {
        try { statement.finalize(); } catch { /* Rolled-back schema owns no live statement. */ }
      }
      throw error;
    }

    const previous = this.tables.get(name);
    this.tables.set(name, tableDef!);
    this.managedTableSchemaContracts.set(name, schemaContract!);
    if (previous) finalizeTableStatements(previous);
  }

  // ─── Write Methods ──────────────────────────────────────────────────────

  /**
   * Insert a row. If the primary key already exists, updates that exact row
   * with replacement-style values and emits op: 'UPDATE'. Other uniqueness
   * conflicts abort instead of silently deleting a different tracked row.
   *
   * Returns the Change, or null if the write somehow produced no effect.
   */
  insert(table: string, row: Row): Change {
    try {
      this.assertNotDisposed();
      if (!this.inTransaction) {
        return this.transaction(() => this.insert(table, row));
      }
      const def = getTableDef(this.tables, table);
      const nextRow = ensurePrimaryKeyFromIdentity(def, row);
      const pkValue = nextRow[def.primaryKey];
      if (pkValue === undefined || pkValue === null || pkValue === '') {
        throw new Error(`insert('${table}'): row is missing primary key '${def.primaryKey}'`);
      }
      const pk = requireCanonicalReactiveDBRowId(
        table,
        def.primaryKey,
        pkValue,
      );

      // Check if row already exists to determine correct op
      const existing = def.stmts.getOne.get(pk) as Row | null;
      const op: ChangeOp = existing ? 'UPDATE' : 'INSERT';
      if (existing) assertIdentityUnchanged(def, existing, nextRow);
      assertNoIdentityConflict(
        def,
        nextRow,
        existing
          ? requireCanonicalReactiveDBRowId(
            table,
            def.primaryKey,
            existing[def.primaryKey],
          )
          : pk,
      );

      // Determine which columns are present in the row object.
      // Columns NOT provided are omitted from the INSERT so SQLite applies defaults.
      const presentColumns = def.columns.filter((col) => col in nextRow);
      const values = presentColumns.map((col) => nextRow[col] ?? null);

      if (presentColumns.length === def.columns.length) {
        // All columns provided — use the pre-prepared statement (fast path)
        const returned = def.stmts.insert.get(...values);
        if (!returned) {
          throw new Error(`insert('${table}'): target write was suppressed`);
        }
      } else {
        // Partial columns — build dynamic INSERT to let defaults apply
        const placeholders = presentColumns.map(() => '?').join(', ');
        const quotedPrimaryKey = quoteSqlIdentifier(def.primaryKey);
        const assignments = def.columns
          .filter((column) => column !== def.primaryKey)
          .map((column) => {
            const quoted = quoteSqlIdentifier(column);
            return `${quoted} = excluded.${quoted}`;
          });
        const sql = `INSERT OR ABORT INTO ${quoteMainTable(def.name)} ` +
          `(${presentColumns.map(quoteSqlIdentifier).join(', ')}) VALUES (${placeholders}) ` +
          `ON CONFLICT (${quotedPrimaryKey}) DO UPDATE SET ` +
          (assignments.length > 0
            ? assignments.join(', ')
            : `${quotedPrimaryKey} = ${quotedPrimaryKey}`) +
          ` RETURNING ${quotedPrimaryKey}`;
        const statement = this.db.prepare(sql);
        try {
          const returned = statement.get(...(values as any[]));
          if (!returned) {
            throw new Error(`insert('${table}'): target write was suppressed`);
          }
        } finally {
          statement.finalize();
        }
      }

      // Read back the full row to get any defaults applied by SQLite
      const fullRow = def.stmts.getOne.get(pk) as Row | null;
      if (!fullRow) {
        throw new Error(`insert('${table}'): persisted row is missing`);
      }
      const persistedId = requireCanonicalReactiveDBRowId(
        table,
        def.primaryKey,
        fullRow[def.primaryKey],
      );

      const change = this.createChange(table, op, persistedId, fullRow, existing);
      this.recordAndEmit(change);
      return change;
    } catch (error) {
      this.markTransactionRollbackOnly(error);
      throw error;
    }
  }

  /**
   * Canonical create alias for insert().
   *
   * ReactiveDB insert semantics are preserved: existing primary keys are
   * replaced and emitted as UPDATE changes.
   */
  create(table: string, row: Row): Change {
    return this.insert(table, row);
  }

  /**
   * Insert a row only when its primary key is absent.
   *
   * Unlike the legacy `insert()`/`create()` aliases, this never turns a
   * policy-authorized CREATE into a replacement UPDATE. Registered resources
   * use this boundary so a guessed id cannot bypass row-level update policy.
   */
  createStrict(table: string, row: Row): Change {
    try {
      this.assertNotDisposed();
      const def = getTableDef(this.tables, table);
      return this.transaction(() => {
        const nextRow = ensurePrimaryKeyFromIdentity(def, row);
        const pkValue = nextRow[def.primaryKey];
        if (pkValue === undefined || pkValue === null || pkValue === '') {
          throw new Error(`createStrict('${table}'): row is missing primary key '${def.primaryKey}'`);
        }
        const pk = requireCanonicalReactiveDBRowId(
          table,
          def.primaryKey,
          pkValue,
        );
        if (def.stmts.getOne.get(pk)) {
          throw new Error(`createStrict('${table}'): primary key already exists`);
        }
        assertNoIdentityConflict(def, nextRow, pk);

        const presentColumns = def.columns.filter((column) => column in nextRow);
        const values = presentColumns.map((column) => nextRow[column] ?? null);
        const statement = this.db.prepare(
          `INSERT OR ABORT INTO ${quoteMainTable(def.name)} (` +
          `${presentColumns.map(quoteSqlIdentifier).join(', ')}) ` +
          `VALUES (${presentColumns.map(() => '?').join(', ')}) ` +
          `RETURNING ${quoteSqlIdentifier(def.primaryKey)}`,
        );
        try {
          const returned = statement.get(...(values as any[]));
          if (!returned) {
            throw new Error(`createStrict('${table}'): target write was suppressed`);
          }
        } finally {
          statement.finalize();
        }

        const fullRow = def.stmts.getOne.get(pk) as Row | null;
        if (!fullRow) {
          throw new Error(`createStrict('${table}'): inserted row is missing`);
        }
        const change = this.createChange(
          table,
          'INSERT',
          requireCanonicalReactiveDBRowId(
            table,
            def.primaryKey,
            fullRow[def.primaryKey],
          ),
          fullRow,
          null,
        );
        this.recordAndEmit(change);
        return change;
      });
    } catch (error) {
      this.markTransactionRollbackOnly(error);
      throw error;
    }
  }

  /**
   * Insert a realm-stamped row without ReactiveDB's legacy replace behavior.
   * A primary-key collision is rejected, including when the existing row is in
   * another tenant. This prevents a guessed id from becoming a cross-realm
   * overwrite through an upsert.
   */
  createScoped(table: string, row: Row, scope: ReactiveDBRowScope): Change {
    try {
      this.assertNotDisposed();
      const def = getTableDef(this.tables, table);
      assertValidRowScope(def, scope);
      return this.transaction(() => {
        const nextRow = ensurePrimaryKeyFromIdentity(def, row);
        if (nextRow[scope.field] !== scope.value) {
          throw new Error(`createScoped('${table}'): row does not match trusted scope '${scope.field}'`);
        }

        const pkValue = nextRow[def.primaryKey];
        if (pkValue === undefined || pkValue === null || pkValue === '') {
          throw new Error(`createScoped('${table}'): row is missing primary key '${def.primaryKey}'`);
        }
        const pk = requireCanonicalReactiveDBRowId(
          table,
          def.primaryKey,
          pkValue,
        );
        if (def.stmts.getOne.get(pk)) {
          throw new Error(`createScoped('${table}'): primary key already exists`);
        }
        assertNoIdentityConflict(def, nextRow, pk);

        const presentColumns = def.columns.filter((column) => column in nextRow);
        const values = presentColumns.map((column) => nextRow[column] ?? null);
        const statement = this.db.prepare(
          `INSERT OR ABORT INTO ${quoteMainTable(def.name)} (` +
          `${presentColumns.map(quoteSqlIdentifier).join(', ')}) ` +
          `VALUES (${presentColumns.map(() => '?').join(', ')}) ` +
          `RETURNING ${quoteSqlIdentifier(def.primaryKey)}`,
        );
        try {
          const returned = statement.get(...(values as any[]));
          if (!returned) {
            throw new Error(`createScoped('${table}'): target write was suppressed`);
          }
        } finally {
          statement.finalize();
        }

        const fullRow = def.stmts.getOne.get(pk) as Row | null;
        if (!fullRow || fullRow[scope.field] !== scope.value) {
          throw new Error(`createScoped('${table}'): persisted row escaped trusted scope`);
        }
        const change = this.createChange(
          table,
          'INSERT',
          requireCanonicalReactiveDBRowId(
            table,
            def.primaryKey,
            fullRow[def.primaryKey],
          ),
          fullRow,
          null,
        );
        this.recordAndEmit(change);
        return change;
      });
    } catch (error) {
      this.markTransactionRollbackOnly(error);
      throw error;
    }
  }

  /**
   * Update a row by merging partial data into the existing row.
   * Returns the Change with the full merged row, or null if the row doesn't exist.
   */
  update(table: string, id: string, partial: Partial<Row>): Change | null {
    try {
      this.assertNotDisposed();
      if (!this.inTransaction) {
        return this.transaction(() => this.update(table, id, partial));
      }
      const def = getTableDef(this.tables, table);

      // Read current row
      const existing = def.stmts.getOne.get(id) as Row | null;
      if (!existing) return null;
      assertIdentityUnchanged(def, existing, partial);

      // Merge: existing values + partial overrides
      const merged: Row = { ...existing, ...partial };
      // Ensure PK hasn't been changed
      merged[def.primaryKey] = id;

      // Build values for UPDATE SET clause: non-PK columns + PK for WHERE
      const nonPkColumns = def.columns.filter((c) => c !== def.primaryKey);
      if (nonPkColumns.length > 0) {
        const updateValues = nonPkColumns.map((col) => merged[col] ?? null);
        updateValues.push(id); // WHERE pk = ?
        const returned = def.stmts.update.get(...updateValues);
        if (!returned) {
          throw new Error(`update('${table}'): target write was suppressed`);
        }
      } else {
        const returned = def.stmts.update.get(id);
        if (!returned) {
          throw new Error(`update('${table}'): target write was suppressed`);
        }
      }

      // Read back the full row
      const fullRow = def.stmts.getOne.get(id) as Row | null;
      if (!fullRow) {
        throw new Error(`update('${table}'): persisted row is missing`);
      }

      const change = this.createChange(
        table,
        'UPDATE',
        requireCanonicalReactiveDBRowId(
          table,
          def.primaryKey,
          fullRow[def.primaryKey],
        ),
        fullRow,
        existing,
      );
      this.recordAndEmit(change);
      return change;
    } catch (error) {
      this.markTransactionRollbackOnly(error);
      throw error;
    }
  }

  /**
   * Update only when the row still exactly matches the snapshot evaluated by
   * policy. JS preflight rejects type/case drift and the compare-and-write SQL
   * repeats storage-class plus BINARY equality in one transaction.
   */
  updateIfCurrent(
    table: string,
    id: string,
    partial: Partial<Row>,
    expectedRow: Row,
  ): Change | null {
    try {
      this.assertNotDisposed();
      const def = getTableDef(this.tables, table);
      return this.transaction(() => {
        const existing = def.stmts.getOne.get(id) as Row | null;
        if (!existing) return null;
        assertIdentityUnchanged(def, existing, partial);

        const merged: Row = { ...existing, ...partial, [def.primaryKey]: id };
        const nonPkColumns = def.columns.filter((column) => column !== def.primaryKey);
        if (nonPkColumns.length > 0) {
          const expectedColumns = def.columns.filter((column) => column !== def.primaryKey);
          if (!rowExactlyMatchesColumns(existing, expectedRow, expectedColumns)) {
            throw new Error(`updateIfCurrent('${table}'): row changed since authorization`);
          }
          const statement = this.db.prepare(
            `UPDATE OR ABORT ${quoteMainTable(def.name)} SET ` +
            `${nonPkColumns.map((column) => `${quoteSqlIdentifier(column)} = ?`).join(', ')} ` +
            `WHERE ${quoteSqlIdentifier(def.primaryKey)} = ?` +
            expectedColumns.map((column) => exactSqlValuePredicate(column)).join('') +
            ` RETURNING ${quoteSqlIdentifier(def.primaryKey)}`,
          );
          let returned: unknown;
          try {
            returned = statement.get(
              ...(nonPkColumns.map((column) => merged[column] ?? null) as any[]),
              id,
              ...exactSqlValueBindings(expectedRow, expectedColumns),
            );
          } finally {
            statement.finalize();
          }
          if (!returned) {
            throw new Error(`updateIfCurrent('${table}'): row changed since authorization`);
          }
        } else {
          const returned = def.stmts.update.get(id);
          if (!returned) {
            throw new Error(`updateIfCurrent('${table}'): target write was suppressed`);
          }
        }

        const fullRow = def.stmts.getOne.get(id) as Row | null;
        if (!fullRow) {
          throw new Error(`updateIfCurrent('${table}'): persisted row is missing`);
        }
        const change = this.createChange(
          table,
          'UPDATE',
          requireCanonicalReactiveDBRowId(
            table,
            def.primaryKey,
            fullRow[def.primaryKey],
          ),
          fullRow,
          existing,
        );
        this.recordAndEmit(change);
        return change;
      });
    } catch (error) {
      this.markTransactionRollbackOnly(error);
      throw error;
    }
  }

  /** Update only when the target row still exactly matches the trusted scope. */
  updateScoped(
    table: string,
    id: string,
    partial: Partial<Row>,
    scope: ReactiveDBRowScope,
    expectedRow?: Row,
  ): Change | null {
    try {
      this.assertNotDisposed();
      const def = getTableDef(this.tables, table);
      assertValidRowScope(def, scope);
      if (scope.field in partial) {
        throw new Error(`updateScoped('${table}'): trusted scope '${scope.field}' is immutable`);
      }

      return this.transaction(() => {
        const existing = queryOneScoped(this.db, def, id, scope);
        if (!existing) return null;
        assertIdentityUnchanged(def, existing, partial);

        const merged: Row = { ...existing, ...partial };
        merged[def.primaryKey] = id;
        merged[scope.field] = scope.value;
        const nonPkColumns = def.columns.filter((column) => column !== def.primaryKey);
        if (nonPkColumns.length > 0) {
          const expected = expectedRow ?? existing;
          const expectedColumns = def.columns.filter((column) =>
            column !== def.primaryKey && column !== scope.field);
          if (!rowExactlyMatchesColumns(existing, expected, expectedColumns)) {
            throw new Error(`updateScoped('${table}'): row changed since authorization`);
          }
          const statement = this.db.prepare(
            `UPDATE OR ABORT ${quoteMainTable(def.name)} SET ` +
            `${nonPkColumns.map((column) => `${quoteSqlIdentifier(column)} = ?`).join(', ')} ` +
            `WHERE ${quoteSqlIdentifier(def.primaryKey)} = ? ` +
            `${exactSqlValuePredicate(scope.field, false)}` +
            expectedColumns.map((column) => exactSqlValuePredicate(column)).join('') +
            ` RETURNING ${quoteSqlIdentifier(def.primaryKey)}`,
          );
          let returned: unknown;
          try {
            returned = statement.get(
              ...(nonPkColumns.map((column) => merged[column] ?? null) as any[]),
              id,
              scope.value,
              scope.value,
              ...exactSqlValueBindings(expected, expectedColumns),
            );
          } finally {
            statement.finalize();
          }
          if (!returned) {
            throw new Error(`updateScoped('${table}'): row changed since authorization`);
          }
        } else {
          const returned = def.stmts.update.get(id);
          if (!returned) {
            throw new Error(`updateScoped('${table}'): target write was suppressed`);
          }
        }

        const fullRow = queryOneScoped(this.db, def, id, scope);
        if (!fullRow) {
          throw new Error(`updateScoped('${table}'): persisted row escaped trusted scope`);
        }
        const change = this.createChange(
          table,
          'UPDATE',
          requireCanonicalReactiveDBRowId(
            table,
            def.primaryKey,
            fullRow[def.primaryKey],
          ),
          fullRow,
          existing,
        );
        this.recordAndEmit(change);
        return change;
      });
    } catch (error) {
      this.markTransactionRollbackOnly(error);
      throw error;
    }
  }

  /**
   * Delete a row by primary key.
   * Returns the Change, or null if the row didn't exist.
   */
  delete(table: string, id: string): Change | null {
    try {
      this.assertNotDisposed();
      if (!this.inTransaction) {
        return this.transaction(() => this.delete(table, id));
      }
      const def = getTableDef(this.tables, table);

      // Check existence
      const existing = def.stmts.getOne.get(id) as Row | null;
      if (!existing) return null;

      const returned = def.stmts.delete.get(id);
      if (!returned) {
        throw new Error(`delete('${table}'): target write was suppressed`);
      }
      if (def.stmts.getOne.get(id)) {
        throw new Error(`delete('${table}'): row was not removed`);
      }

      const change = this.createChange(
        table,
        'DELETE',
        requireCanonicalReactiveDBRowId(
          table,
          def.primaryKey,
          existing[def.primaryKey],
        ),
        null,
        existing,
      );
      this.recordAndEmit(change);
      return change;
    } catch (error) {
      this.markTransactionRollbackOnly(error);
      throw error;
    }
  }

  /** Delete only when the row exactly matches the policy-evaluated snapshot. */
  deleteIfCurrent(table: string, id: string, expectedRow: Row): Change | null {
    try {
      this.assertNotDisposed();
      const def = getTableDef(this.tables, table);
      return this.transaction(() => {
        const existing = def.stmts.getOne.get(id) as Row | null;
        if (!existing) return null;
        const expectedColumns = def.columns.filter((column) => column !== def.primaryKey);
        if (!rowExactlyMatchesColumns(existing, expectedRow, expectedColumns)) {
          throw new Error(`deleteIfCurrent('${table}'): row changed since authorization`);
        }
        const statement = this.db.prepare(
          `DELETE FROM ${quoteMainTable(def.name)} ` +
          `WHERE ${quoteSqlIdentifier(def.primaryKey)} = ?` +
          expectedColumns.map((column) => exactSqlValuePredicate(column)).join('') +
          ` RETURNING ${quoteSqlIdentifier(def.primaryKey)}`,
        );
        let returned: unknown;
        try {
          returned = statement.get(
            id,
            ...exactSqlValueBindings(expectedRow, expectedColumns),
          );
        } finally {
          statement.finalize();
        }
        if (!returned) {
          throw new Error(`deleteIfCurrent('${table}'): row changed since authorization`);
        }
        if (def.stmts.getOne.get(id)) {
          throw new Error(`deleteIfCurrent('${table}'): deleted row was recreated during the write`);
        }

        const change = this.createChange(
          table,
          'DELETE',
          requireCanonicalReactiveDBRowId(
            table,
            def.primaryKey,
            existing[def.primaryKey],
          ),
          null,
          existing,
        );
        this.recordAndEmit(change);
        return change;
      });
    } catch (error) {
      this.markTransactionRollbackOnly(error);
      throw error;
    }
  }

  /** Delete only when the row still exactly matches the trusted scope. */
  deleteScoped(
    table: string,
    id: string,
    scope: ReactiveDBRowScope,
    expectedRow?: Row,
  ): Change | null {
    try {
      this.assertNotDisposed();
      const def = getTableDef(this.tables, table);
      assertValidRowScope(def, scope);
      return this.transaction(() => {
        const existing = queryOneScoped(this.db, def, id, scope);
        if (!existing) return null;
        const expected = expectedRow ?? existing;
        const expectedColumns = def.columns.filter((column) =>
          column !== def.primaryKey && column !== scope.field);
        if (!rowExactlyMatchesColumns(existing, expected, expectedColumns)) {
          throw new Error(`deleteScoped('${table}'): row changed since authorization`);
        }

        const statement = this.db.prepare(
          `DELETE FROM ${quoteMainTable(def.name)} ` +
          `WHERE ${quoteSqlIdentifier(def.primaryKey)} = ? ` +
          `${exactSqlValuePredicate(scope.field, false)}` +
          expectedColumns.map((column) => exactSqlValuePredicate(column)).join('') +
          ` RETURNING ${quoteSqlIdentifier(def.primaryKey)}`,
        );
        let returned: unknown;
        try {
          returned = statement.get(
            id,
            scope.value,
            scope.value,
            ...exactSqlValueBindings(expected, expectedColumns),
          );
        } finally {
          statement.finalize();
        }
        if (!returned) {
          throw new Error(`deleteScoped('${table}'): row changed since authorization`);
        }
        if (def.stmts.getOne.get(id)) {
          throw new Error(`deleteScoped('${table}'): deleted row was recreated during the scoped write`);
        }

        const change = this.createChange(
          table,
          'DELETE',
          requireCanonicalReactiveDBRowId(
            table,
            def.primaryKey,
            existing[def.primaryKey],
          ),
          null,
          existing,
        );
        this.recordAndEmit(change);
        return change;
      });
    } catch (error) {
      this.markTransactionRollbackOnly(error);
      throw error;
    }
  }

  // ─── Read Methods ───────────────────────────────────────────────────────

  /** Get all rows from a table. */
  query(table: string): Row[] {
    this.assertNotDisposed();
    const def = getTableDef(this.tables, table);
    return def.stmts.getAll.all() as Row[];
  }

  /** Canonical list alias for query(). */
  list(table: string): Row[] {
    return this.query(table);
  }

  /** Get a single row by primary key. Returns null if not found. */
  queryOne(table: string, id: string): Row | null {
    this.assertNotDisposed();
    const def = getTableDef(this.tables, table);
    return (def.stmts.getOne.get(id) as Row | null) ?? null;
  }

  /** Canonical get alias for queryOne(). */
  get(table: string, id: string): Row | null {
    return this.queryOne(table, id);
  }

  /** Read one row with exact storage-class/BINARY trusted-realm equality. */
  getScoped(table: string, id: string, scope: ReactiveDBRowScope): Row | null {
    this.assertNotDisposed();
    const def = getTableDef(this.tables, table);
    assertValidRowScope(def, scope);
    return queryOneScoped(this.db, def, id, scope);
  }

  /** Get the ordered natural identity fields for a table, if configured. */
  getIdentity(table: string): string[] {
    this.assertNotDisposed();
    return [...(getTableDef(this.tables, table).identity ?? [])];
  }

  /** Return the deterministic sync primary key for a natural identity object. */
  identityKey(table: string, key: IdentityKey): string {
    this.assertNotDisposed();
    const def = getTableDef(this.tables, table);
    if (!hasIdentity(def.identity)) {
      throw new Error(`Table '${table}' does not define a natural identity.`);
    }
    return createIdentityId(table, def.identity, key);
  }

  /** Get a single row by natural identity. Returns null if not found. */
  queryByIdentity(table: string, key: IdentityKey): Row | null {
    this.assertNotDisposed();
    const def = getTableDef(this.tables, table);
    const stmt = requireIdentityStatement(def);
    const values = getIdentityValues(def.identity!, key);
    return (stmt.get(...values) as Row | null) ?? null;
  }

  /**
   * Insert or update a row by natural identity.
   *
   * Missing primary keys are generated deterministically from the identity
   * fields. Existing rows are updated by their current sync primary key.
   */
  upsertByIdentity(table: string, row: Row): Change {
    this.assertNotDisposed();
    if (!this.inTransaction) {
      return this.transaction(() => this.upsertByIdentity(table, row));
    }
    const def = getTableDef(this.tables, table);
    requireIdentityStatement(def);

    const existing = this.queryByIdentity(table, row);
    if (existing) {
      const pk = String(existing[def.primaryKey]);
      const partial = { ...row };
      delete partial[def.primaryKey];
      const change = this.update(table, pk, partial);
      if (!change) throw new Error(`upsertByIdentity('${table}'): existing row disappeared during update`);
      return change;
    }

    return this.insert(table, row);
  }

  /** Update a row by natural identity. Returns null if not found. */
  updateByIdentity(table: string, key: IdentityKey, partial: Partial<Row>): Change | null {
    this.assertNotDisposed();
    if (!this.inTransaction) {
      return this.transaction(() => this.updateByIdentity(table, key, partial));
    }
    const def = getTableDef(this.tables, table);
    requireIdentityStatement(def);

    const existing = this.queryByIdentity(table, key);
    if (!existing) return null;
    return this.update(table, String(existing[def.primaryKey]), partial);
  }

  /** Delete a row by natural identity. Returns null if not found. */
  deleteByIdentity(table: string, key: IdentityKey): Change | null {
    this.assertNotDisposed();
    if (!this.inTransaction) {
      return this.transaction(() => this.deleteByIdentity(table, key));
    }
    const def = getTableDef(this.tables, table);
    requireIdentityStatement(def);

    const existing = this.queryByIdentity(table, key);
    if (!existing) return null;
    return this.delete(table, String(existing[def.primaryKey]));
  }

  // ─── Change Listeners ──────────────────────────────────────────────────

  /**
   * Register a committed-change listener. Local commits notify synchronously;
   * external commits notify when the durable dispatcher drains them.
   * Listeners must be synchronous and receive isolated canonical payload and
   * metadata copies. A returned thenable is consumed and reported as an error.
   * Each change uses a stable subscription snapshot; reentrant writes queue
   * behind the complete committed batch already awaiting delivery.
   * Returns an unsubscribe function.
   *
   * Callable at any time after construction — not tied to WS connections.
   */
  onChange(listener: ChangeListener): () => void {
    this.assertNotDisposed();
    this.listeners.push(listener);

    return () => {
      const idx = this.listeners.indexOf(listener);
      if (idx !== -1) this.listeners.splice(idx, 1);
    };
  }

  /**
   * Deliver the shared durable change log to this instance's ordinary
   * onChange listeners in strict sequence order.
   *
   * While active this dispatcher is the sole listener-delivery path for both
   * local and external commits. A local commit synchronously wakes the drain,
   * which first relays any lower external sequence. A retention/corruption gap
   * is surfaced explicitly so a transport can require a fresh snapshot.
   */
  startExternalChangePolling(
    options: ExternalChangePollingOptions = {},
  ): () => void {
    this.assertNotDisposed();
    if (this.externalChangeDispatcher) {
      throw new Error('ReactiveDB external change polling is already active');
    }
    const dispatcher = createExternalChangeDispatcher(options, {
      writerEpoch: this.epoch,
      assertUsable: () => this.assertChangeLogUsable(),
      currentState: () => this.changeLog.currentState(),
      readSnapshot: (afterSeq) => this.changeLog.readSnapshot(
        afterSeq,
        this.inTransaction,
      ),
      emitChange: (change, delivery) => this.emitChange(change, delivery),
      isDisposed: () => this.lifecycleState !== 'active',
      invalidate: () => {
        this.changeLogInvalid = true;
      },
      clearLocalOriginsThrough: (sequence) => {
        clearReactiveDBLocalChangeOriginsThrough(this, sequence);
      },
      clearAllLocalOrigins: () => clearAllReactiveDBLocalChangeOrigins(this),
      onStopped: (stoppedDispatcher) => {
        if (this.externalChangeDispatcher === stoppedDispatcher) {
          this.externalChangeDispatcher = null;
        }
      },
    });
    this.externalChangeDispatcher = dispatcher;
    return dispatcher.stop;
  }

  /**
   * Read application rows and the represented change cursor from one SQLite
   * snapshot. Reading the sequence first establishes the WAL snapshot used by
   * every subsequent query in `reader`.
   *
   * The reader must be synchronous and read-only through managed ReactiveDB
   * APIs. A managed write or disposal attempt poisons the snapshot and any
   * surrounding write transaction even when application code catches it.
   * A returned thenable is rejected and consumed, and its asynchronous
   * execution context remains poisoned against later ReactiveDB access. Raw
   * SQL handles remain an explicitly trusted escape hatch.
   */
  readAtCurrentSequence<T>(reader: () => T): { value: T; seq: number } {
    this.assertNotDisposed();
    const read = (execution: TransactionExecutionContext) => {
      execution.snapshotReaderDepth += 1;
      try {
        const seq = this.currentSeq;
        const value = reader();
        if (isReactiveDBPromiseLike(value)) {
          const error = new Error('ReactiveDB snapshot readers must be synchronous');
          this.markTransactionRollbackOnly(error);
          void Promise.resolve(value).catch(() => {});
          throw error;
        }
        if (execution.rollbackOnlyError) {
          throw createRollbackOnlyError(execution.rollbackOnlyError);
        }
        return { value, seq };
      } finally {
        execution.snapshotReaderDepth -= 1;
      }
    };
    const activeExecution = this.transactionExecution.getStore();
    if (activeExecution && (this.inTransaction || activeExecution.snapshotReaderDepth > 0)) {
      return read(activeExecution);
    }

    const execution: TransactionExecutionContext = {
      rollbackOnlyError: null,
      snapshotReaderDepth: 0,
    };
    return this.transactionExecution.run(
      execution,
      () => this.db.transaction(() => read(execution)).deferred(),
    );
  }

  // ─── Ring Buffer Replay ─────────────────────────────────────────────────

  /**
   * Get all changes after the given sequence number.
   *
   * Returns null if the seq has been pruned from the ring buffer,
   * indicating the caller should send a full snapshot instead.
   */
  getChangesAfter(seq: number): Change[] | null {
    this.assertNotDisposed();
    this.assertChangeLogUsable();
    if (!Number.isSafeInteger(seq) || seq < 0) {
      throw new Error('ReactiveDB change cursor must be a non-negative safe integer');
    }

    const snapshot = this.changeLog.readSnapshot(seq, this.inTransaction);
    if (!snapshot.contiguous) return null;
    // Decode the complete snapshot before returning anything. Unsupported
    // formats or corrupt JSON therefore fail closed without a partial replay;
    // callers receive the same authoritative-snapshot signal as a retention
    // gap. Durable state/schema failures still throw and invalidate serving.
    try {
      return snapshot.rows.map(deserializeChangeRow);
    } catch (error) {
      if (isChangeLogFormatIncompatibleError(error)) return null;
      throw error;
    }
  }

  /**
   * Read at most `limit` contiguous durable changes and the exact represented
   * head. This is the bounded replay primitive for actor and transport pages;
   * it never materializes the complete retained window.
   *
   * @internal Fabric transport primitive; application replay continues to use
   * `getChangesAfter`.
   */
  getChangesPageAfter(
    seq: number,
    limit: number,
  ): Readonly<{ changes: Change[]; headSeq: number; hasMore: boolean }> | null {
    this.assertNotDisposed();
    this.assertChangeLogUsable();
    if (!Number.isSafeInteger(seq) || seq < 0) {
      throw new Error('ReactiveDB change cursor must be a non-negative safe integer');
    }
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1_000) {
      throw new Error('ReactiveDB change page size must be between 1 and 1000');
    }

    const snapshot = this.changeLog.readPage(seq, limit, this.inTransaction);
    if (!snapshot.contiguous) return null;
    try {
      return Object.freeze({
        changes: snapshot.rows.map(deserializeChangeRow),
        headSeq: snapshot.state.seq,
        hasMore: snapshot.hasMore,
      });
    } catch (error) {
      if (isChangeLogFormatIncompatibleError(error)) return null;
      throw error;
    }
  }

  // ─── Transactions ───────────────────────────────────────────────────────

  /**
   * Return the stable opaque identity for this ReactiveDB transaction domain.
   *
   * Services can compare this object by identity to prove that cooperating
   * stores share this exact ReactiveDB instance without exposing its database
   * methods or relying on configuration/path equality.
   */
  getTransactionDomain(): object {
    this.assertNotDisposed();
    return this.transactionDomain;
  }

  /**
   * Register a synchronous best-effort callback for the current transaction.
   *
   * Registration requires an active managed transaction. Nested transaction
   * registrations join the outer transaction's queue. The queue is discarded
   * if that transaction rolls back or becomes rollback-only. After a successful
   * outer commit, callbacks run exactly once in registration order, after the
   * transaction state has reset and the committed change batch has been
   * delivered. A callback failure cannot undo the commit or prevent later
   * callbacks. Returned thenables are consumed but are not awaited and are
   * reported as a synchronous-callback contract failure.
   */
  afterCommit(callback: () => unknown): void {
    this.assertNotDisposed();
    this.assertNotInSnapshotReader();
    if (!this.inTransaction || this.postCommitCallbacks === null) {
      throw new Error(
        'ReactiveDB afterCommit callbacks require an active transaction',
      );
    }
    if (typeof callback !== 'function') {
      throw new TypeError('ReactiveDB afterCommit callback must be a function');
    }
    this.postCommitCallbacks.push(callback);
  }

  /**
   * Register a synchronous mandatory fence for the current transaction.
   *
   * Unlike `afterCommit`, a fence failure is returned to the root transaction
   * caller after SQLite has committed and normal committed-change delivery has
   * run. Callers must throw an outcome-aware error because the commit can no
   * longer be rolled back. Nested registrations join the outer root boundary.
   *
   * @internal Platform durability/security primitive; application notifications
   * should continue to use best-effort `afterCommit`.
   */
  afterCommitFence(callback: () => unknown): void {
    this.assertNotDisposed();
    this.assertNotInSnapshotReader();
    if (!this.inTransaction || this.postCommitFences === null) {
      throw new Error(
        'ReactiveDB afterCommitFence callbacks require an active transaction',
      );
    }
    if (typeof callback !== 'function') {
      throw new TypeError('ReactiveDB afterCommitFence callback must be a function');
    }
    this.postCommitFences.push(callback);
  }

  /**
   * Execute multiple writes as a single atomic transaction.
   *
   * - All writes succeed or none do (SQLite ACID).
   * - Each write increments seq and records in _changes normally.
   * - The optional mutation interceptor runs synchronously after each change is
   *   recorded and queued, while the root SQLite transaction can still roll back.
   * - Change listeners are deferred as one complete batch, then fired in
   *   sequence and registration order after commit. Reentrant commits queue
   *   behind that batch.
   * - Schema DDL is allowed only in a transaction with no tracked changes.
   * - If the transaction throws, no changes are emitted and writes are rolled back.
   */
  transaction<T>(fn: () => T): T {
    this.assertNotDisposed();
    this.assertNotInSnapshotReader();
    this.assertChangeLogUsable();

    // Nested transactions just run the function — SQLite doesn't support
    // true nested transactions, and the outer transaction handles atomicity.
    if (this.inTransaction) {
      try {
        const result = fn();
        if (isReactiveDBPromiseLike(result)) {
          const error = new Error('ReactiveDB transactions must be synchronous');
          this.markTransactionRollbackOnly(error);
          void Promise.resolve(result).catch(() => {});
          throw error;
        }
        return result;
      } catch (error) {
        this.markTransactionRollbackOnly(error);
        throw error;
      }
    }

    const pendingChanges: Change[] = [];
    const pendingPostCommitCallbacks: Array<() => unknown> = [];
    const pendingPostCommitFences: Array<() => unknown> = [];
    const transactionChangeOrigin = takeReactiveDBLocalChangeOrigin(this);
    const transactionToken = createReactiveDBTransactionToken();
    this.inTransaction = true;
    this.deferredChanges = pendingChanges;
    this.postCommitCallbacks = pendingPostCommitCallbacks;
    this.postCommitFences = pendingPostCommitFences;
    beginReactiveDBRollbackRecoveryScope(this);
    this.activeTransactionChangeOrigin = transactionChangeOrigin;
    this.activeTransactionToken = transactionToken;
    const commitGuardLease: { release: (() => undefined) | null } = {
      release: null,
    };

    const execution: TransactionExecutionContext = {
      rollbackOnlyError: null,
      snapshotReaderDepth: 0,
    };
    try {
      let committedSchemaVersions: SQLiteSchemaVersions | null = null;
      const commitGuard = reactiveDBCommitGuards.get(this) ?? null;
      const result = this.transactionExecution.run(execution, () =>
        this.db.transaction(() => {
          const guardSnapshot = commitGuard?.capture();
          if (guardSnapshot !== undefined
            && guardSnapshot !== null
            && typeof guardSnapshot !== 'string'
            && typeof guardSnapshot !== 'number'
            && typeof guardSnapshot !== 'boolean') {
            throw new TypeError('ReactiveDB commit guard returned an invalid snapshot');
          }
          // Verify the protected log triggers and registered managed-table
          // contracts while BEGIN IMMEDIATE holds the writer lock. The normal
          // path is two scalar schema-version reads; DDL forces a catalog audit.
          const schemaVersions = this.changeLog.assertSchemaFence();
          const value = fn();
          if (execution.rollbackOnlyError) {
            throw createRollbackOnlyError(execution.rollbackOnlyError);
          }
          if (isReactiveDBPromiseLike(value)) {
            const error = new Error('ReactiveDB transactions must be synchronous');
            execution.rollbackOnlyError = error;
            // The Promise cannot be cancelled, but its AsyncLocalStorage scope
            // remains poisoned so an awaited continuation cannot write later.
            void Promise.resolve(value).catch(() => {});
            throw error;
          }
          let finalSchemaVersions = this.changeLog.readSchemaVersions();
          if (finalSchemaVersions.main !== schemaVersions.main
            || finalSchemaVersions.temp !== schemaVersions.temp) {
            // DDL-only auth/application installers remain supported, but DDL
            // cannot share a commit with tracked changes. Otherwise a caller
            // could create a mutating trigger/FK, use it, remove it, and leave
            // an apparently compatible final schema around an unlogged row.
            finalSchemaVersions = this.changeLog.validateSchemaFence(
              schemaVersions,
              finalSchemaVersions,
            );
            if (pendingChanges.length > 0) {
              throw new Error(
                'ReactiveDB transactions cannot combine schema changes with tracked changes',
              );
            }
          }
          const release = commitGuard?.beforeCommit(guardSnapshot);
          if (release !== undefined && typeof release !== 'function') {
            throw new TypeError('ReactiveDB commit guard returned an invalid lease');
          }
          commitGuardLease.release = release ?? null;
          committedSchemaVersions = finalSchemaVersions;
          return value;
        }).immediate());

      // Schema changes inside a rolled-back transaction disappear, so advance
      // the cache only after SQLite confirms this transaction committed.
      this.changeLog.commitSchemaVersions(committedSchemaVersions!);

      // The cross-database authority edge protects the SQLite commit, not
      // listener delivery or application callbacks. Release immediately after
      // the local commit is durably settled so a synchronous afterCommit
      // Guardian mutation cannot conflict with an already-finished data write.
      commitGuardLease.release?.();
      commitGuardLease.release = null;

      // Transaction committed — emit all deferred changes
      this.inTransaction = false;
      this.deferredChanges = null;
      this.postCommitCallbacks = null;
      this.postCommitFences = null;
      discardReactiveDBRollbackRecoveries(this);
      this.activeTransactionChangeOrigin = null;
      this.activeTransactionToken = null;
      retireReactiveDBTransactionToken(transactionToken);

      const postCommitFenceFailure = this.runPostCommitFences(
        pendingPostCommitFences,
      );

      if (pendingChanges.length > 0 && this.externalChangeDispatcher) {
        // The durable dispatcher is the sole listener path while replica
        // polling is active. A synchronous drain keeps local writes responsive
        // but first emits every lower sequence committed by another handle.
        this.externalChangeDispatcher.drain();
      } else {
        this.enqueueLocalChanges(pendingChanges);
      }

      this.runPostCommitCallbacks(pendingPostCommitCallbacks);

      if (postCommitFenceFailure) throw postCommitFenceFailure;

      return result;
    } catch (err) {
      // Mandatory fences run only after the committed transaction state has
      // been fully released. Their failure reports the committed-but-unknown
      // boundary and must never execute rollback recovery against that commit.
      if (!this.inTransaction) throw err;
      // Transaction rolled back — the database-owned sequence allocation and
      // all pending change rows roll back with the application writes. Keep
      // this execution poisoned as well: any detached async continuation
      // created inside the failed synchronous transaction retains this
      // AsyncLocalStorage context and must not begin a fresh write later.
      if (!execution.rollbackOnlyError) {
        execution.rollbackOnlyError = err instanceof Error
          ? err
          : new Error(String(err));
      }
      this.inTransaction = false;
      this.deferredChanges = null;
      this.postCommitCallbacks = null;
      this.postCommitFences = null;
      this.activeTransactionChangeOrigin = null;
      this.activeTransactionToken = null;
      retireReactiveDBTransactionToken(transactionToken);
      for (const change of pendingChanges) {
        clearReactiveDBLocalChangeOrigin(this, change.seq);
      }
      // A recovery may open a fresh transaction, so release any authority
      // lease retained by a failed commit attempt before invoking it.
      commitGuardLease.release?.();
      commitGuardLease.release = null;
      runReactiveDBRollbackRecoveries(this);
      throw err;
    } finally {
      retireReactiveDBTransactionToken(transactionToken);
      commitGuardLease.release?.();
    }
  }

  /**
   * Append one logical change for an internal SQLite mutation that already ran
   * inside this ReactiveDB transaction.
   *
   * This intentionally accepts only underscore-prefixed tables and refuses to
   * open its own transaction. Platform subsystems can therefore make a raw
   * internal-table write and its durable change-log entry one atomic commit
   * without turning arbitrary raw SQL into an untracked public write surface.
   * The row id must be a non-empty string; no coercion is performed.
   */
  recordInternalChange(input: {
    table: string;
    op: ChangeOp;
    rowId: string;
    row?: Row | null;
    previousRow?: Row | null;
  }): Change {
    try {
      this.assertNotDisposed();
      this.assertNotInSnapshotReader();
      if (!this.inTransaction) {
        throw new Error('ReactiveDB internal changes require an active transaction');
      }
      if (typeof input.table !== 'string'
        || !input.table.startsWith('_')
        || input.table === '_changes'
        || input.table === LEGACY_CHANGE_SEQUENCE_TABLE
        || input.table === CHANGE_LOG_STATE_TABLE) {
        throw new Error(
          `ReactiveDB internal changes require an underscore-prefixed data table; received '${input.table}'`,
        );
      }
      if (typeof input.rowId !== 'string' || input.rowId.length === 0) {
        throw new Error('ReactiveDB internal changes require a non-empty string row id');
      }

      const row = input.row ?? null;
      const previousRow = input.previousRow ?? null;
      const hasValidShape = input.op === 'INSERT'
        ? row !== null && previousRow === null
        : input.op === 'UPDATE'
          ? row !== null && previousRow !== null
          : row === null && previousRow !== null;
      if (!hasValidShape
        || (row !== null && !isSerializableRowObject(row))
        || (previousRow !== null && !isSerializableRowObject(previousRow))) {
        throw new Error(
          `ReactiveDB internal ${input.op} changes require the canonical v1 row/previousRow shape`,
        );
      }

      const change = this.createChange(
        input.table,
        input.op,
        input.rowId,
        row,
        previousRow,
      );
      this.recordAndEmit(change);
      return change;
    } catch (error) {
      this.markTransactionRollbackOnly(error);
      throw error;
    }
  }

  // ─── Raw Access ─────────────────────────────────────────────────────────

  /**
   * Execute raw SQL. Use for creating internal (_-prefixed) tables
   * that don't need change tracking (e.g., _credentials, _auth_config).
   * Keep schema DDL in a separate transaction from tracked mutations.
   */
  exec(sql: string): void {
    this.assertNotDisposed();
    this.db.run(sql);
  }

  /**
   * Prepare a raw SQL statement. Use for internal table operations
   * where you don't want change tracking.
   */
  prepare(sql: string) {
    this.assertNotDisposed();
    return this.db.prepare(sql);
  }

  /**
   * Get the list of defined table names.
   */
  getTableNames(): string[] {
    this.assertNotDisposed();
    return Array.from(this.tables.keys());
  }

  /**
   * Check if a table has been defined.
   */
  hasTable(name: string): boolean {
    this.assertNotDisposed();
    return this.tables.has(name);
  }

  /**
   * Get the primary key column name for a defined table.
   */
  getPrimaryKey(table: string): string {
    this.assertNotDisposed();
    return getTableDef(this.tables, table).primaryKey;
  }

  /** Get the ordered SQL column names for a defined table. */
  getColumns(table: string): string[] {
    this.assertNotDisposed();
    return [...getTableDef(this.tables, table).columns];
  }

  /**
   * Get the current sequence number.
   */
  get currentSeq(): number {
    this.assertNotDisposed();
    this.assertChangeLogUsable();
    return this.changeLog.currentSequence;
  }

  /** Process-unique cursor epoch used to reject pre-restart client sequences. */
  get syncEpoch(): string {
    this.assertNotDisposed();
    return this.epoch;
  }

  /** Return the platform SQLite service backing this ReactiveDB, if present. */
  getSQLiteService(): PlatformSQLiteService | null {
    this.assertNotDisposed();
    return this.sqlite;
  }

  /** Return the raw Bun SQLite handle for advanced platform internals. */
  getRawDatabase(): Database {
    this.assertNotDisposed();
    return this.db;
  }

  // ─── Lifecycle ──────────────────────────────────────────────────────────

  /**
   * Close the SQLite database and release all resources.
   * After disposal, all methods throw.
   */
  dispose(): void {
    if (this.lifecycleState === 'disposed') return;
    if (this.lifecycleState === 'releasing' || this.lifecycleState === 'closing') {
      throw new Error('ReactiveDB disposal is already in progress');
    }

    if (this.lifecycleState === 'active') {
      this.assertNotInSnapshotReader();
      const rollbackOnlyError = this.transactionExecution.getStore()?.rollbackOnlyError;
      if (rollbackOnlyError) {
        throw createRollbackOnlyError(rollbackOnlyError);
      }
      if (this.inTransaction) {
        const error = new Error(
          'ReactiveDB cannot be disposed during an active transaction',
        );
        this.markTransactionRollbackOnly(error);
        throw error;
      }
      if (this.changeDeliveryDepth > 0) {
        throw new Error('ReactiveDB cannot be disposed during change delivery');
      }

      this.lifecycleState = 'releasing';
      // Seal trusted interceptor registration before any fallible resource
      // cleanup. A partially released database must never accept a new hook.
      disposeReactiveDBMutationInterceptorHost(this);
      try {
        this.externalChangeDispatcher?.stop();

        // Finalize all table prepared statements exactly once. If any release
        // step throws, the runtime remains sealed and a later dispose call may
        // still close its owned SQLite handle without repeating this cleanup.
        for (const def of this.tables.values()) {
          finalizeTableStatements(def);
        }

        this.changeLog.dispose();

        this.tables.clear();
        this.managedTableSchemaContracts.clear();
        this.listeners.length = 0;
        this.localDeliveryQueue.length = 0;
        this.drainingLocalDeliveryQueue = false;
        this.activeTransactionChangeOrigin = null;
        this.activeTransactionToken = null;
        this.postCommitCallbacks = null;
        this.postCommitFences = null;
        clearAllReactiveDBLocalChangeOrigins(this);
        reactiveDBCommitGuards.delete(this);
        discardReactiveDBRollbackRecoveries(this);
      } finally {
        this.lifecycleState = 'released';
      }
    }

    // Keep `released` when the durability boundary fails. Application methods
    // stay sealed, while a later dispose call retries only the underlying
    // close and cannot double-finalize prepared statements.
    this.lifecycleState = 'closing';
    try {
      if (this.ownsSQLiteService) {
        this.sqlite?.close();
      } else if (this.ownsDatabase) {
        this.db.close();
      }
    } catch (error) {
      this.lifecycleState = 'released';
      throw error;
    }
    this.lifecycleState = 'disposed';
  }

  // ─── Private ────────────────────────────────────────────────────────────

  private nextSeq(): number {
    if (!this.inTransaction) {
      throw new Error('ReactiveDB sequence allocation requires an active write transaction');
    }
    return this.changeLog.allocateSequence();
  }

  private createChange(
    table: string,
    op: ChangeOp,
    rowId: string,
    row: Row | null,
    previousRow: Row | null = null
  ): Change {
    this.assertNotInSnapshotReader();
    return {
      seq: this.nextSeq(),
      table,
      op,
      rowId,
      row: canonicalizeChangeRow(row, 'row'),
      previousRow: canonicalizeChangeRow(previousRow, 'previousRow'),
      ts: Date.now(),
    };
  }

  /**
   * Record a change in the ring buffer and emit to listeners.
   * During transactions, emission is deferred until commit.
   */
  private recordAndEmit(change: Change): void {
    this.recordChange(change);
    // The returned Change is public API and may be mutated by application code
    // before an explicit outer transaction commits. Keep delivery isolated from
    // that caller-owned object just as listener payloads are isolated below.
    const deliveryChange = cloneChange(change);
    if (this.activeTransactionChangeOrigin !== null) {
      bindReactiveDBLocalChangeOrigin(
        this,
        deliveryChange.seq,
        this.activeTransactionChangeOrigin,
      );
    }

    if (this.inTransaction && this.deferredChanges) {
      // Defer emission until transaction commits
      this.deferredChanges.push(deliveryChange);
      if (!this.activeTransactionToken) {
        throw new Error('ReactiveDB mutation interception requires an active transaction token');
      }
      invokeReactiveDBMutationInterceptor(
        this,
        deliveryChange,
        this.activeTransactionToken,
      );
    } else {
      this.enqueueLocalChanges([deliveryChange]);
    }
  }

  /**
   * Write a change to the _changes ring buffer and prune old entries.
   * Runs atomically — insert + prune in a single transaction.
   *
   * During an outer transaction, this runs within that transaction
   * (bun:sqlite doesn't support nested transactions, but the statements
   * execute within the active transaction context).
   */
  private recordChange(change: Change): void {
    if (!this.inTransaction) {
      throw new Error('ReactiveDB change recording requires an active write transaction');
    }
    this.changeLog.record(change, this.epoch);
  }

  /**
   * Emit a change to all registered listeners.
   * Errors in listeners are caught and logged — a broken listener
   * cannot prevent subsequent listeners from being called.
   */
  private emitChange(
    change: Change,
    delivery: ChangeDeliveryMetadata,
  ): void {
    // Subscription mutation during one callback must not skip another listener
    // that was part of this event's dispatch set.
    this.changeDeliveryDepth += 1;
    try {
      for (const listener of [...this.listeners]) {
        try {
          const result = (listener as (
            value: Change,
            metadata: ChangeDeliveryMetadata,
          ) => unknown)(cloneChange(change), { ...delivery });
          if (isReactiveDBPromiseLike(result)) {
            void Promise.resolve(result).catch(() => {});
            throw new Error('ReactiveDB onChange listeners must be synchronous');
          }
        } catch {
          // Listener failures are operational signals only. Never attach row
          // payloads, identifiers, or application exception text.
          this.reportPlatformCode(OBS_CODES.SYNC_CHANGE_LISTENER_FAILED);
        }
      }
    } finally {
      this.changeDeliveryDepth -= 1;
      clearReactiveDBLocalChangeOrigin(this, change.seq);
    }
  }

  /**
   * Preserve commit order across reentrant local writes. The whole committed
   * batch is queued before delivery begins, so a listener-triggered commit is
   * appended behind every earlier sequence instead of interleaving with it.
   */
  private enqueueLocalChanges(changes: readonly Change[]): void {
    if (changes.length === 0) return;
    this.localDeliveryQueue.push(...changes);
    if (this.drainingLocalDeliveryQueue) return;

    this.drainingLocalDeliveryQueue = true;
    let delivered = 0;
    try {
      while (delivered < this.localDeliveryQueue.length) {
        const change = this.localDeliveryQueue[delivered]!;
        delivered += 1;
        this.emitChange(change, { source: 'local' });
      }
    } finally {
      this.localDeliveryQueue.splice(0, delivered);
      this.drainingLocalDeliveryQueue = false;
    }
  }

  private runPostCommitCallbacks(callbacks: readonly (() => unknown)[]): void {
    for (const callback of callbacks) {
      try {
        const result = callback();
        if (isReactiveDBPromiseLike(result)) {
          void Promise.resolve(result).catch(() => {});
          throw new Error('ReactiveDB afterCommit callbacks must be synchronous');
        }
      } catch (error) {
        this.reportPlatformCode(OBS_CODES.SYNC_POST_COMMIT_NOTIFICATION_FAILED, {
          error,
        });
      }
    }
  }

  private runPostCommitFences(
    fences: readonly (() => unknown)[],
  ): unknown | null {
    const failures: unknown[] = [];
    for (const fence of fences) {
      try {
        const result = fence();
        if (isReactiveDBPromiseLike(result)) {
          void Promise.resolve(result).catch(() => {});
          throw new Error('ReactiveDB afterCommitFence callbacks must be synchronous');
        }
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length === 0) return null;
    return failures.length === 1
      ? failures[0]
      : new AggregateError(failures, 'ReactiveDB post-commit fences failed');
  }

  private assertNotDisposed(): void {
    const rollbackOnlyError = this.transactionExecution.getStore()?.rollbackOnlyError;
    if (rollbackOnlyError) {
      throw createRollbackOnlyError(rollbackOnlyError);
    }
    if (this.lifecycleState !== 'active') {
      throw new Error('ReactiveDB is disposed');
    }
  }

  private reportPlatformCode(
    definition: PlatformCodeDefinition,
    options?: PlatformCodeEmitOptions,
  ): void {
    try {
      const outcome = this.emitCode(definition, options);
      if (outcome !== null
        && (typeof outcome === 'object' || typeof outcome === 'function')
        && typeof (outcome as { then?: unknown }).then === 'function') {
        void Promise.resolve(outcome).catch(() => {});
      }
    } catch {
      // Observability is best-effort and cannot disrupt committed delivery.
    }
  }

  private assertNotInSnapshotReader(): void {
    const context = this.transactionExecution.getStore();
    if (!context || context.snapshotReaderDepth === 0) return;
    const error = new Error(
      'ReactiveDB snapshot readers are read-only; managed writes and disposal are not allowed',
    );
    this.markTransactionRollbackOnly(error);
    throw error;
  }

  private markTransactionRollbackOnly(error: unknown): void {
    const context = this.transactionExecution.getStore();
    if (!context || context.rollbackOnlyError) return;
    context.rollbackOnlyError = error instanceof Error
      ? error
      : new Error(String(error));
  }

  private assertChangeLogUsable(): void {
    if (this.changeLogInvalid) {
      throw new Error(
        'ZERO_SYNC_LOG_STATE_INVALID: runtime was invalidated; restart after repair',
      );
    }
  }
}

// ─── Factory ──────────────────────────────────────────────────────────────

/** Create a new ReactiveDB instance. */
export function createReactiveDB(config: ReactiveDBConfig): ReactiveDB {
  return new ReactiveDB(config);
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function createReactiveDBRuntime(config: ReactiveDBConfig): ReactiveDBRuntime {
  if (config.sqlite) {
    return {
      database: config.sqlite.raw,
      sqlite: config.sqlite,
      ownsSQLiteService: false,
      ownsDatabase: false,
      clearChangesOnStart: config.clearChangesOnStart ?? false,
    };
  }

  if (config.database) {
    return {
      database: config.database,
      sqlite: null,
      ownsSQLiteService: false,
      ownsDatabase: config.ownsDatabase ?? false,
      clearChangesOnStart: config.clearChangesOnStart ?? false,
    };
  }

  const sqlite = createPlatformSQLiteService(config, {
    observability: config.observability ?? undefined,
  });
  sqlite.start();

  return {
    database: sqlite.raw,
    sqlite,
    ownsSQLiteService: true,
    ownsDatabase: false,
    clearChangesOnStart: config.clearChangesOnStart ?? false,
  };
}

function requireCanonicalReactiveDBRowId(
  table: string,
  primaryKey: string,
  value: unknown,
): string {
  const canonical = canonicalDatabaseRowId(value);
  if (canonical === null) {
    throw new Error(
      `ReactiveDB table '${table}' primary key '${primaryKey}' must persist as a bounded string or safe integer`,
    );
  }
  return canonical;
}

function createRollbackOnlyError(cause: Error): Error {
  return new Error(
    `ReactiveDB transaction is rollback-only: ${cause.message}`,
    { cause },
  );
}
