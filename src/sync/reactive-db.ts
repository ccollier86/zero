import type { Database } from 'bun:sqlite';
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
  TableDef,
  ChangeStatements,
  ChangeRow,
} from './types';

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
}

/**
 * ReactiveDB — SQLite wrapper that makes every write observable.
 *
 * Define a table, get prepared CRUD statements and change events for free.
 * One instance per application.
 *
 * Every write:
 *  1. Executes the prepared statement
 *  2. Increments the global seq counter
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
  private seq = 0;
  private ringBufferDepth: number;
  private changeStmts: ChangeStatements;
  private disposed = false;
  private readonly localDeliveryQueue: Change[] = [];
  private drainingLocalDeliveryQueue = false;

  // Transaction support: when true, changes are accumulated and emitted after commit
  private inTransaction = false;
  private deferredChanges: Change[] | null = null;
  private postCommitCallbacks: Array<() => unknown> | null = null;
  private readonly transactionExecution = new AsyncLocalStorage<TransactionExecutionContext>();

  constructor(config: ReactiveDBConfig) {
    const runtime = createReactiveDBRuntime(config);
    this.db = runtime.database;
    this.sqlite = runtime.sqlite;
    this.ownsSQLiteService = runtime.ownsSQLiteService;
    this.ownsDatabase = runtime.ownsDatabase;
    this.clearChangesOnStart = runtime.clearChangesOnStart;
    this.ringBufferDepth = config.ringBufferDepth ?? DEFAULT_RING_BUFFER_DEPTH;

    this.createChangesTable();
    this.changeStmts = this.prepareChangeStatements();

    // Explicit legacy reset remains available. By default file-backed handles
    // retain the ring and continue its durable sequence so rolling Torrent
    // ownership handoffs cannot collide with another handle's sequence values.
    if (this.clearChangesOnStart) {
      this.db.transaction(() => {
        this.db.run('DELETE FROM _changes');
        this.db.run('UPDATE _change_sequence SET seq = 0 WHERE singleton = 1');
      })();
    }
    this.seq = this.latestDurableSeq();
  }

  // ─── Table Definition ───────────────────────────────────────────────────

  /**
   * Define a table schema and prepare all CRUD statements.
   *
   * Idempotent — calling with the same name re-creates statements.
   * Table names starting with `_` are allowed but the sync plugin will
   * exclude them from pub/sub broadcasts.
   */
  defineTable(name: string, schema: TableSchema): void {
    this.assertNotDisposed();

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

    // Create the table
    const columnDefs = columns
      .map((col) => `${col} ${schema[col]}`)
      .join(', ');
    this.db.run(`CREATE TABLE IF NOT EXISTS ${name} (${columnDefs})`);

    if (hasIdentity(identity)) {
      const indexName = `idx_${name}_identity`;
      const identityColumns = identity.map(quoteSqlIdentifier).join(', ');
      this.db.run(
        `CREATE UNIQUE INDEX IF NOT EXISTS ${quoteSqlIdentifier(indexName)} ` +
        `ON ${quoteSqlIdentifier(name)} (${identityColumns})`
      );
    }

    // Prepare CRUD statements
    const nonPkColumns = columns.filter((c) => c !== primaryKey);

    // INSERT OR REPLACE — all columns
    const insertPlaceholders = columns.map(() => '?').join(', ');
    const insertSQL = `INSERT OR REPLACE INTO ${name} (${columns.join(', ')}) VALUES (${insertPlaceholders})`;

    // UPDATE — set non-PK columns, WHERE pk = ?
    let updateSQL: string;
    if (nonPkColumns.length > 0) {
      const setClauses = nonPkColumns.map((c) => `${c} = ?`).join(', ');
      updateSQL = `UPDATE ${name} SET ${setClauses} WHERE ${primaryKey} = ?`;
    } else {
      // Table with only a PK column — update is effectively a no-op
      // Use a self-referencing SET to satisfy SQL syntax
      updateSQL = `UPDATE ${name} SET ${primaryKey} = ${primaryKey} WHERE ${primaryKey} = ?`;
    }

    const deleteSQL = `DELETE FROM ${name} WHERE ${primaryKey} = ?`;
    const getOneSQL = `SELECT * FROM ${name} WHERE ${primaryKey} = ?`;
    const getAllSQL = `SELECT * FROM ${name}`;
    const getByIdentitySQL = hasIdentity(identity)
      ? `SELECT * FROM ${name} WHERE ${identity.map((field) => `${field} = ?`).join(' AND ')}`
      : null;

    const tableDef: TableDef = {
      name,
      columns,
      primaryKey,
      identity: hasIdentity(identity) ? [...identity] : undefined,
      stmts: {
        insert: this.db.prepare(insertSQL),
        update: this.db.prepare(updateSQL),
        delete: this.db.prepare(deleteSQL),
        getOne: this.db.prepare(getOneSQL),
        getAll: this.db.prepare(getAllSQL),
        getByIdentity: getByIdentitySQL ? this.db.prepare(getByIdentitySQL) : undefined,
      },
    };

    this.tables.set(name, tableDef);
  }

  // ─── Write Methods ──────────────────────────────────────────────────────

  /**
   * Insert a row. If the primary key already exists, replaces it
   * (INSERT OR REPLACE) and emits op: 'UPDATE'.
   *
   * Returns the Change, or null if the write somehow produced no effect.
   */
  insert(table: string, row: Row): Change {
    this.assertNotDisposed();
    if (!this.inTransaction) {
      return this.transaction(() => this.insert(table, row));
    }
    try {
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
      this.assertNoIdentityConflict(def, nextRow, pk);

      // Determine which columns are present in the row object.
      // Columns NOT provided are omitted from the INSERT so SQLite applies defaults.
      const presentColumns = def.columns.filter((col) => col in nextRow);
      const values = presentColumns.map((col) => nextRow[col] ?? null);

      if (presentColumns.length === def.columns.length) {
        // All columns provided — use the pre-prepared statement (fast path)
        def.stmts.insert.run(...values);
      } else {
        // Partial columns — build dynamic INSERT to let defaults apply
        const placeholders = presentColumns.map(() => '?').join(', ');
        const sql = `INSERT OR REPLACE INTO ${def.name} (${presentColumns.join(', ')}) VALUES (${placeholders})`;
        const statement = this.db.prepare(sql);
        try {
          statement.run(...(values as any[]));
        } finally {
          statement.finalize();
        }
      }

      // Read back the full row to get any defaults applied by SQLite
      const fullRow = def.stmts.getOne.get(pk) as Row;

      const change = this.createChange(table, op, pk, fullRow, existing);
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
   * Update a row by merging partial data into the existing row.
   * Returns the Change with the full merged row, or null if the row doesn't exist.
   */
  update(table: string, id: string, partial: Partial<Row>): Change | null {
    this.assertNotDisposed();
    if (!this.inTransaction) {
      return this.transaction(() => this.update(table, id, partial));
    }
    try {
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
        def.stmts.update.run(...updateValues);
      }
      // If table only has PK column, nothing to update — but we still emit

      // Read back the full row
      const fullRow = def.stmts.getOne.get(id) as Row;

      const change = this.createChange(table, 'UPDATE', id, fullRow, existing);
      this.recordAndEmit(change);
      return change;
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
    this.assertNotDisposed();
    if (!this.inTransaction) {
      return this.transaction(() => this.delete(table, id));
    }
    try {
      const def = this.getTableDef(table);

      // Check existence
      const existing = def.stmts.getOne.get(id) as Row | null;
      if (!existing) return null;

      def.stmts.delete.run(id);

      const change = this.createChange(table, 'DELETE', id, null, existing);
      this.recordAndEmit(change);
      return change;
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

  /** Get the ordered natural identity fields for a table, if configured. */
  getIdentity(table: string): string[] {
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
   * Register a change listener. Fires synchronously after every write.
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

  // ─── Ring Buffer Replay ─────────────────────────────────────────────────

  /**
   * Get all changes after the given sequence number.
   *
   * Returns null if the seq has been pruned from the ring buffer,
   * indicating the caller should send a full snapshot instead.
   */
  getChangesAfter(seq: number): Change[] | null {
    this.assertNotDisposed();

    // If seq is 0, the caller wants everything — check if buffer has data
    if (seq === 0) {
      const rows = this.changeStmts.after.all(0) as ChangeRow[];
      return rows.map(deserializeChangeRow);
    }

    // Check if we can fulfill this request
    const oldest = this.changeStmts.oldest.get() as { min_seq: number | null } | null;

    // No changes in buffer at all
    if (!oldest || oldest.min_seq === null) {
      // Buffer is empty. If seq > 0, the client is up to date (or we can't tell).
      // Return empty array — no changes to send.
      return [];
    }

    // If the requested seq is older than the oldest entry in the buffer,
    // we can't provide a contiguous sequence — signal snapshot needed.
    if (seq < oldest.min_seq - 1) {
      return null;
    }

    const rows = this.changeStmts.after.all(seq) as ChangeRow[];
    return rows.map(deserializeChangeRow);
  }

  // ─── Transactions ───────────────────────────────────────────────────────

  /** Register a synchronous best-effort callback for the active transaction. */
  afterCommit(callback: () => unknown): void {
    this.assertNotDisposed();
    if (!this.inTransaction || this.postCommitCallbacks === null) {
      throw new Error('ReactiveDB afterCommit callbacks require an active transaction');
    }
    if (typeof callback !== 'function') {
      throw new TypeError('ReactiveDB afterCommit callback must be a function');
    }
    this.postCommitCallbacks.push(callback);
  }

  /**
   * Execute multiple writes as a single atomic transaction.
   *
   * - All writes succeed or none do (SQLite ACID).
   * - Each write increments seq and records in _changes normally.
   * - Change listeners are deferred — accumulated during the transaction,
   *   fired in order after commit.
   * - If the transaction throws, no changes are emitted and writes are rolled back.
   */
  transaction<T>(fn: () => T): T {
    this.assertNotDisposed();

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
        const rollbackOnlyError = this.transactionExecution.getStore()?.rollbackOnlyError;
        if (rollbackOnlyError) throw createRollbackOnlyError(rollbackOnlyError);
        return result;
      } catch (error) {
        this.markTransactionRollbackOnly(error);
        throw error;
      }
    }

    const pendingChanges: Change[] = [];
    const pendingPostCommitCallbacks: Array<() => unknown> = [];
    this.inTransaction = true;
    this.deferredChanges = pendingChanges;
    this.postCommitCallbacks = pendingPostCommitCallbacks;
    const execution: TransactionExecutionContext = { rollbackOnlyError: null };

    try {
      const result = this.transactionExecution.run(execution, () => this.db.transaction(() => {
        const value = fn();
        if (execution.rollbackOnlyError) {
          throw createRollbackOnlyError(execution.rollbackOnlyError);
        }
        if (isPromiseLike(value)) {
          const error = new Error('ReactiveDB transactions must be synchronous');
          execution.rollbackOnlyError = error;
          // The Promise cannot be cancelled. Poison its AsyncLocalStorage
          // context so an awaited continuation cannot mutate after rollback.
          void Promise.resolve(value).catch(() => {});
          throw error;
        }
        return value;
      })());

      // Transaction committed — emit all deferred changes
      this.inTransaction = false;
      this.deferredChanges = null;
      this.postCommitCallbacks = null;

      this.enqueueLocalChanges(pendingChanges);
      this.runPostCommitCallbacks(pendingPostCommitCallbacks);

      return result;
    } catch (err) {
      // Transaction rolled back — discard deferred changes and restore the
      // durable allocator value. Another handle may have advanced it, so a
      // local subtraction is not a valid recovery rule.
      if (!execution.rollbackOnlyError) {
        execution.rollbackOnlyError = normalizeError(err);
      }
      this.seq = this.latestDurableSeq();
      this.inTransaction = false;
      this.deferredChanges = null;
      this.postCommitCallbacks = null;
      throw err;
    }
  }

  // ─── Raw Access ─────────────────────────────────────────────────────────

  /**
   * Execute raw SQL. Use for creating internal (_-prefixed) tables
   * that don't need change tracking (e.g., _credentials, _auth_config).
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
    return Array.from(this.tables.keys());
  }

  /**
   * Check if a table has been defined.
   */
  hasTable(name: string): boolean {
    return this.tables.has(name);
  }

  /**
   * Get the primary key column name for a defined table.
   */
  getPrimaryKey(table: string): string {
    return this.getTableDef(table).primaryKey;
  }

  /**
   * Get the current sequence number.
   */
  get currentSeq(): number {
    this.assertNotDisposed();
    return this.latestDurableSeq();
  }

  /** Process-unique cursor epoch used to reject pre-restart client sequences. */
  get syncEpoch(): string {
    return this.epoch;
  }

  /** Return the platform SQLite service backing this ReactiveDB, if present. */
  getSQLiteService(): PlatformSQLiteService | null {
    return this.sqlite;
  }

  /** Return the raw Bun SQLite handle for advanced platform internals. */
  getRawDatabase(): Database {
    return this.db;
  }

  // ─── Lifecycle ──────────────────────────────────────────────────────────

  /**
   * Close the SQLite database and release all resources.
   * After disposal, all methods throw.
   */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    // Finalize all table prepared statements
    for (const def of this.tables.values()) {
      def.stmts.insert.finalize();
      def.stmts.update.finalize();
      def.stmts.delete.finalize();
      def.stmts.getOne.finalize();
      def.stmts.getAll.finalize();
      def.stmts.getByIdentity?.finalize();
    }

    // Finalize change buffer statements
    this.changeStmts.insert.finalize();
    this.changeStmts.prune.finalize();
    this.changeStmts.after.finalize();
    this.changeStmts.oldest.finalize();
    this.changeStmts.latest.finalize();
    this.changeStmts.next.finalize();

    this.tables.clear();
    this.listeners.length = 0;
    this.localDeliveryQueue.length = 0;
    this.drainingLocalDeliveryQueue = false;

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
    this.db.run(`
      CREATE TABLE IF NOT EXISTS _changes (
        seq     INTEGER PRIMARY KEY,
        tbl     TEXT NOT NULL,
        op      TEXT NOT NULL,
        row_id  TEXT NOT NULL,
        data    TEXT,
        previous_data TEXT,
        ts      INTEGER NOT NULL
      )
    `);

    const columns = this.db.prepare('PRAGMA table_info(_changes)').all() as Array<{ name: string }>;
    if (!columns.some((column) => column.name === 'previous_data')) {
      this.db.run('ALTER TABLE _changes ADD COLUMN previous_data TEXT');
    }

    // This singleton is intentionally separate from the prunable ring. Its
    // UPDATE ... RETURNING operation is SQLite's serialization boundary for
    // sequence allocation across independent ReactiveDB handles.
    this.db.run(`
      CREATE TABLE IF NOT EXISTS _change_sequence (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        seq INTEGER NOT NULL CHECK (seq >= 0)
      )
    `);
    this.db.transaction(() => {
      this.db.run('INSERT OR IGNORE INTO _change_sequence (singleton, seq) VALUES (1, 0)');
      this.db.run(`UPDATE _change_sequence
        SET seq = MAX(seq, COALESCE((SELECT MAX(seq) FROM _changes), 0))
        WHERE singleton = 1`);
    })();
  }

  private prepareChangeStatements(): ChangeStatements {
    return {
      insert: this.db.prepare(
        'INSERT INTO _changes (seq, tbl, op, row_id, data, previous_data, ts) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ),
      prune: this.db.prepare('DELETE FROM _changes WHERE seq <= ?'),
      after: this.db.prepare('SELECT * FROM _changes WHERE seq > ? ORDER BY seq'),
      oldest: this.db.prepare('SELECT MIN(seq) AS min_seq FROM _changes'),
      latest: this.db.prepare('SELECT seq AS max_seq FROM _change_sequence WHERE singleton = 1'),
      next: this.db.prepare(`UPDATE _change_sequence SET seq = seq + 1
        WHERE singleton = 1 RETURNING seq`),
    };
  }

  private latestDurableSeq(): number {
    const row = this.changeStmts.latest.get() as { max_seq: number | null } | null;
    const value = Number(row?.max_seq ?? 0);
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error('ReactiveDB durable change sequence is invalid');
    }
    return value;
  }

  private getTableDef(table: string): TableDef {
    const def = this.tables.get(table);
    if (!def) {
      throw new Error(`Table '${table}' is not defined. Call defineTable() first.`);
    }
    return def;
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
    const row = this.changeStmts.next.get() as { seq: number } | null;
    const value = Number(row?.seq);
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new Error('ReactiveDB could not allocate a durable change sequence');
    }
    this.seq = value;
    return this.seq;
  }

  private createChange(
    table: string,
    op: ChangeOp,
    rowId: string,
    row: Row | null,
    previousRow: Row | null = null
  ): Change {
    return {
      seq: this.nextSeq(),
      table,
      op,
      rowId,
      row,
      previousRow,
      ts: Date.now(),
    };
  }

  /**
   * Record a change in the ring buffer and emit to listeners.
   * During transactions, emission is deferred until commit.
   */
  private recordAndEmit(change: Change): void {
    this.recordChange(change);

    if (this.inTransaction && this.deferredChanges) {
      // Defer emission until transaction commits
      this.deferredChanges.push(change);
    } else {
      this.enqueueLocalChanges([change]);
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
    const data = change.row ? JSON.stringify(change.row) : null;
    const previousData = change.previousRow ? JSON.stringify(change.previousRow) : null;

    if (this.inTransaction) {
      // Already inside a transaction — just run the statements
      this.changeStmts.insert.run(
        change.seq,
        change.table,
        change.op,
        change.rowId,
        data,
        previousData,
        change.ts
      );
      const cutoff = change.seq - this.ringBufferDepth;
      if (cutoff > 0) {
        this.changeStmts.prune.run(cutoff);
      }
    } else {
      // Wrap in transaction for atomicity
      this.db.transaction(() => {
        this.changeStmts.insert.run(
          change.seq,
          change.table,
          change.op,
          change.rowId,
          data,
          previousData,
          change.ts
        );
        const cutoff = change.seq - this.ringBufferDepth;
        if (cutoff > 0) {
          this.changeStmts.prune.run(cutoff);
        }
      })();
    }
  }

  /**
   * Emit a change to all registered listeners.
   * Errors in listeners are caught and logged — a broken listener
   * cannot prevent subsequent listeners from being called.
   */
  private emitChange(change: Change): void {
    for (const listener of this.listeners) {
      try {
        listener(change);
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
        this.emitChange(change);
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
        if (isPromiseLike(result)) {
          void Promise.resolve(result).catch(() => {});
          throw new Error('ReactiveDB afterCommit callbacks must be synchronous');
        }
      } catch (error) {
        emitPlatformCode(OBS_CODES.SYNC_POST_COMMIT_NOTIFICATION_FAILED, { error });
      }
    }
  }

  private assertNotDisposed(): void {
    const rollbackOnlyError = this.transactionExecution.getStore()?.rollbackOnlyError;
    if (rollbackOnlyError) throw createRollbackOnlyError(rollbackOnlyError);
    if (this.disposed) {
      throw new Error('ReactiveDB is disposed');
    }
  }

  private markTransactionRollbackOnly(error: unknown): void {
    const execution = this.transactionExecution.getStore();
    if (!execution || execution.rollbackOnlyError) return;
    execution.rollbackOnlyError = normalizeError(error);
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

function deserializeChangeRow(row: ChangeRow): Change {
  return {
    seq: row.seq,
    table: row.tbl,
    op: row.op as ChangeOp,
    rowId: row.row_id,
    row: row.data ? JSON.parse(row.data) : null,
    previousRow: row.previous_data ? JSON.parse(row.previous_data) : null,
    ts: row.ts,
  };
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  if (value === null
    || (typeof value !== 'object' && typeof value !== 'function')) return false;
  try {
    return typeof (value as { then?: unknown }).then === 'function';
  } catch (cause) {
    throw new Error('ReactiveDB synchronous callback thenable inspection failed', { cause });
  }
}

function normalizeError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function createRollbackOnlyError(cause: Error): Error {
  return new Error(`ReactiveDB transaction is rollback-only: ${cause.message}`, { cause });
}
