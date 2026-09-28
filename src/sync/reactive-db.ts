import type { Database, Statement } from 'bun:sqlite';
import { AsyncLocalStorage } from 'node:async_hooks';
import {
  createIdentityId,
  getIdentityValues,
  hasIdentity,
  quoteSqlIdentifier,
  type IdentityKey,
} from './identity';
import { OBS_CODES } from '../observability/codes';
import { emitPlatformCode } from '../observability/sink';
import { createPlatformSQLiteService, type PlatformSQLiteService } from '../persistence';
import type {
  ReactiveDBConfig,
  TableSchema,
  Row,
  Change,
  ChangeOp,
  ChangeListener,
  ChangeDeliveryMetadata,
  SyncHistoryGap,
  TableDef,
  ChangeStatements,
  ChangeRow,
} from './types';

const DEFAULT_RING_BUFFER_DEPTH = 1000;
const CHANGE_LOG_SCHEMA_VERSION = 1;
const CHANGE_LOG_FORMAT_VERSION = 1;
const CHANGE_LOG_MIN_READER_FORMAT = 0;
const CHANGE_LOG_SENTINEL_TABLE = '_zero_sync_fence';
const CHANGE_LOG_SENTINEL_ROW_ID = 'format-v1';
const CHANGE_LOG_STATE_TABLE = '_zero_sync_log_state';
const LEGACY_CHANGE_SEQUENCE_TABLE = '_change_sequence';

const CHANGE_LOG_TRIGGER_SQL = Object.freeze({
  insert: `
    CREATE TRIGGER _zero_sync_changes_insert_fence_v1
    BEFORE INSERT ON main._changes
    WHEN CASE
      WHEN NEW.seq > 0
        AND typeof(NEW.format_version) = 'integer'
        AND NEW.format_version = 1
        AND NEW.op COLLATE BINARY IN ('INSERT', 'UPDATE', 'DELETE')
        AND NOT EXISTS (SELECT 1 FROM main._changes WHERE seq = NEW.seq)
        AND EXISTS (
          SELECT 1 FROM main._zero_sync_log_state
          WHERE singleton = 1
            AND schema_version = 1
            AND write_format = 1
            AND min_reader_format = 0
            AND seq = NEW.seq
        )
      THEN 0
      ELSE 1
    END = 1
    BEGIN
      SELECT RAISE(ROLLBACK, 'ZERO_SYNC_LOG_FORMAT_INCOMPATIBLE');
    END
  `,
  update: `
    CREATE TRIGGER _zero_sync_changes_update_fence_v1
    BEFORE UPDATE ON main._changes
    BEGIN
      SELECT RAISE(ROLLBACK, 'ZERO_SYNC_LOG_IMMUTABLE');
    END
  `,
  delete: `
    CREATE TRIGGER _zero_sync_changes_delete_fence_v1
    BEFORE DELETE ON main._changes
    WHEN OLD.seq = 0 OR NOT EXISTS (
      SELECT 1 FROM main._zero_sync_log_state
      WHERE singleton = 1
        AND schema_version = 1
        AND write_format = 1
        AND min_reader_format = 0
        AND OLD.seq > 0
        AND OLD.seq <= prune_through
    )
    BEGIN
      SELECT RAISE(ROLLBACK, 'ZERO_SYNC_LOG_DELETE_FORBIDDEN');
    END
  `,
  stateInsert: `
    CREATE TRIGGER _zero_sync_log_state_insert_fence_v1
    BEFORE INSERT ON main._zero_sync_log_state
    WHEN EXISTS (SELECT 1 FROM main._zero_sync_log_state WHERE singleton = 1)
    BEGIN
      SELECT RAISE(ROLLBACK, 'ZERO_SYNC_LOG_STATE_INVALID');
    END
  `,
  stateUpdate: `
    CREATE TRIGGER _zero_sync_log_state_update_fence_v1
    BEFORE UPDATE ON main._zero_sync_log_state
    WHEN
      NEW.singleton <> 1
      OR typeof(NEW.schema_version) <> 'integer'
      OR typeof(NEW.write_format) <> 'integer'
      OR typeof(NEW.min_reader_format) <> 'integer'
      OR typeof(NEW.seq) <> 'integer'
      OR typeof(NEW.prune_through) <> 'integer'
      OR NEW.schema_version <> OLD.schema_version
      OR NEW.write_format <> OLD.write_format
      OR NEW.min_reader_format <> OLD.min_reader_format
      OR NEW.seq < OLD.seq
      OR NEW.seq > 9007199254740991
      OR NEW.prune_through < OLD.prune_through
      OR NEW.prune_through > NEW.seq
      OR NOT (
        (NEW.seq = OLD.seq + 1 AND NEW.prune_through = OLD.prune_through)
        OR (NEW.seq = OLD.seq AND NEW.prune_through >= OLD.prune_through)
      )
    BEGIN
      SELECT RAISE(ROLLBACK, 'ZERO_SYNC_LOG_STATE_INVALID');
    END
  `,
  stateDelete: `
    CREATE TRIGGER _zero_sync_log_state_delete_fence_v1
    BEFORE DELETE ON main._zero_sync_log_state
    BEGIN
      SELECT RAISE(ROLLBACK, 'ZERO_SYNC_LOG_STATE_INVALID');
    END
  `,
  legacySequenceInsert: `
    CREATE TRIGGER _zero_sync_legacy_sequence_insert_fence_v1
    BEFORE INSERT ON main._change_sequence
    BEGIN
      SELECT RAISE(ROLLBACK, 'ZERO_SYNC_LOG_FORMAT_INCOMPATIBLE');
    END
  `,
  legacySequenceUpdate: `
    CREATE TRIGGER _zero_sync_legacy_sequence_update_fence_v1
    BEFORE UPDATE ON main._change_sequence
    BEGIN
      SELECT RAISE(ROLLBACK, 'ZERO_SYNC_LOG_FORMAT_INCOMPATIBLE');
    END
  `,
  legacySequenceDelete: `
    CREATE TRIGGER _zero_sync_legacy_sequence_delete_fence_v1
    BEFORE DELETE ON main._change_sequence
    BEGIN
      SELECT RAISE(ROLLBACK, 'ZERO_SYNC_LOG_FORMAT_INCOMPATIBLE');
    END
  `,
});

const CHANGE_LOG_TRIGGER_DEFINITIONS = Object.freeze([
  ['_zero_sync_changes_insert_fence_v1', CHANGE_LOG_TRIGGER_SQL.insert],
  ['_zero_sync_changes_update_fence_v1', CHANGE_LOG_TRIGGER_SQL.update],
  ['_zero_sync_changes_delete_fence_v1', CHANGE_LOG_TRIGGER_SQL.delete],
  ['_zero_sync_log_state_insert_fence_v1', CHANGE_LOG_TRIGGER_SQL.stateInsert],
  ['_zero_sync_log_state_update_fence_v1', CHANGE_LOG_TRIGGER_SQL.stateUpdate],
  ['_zero_sync_log_state_delete_fence_v1', CHANGE_LOG_TRIGGER_SQL.stateDelete],
  ['_zero_sync_legacy_sequence_insert_fence_v1', CHANGE_LOG_TRIGGER_SQL.legacySequenceInsert],
  ['_zero_sync_legacy_sequence_update_fence_v1', CHANGE_LOG_TRIGGER_SQL.legacySequenceUpdate],
  ['_zero_sync_legacy_sequence_delete_fence_v1', CHANGE_LOG_TRIGGER_SQL.legacySequenceDelete],
] as const);

interface ChangeLogStateRow {
  singleton: number;
  schema_version: number;
  write_format: number;
  min_reader_format: number;
  seq: number;
  prune_through: number;
}

interface ChangeLogReadSnapshot {
  state: ChangeLogStateRow;
  rows: ChangeRow[];
  oldestSeq: number;
  contiguous: boolean;
}

interface ReactiveDBRuntime {
  database: Database;
  sqlite: PlatformSQLiteService | null;
  ownsSQLiteService: boolean;
  ownsDatabase: boolean;
  clearChangesOnStart: boolean;
}

interface ExternalChangeDispatcher {
  drain: () => void;
  stop: () => void;
}

interface TransactionExecutionContext {
  rollbackOnlyError: Error | null;
  snapshotReaderDepth: number;
}

interface SQLiteSchemaVersions {
  main: number;
  temp: number;
}

interface ManagedTableColumnContract {
  cid: number;
  name: string;
  type: string;
  notnull: number;
  dflt_value: unknown;
  pk: number;
  hidden: number;
}

interface ManagedTablePrimaryKeyIndexColumnContract {
  seqno: number;
  cid: number;
  name: string | null;
  desc: number;
  coll: string | null;
  key: number;
}

interface ManagedTablePrimaryKeyIndexContract {
  name: string;
  unique: number;
  origin: string;
  partial: number;
  columns: ManagedTablePrimaryKeyIndexColumnContract[];
}

/**
 * One-shot transport attribution for the next outer transaction on a specific
 * ReactiveDB instance. This stays module-internal to the Sync transport: it is
 * neither persisted in `_changes` nor exposed through ReactiveDB's public
 * change payload/metadata contract.
 */
const requestedLocalChangeOrigins = new WeakMap<ReactiveDB, string>();
const committedLocalChangeOrigins = new WeakMap<ReactiveDB, Map<number, string>>();

/** Bind an exact socket origin to every row committed by one outer transaction. */
export function withReactiveDBLocalChangeOrigin<T>(
  db: ReactiveDB,
  origin: string,
  operation: () => T,
): T {
  const previous = requestedLocalChangeOrigins.get(db);
  requestedLocalChangeOrigins.set(db, origin);
  try {
    return operation();
  } finally {
    if (previous === undefined) requestedLocalChangeOrigins.delete(db);
    else requestedLocalChangeOrigins.set(db, previous);
  }
}

