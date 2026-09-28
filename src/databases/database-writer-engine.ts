/**
 * database-writer-engine.ts
 *
 * Actor-local execution engine for one writer-owned DatabaseRuntime. The
 * engine accepts only validated declarative operations: managed application
 * writes flow through ReactiveDB, while its private receipt ledger is the one
 * intentionally untracked internal SQL mutation.
 */

import type { Statement } from 'bun:sqlite';
import { createHash } from 'node:crypto';
import { stableStringify } from '../migrations/schema-snapshot';
import { quoteSqlIdentifier } from '../sync/identity';
import type { ReactiveDB } from '../sync/reactive-db';
import { validateSyncMutation } from '../sync/sync-mutation-validation';
import {
  SYNC_TABLE_MUTATION_VALIDATOR,
  type Change,
  type ChangeOp,
  type Row,
  type SyncTableMutationValidator,
} from '../sync/types';
import { DatabaseError } from './database-error';
import {
  cloneDatabaseSerializableValue,
  createDatabaseSequenceToken,
  validateDatabaseCommitResult,
  validateDatabaseOperation,
  validateDatabaseReadResult,
  type DatabaseAssertion,
  type DatabaseBatchOperation,
  type DatabaseCommitResult,
  type DatabaseListOperation,
  type DatabaseListPage,
  type DatabaseMutation,
  type DatabaseOperation,
  type DatabaseOperationCatalog,
  type DatabaseOperationRow,
  type DatabaseReadOperation,
  type DatabaseReadResult,
  type DatabaseSerializableValue,
  type DatabaseWriteOperation,
} from './database-operations';
import {
  createDatabaseRealmOperationCatalog,
  runDatabaseRealmCommand,
  runDatabaseRealmQuery,
  type DatabaseRealm,
} from './database-realm';
import type { DatabaseRuntime } from './database-runtime';

/** Current schema of the private durable write-receipt ledger. */
export const DATABASE_WRITER_RECEIPT_SCHEMA_VERSION = 1 as const;

/** Hard actor-local ceiling for one durable change replay page. */
export const DATABASE_WRITER_MAX_REPLAY_CHANGES = 500 as const;

const RECEIPT_TABLE = '_zero_database_operation_receipts';
const RECEIPT_COLUMNS_SQL = `(
  receipt_key TEXT PRIMARY KEY,
  realm_fingerprint TEXT NOT NULL,
  operation_fingerprint TEXT NOT NULL,
  result_json TEXT NOT NULL,
  final_seq INTEGER NOT NULL CHECK (final_seq >= 0),
  schema_version INTEGER NOT NULL CHECK (schema_version = 1),
  created_at INTEGER NOT NULL CHECK (created_at >= 0)
) STRICT, WITHOUT ROWID`;
const RECEIPT_STORED_SQL = `CREATE TABLE ${RECEIPT_TABLE} ${RECEIPT_COLUMNS_SQL}`;
const RECEIPT_CREATE_SQL =
  `CREATE TABLE IF NOT EXISTS main.${RECEIPT_TABLE} ${RECEIPT_COLUMNS_SQL}`;
const OPERATION_FINGERPRINT_DOMAIN = 'zero.database-operation.v1\0';

/** Precise result for one safe ReactiveDB CRUD mutation. */
export type DatabaseMutationEffect = Readonly<{
  readonly type: DatabaseMutation['type'];
  readonly table: string;
  readonly rowId: string;
  readonly changed: boolean;
  readonly op: ChangeOp | null;
  readonly sequence: Readonly<{ seq: number }> | null;
}>;

export type DatabaseMutationCommitValue = Readonly<{
  readonly kind: 'mutation';
  readonly mutation: DatabaseMutationEffect;
}>;

export type DatabaseBatchCommitValue = Readonly<{
  readonly kind: 'batch';
  readonly mutations: readonly DatabaseMutationEffect[];
}>;

export type DatabaseCommandCommitValue = Readonly<{
  readonly kind: 'command';
  readonly name: string;
  readonly output: DatabaseSerializableValue;
}>;

export type DatabaseWriterCommitValue =
  | DatabaseMutationCommitValue
  | DatabaseBatchCommitValue
  | DatabaseCommandCommitValue;

/** Privacy-safe durable sequence range made available by one committed write. */
export interface DatabaseChangesAvailableRange {
  /** Cursor immediately before the committed operation. */
  readonly afterSeq: number;
  /** Final durable sequence represented by the commit. */
  readonly throughSeq: number;
}

export type DatabaseChangesAvailableListener = (
  range: DatabaseChangesAvailableRange,
) => void;

/** Canonical change shape returned for actor/coordinator replay. */
export type DatabaseReplayChange = Readonly<{
  readonly seq: number;
  readonly table: string;
  readonly op: ChangeOp;
  readonly rowId: string;
  readonly row: DatabaseOperationRow | null;
  readonly previousRow: DatabaseOperationRow | null;
  readonly ts: number;
}>;

export type DatabaseChangeReplayPage = Readonly<{
  /** Cursor supplied by the caller for this page. */
  readonly afterSeq: number;
  /** Last sequence consumed by this page, or `afterSeq` when it is empty. */
  readonly throughSeq: number;
  /** Cursor for the next page, or null once the represented head is reached. */
  readonly nextAfterSeq: number | null;
  readonly changes: readonly DatabaseReplayChange[];
}>;

export type DatabaseChangeReplayResult = DatabaseReadResult<DatabaseChangeReplayPage>;

export type DatabaseWriterOperationResult =
  | DatabaseReadResult
  | DatabaseCommitResult<DatabaseWriterCommitValue>;

export interface DatabaseWriterOperationEngineOptions {
  /** Open, writer-owned runtime dedicated to this engine's database file. */
  readonly runtime: DatabaseRuntime;
  /** Realm imported independently inside this actor process. */
  readonly realm: DatabaseRealm;
}

interface ReceiptRow {
  receipt_key: string;
  realm_fingerprint: string;
  operation_fingerprint: string;
  result_json: string;
  final_seq: number;
  schema_version: number;
  created_at: number;
  receipt_key_type: string;
  realm_fingerprint_type: string;
  operation_fingerprint_type: string;
  result_json_type: string;
  final_seq_type: string;
  schema_version_type: string;
  created_at_type: string;
}

interface WriteExecution {
  result: DatabaseCommitResult<DatabaseWriterCommitValue>;
  beforeSeq: number;
  replayed: boolean;
}

/**
 * Synchronous engine hosted by one isolated writer actor.
 *
 * The transport may await its return value, but SQLite work deliberately stays
 * synchronous within the actor so transaction and commit outcomes are exact.
 */
export class DatabaseWriterOperationEngine {
  readonly runtime: DatabaseRuntime;
  readonly realm: DatabaseRealm;

  private readonly catalog: DatabaseOperationCatalog;
  private readonly receiptGet: Statement;
  private readonly receiptInsert: Statement;
  private readonly changeListeners = new Set<DatabaseChangesAvailableListener>();
  private readonly pendingChangeRanges: DatabaseChangesAvailableRange[] = [];
  private emittingChangeRanges = false;
  private closed = false;