/** Read process-local attribution while the matching committed row is delivered. */
export function getReactiveDBLocalChangeOrigin(
  db: ReactiveDB,
  sequence: number,
): string | null {
  return committedLocalChangeOrigins.get(db)?.get(sequence) ?? null;
}

function takeRequestedLocalChangeOrigin(db: ReactiveDB): string | null {
  const origin = requestedLocalChangeOrigins.get(db) ?? null;
  requestedLocalChangeOrigins.delete(db);
  return origin;
}

function bindCommittedLocalChangeOrigin(
  db: ReactiveDB,
  sequence: number,
  origin: string,
): void {
  let origins = committedLocalChangeOrigins.get(db);
  if (!origins) {
    origins = new Map();
    committedLocalChangeOrigins.set(db, origins);
  }
  origins.set(sequence, origin);
}

function clearCommittedLocalChangeOrigin(db: ReactiveDB, sequence: number): void {
  const origins = committedLocalChangeOrigins.get(db);
  if (!origins) return;
  origins.delete(sequence);
  if (origins.size === 0) committedLocalChangeOrigins.delete(db);
}

function clearCommittedLocalChangeOriginsThrough(
  db: ReactiveDB,
  sequence: number,
): void {
  const origins = committedLocalChangeOrigins.get(db);
  if (!origins) return;
  for (const committedSequence of origins.keys()) {
    if (committedSequence <= sequence) origins.delete(committedSequence);
  }
  if (origins.size === 0) committedLocalChangeOrigins.delete(db);
}

function clearAllCommittedLocalChangeOrigins(db: ReactiveDB): void {
  committedLocalChangeOrigins.delete(db);
}

/** Exact stored SQLite definition and structure managed CRUD is allowed to use. */
interface ManagedTableSchemaContract {
  name: string;
  type: string;
  definition: string;
  ncol: number;
  withoutRowId: number;
  strict: number;
  columns: ManagedTableColumnContract[];
  primaryKeyIndexes: ManagedTablePrimaryKeyIndexContract[];
}

/**
 * Trusted equality predicate enforced with exact JS, SQLite storage-class, and
 * BINARY comparison semantics. Declared column affinity/collation cannot widen it.
 */
export interface ReactiveDBRowScope {
  field: string;
  value: string | number;
}

/** Options for durable change fanout between ReactiveDB file connections. */
export interface ExternalChangePollingOptions {
  /** Positive safe-integer poll cadence in milliseconds. Values below 10ms are clamped. */
  intervalMs?: number;
  /**
   * Called when retention/corruption makes incremental delivery impossible.
   * If omitted or if it throws, the dispatcher permanently invalidates this
   * runtime rather than silently advancing past undelivered history.
   */
  onGap?: (gap: SyncHistoryGap) => void;
  /**
   * Called once when the durable log/state is incompatible or corrupt.
   * The dispatcher stops after this callback; connected transports must
   * invalidate their clients rather than continue from an untrusted cursor.
   */
  onInvalid?: (error: unknown) => void;
  /** Called for a transient poll failure. The cursor is retained for retry. */
  onError?: (error: unknown) => void;
}

/**
 * ReactiveDB — SQLite wrapper that makes every write observable.
 *
 * Define a table, get prepared CRUD statements and change events for free.
 * One instance per application.
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
 *  4. Emits to change listeners
 */
export class ReactiveDB {
  private readonly epoch = crypto.randomUUID();
  private db: Database;
  private sqlite: PlatformSQLiteService | null;
  private ownsSQLiteService: boolean;
  private ownsDatabase: boolean;
  private clearChangesOnStart: boolean;
  private tables: Map<string, TableDef> = new Map();
  private listeners: ChangeListener[] = [];
  private ringBufferDepth: number;
  private changeStmts: ChangeStatements;
  private validatedSchemaVersions: SQLiteSchemaVersions;
  private managedTableSchemaContracts = new Map<string, ManagedTableSchemaContract>();
  private disposed = false;
  private changeLogInvalid = false;
  private externalChangeDispatcher: ExternalChangeDispatcher | null = null;
  private readonly localDeliveryQueue: Change[] = [];
  private drainingLocalDeliveryQueue = false;
  private changeDeliveryDepth = 0;
  private activeTransactionChangeOrigin: string | null = null;

  // Transaction support: when true, changes are accumulated and emitted after commit
  private inTransaction = false;
  private deferredChanges: Change[] | null = null;
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
    this.clearChangesOnStart = runtime.clearChangesOnStart;
    this.ringBufferDepth = ringBufferDepth;

    try {
      this.createChangesTable();
      this.changeStmts = this.prepareChangeStatements();
      this.validatedSchemaVersions = this.readSchemaVersions();
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

    // Find primary key: first column whose definition contains 'primary key'
    let primaryKey: string | null = null;
    for (const col of columns) {
      const def = schema[col];
      if (typeof def !== 'string') {
        throw new Error(`defineTable('${name}'): column '${col}' must have a SQL definition string`);
      }
      if (def.toLowerCase().includes('primary key')) {
        primaryKey = col;
        break;
      }
    }
    if (!primaryKey) {
      throw new Error(
        `defineTable('${name}'): schema must have a column with 'primary key' in its definition`
      );
    }

    this.validateIdentity(name, columns, primaryKey, identity);

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
        this.assertManagedForeignKeyActionsSafe(name);

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
        schemaContract = this.readManagedTableSchemaContract(name);
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
      const def = this.getTableDef(table);
      const nextRow = this.ensurePrimaryKeyFromIdentity(def, row);
      const pkValue = nextRow[def.primaryKey];
      if (pkValue === undefined || pkValue === null || pkValue === '') {
        throw new Error(`insert('${table}'): row is missing primary key '${def.primaryKey}'`);
      }
      const pk = String(pkValue);

      // Check if row already exists to determine correct op
      const existing = def.stmts.getOne.get(pk) as Row | null;
      const op: ChangeOp = existing ? 'UPDATE' : 'INSERT';
      if (existing) this.assertIdentityUnchanged(def, existing, nextRow);
      this.assertNoIdentityConflict(
        def,
        nextRow,
        existing ? String(existing[def.primaryKey]) : pk,
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
      const persistedId = String(fullRow[def.primaryKey]);

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
      const def = this.getTableDef(table);
      return this.transaction(() => {
        const nextRow = this.ensurePrimaryKeyFromIdentity(def, row);
        const pkValue = nextRow[def.primaryKey];
        if (pkValue === undefined || pkValue === null || pkValue === '') {
          throw new Error(`createStrict('${table}'): row is missing primary key '${def.primaryKey}'`);
        }
        const pk = String(pkValue);
        if (def.stmts.getOne.get(pk)) {
          throw new Error(`createStrict('${table}'): primary key already exists`);
        }
        this.assertNoIdentityConflict(def, nextRow, pk);

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
          String(fullRow[def.primaryKey]),
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
      const def = this.getTableDef(table);
      this.assertValidRowScope(def, scope);
      return this.transaction(() => {
        const nextRow = this.ensurePrimaryKeyFromIdentity(def, row);
        if (nextRow[scope.field] !== scope.value) {
          throw new Error(`createScoped('${table}'): row does not match trusted scope '${scope.field}'`);
        }

        const pkValue = nextRow[def.primaryKey];
        if (pkValue === undefined || pkValue === null || pkValue === '') {
          throw new Error(`createScoped('${table}'): row is missing primary key '${def.primaryKey}'`);
        }
        const pk = String(pkValue);
        if (def.stmts.getOne.get(pk)) {
          throw new Error(`createScoped('${table}'): primary key already exists`);
        }
        this.assertNoIdentityConflict(def, nextRow, pk);

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
          String(fullRow[def.primaryKey]),
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
      const def = this.getTableDef(table);

      // Read current row
      const existing = def.stmts.getOne.get(id) as Row | null;
      if (!existing) return null;
      this.assertIdentityUnchanged(def, existing, partial);

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
        String(fullRow[def.primaryKey]),
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
      const def = this.getTableDef(table);
      return this.transaction(() => {
        const existing = def.stmts.getOne.get(id) as Row | null;
        if (!existing) return null;
        this.assertIdentityUnchanged(def, existing, partial);

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
          String(fullRow[def.primaryKey]),
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
      const def = this.getTableDef(table);
      this.assertValidRowScope(def, scope);
      if (scope.field in partial) {
        throw new Error(`updateScoped('${table}'): trusted scope '${scope.field}' is immutable`);
      }

      return this.transaction(() => {
        const existing = this.queryOneScoped(def, id, scope);
        if (!existing) return null;
        this.assertIdentityUnchanged(def, existing, partial);

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

        const fullRow = this.queryOneScoped(def, id, scope);
        if (!fullRow) {
          throw new Error(`updateScoped('${table}'): persisted row escaped trusted scope`);
        }
        const change = this.createChange(
          table,
          'UPDATE',
          String(fullRow[def.primaryKey]),
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
      const def = this.getTableDef(table);

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
        String(existing[def.primaryKey]),
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
      const def = this.getTableDef(table);
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
          String(existing[def.primaryKey]),
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
      const def = this.getTableDef(table);
      this.assertValidRowScope(def, scope);
      return this.transaction(() => {
        const existing = this.queryOneScoped(def, id, scope);
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
          String(existing[def.primaryKey]),
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
    const def = this.getTableDef(table);
    return def.stmts.getAll.all() as Row[];
  }

  /** Canonical list alias for query(). */
  list(table: string): Row[] {
    return this.query(table);
  }

  /** Get a single row by primary key. Returns null if not found. */
  queryOne(table: string, id: string): Row | null {
    this.assertNotDisposed();
    const def = this.getTableDef(table);
    return (def.stmts.getOne.get(id) as Row | null) ?? null;
  }

  /** Canonical get alias for queryOne(). */
  get(table: string, id: string): Row | null {
    return this.queryOne(table, id);
  }

  /** Read one row with exact storage-class/BINARY trusted-realm equality. */
  getScoped(table: string, id: string, scope: ReactiveDBRowScope): Row | null {
    this.assertNotDisposed();
    const def = this.getTableDef(table);
    this.assertValidRowScope(def, scope);
    return this.queryOneScoped(def, id, scope);
  }

  /** Get the ordered natural identity fields for a table, if configured. */
  getIdentity(table: string): string[] {
    this.assertNotDisposed();
    return [...(this.getTableDef(table).identity ?? [])];
  }

  /** Return the deterministic sync primary key for a natural identity object. */
  identityKey(table: string, key: IdentityKey): string {
    this.assertNotDisposed();
    const def = this.getTableDef(table);
    if (!hasIdentity(def.identity)) {
      throw new Error(`Table '${table}' does not define a natural identity.`);
    }
    return createIdentityId(table, def.identity, key);
  }

  /** Get a single row by natural identity. Returns null if not found. */
  queryByIdentity(table: string, key: IdentityKey): Row | null {
    this.assertNotDisposed();
    const def = this.getTableDef(table);
    const stmt = this.requireIdentityStatement(def);
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
    const def = this.getTableDef(table);
    this.requireIdentityStatement(def);

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
    const def = this.getTableDef(table);
    this.requireIdentityStatement(def);

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
    const def = this.getTableDef(table);
    this.requireIdentityStatement(def);

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
    const requestedInterval = options.intervalMs ?? 250;
    if (!Number.isSafeInteger(requestedInterval) || requestedInterval < 1) {
      throw new Error(
        'ReactiveDB replica polling intervalMs must be a positive safe integer',
      );
    }
    const intervalMs = Math.max(10, requestedInterval);
    this.assertChangeLogUsable();
    const initialState = validateChangeLogStateRow(
      this.changeStmts.current.get() as ChangeLogStateRow | null,
    );
    let cursor = initialState.seq;
    let lastObservedPruneThrough = initialState.prune_through;
    let draining = false;
    let drainQueued = false;
    let stopped = false;
    let timer: ReturnType<typeof setInterval> | null = null;

    const notifyError = (error: unknown) => {
      try {
        options.onError?.(error);
      } catch {
        // An observability callback cannot stop the durable dispatcher.
      }
    };

    const notifyGap = (gap: SyncHistoryGap): boolean => {
      if (!options.onGap) {
        notifyInvalid(new Error(
          'ZERO_SYNC_LOG_STATE_INVALID: replica history gap was not handled',
        ));
        return false;
      }
      try {
        const handler = options.onGap as (value: SyncHistoryGap) => unknown;
        const outcome = handler.call(options, gap);
        if (isPromiseLike(outcome)) {
          void Promise.resolve(outcome).catch(() => {});
          throw new Error(
            'ZERO_SYNC_LOG_STATE_INVALID: replica history gap handler must be synchronous',
          );
        }
        return true;
      } catch (error) {
        notifyError(error);
        notifyInvalid(new Error(
          'ZERO_SYNC_LOG_STATE_INVALID: replica history gap handler failed',
        ));
        return false;
      }
    };

    const stop = () => {
      stopped = true;
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
      if (this.externalChangeDispatcher?.stop === stop) {
        this.externalChangeDispatcher = null;
      }
    };

    const haltInvalid = () => {
      stopped = true;
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
      // Deliberately retain the dispatcher latch. Local commits must not fall
      // back to direct listener delivery after the durable cursor is invalid.
    };

    const notifyInvalid = (error: unknown) => {
      this.changeLogInvalid = true;
      // No further durable rows can be trusted or delivered after invalidation.
      // Drop only this runtime's process-local transport attribution so skipped
      // sequences cannot remain retained until disposal.
      clearAllCommittedLocalChangeOrigins(this);
      try {
        options.onInvalid?.(error);
      } catch (callbackError) {
        notifyError(callbackError);
      } finally {
        haltInvalid();
      }
    };

    const drainOnce = () => {
      const snapshot = this.readChangeLogSnapshot(cursor);
      const currentSeq = snapshot.state.seq;
      if (currentSeq < cursor) {
        throw new Error(
          'ZERO_SYNC_LOG_STATE_INVALID: durable sequence regressed behind replica cursor',
        );
      }
      if (snapshot.state.prune_through < lastObservedPruneThrough) {
        throw new Error(
          'ZERO_SYNC_LOG_STATE_INVALID: durable prune watermark regressed',
        );
      }
      lastObservedPruneThrough = snapshot.state.prune_through;
      if (currentSeq === cursor && snapshot.contiguous) return;

      if (!snapshot.contiguous) {
        const afterSeq = cursor;
        if (notifyGap({
          kind: cursor < snapshot.state.prune_through ? 'retention' : 'continuity',
          afterSeq,
          oldestSeq: snapshot.oldestSeq,
          currentSeq,
        })) {
          clearCommittedLocalChangeOriginsThrough(this, currentSeq);
          cursor = currentSeq;
        }
        return;
      }

      const decoded: Array<{
        change: Change;
        delivery: ChangeDeliveryMetadata;
      }> = [];
      for (const row of snapshot.rows) {
        try {
          // Decode the complete contiguous batch before advancing the cursor or
          // notifying a listener. Corrupt retained JSON therefore requires an
          // authoritative reconnect instead of becoming a silently lost row.
          decoded.push({
            change: deserializeChangeRow(row),
            delivery: { source: row.origin === this.epoch ? 'local' : 'external' },
          });
        } catch (error) {
          const afterSeq = cursor;
          notifyError(error);
          if (notifyGap({
            kind: 'format',
            afterSeq,
            oldestSeq: snapshot.oldestSeq,
            currentSeq,
          })) {
            clearCommittedLocalChangeOriginsThrough(this, currentSeq);
            cursor = currentSeq;
          }
          return;
        }
      }

      for (const entry of decoded) {
        cursor = entry.change.seq;
        this.emitChange(entry.change, entry.delivery);
      }
    };

    const drain = () => {
      if (stopped || this.disposed) return;
      if (draining) {
        drainQueued = true;
        return;
      }
      draining = true;
      try {
        do {
          drainQueued = false;
          drainOnce();
        } while (drainQueued && !stopped && !this.disposed);
      } catch (error) {
        if (isTransientChangeLogReadError(error)) notifyError(error);
        else notifyInvalid(error);
      } finally {
        draining = false;
      }
    };

    timer = setInterval(drain, intervalMs);
    (timer as ReturnType<typeof setInterval> & { unref?: () => void }).unref?.();
    this.externalChangeDispatcher = { drain, stop };
    return stop;
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
        if (isPromiseLike(value)) {
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

    const snapshot = this.readChangeLogSnapshot(seq);
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

  // ─── Transactions ───────────────────────────────────────────────────────

  /**
   * Execute multiple writes as a single atomic transaction.
   *
   * - All writes succeed or none do (SQLite ACID).
   * - Each write increments seq and records in _changes normally.
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
        if (isPromiseLike(result)) {
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
    const transactionChangeOrigin = takeRequestedLocalChangeOrigin(this);
    this.inTransaction = true;
    this.deferredChanges = pendingChanges;
    this.activeTransactionChangeOrigin = transactionChangeOrigin;

    try {
      const execution: TransactionExecutionContext = {
        rollbackOnlyError: null,
        snapshotReaderDepth: 0,
      };
      let committedSchemaVersions: SQLiteSchemaVersions | null = null;
      const result = this.transactionExecution.run(execution, () =>
        this.db.transaction(() => {
          // Verify the protected log triggers and registered managed-table
          // contracts while BEGIN IMMEDIATE holds the writer lock. The normal
          // path is two scalar schema-version reads; DDL forces a catalog audit.
          const schemaVersions = this.assertSchemaFence();
          const value = fn();
          if (execution.rollbackOnlyError) {
            throw createRollbackOnlyError(execution.rollbackOnlyError);
          }
          if (isPromiseLike(value)) {
            const error = new Error('ReactiveDB transactions must be synchronous');
            execution.rollbackOnlyError = error;
            // The Promise cannot be cancelled, but its AsyncLocalStorage scope
            // remains poisoned so an awaited continuation cannot write later.
            void Promise.resolve(value).catch(() => {});
            throw error;
          }
          let finalSchemaVersions = this.readSchemaVersions();
          if (finalSchemaVersions.main !== schemaVersions.main
            || finalSchemaVersions.temp !== schemaVersions.temp) {
            // DDL-only auth/application installers remain supported, but DDL
            // cannot share a commit with tracked changes. Otherwise a caller
            // could create a mutating trigger/FK, use it, remove it, and leave
            // an apparently compatible final schema around an unlogged row.
            finalSchemaVersions = this.validateSchemaFence(
              schemaVersions,
              finalSchemaVersions,
            );
            if (pendingChanges.length > 0) {
              throw new Error(
                'ReactiveDB transactions cannot combine schema changes with tracked changes',
              );
            }
          }
          committedSchemaVersions = finalSchemaVersions;
          return value;
        }).immediate());

      // Schema changes inside a rolled-back transaction disappear, so advance
      // the cache only after SQLite confirms this transaction committed.
      this.validatedSchemaVersions = committedSchemaVersions!;

      // Transaction committed — emit all deferred changes
      this.inTransaction = false;
      this.deferredChanges = null;
      this.activeTransactionChangeOrigin = null;

      if (pendingChanges.length > 0 && this.externalChangeDispatcher) {
        // The durable dispatcher is the sole listener path while replica
        // polling is active. A synchronous drain keeps local writes responsive
        // but first emits every lower sequence committed by another handle.
        this.externalChangeDispatcher.drain();
      } else {
        this.enqueueLocalChanges(pendingChanges);
      }

      return result;
    } catch (err) {
      // Transaction rolled back — the database-owned sequence allocation and
      // all pending change rows roll back with the application writes.
      this.inTransaction = false;
      this.deferredChanges = null;
      this.activeTransactionChangeOrigin = null;
      for (const change of pendingChanges) {
        clearCommittedLocalChangeOrigin(this, change.seq);
      }
      throw err;
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
    return this.getTableDef(table).primaryKey;
  }

  /** Get the ordered SQL column names for a defined table. */
  getColumns(table: string): string[] {
    this.assertNotDisposed();
    return [...this.getTableDef(table).columns];
  }

  /**
   * Get the current sequence number.
   */
  get currentSeq(): number {
    this.assertNotDisposed();
    this.assertChangeLogUsable();
    return validateChangeLogStateRow(
      this.changeStmts.current.get() as ChangeLogStateRow | null,
    ).seq;
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
    this.assertNotInSnapshotReader();
    const rollbackOnlyError = this.transactionExecution.getStore()?.rollbackOnlyError;
    if (rollbackOnlyError) {
      throw createRollbackOnlyError(rollbackOnlyError);
    }
    if (this.disposed) return;
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
    this.disposed = true;

    this.externalChangeDispatcher?.stop();

    // Finalize all table prepared statements
    for (const def of this.tables.values()) {
      finalizeTableStatements(def);
    }

    // Finalize change buffer statements
    this.changeStmts.insert.finalize();
    this.changeStmts.mainSchemaVersion.finalize();
    this.changeStmts.tempSchemaVersion.finalize();
    this.changeStmts.allocate.finalize();
    this.changeStmts.current.finalize();
    this.changeStmts.advancePrune.finalize();
    this.changeStmts.prune.finalize();
    this.changeStmts.unprunedThrough.finalize();
    this.changeStmts.after.finalize();
    this.changeStmts.oldest.finalize();

    this.tables.clear();
    this.managedTableSchemaContracts.clear();
    this.listeners.length = 0;
    this.localDeliveryQueue.length = 0;
    this.drainingLocalDeliveryQueue = false;
    this.activeTransactionChangeOrigin = null;
    requestedLocalChangeOrigins.delete(this);
    clearAllCommittedLocalChangeOrigins(this);

    if (this.ownsSQLiteService) {
      this.sqlite?.close();
    } else if (this.ownsDatabase) {
      this.db.close();
    }
  }

  // ─── Private ────────────────────────────────────────────────────────────

  private applyPragmas(): void {
    this.db.run('PRAGMA journal_mode = WAL');
    this.db.run('PRAGMA synchronous = NORMAL');
    this.db.run('PRAGMA cache_size = -64000'); // 64MB page cache
    this.db.run('PRAGMA mmap_size = 268435456'); // 256MB memory-mapped I/O
    this.db.run('PRAGMA temp_store = MEMORY');
    this.db.run('PRAGMA wal_autocheckpoint = 1000');
  }

  private createChangesTable(): void {
    this.db.transaction(() => {
      const existingStateType = this.sqliteObjectType(CHANGE_LOG_STATE_TABLE);
      if (existingStateType && existingStateType !== 'table') {
        throw new Error('ZERO_SYNC_LOG_STATE_INVALID: state object is not a table');
      }
      const existingChangesType = this.sqliteObjectType('_changes');
      if (existingChangesType && existingChangesType !== 'table') {
        throw new Error('ZERO_SYNC_LOG_STATE_INVALID: _changes is not a table');
      }

      this.db.run(`
        CREATE TABLE IF NOT EXISTS main._changes (
          seq     INTEGER PRIMARY KEY,
          tbl     TEXT NOT NULL,
          op      TEXT NOT NULL,
          row_id  TEXT NOT NULL,
          data    TEXT,
          previous_data TEXT,
          ts      INTEGER NOT NULL,
          origin  TEXT,
          format_version
        )
      `);

      const columns = this.db.prepare('PRAGMA main.table_info(_changes)').all() as Array<{
        name: string;
        type: string;
        notnull: number;
        dflt_value: unknown;
      }>;
      if (!columns.some((column) => column.name === 'previous_data')) {
        this.db.run('ALTER TABLE main._changes ADD COLUMN previous_data TEXT');
      }
      if (!columns.some((column) => column.name === 'origin')) {
        this.db.run('ALTER TABLE main._changes ADD COLUMN origin TEXT');
      }
      const formatColumn = columns.find((column) => column.name === 'format_version');
      if (!formatColumn) {
        // Deliberately nullable and without a default: retained pre-fence rows
        // remain distinguishable as legacy-v0 history.
        // No type affinity: the insert fence can distinguish integer `1`
        // from text `'1'` instead of SQLite coercing both before the trigger.
        this.db.run('ALTER TABLE main._changes ADD COLUMN format_version');
      } else if (formatColumn.type !== ''
        || formatColumn.notnull !== 0
        || formatColumn.dflt_value !== null) {
        throw new Error(
          'ZERO_SYNC_LOG_STATE_INVALID: format_version must be nullable without affinity/default',
        );
      }
      this.validateChangesTableSchema();

      const negativeSequence = this.db.prepare(
        'SELECT seq FROM main._changes WHERE seq < 0 LIMIT 1',
      ).get() as { seq: number } | null;
      if (negativeSequence) {
        throw new Error('ZERO_SYNC_LOG_STATE_INVALID: negative change sequence');
      }

      const retainedRows = this.db.prepare(
        `SELECT *, typeof(format_version) AS format_version_type
         FROM main._changes WHERE seq > 0 ORDER BY seq`,
      ).all() as ChangeRow[];
      validateRetainedChangeRows(retainedRows);

      if (existingStateType) {
        const state = this.readAndValidateChangeLogState();
        this.validateChangeLogSentinel();
        this.validateChangeLogTriggers();
        validateRetainedHistory(state, retainedRows);

        if (this.clearChangesOnStart) {
          // Clearing retained replay history never reuses a durable cursor.
          // Older cursors fall behind prune_through and receive a snapshot.
          this.db.run(`
            UPDATE main.${CHANGE_LOG_STATE_TABLE}
            SET prune_through = seq
            WHERE singleton = 1
          `);
          this.db.run('DELETE FROM main._changes WHERE seq > 0');
        }
        return;
      }

      const existingSentinel = this.db.prepare(
        'SELECT seq FROM main._changes WHERE seq = 0',
      ).get();
      if (existingSentinel) {
        throw new Error('ZERO_SYNC_LOG_STATE_INVALID: reserved change sequence 0 already exists');
      }

      const legacySequence = this.readLegacySequence();
      const newestRetained = retainedRows.at(-1)?.seq ?? 0;
      let durableSequence = newestRetained;
      if (legacySequence !== null) {
        if (legacySequence > newestRetained && retainedRows.length > 0) {
          throw new Error(
            'ZERO_SYNC_LOG_STATE_INVALID: durable sequence is ahead of retained history',
          );
        }
        durableSequence = Math.max(legacySequence, newestRetained);
      }
      const pruneThrough = retainedRows.length > 0
        ? retainedRows[0]!.seq - 1
        : durableSequence;

      this.db.run(`
        CREATE TABLE main.${CHANGE_LOG_STATE_TABLE} (
          singleton         INTEGER PRIMARY KEY CHECK (singleton = 1),
          schema_version    INTEGER NOT NULL,
          write_format      INTEGER NOT NULL,
          min_reader_format INTEGER NOT NULL,
          seq               INTEGER NOT NULL CHECK (
            seq >= 0 AND seq <= 9007199254740991
          ),
          prune_through     INTEGER NOT NULL CHECK (
            prune_through >= 0 AND prune_through <= seq
          )
        ) STRICT
      `);
      this.db.prepare(`
        INSERT INTO main.${CHANGE_LOG_STATE_TABLE}
          (singleton, schema_version, write_format, min_reader_format, seq, prune_through)
        VALUES (1, ?, ?, ?, ?, ?)
      `).run(
        CHANGE_LOG_SCHEMA_VERSION,
        CHANGE_LOG_FORMAT_VERSION,
        CHANGE_LOG_MIN_READER_FORMAT,
        durableSequence,
        pruneThrough,
      );

      this.db.prepare(`
        INSERT INTO main._changes
          (seq, tbl, op, row_id, data, previous_data, ts, origin, format_version)
        VALUES (0, ?, 'INSERT', ?, NULL, NULL, 0, NULL, ?)
      `).run(
        CHANGE_LOG_SENTINEL_TABLE,
        CHANGE_LOG_SENTINEL_ROW_ID,
        CHANGE_LOG_FORMAT_VERSION,
      );

      // Preserve a poisoned legacy allocator object. Fence-aware code never
      // reads it; intermediate/pre-fence allocators fail before they can serve.
      const legacyType = this.sqliteObjectType(LEGACY_CHANGE_SEQUENCE_TABLE);
      if (legacyType && legacyType !== 'table') {
        throw new Error('ZERO_SYNC_LOG_STATE_INVALID: legacy sequence object is not a table');
      }
      this.db.run(`
        CREATE TABLE IF NOT EXISTS main.${LEGACY_CHANGE_SEQUENCE_TABLE} (
          singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
          seq       INTEGER NOT NULL CHECK (seq >= 0)
        )
      `);
      const legacyRows = this.db.prepare(
        `SELECT singleton, seq FROM main.${LEGACY_CHANGE_SEQUENCE_TABLE}`,
      ).all() as Array<{ singleton: number; seq: number }>;
      if (legacyRows.length === 0) {
        this.db.prepare(
          `INSERT INTO main.${LEGACY_CHANGE_SEQUENCE_TABLE} (singleton, seq) VALUES (1, ?)`,
        ).run(durableSequence);
      } else if (legacyRows.length !== 1
        || legacyRows[0]!.singleton !== 1
        || !isNonNegativeSafeInteger(legacyRows[0]!.seq)) {
        throw new Error('ZERO_SYNC_LOG_STATE_INVALID: legacy sequence row is malformed');
      }

      for (const [, sql] of CHANGE_LOG_TRIGGER_DEFINITIONS) this.db.run(sql);

      if (this.clearChangesOnStart) {
        this.db.run(`
          UPDATE main.${CHANGE_LOG_STATE_TABLE}
          SET prune_through = seq
          WHERE singleton = 1
        `);
        this.db.run('DELETE FROM main._changes WHERE seq > 0');
      }

      this.readAndValidateChangeLogState();
      this.validateChangeLogSentinel();
      this.validateChangeLogTriggers();
      validateRetainedHistory(
        this.readAndValidateChangeLogState(),
        this.db.prepare(
          `SELECT *, typeof(format_version) AS format_version_type
           FROM main._changes WHERE seq > 0 ORDER BY seq`,
        ).all() as ChangeRow[],
      );
    }).immediate();
  }

  private prepareChangeStatements(): ChangeStatements {
    return {
      mainSchemaVersion: this.db.prepare('PRAGMA main.schema_version'),
      tempSchemaVersion: this.db.prepare('PRAGMA temp.schema_version'),
      allocate: this.db.prepare(
        `UPDATE main.${CHANGE_LOG_STATE_TABLE} SET seq = seq + 1 ` +
        'WHERE singleton = 1 RETURNING seq'
      ),
      current: this.db.prepare(
        `SELECT singleton, schema_version, write_format, min_reader_format, seq, prune_through ` +
        `FROM main.${CHANGE_LOG_STATE_TABLE} WHERE singleton = 1`,
      ),
      insert: this.db.prepare(
        'INSERT INTO main._changes ' +
        '(seq, tbl, op, row_id, data, previous_data, ts, origin, format_version) ' +
        'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING seq'
      ),
      advancePrune: this.db.prepare(
        `UPDATE main.${CHANGE_LOG_STATE_TABLE} ` +
        'SET prune_through = MAX(prune_through, ?) WHERE singleton = 1',
      ),
      prune: this.db.prepare('DELETE FROM main._changes WHERE seq > 0 AND seq <= ?'),
      unprunedThrough: this.db.prepare(
        'SELECT seq FROM main._changes WHERE seq > 0 AND seq <= ? LIMIT 1',
      ),
      after: this.db.prepare(
        `SELECT *, typeof(format_version) AS format_version_type
         FROM main._changes WHERE seq > 0 AND seq > ? ORDER BY seq`,
      ),
      oldest: this.db.prepare(
        'SELECT MIN(seq) AS min_seq FROM main._changes WHERE seq > 0',
      ),
    };
  }

  private validateChangesTableSchema(): void {
    type Column = {
      name: string;
      type: string;
      notnull: number;
      dflt_value: unknown;
      pk: number;
      hidden: number;
    };
    const columns = this.db.prepare('PRAGMA main.table_xinfo(_changes)').all() as Column[];
    const expected = new Map<string, Omit<Column, 'name'>>([
      ['seq', { type: 'INTEGER', notnull: 0, dflt_value: null, pk: 1, hidden: 0 }],
      ['tbl', { type: 'TEXT', notnull: 1, dflt_value: null, pk: 0, hidden: 0 }],
      ['op', { type: 'TEXT', notnull: 1, dflt_value: null, pk: 0, hidden: 0 }],
      ['row_id', { type: 'TEXT', notnull: 1, dflt_value: null, pk: 0, hidden: 0 }],
      ['data', { type: 'TEXT', notnull: 0, dflt_value: null, pk: 0, hidden: 0 }],
      ['previous_data', { type: 'TEXT', notnull: 0, dflt_value: null, pk: 0, hidden: 0 }],
      ['ts', { type: 'INTEGER', notnull: 1, dflt_value: null, pk: 0, hidden: 0 }],
      ['origin', { type: 'TEXT', notnull: 0, dflt_value: null, pk: 0, hidden: 0 }],
      ['format_version', { type: '', notnull: 0, dflt_value: null, pk: 0, hidden: 0 }],
    ]);
    const compatible = columns.length === expected.size && columns.every((column) => {
      const contract = expected.get(column.name);
      return Boolean(contract)
        && column.type.toUpperCase() === contract!.type
        && column.notnull === contract!.notnull
        && column.dflt_value === contract!.dflt_value
        && column.pk === contract!.pk
        && column.hidden === contract!.hidden;
    });
    const definition = this.db.prepare(
      "SELECT sql FROM main.sqlite_schema WHERE type = 'table' AND name = '_changes' COLLATE BINARY",
    ).get() as { sql: string | null } | null;
    const indexes = this.db.prepare('PRAGMA main.index_list(_changes)').all() as Array<{
      origin: string;
    }>;
    // table_xinfo does not expose declared collations or the historical
    // `INTEGER PRIMARY KEY DESC` exception (which is not a rowid alias).
    // Reject both rather than allowing SQLite comparison/identity semantics
    // to weaken the durable-log contract beneath otherwise identical columns.
    const hasNonCanonicalDefinition = !definition?.sql
      || /\bcollate\b/iu.test(definition.sql)
      || /\bautoincrement\b/iu.test(definition.sql)
      || indexes.length > 0;
    if (!compatible || hasNonCanonicalDefinition) {
      throw new Error('ZERO_SYNC_LOG_STATE_INVALID: _changes schema is incompatible');
    }
  }

  private sqliteObjectType(name: string): string | null {
    const row = this.db.prepare(
      'SELECT type FROM main.sqlite_schema WHERE name = ? COLLATE BINARY',
    ).get(name) as { type: string } | null;
    return row?.type ?? null;
  }

  /**
   * Cascading referential actions mutate this tracked table outside its own
   * ReactiveDB call, so no matching durable change can be emitted. Require
   * callers to spell those dependent writes out in one ReactiveDB transaction.
   */
  private assertManagedForeignKeyActionsSafe(
    table: string,
    boundary = `defineTable('${table}')`,
  ): void {
    const foreignKeys = this.db.prepare(
      `PRAGMA main.foreign_key_list(${quoteSqlIdentifier(table)})`,
    ).all() as Array<{ on_update: string; on_delete: string }>;
    const unsafe = foreignKeys.find((foreignKey) =>
      !isNonMutatingForeignKeyAction(foreignKey.on_update)
      || !isNonMutatingForeignKeyAction(foreignKey.on_delete));
    if (unsafe) {
      throw new Error(
        `${boundary}: cascading or value-setting foreign-key actions ` +
        'are not observable; use explicit ReactiveDB transaction writes',
      );
    }
  }

  /** Capture the stored CREATE TABLE SQL and structure managed CRUD relies on. */
  private readManagedTableSchemaContract(table: string): ManagedTableSchemaContract {
    const objects = this.db.prepare(`
      SELECT name, type, sql
      FROM main.sqlite_schema
      WHERE name = ? COLLATE NOCASE
        AND type IN ('table', 'view')
    `).all(table) as Array<{ name: string; type: string; sql: string | null }>;
    const object = objects[0];
    if (objects.length !== 1 || !object || object.type !== 'table' || !object.sql) {
      throw new Error(
        `ReactiveDB managed table '${table}' must remain a main SQLite table`,
      );
    }

    const tableRows = this.db.prepare('PRAGMA main.table_list').all() as Array<{
      schema: string;
      name: string;
      type: string;
      ncol: number;
      wr: number;
      strict: number;
    }>;
    const tableRow = tableRows.find((row) =>
      row.schema === 'main' && row.name === object.name);
    if (!tableRow || tableRow.type !== 'table') {
      throw new Error(
        `ReactiveDB managed table '${table}' must remain an ordinary main SQLite table`,
      );
    }

    const columns = this.db.prepare(
      `PRAGMA main.table_xinfo(${quoteSqlIdentifier(object.name)})`,
    ).all() as ManagedTableColumnContract[];
    if (columns.length === 0 || columns.length !== tableRow.ncol) {
      throw new Error(
        `ReactiveDB managed table '${table}' has an invalid column contract`,
      );
    }

    const primaryKeyIndexes = (this.db.prepare(
      `PRAGMA main.index_list(${quoteSqlIdentifier(object.name)})`,
    ).all() as Array<{
      name: string;
      unique: number;
      origin: string;
      partial: number;
    }>)
      .filter((index) => index.origin === 'pk')
      .sort((left, right) => left.name.localeCompare(right.name))
      .map((index) => ({
        name: index.name,
        unique: index.unique,
        origin: index.origin,
        partial: index.partial,
        columns: this.db.prepare(
          `PRAGMA main.index_xinfo(${quoteSqlIdentifier(index.name)})`,
        ).all() as ManagedTablePrimaryKeyIndexColumnContract[],
      }));

    return {
      name: object.name,
      type: tableRow.type,
      definition: normalizeSchemaSql(object.sql),
      ncol: tableRow.ncol,
      withoutRowId: tableRow.wr,
      strict: tableRow.strict,
      columns: columns.map((column) => ({ ...column })),
      primaryKeyIndexes,
    };
  }

  /** Revalidate every registered table after main-schema DDL. */
  private validateManagedTableSchemaContracts(): void {
    for (const [table, expected] of this.managedTableSchemaContracts) {
      const actual = this.readManagedTableSchemaContract(table);
      this.assertManagedForeignKeyActionsSafe(
        table,
        `ReactiveDB managed table '${table}'`,
      );
      if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        throw new Error(
          `ReactiveDB managed table '${table}' no longer matches its registered column/primary-key contract`,
        );
      }
    }
  }

  private readLegacySequence(): number | null {
    const type = this.sqliteObjectType(LEGACY_CHANGE_SEQUENCE_TABLE);
    if (!type) return null;
    if (type !== 'table') {
      throw new Error('ZERO_SYNC_LOG_STATE_INVALID: legacy sequence object is not a table');
    }
    const columns = this.db.prepare(
      `PRAGMA main.table_info(${LEGACY_CHANGE_SEQUENCE_TABLE})`,
    ).all() as Array<{ name: string }>;
    if (!columns.some((column) => column.name === 'singleton')
      || !columns.some((column) => column.name === 'seq')) {
      throw new Error('ZERO_SYNC_LOG_STATE_INVALID: legacy sequence schema is malformed');
    }
    const rows = this.db.prepare(
      `SELECT singleton, seq FROM main.${LEGACY_CHANGE_SEQUENCE_TABLE}`,
    ).all() as Array<{ singleton: number; seq: number }>;
    if (rows.length === 0) return 0;
    if (rows.length !== 1
      || rows[0]!.singleton !== 1
      || !isNonNegativeSafeInteger(rows[0]!.seq)) {
      throw new Error('ZERO_SYNC_LOG_STATE_INVALID: legacy sequence row is malformed');
    }
    return rows[0]!.seq;
  }

  private readAndValidateChangeLogState(): ChangeLogStateRow {
    const table = this.db.prepare(
      `PRAGMA main.table_list(${JSON.stringify(CHANGE_LOG_STATE_TABLE)})`,
    ).get() as { type?: string; strict?: number } | null;
    if (!table || table.type !== 'table' || table.strict !== 1) {
      throw new Error('ZERO_SYNC_LOG_STATE_INVALID: log state table must be STRICT');
    }
    const rows = this.db.prepare(`
      SELECT singleton, schema_version, write_format, min_reader_format, seq, prune_through,
        typeof(singleton) AS singleton_type,
        typeof(schema_version) AS schema_version_type,
        typeof(write_format) AS write_format_type,
        typeof(min_reader_format) AS min_reader_format_type,
        typeof(seq) AS seq_type,
        typeof(prune_through) AS prune_through_type
      FROM main.${CHANGE_LOG_STATE_TABLE}
    `).all() as Array<ChangeLogStateRow & Record<string, string | number>>;
    const row = rows[0];
    if (rows.length !== 1
      || !row
      || row.singleton !== 1
      || row.singleton_type !== 'integer'
      || row.schema_version_type !== 'integer'
      || row.write_format_type !== 'integer'
      || row.min_reader_format_type !== 'integer'
      || row.seq_type !== 'integer'
      || row.prune_through_type !== 'integer'
      || row.schema_version !== CHANGE_LOG_SCHEMA_VERSION
      || row.write_format !== CHANGE_LOG_FORMAT_VERSION
      || row.min_reader_format !== CHANGE_LOG_MIN_READER_FORMAT
      || !isNonNegativeSafeInteger(row.seq)
      || !isNonNegativeSafeInteger(row.prune_through)
      || row.prune_through > row.seq) {
      throw new Error('ZERO_SYNC_LOG_STATE_INVALID: unsupported or malformed log state');
    }
    return validateChangeLogStateRow(row);
  }

  private validateChangeLogSentinel(): void {
    const rows = this.db.prepare(
      `SELECT *, typeof(format_version) AS format_version_type
       FROM main._changes WHERE seq = 0`,
    ).all() as ChangeRow[];
    const row = rows[0];
    if (rows.length !== 1
      || !row
      || row.tbl !== CHANGE_LOG_SENTINEL_TABLE
      || row.op !== 'INSERT'
      || row.row_id !== CHANGE_LOG_SENTINEL_ROW_ID
      || row.data !== null
      || (row.previous_data ?? null) !== null
      || row.ts !== 0
      || (row.origin ?? null) !== null
      || row.format_version !== CHANGE_LOG_FORMAT_VERSION
      || row.format_version_type !== 'integer') {
      throw new Error('ZERO_SYNC_LOG_STATE_INVALID: change-log sentinel is malformed');
    }
  }

  private validateChangeLogTriggers(): void {
    const ownedTables = [
      '_changes',
      CHANGE_LOG_STATE_TABLE,
      LEGACY_CHANGE_SEQUENCE_TABLE,
    ];
    const installed = this.db.prepare(`
      SELECT name, sql
      FROM main.sqlite_schema
      WHERE type = 'trigger'
        AND lower(tbl_name) IN (lower(?), lower(?), lower(?))
      ORDER BY name
    `).all(...ownedTables) as Array<{ name: string; sql: string | null }>;
    const expected = new Map<string, string>(CHANGE_LOG_TRIGGER_DEFINITIONS.map(
      ([name, sql]) => [name, normalizeSchemaSql(sql)] as const,
    ));
    const expectedNames = [...expected.keys()].sort();
    if (installed.length !== expected.size
      || installed.some((row, index) => row.name !== expectedNames[index])) {
      throw new Error('ZERO_SYNC_LOG_STATE_INVALID: owned log trigger set is incompatible');
    }
    for (const row of installed) {
      if (!row.sql || normalizeSchemaSql(row.sql) !== expected.get(row.name)) {
        throw new Error(
          `ZERO_SYNC_LOG_STATE_INVALID: trigger ${row.name} is missing or altered`,
        );
      }
    }
    const tempInstalled = this.db.prepare(`
      SELECT name
      FROM temp.sqlite_schema
      WHERE type = 'trigger'
        AND lower(tbl_name) IN (lower(?), lower(?), lower(?))
      LIMIT 1
    `).get(...ownedTables) as { name: string } | null;
    if (tempInstalled) {
      throw new Error('ZERO_SYNC_LOG_STATE_INVALID: temporary owned log trigger is incompatible');
    }
  }

  private readSchemaVersions(): SQLiteSchemaVersions {
    const main = this.changeStmts.mainSchemaVersion.get() as {
      schema_version: number;
    } | null;
    const temp = this.changeStmts.tempSchemaVersion.get() as {
      schema_version: number;
    } | null;
    if (!main || !Number.isSafeInteger(main.schema_version)
      || !temp || !Number.isSafeInteger(temp.schema_version)) {
      throw new Error('ZERO_SYNC_LOG_STATE_INVALID: schema version is unavailable');
    }
    return { main: main.schema_version, temp: temp.schema_version };
  }

  /**
   * Validate every schema invariant affected between two observed versions.
   * The caller holds the managed transaction's IMMEDIATE writer boundary.
   */
  private validateSchemaFence(
    previous: SQLiteSchemaVersions,
    observed: SQLiteSchemaVersions,
  ): SQLiteSchemaVersions {
    this.validateChangeLogTriggers();
    if (observed.main !== previous.main) {
      this.validateManagedTableSchemaContracts();
    }
    const validated = this.readSchemaVersions();
    if (validated.main !== observed.main || validated.temp !== observed.temp) {
      throw new Error(
        'ZERO_SYNC_LOG_STATE_INVALID: schema changed during schema-fence validation',
      );
    }
    return validated;
  }

  private assertSchemaFence(): SQLiteSchemaVersions {
    const versions = this.readSchemaVersions();
    if (versions.main !== this.validatedSchemaVersions.main
      || versions.temp !== this.validatedSchemaVersions.temp) {
      const validated = this.validateSchemaFence(
        this.validatedSchemaVersions,
        versions,
      );
      // An entry audit observes already-committed external DDL. It is safe to
      // cache immediately; later DDL in this transaction gets a separate final
      // audit and only advances the cache after commit.
      this.validatedSchemaVersions = validated;
      return validated;
    }
    return versions;
  }

  /** Read log state and retained rows from one WAL snapshot. */
  private readChangeLogSnapshot(afterSeq: number): ChangeLogReadSnapshot {
    const read = (): ChangeLogReadSnapshot => {
      const state = validateChangeLogStateRow(
        this.changeStmts.current.get() as ChangeLogStateRow | null,
      );
      const rows = this.changeStmts.after.all(afterSeq) as ChangeRow[];
      const oldest = this.changeStmts.oldest.get() as { min_seq: number | null } | null;
      const oldestSeq = oldest?.min_seq ?? state.seq;
      let contiguous = afterSeq >= state.prune_through && afterSeq <= state.seq;
      if (contiguous) {
        const expectedCount = state.seq - afterSeq;
        contiguous = rows.length === expectedCount;
        for (let index = 0; contiguous && index < rows.length; index += 1) {
          contiguous = rows[index]!.seq === afterSeq + index + 1;
        }
      }
      return { state, rows, oldestSeq, contiguous };
    };

    return this.inTransaction ? read() : this.db.transaction(read).deferred();
  }

  private getTableDef(table: string): TableDef {
    const def = this.tables.get(table);
    if (!def) {
      throw new Error(`Table '${table}' is not defined. Call defineTable() first.`);
    }
    return def;
  }

  private assertValidRowScope(def: TableDef, scope: ReactiveDBRowScope): void {
    if (!def.columns.includes(scope.field)) {
      throw new Error(`Table '${def.name}' does not define scope column '${scope.field}'.`);
    }
    if (scope.value === '') {
      throw new Error(`Table '${def.name}' received an empty trusted scope value.`);
    }
  }

  private queryOneScoped(
    def: TableDef,
    id: string,
    scope: ReactiveDBRowScope,
  ): Row | null {
    const statement = this.db.prepare(
      `SELECT * FROM ${quoteMainTable(def.name)} ` +
      `WHERE ${quoteSqlIdentifier(def.primaryKey)} = ? ` +
      `${exactSqlValuePredicate(scope.field, false)} LIMIT 1`,
    );
    try {
      const row = (statement.get(id, scope.value, scope.value) as Row | null) ?? null;
      return row && sqliteValuesExactlyEqual(row[scope.field], scope.value)
        ? row
        : null;
    } finally {
      statement.finalize();
    }
  }

  private validateIdentity(
    table: string,
    columns: string[],
    primaryKey: string,
    identity: string[] | undefined
  ): void {
    if (!hasIdentity(identity)) return;

    const columnSet = new Set(columns);
    for (const field of identity) {
      if (field === primaryKey) {
        throw new Error(`defineTable('${table}'): identity field '${field}' cannot be the primary key`);
      }
      if (!columnSet.has(field)) {
        throw new Error(`defineTable('${table}'): identity field '${field}' is not a table column`);
      }
    }
  }

  private ensurePrimaryKeyFromIdentity(def: TableDef, row: Row): Row {
    const pkValue = row[def.primaryKey];
    if (pkValue !== undefined && pkValue !== null && pkValue !== '') return row;
    if (!hasIdentity(def.identity)) return row;

    return {
      ...row,
      [def.primaryKey]: createIdentityId(def.name, def.identity, row),
    };
  }

  private assertIdentityUnchanged(
    def: TableDef,
    existing: Row,
    partial: Partial<Row>
  ): void {
    if (!hasIdentity(def.identity)) return;

    for (const field of def.identity) {
      if (!(field in partial)) continue;
      const next = partial[field];
      if (next !== existing[field]) {
        throw new Error(`update('${def.name}'): identity field '${field}' is immutable`);
      }
    }
  }

  private assertNoIdentityConflict(def: TableDef, row: Row, primaryKey: string): void {
    if (!hasIdentity(def.identity)) return;

    const stmt = this.requireIdentityStatement(def);
    const values = getIdentityValues(def.identity, row);
    const existing = stmt.get(...values) as Row | null;
    if (!existing) return;

    const existingKey = String(existing[def.primaryKey]);
    if (existingKey !== primaryKey) {
      throw new Error(
        `insert('${def.name}'): natural identity already exists for a different primary key`
      );
    }
  }

  private requireIdentityStatement(def: TableDef): NonNullable<TableDef['stmts']['getByIdentity']> {
    if (!hasIdentity(def.identity) || !def.stmts.getByIdentity) {
      throw new Error(`Table '${def.name}' does not define a natural identity.`);
    }
    return def.stmts.getByIdentity;
  }

  private nextSeq(): number {
    if (!this.inTransaction) {
      throw new Error('ReactiveDB sequence allocation requires an active write transaction');
    }
    const row = this.changeStmts.allocate.get() as { seq: number } | null;
    if (!row) {
      throw new Error('ReactiveDB change sequence is not initialized');
    }
    return row.seq;
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
      bindCommittedLocalChangeOrigin(
        this,
        deliveryChange.seq,
        this.activeTransactionChangeOrigin,
      );
    }

    if (this.inTransaction && this.deferredChanges) {
      // Defer emission until transaction commits
      this.deferredChanges.push(deliveryChange);
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
    const data = change.row !== null ? JSON.stringify(change.row) : null;
    const previousData = change.previousRow !== null
      ? JSON.stringify(change.previousRow)
      : null;

    if (!this.inTransaction) {
      throw new Error('ReactiveDB change recording requires an active write transaction');
    }

    const stateBeforeInsert = validateChangeLogStateRow(
      this.changeStmts.current.get() as ChangeLogStateRow | null,
    );
    if (stateBeforeInsert.seq !== change.seq) {
      throw new Error(
        'ZERO_SYNC_LOG_STATE_INVALID: allocated sequence changed before change recording',
      );
    }

    const inserted = this.changeStmts.insert.get(
      change.seq,
      change.table,
      change.op,
      change.rowId,
      data,
      previousData,
      change.ts,
      this.epoch,
      CHANGE_LOG_FORMAT_VERSION,
    ) as { seq: number } | null;
    if (inserted?.seq !== change.seq) {
      throw new Error('ZERO_SYNC_LOG_STATE_INVALID: durable change row was not recorded');
    }
    const stateAfterInsert = validateChangeLogStateRow(
      this.changeStmts.current.get() as ChangeLogStateRow | null,
    );
    if (stateAfterInsert.seq !== stateBeforeInsert.seq
      || stateAfterInsert.prune_through !== stateBeforeInsert.prune_through) {
      throw new Error(
        'ZERO_SYNC_LOG_STATE_INVALID: durable log state changed during change recording',
      );
    }
    const cutoff = change.seq - this.ringBufferDepth;
    if (cutoff > 0) {
      const expectedPruneThrough = Math.max(
        stateAfterInsert.prune_through,
        cutoff,
      );
      this.changeStmts.advancePrune.run(cutoff);
      const state = validateChangeLogStateRow(
        this.changeStmts.current.get() as ChangeLogStateRow | null,
      );
      if (state.seq !== change.seq
        || state.prune_through !== expectedPruneThrough) {
        throw new Error(
          'ZERO_SYNC_LOG_STATE_INVALID: durable prune watermark was not advanced exactly',
        );
      }
      this.changeStmts.prune.run(state.prune_through);
      const stateAfterPrune = validateChangeLogStateRow(
        this.changeStmts.current.get() as ChangeLogStateRow | null,
      );
      if (stateAfterPrune.seq !== change.seq
        || stateAfterPrune.prune_through !== expectedPruneThrough) {
        throw new Error(
          'ZERO_SYNC_LOG_STATE_INVALID: durable log state changed during pruning',
        );
      }
      if (this.changeStmts.unprunedThrough.get(stateAfterPrune.prune_through)) {
        throw new Error(
          'ZERO_SYNC_LOG_STATE_INVALID: retained change rows were not pruned',
        );
      }
    }
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
          if (isPromiseLike(result)) {
            void Promise.resolve(result).catch(() => {});
            throw new Error('ReactiveDB onChange listeners must be synchronous');
          }
        } catch (err) {
          emitPlatformCode(OBS_CODES.SYNC_CHANGE_LISTENER_FAILED, {
            error: err,
            metadata: {
              table: change.table,
              op: change.op,
              rowId: change.rowId,
              seq: change.seq,
            },
          });
        }
      }
    } finally {
      this.changeDeliveryDepth -= 1;
      clearCommittedLocalChangeOrigin(this, change.seq);
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

  private assertNotDisposed(): void {
    const rollbackOnlyError = this.transactionExecution.getStore()?.rollbackOnlyError;
    if (rollbackOnlyError) {
      throw createRollbackOnlyError(rollbackOnlyError);
    }
    if (this.disposed) {
      throw new Error('ReactiveDB is disposed');
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

  const sqlite = createPlatformSQLiteService(config);
  sqlite.start();

  return {
    database: sqlite.raw,
    sqlite,
    ownsSQLiteService: true,
    ownsDatabase: false,
    clearChangesOnStart: config.clearChangesOnStart ?? false,
  };
}

function quoteMainTable(name: string): string {
  return `main.${quoteSqlIdentifier(name)}`;
}

function finalizeTableStatements(definition: TableDef): void {
  definition.stmts.insert.finalize();
  definition.stmts.update.finalize();
  definition.stmts.delete.finalize();
  definition.stmts.getOne.finalize();
  definition.stmts.getAll.finalize();
  definition.stmts.getByIdentity?.finalize();
}

function cloneChange(change: Change): Change {
  return {
    seq: change.seq,
    table: change.table,
    op: change.op,
    rowId: change.rowId,
    row: cloneCanonicalRow(change.row),
    previousRow: cloneCanonicalRow(change.previousRow ?? null),
    ts: change.ts,
  };
}

function cloneCanonicalRow(row: Row | null): Row | null {
  return row === null ? null : JSON.parse(JSON.stringify(row)) as Row;
}

function deserializeChangeRow(row: ChangeRow): Change {
  if (!Number.isSafeInteger(row.seq) || row.seq <= 0) {
    throw new Error('ZERO_SYNC_LOG_FORMAT_INCOMPATIBLE: invalid change sequence');
  }
  const legacyFormat = row.format_version === null
    && row.format_version_type === 'null';
  const currentFormat = row.format_version === CHANGE_LOG_FORMAT_VERSION
    && row.format_version_type === 'integer';
  if (!legacyFormat && !currentFormat) {
    throw new Error(
      `ZERO_SYNC_LOG_FORMAT_INCOMPATIBLE: unsupported format ${String(row.format_version)}`,
    );
  }
  if (row.op !== 'INSERT' && row.op !== 'UPDATE' && row.op !== 'DELETE') {
    throw new Error(`ZERO_SYNC_LOG_FORMAT_INCOMPATIBLE: invalid operation ${row.op}`);
  }
  if (typeof row.tbl !== 'string' || row.tbl.length === 0) {
    throw new Error('ZERO_SYNC_LOG_FORMAT_INCOMPATIBLE: invalid table name');
  }
  if (typeof row.row_id !== 'string' || row.row_id.length === 0) {
    throw new Error('ZERO_SYNC_LOG_FORMAT_INCOMPATIBLE: invalid row id');
  }
  if (!isNonNegativeSafeInteger(row.ts)) {
    throw new Error('ZERO_SYNC_LOG_FORMAT_INCOMPATIBLE: invalid timestamp');
  }
  if (row.origin !== null
    && row.origin !== undefined
    && typeof row.origin !== 'string') {
    throw new Error('ZERO_SYNC_LOG_FORMAT_INCOMPATIBLE: invalid origin');
  }

  const data = deserializeChangeObject(row.data, 'data');
  const previousData = deserializeChangeObject(row.previous_data ?? null, 'previous_data');
  if ((row.op === 'INSERT' || row.op === 'UPDATE') && data === null) {
    throw new Error(`ZERO_SYNC_LOG_FORMAT_INCOMPATIBLE: ${row.op} requires row data`);
  }
  if (row.op === 'DELETE' && data !== null) {
    throw new Error('ZERO_SYNC_LOG_FORMAT_INCOMPATIBLE: DELETE row data must be null');
  }
  if (currentFormat) {
    if (row.op === 'INSERT' && previousData !== null) {
      throw new Error('ZERO_SYNC_LOG_FORMAT_INCOMPATIBLE: INSERT previous_data must be null');
    }
    if ((row.op === 'UPDATE' || row.op === 'DELETE') && previousData === null) {
      throw new Error(`ZERO_SYNC_LOG_FORMAT_INCOMPATIBLE: ${row.op} requires previous_data`);
    }
  }
  return {
    seq: row.seq,
    table: row.tbl,
    op: row.op,
    rowId: row.row_id,
    row: data,
    previousRow: previousData,
    ts: row.ts,
  };
}

function deserializeChangeObject(value: unknown, field: string): Row | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') {
    throw new Error(`ZERO_SYNC_LOG_FORMAT_INCOMPATIBLE: invalid ${field}`);
  }
  let decoded: unknown;
  try {
    decoded = JSON.parse(value);
  } catch {
    throw new Error(`ZERO_SYNC_LOG_FORMAT_INCOMPATIBLE: invalid ${field} JSON`);
  }
  if (decoded === null || typeof decoded !== 'object' || Array.isArray(decoded)) {
    throw new Error(`ZERO_SYNC_LOG_FORMAT_INCOMPATIBLE: ${field} must be a JSON object`);
  }
  if (!isSerializableRowObject(decoded)) {
    throw new Error(
      `ZERO_SYNC_LOG_FORMAT_INCOMPATIBLE: ${field} must be a canonical JSON object`,
    );
  }
  return decoded as Row;
}

function isSerializableRowObject(value: unknown): value is Row {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && isCanonicalJsonValue(value, new Set());
}

function canonicalizeChangeRow(value: Row | null, field: string): Row | null {
  if (value === null) return null;
  if (!isSerializableRowObject(value)) {
    throw new Error(
      `ReactiveDB change ${field} must be a lossless JSON object`,
    );
  }
  // Use the exact representation persisted in `_changes` for local listeners
  // too. This also detaches listener payloads from caller-owned objects.
  return JSON.parse(JSON.stringify(value)) as Row;
}

function isCanonicalJsonValue(value: unknown, ancestors: Set<object>): boolean {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return true;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) && !Object.is(value, -0);
  }
  if (typeof value !== 'object') return false;
  if (ancestors.has(value)) return false;

  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      const keys = Reflect.ownKeys(value);
      if (keys.length !== value.length + 1 || !keys.includes('length')) return false;
      for (let index = 0; index < value.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (!descriptor?.enumerable || !('value' in descriptor)
          || !isCanonicalJsonValue(descriptor.value, ancestors)) {
          return false;
        }
      }
      return true;
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return false;
    const keys = Reflect.ownKeys(value);
    if (keys.some((key) => typeof key !== 'string')) return false;
    for (const key of keys as string[]) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor?.enumerable || !('value' in descriptor)
        || !isCanonicalJsonValue(descriptor.value, ancestors)) {
        return false;
      }
    }
    return true;
  } finally {
    ancestors.delete(value);
  }
}

function validateRetainedChangeRows(rows: readonly ChangeRow[]): void {
  let previousSeq: number | null = null;
  let observedVersionedRow = false;
  for (const row of rows) {
    deserializeChangeRow(row);
    if (previousSeq !== null && row.seq !== previousSeq + 1) {
      throw new Error('ZERO_SYNC_LOG_STATE_INVALID: retained change history is not contiguous');
    }
    if (row.format_version === CHANGE_LOG_FORMAT_VERSION) {
      observedVersionedRow = true;
    } else if (observedVersionedRow) {
      throw new Error(
        'ZERO_SYNC_LOG_STATE_INVALID: legacy history follows versioned history',
      );
    }
    previousSeq = row.seq;
  }
}

function validateRetainedHistory(
  state: ChangeLogStateRow,
  rows: readonly ChangeRow[],
): void {
  validateRetainedChangeRows(rows);
  if (rows.length === 0) {
    if (state.prune_through !== state.seq) {
      throw new Error('ZERO_SYNC_LOG_STATE_INVALID: retained history is missing');
    }
    return;
  }
  const first = rows[0]!.seq;
  const last = rows.at(-1)!.seq;
  if (first !== state.prune_through + 1
    || last !== state.seq
    || rows.length !== state.seq - state.prune_through) {
    throw new Error('ZERO_SYNC_LOG_STATE_INVALID: retained history does not match log state');
  }
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function createRollbackOnlyError(cause: Error): Error {
  return new Error(
    `ReactiveDB transaction is rollback-only: ${cause.message}`,
    { cause },
  );
}

function isNonMutatingForeignKeyAction(action: string): boolean {
  const normalized = action.trim().toUpperCase();
  return normalized === 'NO ACTION' || normalized === 'RESTRICT';
}

/**
 * Build a comparison SQLite cannot broaden through a declared collation or
 * column affinity. The duplicated binding first proves the storage class and
 * then applies bytewise/string-exact BINARY equality in the write statement.
 */
function exactSqlValuePredicate(column: string, leadingAnd = true): string {
  const quoted = quoteSqlIdentifier(column);
  return `${leadingAnd ? ' AND ' : 'AND '}typeof(${quoted}) = typeof(?) ` +
    `AND ${quoted} COLLATE BINARY IS ?`;
}

function exactSqlValueBindings(row: Row, columns: string[]): any[] {
  const bindings: any[] = [];
  for (const column of columns) {
    const value = row[column] ?? null;
    bindings.push(value, value);
  }
  return bindings;
}

function rowExactlyMatchesColumns(
  actual: Row,
  expected: Row,
  columns: string[],
): boolean {
  return columns.every((column) => sqliteValuesExactlyEqual(
    actual[column] ?? null,
    expected[column] ?? null,
  ));
}

function sqliteValuesExactlyEqual(actual: unknown, expected: unknown): boolean {
  if (Object.is(actual, expected)) return true;
  if (actual instanceof Uint8Array && expected instanceof Uint8Array) {
    if (actual.byteLength !== expected.byteLength) return false;
    return actual.every((value, index) => value === expected[index]);
  }
  return false;
}

function validateChangeLogStateRow(row: ChangeLogStateRow | null): ChangeLogStateRow {
  if (!row
    || row.singleton !== 1
    || row.schema_version !== CHANGE_LOG_SCHEMA_VERSION
    || row.write_format !== CHANGE_LOG_FORMAT_VERSION
    || row.min_reader_format !== CHANGE_LOG_MIN_READER_FORMAT
    || !isNonNegativeSafeInteger(row.seq)
    || !isNonNegativeSafeInteger(row.prune_through)
    || row.prune_through > row.seq) {
    throw new Error('ZERO_SYNC_LOG_STATE_INVALID: unsupported or malformed log state');
  }
  return {
    singleton: row.singleton,
    schema_version: row.schema_version,
    write_format: row.write_format,
    min_reader_format: row.min_reader_format,
    seq: row.seq,
    prune_through: row.prune_through,
  };
}

function isTransientChangeLogReadError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const sqliteError = error as { code?: unknown; errno?: unknown };
  return sqliteError.code === 'SQLITE_BUSY'
    || (typeof sqliteError.code === 'string' && sqliteError.code.startsWith('SQLITE_BUSY_'))
    || sqliteError.code === 'SQLITE_LOCKED'
    || (typeof sqliteError.code === 'string' && sqliteError.code.startsWith('SQLITE_LOCKED_'))
    || sqliteError.errno === 5
    || sqliteError.errno === 6;
}

function isChangeLogFormatIncompatibleError(error: unknown): boolean {
  return error instanceof Error
    && error.message.startsWith('ZERO_SYNC_LOG_FORMAT_INCOMPATIBLE:');
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (typeof value === 'object' && value !== null)
    || typeof value === 'function'
    ? typeof (value as { then?: unknown }).then === 'function'
    : false;
}

function normalizeSchemaSql(sql: string): string {
  // Collapse formatting only outside quoted literals/identifiers. Whitespace
  // inside a CHECK/default literal is data, so treating `'a  b'` as `'a b'`
  // would hide a semantic managed-table schema change.
  let normalized = '';
  let pendingWhitespace = false;
  let quote: "'" | '"' | '`' | ']' | null = null;

  for (let index = 0; index < sql.length; index += 1) {
    const character = sql[index]!;
    if (quote !== null) {
      normalized += character;
      if (character === quote) {
        // SQL escapes quote delimiters by doubling them. Bracket-quoted
        // identifiers are accepted here as well for defensive completeness.
        if (sql[index + 1] === quote) {
          normalized += sql[index + 1];
          index += 1;
        } else {
          quote = null;
        }
      }
      continue;
    }

    if (/\s/u.test(character)) {
      pendingWhitespace = normalized.length > 0;
      continue;
    }
    if (pendingWhitespace) {
      normalized += ' ';
      pendingWhitespace = false;
    }
    normalized += character;
    if (character === "'" || character === '"' || character === '`') {
      quote = character;
    } else if (character === '[') {
      quote = ']';
    }
  }

  return normalized.replace(/;$/u, '');
}