  constructor(options: DatabaseWriterOperationEngineOptions) {
    this.runtime = options.runtime;
    this.realm = options.realm;
    this.catalog = createDatabaseRealmOperationCatalog(options.realm);

    if (options.runtime.diagnostics().closed) {
      throw new DatabaseError(
        'DATABASE_CLOSED',
        'Database writer runtime is closed.',
      );
    }

    this.assertRealmMatchesRuntime();
    this.initializeReceiptSchema();
    let receiptGet: Statement | null = null;
    try {
      receiptGet = this.runtime.db.prepare(`
        SELECT
          receipt_key,
          realm_fingerprint,
          operation_fingerprint,
          result_json,
          final_seq,
          schema_version,
          created_at,
          typeof(receipt_key) AS receipt_key_type,
          typeof(realm_fingerprint) AS realm_fingerprint_type,
          typeof(operation_fingerprint) AS operation_fingerprint_type,
          typeof(result_json) AS result_json_type,
          typeof(final_seq) AS final_seq_type,
          typeof(schema_version) AS schema_version_type,
          typeof(created_at) AS created_at_type
        FROM main.${RECEIPT_TABLE}
        WHERE receipt_key = ?
      `);
      this.receiptInsert = this.runtime.db.prepare(`
        INSERT INTO main.${RECEIPT_TABLE} (
          receipt_key,
          realm_fingerprint,
          operation_fingerprint,
          result_json,
          final_seq,
          schema_version,
          created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      this.receiptGet = receiptGet;
    } catch (cause) {
      try {
        receiptGet?.finalize();
      } catch {
        // Preserve the initialization failure.
      }
      throw new DatabaseError(
        'DATABASE_SCHEMA_MISMATCH',
        'Database receipt statements could not be prepared.',
        { cause },
      );
    }
  }

  /** Validate and execute one operation against this actor's bound realm. */
  execute(value: unknown): DatabaseWriterOperationResult {
    this.assertOpen();
    const operation = validateDatabaseOperation(value, this.catalog);
    return isReadOperation(operation)
      ? this.executeRead(operation)
      : this.executeWrite(operation);
  }

  /**
   * Read contiguous retained changes after a durable cursor.
   * A pruned, future, corrupt, or discontinuous cursor fails explicitly.
   */
  replayChanges(afterSeq: number, limit: number): DatabaseChangeReplayResult {
    this.assertOpen();
    if (!Number.isSafeInteger(afterSeq) || afterSeq < 0) {
      throw new DatabaseError(
        'DATABASE_PAYLOAD_INVALID',
        'Database replay cursor must be a non-negative safe integer.',
      );
    }
    if (!Number.isSafeInteger(limit)
      || limit < 1
      || limit > DATABASE_WRITER_MAX_REPLAY_CHANGES) {
      throw new DatabaseError(
        'DATABASE_PAYLOAD_INVALID',
        'Database replay limit is invalid.',
      );
    }

    try {
      const changes = this.runtime.db.getChangesAfter(afterSeq);
      const currentSeq = this.runtime.db.currentSeq;
      if (!changes) {
        throw historyGap(afterSeq, currentSeq);
      }
      const pageChanges = changes.slice(0, limit);
      const throughSeq = pageChanges.length === 0
        ? afterSeq
        : pageChanges[pageChanges.length - 1]!.seq;
      const value: DatabaseChangeReplayPage = {
        afterSeq,
        throughSeq,
        nextAfterSeq: changes.length > pageChanges.length ? throughSeq : null,
        changes: pageChanges.map(toReplayChange),
      };
      return validateDatabaseReadResult({
        value,
        sequence: createDatabaseSequenceToken(currentSeq),
      }) as DatabaseChangeReplayResult;
    } catch (error) {
      if (error instanceof DatabaseError) throw error;
      throw new DatabaseError(
        'DATABASE_EXECUTOR_FAILED',
        'Database change replay failed.',
        { cause: error, retryable: false, outcome: null },
      );
    }
  }

  /** Register a synchronous, data-free commit-range wakeup. */
  onChangesAvailable(listener: DatabaseChangesAvailableListener): () => void {
    this.assertOpen();
    if (typeof listener !== 'function') {
      throw new TypeError('Database change listener must be a function.');
    }
    this.changeListeners.add(listener);
    return () => this.changeListeners.delete(listener);
  }

  /** Finalize engine-owned statements; the caller still owns the runtime. */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.changeListeners.clear();
    this.pendingChangeRanges.length = 0;
    const failures: unknown[] = [];
    for (const statement of [this.receiptGet, this.receiptInsert]) {
      try {
        statement.finalize();
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length > 0) {
      throw new AggregateError(
        failures,
        'Database writer engine failed to finalize its statements.',
      );
    }
  }

  private executeRead(operation: DatabaseReadOperation): DatabaseReadResult {
    try {
      const previousQueryOnly = readQueryOnly(this.runtime);
      this.runtime.sqlite.raw.run('PRAGMA query_only = ON');
      try {
        const snapshot = this.runtime.db.readAtCurrentSequence(() => {
          switch (operation.type) {
            case 'get':
              return this.runtime.db.get(operation.table, operation.id);
            case 'list':
              return this.readListPage(operation);
            case 'query':
              return runDatabaseRealmQuery(
                this.realm,
                { database: this.runtime.sqlite.raw },
                operation.name,
                operation.input,
              );
          }
        });

        if (operation.consistency?.mode === 'read-your-writes'
          && snapshot.seq < operation.consistency.minSeq.seq) {
          throw new DatabaseError(
            'DATABASE_NOT_READY',
            'Database has not reached the requested sequence.',
            {
              details: {
                currentSeq: snapshot.seq,
                minSeq: operation.consistency.minSeq.seq,
              },
            },
          );
        }
        return validateDatabaseReadResult({
          value: snapshot.value,
          sequence: createDatabaseSequenceToken(snapshot.seq),
        });
      } finally {
        this.runtime.sqlite.raw.run(
          `PRAGMA query_only = ${previousQueryOnly ? 'ON' : 'OFF'}`,
        );
      }
    } catch (error) {
      if (error instanceof DatabaseError) throw error;
      throw new DatabaseError(
        'DATABASE_EXECUTOR_FAILED',
        'Database read operation failed.',
        { cause: error, retryable: false, outcome: null },
      );
    }
  }

  private readListPage(operation: DatabaseListOperation): DatabaseListPage {
    const primaryKey = this.catalog.primaryKeys?.[operation.table];
    if (!primaryKey) {
      throw new DatabaseError(
        'DATABASE_SCHEMA_MISMATCH',
        'Database table primary key is unavailable.',
      );
    }
    const tableSql = quoteSqlIdentifier(operation.table);
    const primaryKeySql = quoteSqlIdentifier(primaryKey);
    const statement = this.runtime.db.prepare(operation.after === undefined
      ? `SELECT * FROM main.${tableSql} ORDER BY ${primaryKeySql} ASC LIMIT ?`
      : `SELECT * FROM main.${tableSql} WHERE ${primaryKeySql} > ? `
        + `ORDER BY ${primaryKeySql} ASC LIMIT ?`);
    try {
      const requested = operation.limit + 1;
      const rows = (operation.after === undefined
        ? statement.all(requested)
        : statement.all(operation.after, requested)) as Row[];
      const hasMore = rows.length > operation.limit;
      const pageRows = hasMore ? rows.slice(0, operation.limit) : rows;
      const last = pageRows[pageRows.length - 1];
      const nextCursor = hasMore && last
        ? String(last[primaryKey])
        : null;
      return { rows: pageRows as DatabaseOperationRow[], nextCursor };
    } finally {
      statement.finalize();
    }
  }

  private executeWrite(
    operation: DatabaseWriteOperation,
  ): DatabaseCommitResult<DatabaseWriterCommitValue> {
    const fingerprint = fingerprintOperation(this.realm.fingerprint, operation);
    try {
      const execution = this.runtime.db.transaction((): WriteExecution => {
        const receipt = this.findReceipt(operation.idempotencyKey, fingerprint);
        if (receipt) {
          return {
            result: validateDatabaseCommitResult({
              ...receipt,
              replayed: true,
            }) as DatabaseCommitResult<DatabaseWriterCommitValue>,
            beforeSeq: receipt.sequence.seq,
            replayed: true,
          };
        }

        const beforeSeq = this.runtime.db.currentSeq;
        const value = this.executeWriteValue(operation);
        const finalSeq = this.runtime.db.currentSeq;
        const result = validateDatabaseCommitResult({
          value,
          sequence: createDatabaseSequenceToken(finalSeq),
          idempotencyKey: operation.idempotencyKey,
          replayed: false,
        }) as DatabaseCommitResult<DatabaseWriterCommitValue>;
        this.saveReceipt(operation.idempotencyKey, fingerprint, result);
        return { result, beforeSeq, replayed: false };
      });

      if (!execution.replayed
        && execution.result.sequence.seq > execution.beforeSeq) {
        this.emitChangesAvailable({
          afterSeq: execution.beforeSeq,
          throughSeq: execution.result.sequence.seq,
        });
      }
      return execution.result;
    } catch (error) {
      throw normalizeWriteFailure(error);
    }
  }

  private executeWriteValue(operation: DatabaseWriteOperation): DatabaseWriterCommitValue {
    switch (operation.type) {
      case 'mutate':
        return {
          kind: 'mutation',
          mutation: this.applyMutation(operation.mutation),
        };
      case 'batch':
        return this.executeBatch(operation);
      case 'command':
        return {
          kind: 'command',
          name: operation.name,
          output: runDatabaseRealmCommand(
            this.realm,
            { db: this.runtime.db },
            operation.name,
            operation.input,
          ),
        };
    }
  }

  private executeBatch(operation: DatabaseBatchOperation): DatabaseBatchCommitValue {
    for (let index = 0; index < (operation.assertions?.length ?? 0); index += 1) {
      this.evaluateAssertion(operation.assertions![index]!, index);
    }
    return {
      kind: 'batch',
      mutations: operation.mutations.map((mutation) => this.applyMutation(mutation)),
    };
  }

  private evaluateAssertion(assertion: DatabaseAssertion, index: number): void {
    let matches: boolean;
    switch (assertion.type) {
      case 'row-exists':
        matches = this.runtime.db.get(assertion.table, assertion.id) !== null;
        break;
      case 'row-missing':
        matches = this.runtime.db.get(assertion.table, assertion.id) === null;
        break;
      case 'row-equals': {
        const row = this.runtime.db.get(assertion.table, assertion.id);
        matches = row !== null
          && stableStringify(row) === stableStringify(assertion.row);
        break;
      }
      case 'sequence-equals':
        matches = this.runtime.db.currentSeq === assertion.sequence.seq;
        break;
    }
    if (!matches) {
      throw new DatabaseError(
        'DATABASE_CONFLICT',
        'Database batch assertion failed.',
        {
          retryable: false,
          outcome: 'not-committed',
          details: { assertionIndex: index },
        },
      );
    }
  }

  private applyMutation(mutation: DatabaseMutation): DatabaseMutationEffect {
    if ((mutation.type === 'update' || mutation.type === 'delete')
      && this.runtime.db.get(mutation.table, mutation.id) === null) {
      return noChangeEffect(mutation);
    }

    const validator = this.realm.tables[mutation.table]?.[
      SYNC_TABLE_MUTATION_VALIDATOR
    ];
    let row: Row | Partial<Row> | undefined;
    if (mutation.type === 'create' || mutation.type === 'upsert') {
      row = this.validateMutationRow(
        mutation.table,
        'INSERT',
        undefined,
        mutation.row,
        validator,
      );
    } else if (mutation.type === 'update') {
      row = this.validateMutationRow(
        mutation.table,
        'UPDATE',
        mutation.id,
        mutation.patch,
        validator,
      );
    }

    let change: Change | null;
    try {
      switch (mutation.type) {
        case 'create':
          change = this.runtime.db.createStrict(mutation.table, row as Row);
          break;
        case 'upsert':
          change = this.runtime.db.create(mutation.table, row as Row);
          break;
        case 'update':
          change = this.runtime.db.update(mutation.table, mutation.id, row as Partial<Row>);
          break;
        case 'delete':
          change = this.runtime.db.delete(mutation.table, mutation.id);
          break;
      }
    } catch (error) {
      if (isExpectedMutationConflict(error)) {
        throw new DatabaseError(
          'DATABASE_CONFLICT',
          'Database mutation conflicted.',
          {
            cause: error,
            retryable: false,
            outcome: 'not-committed',
          },
        );
      }
      throw error;
    }
    return change ? changeEffect(mutation, change) : noChangeEffect(mutation);
  }

  private validateMutationRow(
    table: string,
    op: 'INSERT' | 'UPDATE',
    rowId: string | undefined,
    row: DatabaseOperationRow,
    validator: SyncTableMutationValidator | undefined,
  ): Row | Partial<Row> {
    const result = validateSyncMutation(
      this.runtime.db,
      table,
      op,
      rowId,
      row as Row,
      validator,
    );
    if (!result.ok || !result.row) {
      throw new DatabaseError(
        'DATABASE_PAYLOAD_INVALID',
        'Database mutation failed logical row validation.',
        { retryable: false, outcome: 'not-committed' },
      );
    }
    return result.row;
  }

  private findReceipt(
    idempotencyKey: string,
    operationFingerprint: string,
  ): DatabaseCommitResult<DatabaseWriterCommitValue> | null {
    const row = this.receiptGet.get(idempotencyKey) as ReceiptRow | null;
    if (!row) return null;
    assertReceiptRow(row, idempotencyKey);
    if (row.final_seq > this.runtime.db.currentSeq) throw receiptCorrupt();
    if (row.realm_fingerprint !== this.realm.fingerprint
      || row.operation_fingerprint !== operationFingerprint) {
      throw new DatabaseError(
        'DATABASE_CONFLICT',
        'Database idempotency key was already used for another operation.',
        { retryable: false, outcome: 'not-committed' },
      );
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(row.result_json);
    } catch (cause) {
      throw receiptCorrupt(cause);
    }
    let result: DatabaseCommitResult;
    try {
      result = validateDatabaseCommitResult(parsed);
    } catch (cause) {
      throw receiptCorrupt(cause);
    }
    if (result.idempotencyKey !== idempotencyKey
      || result.sequence.seq !== row.final_seq
      || result.replayed) {
      throw receiptCorrupt();
    }
    return result as DatabaseCommitResult<DatabaseWriterCommitValue>;
  }

  private saveReceipt(
    idempotencyKey: string,
    operationFingerprint: string,
    result: DatabaseCommitResult<DatabaseWriterCommitValue>,
  ): void {
    const encoded = JSON.stringify(result);
    const outcome = this.receiptInsert.run(
      idempotencyKey,
      this.realm.fingerprint,
      operationFingerprint,
      encoded,
      result.sequence.seq,
      DATABASE_WRITER_RECEIPT_SCHEMA_VERSION,
      Date.now(),
    );
    if (outcome.changes !== 1) throw receiptCorrupt();
  }

  private emitChangesAvailable(range: DatabaseChangesAvailableRange): void {
    this.pendingChangeRanges.push(Object.freeze({ ...range }));
    if (this.emittingChangeRanges) return;
    this.emittingChangeRanges = true;
    try {
      while (this.pendingChangeRanges.length > 0) {
        const value = this.pendingChangeRanges.shift()!;
        for (const listener of [...this.changeListeners]) {
          try {
            const outcome = (
              listener as (range: DatabaseChangesAvailableRange) => unknown
            )(value);
            if (isPromiseLike(outcome)) void Promise.resolve(outcome).catch(() => {});
          } catch {
            // A wakeup hook runs after commit and cannot change its outcome.
          }
        }
      }
    } finally {
      this.emittingChangeRanges = false;
    }
  }

  private assertRealmMatchesRuntime(): void {
    for (const [table, schema] of Object.entries(this.realm.tables)) {
      try {
        if (!this.runtime.db.hasTable(table)) throw new Error('missing table');
        const expectedColumns = Object.keys(schema).filter((name) => name !== '_identity');
        const actualColumns = this.runtime.db.getColumns(table);
        const expectedPrimaryKey = this.catalog.primaryKeys?.[table];
        if (expectedColumns.length !== actualColumns.length
          || expectedColumns.some((column, index) => column !== actualColumns[index])
          || !expectedPrimaryKey
          || this.runtime.db.getPrimaryKey(table) !== expectedPrimaryKey) {
          throw new Error('table contract differs');
        }
      } catch (cause) {
        throw new DatabaseError(
          'DATABASE_SCHEMA_MISMATCH',
          'Database runtime does not match its realm schema.',
          { cause },
        );
      }
    }
  }

  private initializeReceiptSchema(): void {
    try {
      this.runtime.db.exec(RECEIPT_CREATE_SQL);
      const definition = this.runtime.db.prepare(`
        SELECT type, sql FROM main.sqlite_schema WHERE name = ?
      `);
      let schema: { type: string; sql: string | null } | null;
      try {
        schema = definition.get(RECEIPT_TABLE) as {
          type: string;
          sql: string | null;
        } | null;
      } finally {
        definition.finalize();
      }
      if (!schema
        || schema.type !== 'table'
        || !schema.sql
        || normalizeSqlShape(schema.sql) !== normalizeSqlShape(RECEIPT_STORED_SQL)) {
        throw new Error('receipt table definition differs');
      }

      const details = this.runtime.db.prepare(
        `PRAGMA main.table_list(${JSON.stringify(RECEIPT_TABLE)})`,
      );
      let tableRows: Array<{
        name: string;
        type: string;
        ncol: number;
        wr: number;
        strict: number;
      }>;
      try {
        tableRows = details.all() as typeof tableRows;
      } finally {
        details.finalize();
      }
      if (tableRows.length !== 1
        || tableRows[0]!.name !== RECEIPT_TABLE
        || tableRows[0]!.type !== 'table'
        || tableRows[0]!.ncol !== 7
        || tableRows[0]!.wr !== 1
        || tableRows[0]!.strict !== 1) {
        throw new Error('receipt table flags differ');
      }

      const triggers = this.runtime.db.prepare(`
        SELECT COUNT(*) AS count
        FROM main.sqlite_schema
        WHERE type = 'trigger' AND tbl_name = ?
      `);
      let triggerCount: number;
      try {
        triggerCount = (triggers.get(RECEIPT_TABLE) as { count: number }).count;
      } finally {
        triggers.finalize();
      }
      if (triggerCount !== 0) throw new Error('receipt table has triggers');
    } catch (cause) {
      if (cause instanceof DatabaseError) throw cause;
      throw new DatabaseError(
        'DATABASE_SCHEMA_MISMATCH',
        'Database receipt schema is incompatible.',
        { cause },
      );
    }
  }

  private assertOpen(): void {
    if (this.closed || this.runtime.diagnostics().closed) {
      throw new DatabaseError(
        'DATABASE_CLOSED',
        'Database writer engine is closed.',
      );
    }
  }
}

function isReadOperation(operation: DatabaseOperation): operation is DatabaseReadOperation {
  return operation.type === 'get'
    || operation.type === 'list'
    || operation.type === 'query';
}

function fingerprintOperation(
  realmFingerprint: string,
  operation: DatabaseWriteOperation,
): string {
  return `sha256:${createHash('sha256')
    .update(OPERATION_FINGERPRINT_DOMAIN, 'utf8')
    .update(stableStringify({ realmFingerprint, operation }), 'utf8')
    .digest('hex')}`;
}

function changeEffect(
  mutation: DatabaseMutation,
  change: Change,
): DatabaseMutationEffect {
  return {
    type: mutation.type,
    table: mutation.table,
    rowId: change.rowId,
    changed: true,
    op: change.op,
    sequence: createDatabaseSequenceToken(change.seq),
  };
}

function noChangeEffect(mutation: DatabaseMutation): DatabaseMutationEffect {
  if (mutation.type === 'create' || mutation.type === 'upsert') {
    throw new DatabaseError(
      'DATABASE_EXECUTOR_FAILED',
      'Database mutation produced no change.',
      { retryable: false, outcome: 'not-committed' },
    );
  }
  return {
    type: mutation.type,
    table: mutation.table,
    rowId: mutation.id,
    changed: false,
    op: null,
    sequence: null,
  };
}

function toReplayChange(change: Change): DatabaseReplayChange {
  return cloneDatabaseSerializableValue({
    seq: change.seq,
    table: change.table,
    op: change.op,
    rowId: change.rowId,
    row: change.row,
    previousRow: change.previousRow ?? null,
    ts: change.ts,
  }) as DatabaseReplayChange;
}

function assertReceiptRow(row: ReceiptRow, idempotencyKey: string): void {
  if (row.receipt_key !== idempotencyKey
    || row.receipt_key_type !== 'text'
    || row.realm_fingerprint_type !== 'text'
    || row.operation_fingerprint_type !== 'text'
    || row.result_json_type !== 'text'
    || row.final_seq_type !== 'integer'
    || row.schema_version_type !== 'integer'
    || row.created_at_type !== 'integer'
    || row.schema_version !== DATABASE_WRITER_RECEIPT_SCHEMA_VERSION
    || !Number.isSafeInteger(row.final_seq)
    || row.final_seq < 0
    || !Number.isSafeInteger(row.created_at)
    || row.created_at < 0
    || !/^sha256:[a-f0-9]{64}$/u.test(row.realm_fingerprint)
    || !/^sha256:[a-f0-9]{64}$/u.test(row.operation_fingerprint)) {
    throw receiptCorrupt();
  }
}

function receiptCorrupt(cause?: unknown): DatabaseError {
  return new DatabaseError(
    'DATABASE_SCHEMA_MISMATCH',
    'Database idempotency receipt is incompatible.',
    cause === undefined ? undefined : { cause },
  );
}

function historyGap(afterSeq: number, currentSeq: number): DatabaseError {
  return new DatabaseError(
    'DATABASE_HISTORY_GAP',
    'Database change history cannot satisfy the requested cursor.',
    { details: { afterSeq, currentSeq } },
  );
}

function normalizeWriteFailure(error: unknown): DatabaseError {
  if (error instanceof DatabaseError) {
    if (error.outcome === 'not-committed') return error;
    return new DatabaseError(error.code, error.message, {
      cause: error,
      retryable: error.retryable,
      outcome: 'not-committed',
      details: error.details,
    });
  }
  if (isExpectedMutationConflict(error)) {
    return new DatabaseError(
      'DATABASE_CONFLICT',
      'Database mutation conflicted.',
      {
        cause: error,
        retryable: false,
        outcome: 'not-committed',
      },
    );
  }
  return new DatabaseError(
    'DATABASE_EXECUTOR_FAILED',
    'Database write operation failed.',
    {
      cause: error,
      retryable: false,
      outcome: 'not-committed',
    },
  );
}

function isExpectedMutationConflict(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { code?: unknown; message?: unknown };
  if (typeof candidate.code === 'string'
    && candidate.code.startsWith('SQLITE_CONSTRAINT')) return true;
  return typeof candidate.message === 'string'
    && /already exists|constraint|identity conflict|immutable/iu.test(candidate.message);
}

function normalizeSqlShape(sql: string): string {
  return sql.trim().replace(/\s+/gu, ' ').replace(/\s*,\s*/gu, ', ').toLowerCase();
}

function readQueryOnly(runtime: DatabaseRuntime): boolean {
  const row = runtime.sqlite.raw.query('PRAGMA query_only').get() as Record<
    string,
    unknown
  > | null;
  const value = row ? Object.values(row)[0] : null;
  if (value !== 0 && value !== 1) {
    throw new Error('SQLite query_only state is unavailable');
  }
  return value === 1;
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (typeof value === 'object' && value !== null)
    || typeof value === 'function'
    ? typeof (value as { then?: unknown }).then === 'function'
    : false;
}
