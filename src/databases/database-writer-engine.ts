/**
 * database-writer-engine.ts
 *
 * Actor-local execution engine for one writer-owned DatabaseRuntime. The
 * engine accepts only validated declarative operations: managed application
 * writes flow through ReactiveDB, while its private receipt ledger is the one
 * intentionally untracked internal SQL mutation.
 */

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
import { runDatabaseFind } from './database-find';
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
import {
  validateDatabaseActorLegacyReceiptResult,
  validateDatabaseActorTrustedWriteResult,
} from './database-actor-result-validation';
import {
  validateDatabaseLogicalReceiptFingerprint,
  validateDatabaseReceiptLookupIdentity,
  type DatabaseLogicalReceiptFingerprint,
  type DatabaseTrustedReceiptLookup,
} from './database-trusted-writer';
import {
  DatabaseReceiptLedger,
  type DatabaseWriterReceiptCompaction,
  type DatabaseWriterReceiptRetentionCounts,
} from './database-receipt-ledger';
export {
  DATABASE_WRITER_MAX_RECEIPTS,
  DATABASE_WRITER_MAX_RECEIPT_KEYS,
  DATABASE_WRITER_MAX_RECEIPT_RESULT_BYTES,
  DATABASE_WRITER_MAX_RETAINED_RECEIPT_BYTES,
  DATABASE_WRITER_RECEIPT_SCHEMA_VERSION,
} from './database-receipt-ledger';
export type {
  DatabaseWriterReceiptCompaction,
  DatabaseWriterReceiptRetentionCounts,
} from './database-receipt-ledger';

/** Hard actor-local ceiling for one durable change replay page. */
export const DATABASE_WRITER_MAX_REPLAY_CHANGES = 500 as const;

const OPERATION_FINGERPRINT_DOMAIN = 'zero.database-operation.v1\0';
const LOGICAL_RECEIPT_FINGERPRINT_DOMAIN = 'zero.database-logical-receipt.v1\0';

/** Precise result for one safe ReactiveDB CRUD mutation. */
export type DatabaseMutationEffect = Readonly<{
  readonly type: DatabaseMutation['type'];
  readonly table: string;
  readonly rowId: string;
  readonly changed: boolean;
  readonly op: ChangeOp | null;
  readonly sequence: Readonly<{ seq: number }> | null;
  /**
   * Exact post-commit row for inserts/updates, or null for deletion/no-op.
   * Absent only when replaying an exact receipt created by the v1 contract.
   */
  readonly row?: DatabaseOperationRow | null;
  /**
   * Exact row replaced/deleted by this change, or null for inserts/no-op.
   * Absent only when replaying an exact receipt created by the v1 contract.
   */
  readonly previousRow?: DatabaseOperationRow | null;
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

interface WriteExecution {
  result: DatabaseCommitResult<DatabaseWriterCommitValue>;
  beforeSeq: number;
  replayed: boolean;
  receiptCompaction: DatabaseWriterReceiptCompaction | null;
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
  private readonly receipts: DatabaseReceiptLedger<
    DatabaseCommitResult<DatabaseWriterCommitValue>
  >;
  private readonly changeListeners = new Set<DatabaseChangesAvailableListener>();
  private readonly pendingChangeRanges: DatabaseChangesAvailableRange[] = [];
  private pendingReceiptCompaction: DatabaseWriterReceiptCompaction | null = null;
  private emittingChangeRanges = false;
  private closing = false;
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
    this.receipts = new DatabaseReceiptLedger({
      runtime: this.runtime,
      realmFingerprint: this.realm.fingerprint,
      parseRetainedResult: (row, idempotencyKey, resultVersion) =>
        this.parseRetainedReceipt(row, idempotencyKey, resultVersion),
    });
  }

  /** Validate and execute one operation against this actor's bound realm. */
  execute(
    value: unknown,
    logicalReceiptFingerprint?: DatabaseLogicalReceiptFingerprint,
  ): DatabaseWriterOperationResult {
    this.assertOpen();
    this.pendingReceiptCompaction = null;
    const operation = validateDatabaseOperation(value, this.catalog);
    const receiptFingerprint = logicalReceiptFingerprint === undefined
      ? undefined
      : validateDatabaseLogicalReceiptFingerprint(logicalReceiptFingerprint);
    if (receiptFingerprint !== undefined && isReadOperation(operation)) {
      throw new DatabaseError(
        'DATABASE_PAYLOAD_INVALID',
        'Logical receipt fingerprints require a write operation.',
      );
    }
    return isReadOperation(operation)
      ? this.executeRead(operation)
      : this.executeWrite(operation, receiptFingerprint);
  }

  /** @internal Consume one privacy-safe compaction summary after execute(). */
  takeReceiptCompaction(): DatabaseWriterReceiptCompaction | null {
    const value = this.pendingReceiptCompaction;
    this.pendingReceiptCompaction = null;
    return value;
  }

  /** Trusted pre-read for a logical request receipt on this writer authority. */
  findReceipt(
    idempotencyKey: string,
    logicalReceiptFingerprint: DatabaseLogicalReceiptFingerprint,
  ): DatabaseTrustedReceiptLookup {
    this.assertOpen();
    const identity = validateDatabaseReceiptLookupIdentity(
      idempotencyKey,
      logicalReceiptFingerprint,
    );
    const fingerprint = fingerprintLogicalReceipt(
      this.realm.fingerprint,
      identity.logicalReceiptFingerprint,
    );
    const receipt = this.receipts.lookup(identity.idempotencyKey, fingerprint);
    if (receipt.status === 'expired') throw receiptExpired();
    return receipt.status === 'retained'
      ? Object.freeze({
        status: 'hit',
        result: Object.freeze({ ...receipt.result, replayed: true }),
      })
      : Object.freeze({ status: 'miss' });
  }

  /**
   * Aggregate-only retention counts for diagnostics and operational gauges.
   * Tombstones are intentionally permanent: safe deletion would require a
   * separately negotiated retry horizon proving every producer forgot a key.
   */
  receiptRetentionCounts(): DatabaseWriterReceiptRetentionCounts {
    this.assertOpen();
    return this.receipts.retentionCounts();
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
    this.closing = true;
    this.changeListeners.clear();
    this.pendingChangeRanges.length = 0;
    this.receipts.close();
    this.closed = true;
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
            case 'find':
              return runDatabaseFind(
                this.runtime.sqlite.raw,
                operation,
                this.catalog,
              );
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
    logicalReceiptFingerprint?: DatabaseLogicalReceiptFingerprint,
  ): DatabaseCommitResult<DatabaseWriterCommitValue> {
    const fingerprint = logicalReceiptFingerprint === undefined
      ? fingerprintOperation(this.realm.fingerprint, operation)
      : fingerprintLogicalReceipt(
        this.realm.fingerprint,
        logicalReceiptFingerprint,
      );
    try {
      const execution = this.runtime.db.transaction((): WriteExecution => {
        const receipt = this.receipts.lookup(operation.idempotencyKey, fingerprint);
        if (receipt.status === 'expired') throw receiptExpired();
        if (receipt.status === 'retained') {
          return {
            result: validateDatabaseCommitResult({
              ...receipt.result,
              replayed: true,
            }) as DatabaseCommitResult<DatabaseWriterCommitValue>,
            beforeSeq: receipt.result.sequence.seq,
            replayed: true,
            receiptCompaction: null,
          };
        }

        // The permanent identity quota is checked only after exact replay and
        // expired-key lookup, but before any application mutation can run.
        this.receipts.assertCanInsert();
        const beforeSeq = this.runtime.db.currentSeq;
        const value = this.executeWriteValue(operation);
        const finalSeq = this.runtime.db.currentSeq;
        const result = validateDatabaseCommitResult({
          value,
          sequence: createDatabaseSequenceToken(finalSeq),
          idempotencyKey: operation.idempotencyKey,
          replayed: false,
        }) as DatabaseCommitResult<DatabaseWriterCommitValue>;
        const receiptCompaction = this.receipts.save(
          operation.idempotencyKey,
          fingerprint,
          result,
          result.sequence.seq,
        );
        return { result, beforeSeq, replayed: false, receiptCompaction };
      });

      // These counts were derived from values already read while saving the
      // receipt. Never scan the permanent tombstone ledger on the write path.
      this.pendingReceiptCompaction = execution.receiptCompaction;

      if (!execution.replayed
        && execution.result.sequence.seq > execution.beforeSeq) {
        this.emitChangesAvailable({
          afterSeq: execution.beforeSeq,
          throughSeq: execution.result.sequence.seq,
        });
      }
      return execution.result;
    } catch (error) {
      if (this.runtime.sqlite.mode === 'hot' && isSQLiteFull(error)) {
        throw new DatabaseError(
          'DATABASE_PAYLOAD_LIMIT',
          'Database write exceeds the configured hot-memory capacity.',
          {
            cause: error,
            retryable: false,
            outcome: 'not-committed',
            details: { reason: 'max-bytes' },
          },
        );
      }
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
          details: { assertionIndex: index, conflictType: 'cas' },
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
            details: { conflictType: mutationConflictType(error) },
          },
        );
      }
      throw error;
    }
    if (!change) return noChangeEffect(mutation);
    const committedRow = change.op === 'DELETE'
      ? null
      : this.runtime.db.get(mutation.table, change.rowId);
    if (change.op !== 'DELETE' && committedRow === null) {
      throw new DatabaseError(
        'DATABASE_EXECUTOR_FAILED',
        'Database mutation could not read its committed row.',
        { retryable: false, outcome: 'not-committed' },
      );
    }
    return changeEffect(
      mutation,
      change,
      committedRow as DatabaseOperationRow | null,
      (change.previousRow ?? null) as DatabaseOperationRow | null,
    );
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
        const columnInfo = this.runtime.db.prepare(
          `PRAGMA main.table_xinfo(${quoteSqlIdentifier(table)})`,
        );
        let physicalColumns: Array<{ name: string; type: string; hidden: number }>;
        try {
          physicalColumns = columnInfo.all() as typeof physicalColumns;
        } finally {
          columnInfo.finalize();
        }
        if (expectedColumns.length !== actualColumns.length
          || expectedColumns.some((column, index) => column !== actualColumns[index])
          || !expectedPrimaryKey
          || this.runtime.db.getPrimaryKey(table) !== expectedPrimaryKey
          || physicalColumns.length !== expectedColumns.length
          || physicalColumns.some((column) => column.hidden !== 0
            || !hasPortableDatabaseAffinity(column.type))) {
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


  private parseRetainedReceipt(
    row: Readonly<{ resultJson: string; finalSeq: number }>,
    idempotencyKey: string,
    resultVersion: number,
  ): DatabaseCommitResult<DatabaseWriterCommitValue> {
    if (row.finalSeq > this.runtime.db.currentSeq) {
      throw receiptCorrupt();
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(row.resultJson);
    } catch (cause) {
      throw receiptCorrupt(cause);
    }
    let result: DatabaseCommitResult<DatabaseWriterCommitValue>;
    try {
      result = resultVersion === 1
        ? validateDatabaseActorLegacyReceiptResult(
          parsed,
          idempotencyKey,
          this.catalog,
        )
        : validateDatabaseActorTrustedWriteResult(
          parsed,
          idempotencyKey,
          this.catalog,
        );
    } catch (cause) {
      throw receiptCorrupt(cause);
    }
    if (result.idempotencyKey !== idempotencyKey
      || result.sequence.seq !== row.finalSeq
      || result.replayed) {
      throw receiptCorrupt();
    }
    return result;
  }

  private assertOpen(): void {
    if (this.closing || this.closed || this.runtime.diagnostics().closed) {
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
    || operation.type === 'find'
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

function fingerprintLogicalReceipt(
  realmFingerprint: string,
  logicalReceiptFingerprint: DatabaseLogicalReceiptFingerprint,
): string {
  return `sha256:${createHash('sha256')
    .update(LOGICAL_RECEIPT_FINGERPRINT_DOMAIN, 'utf8')
    .update(stableStringify({ realmFingerprint, logicalReceiptFingerprint }), 'utf8')
    .digest('hex')}`;
}

function changeEffect(
  mutation: DatabaseMutation,
  change: Change,
  row: DatabaseOperationRow | null,
  previousRow: DatabaseOperationRow | null,
): DatabaseMutationEffect {
  return {
    type: mutation.type,
    table: mutation.table,
    rowId: change.rowId,
    changed: true,
    op: change.op,
    sequence: createDatabaseSequenceToken(change.seq),
    row,
    previousRow,
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
    row: null,
    previousRow: null,
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


function receiptCorrupt(cause?: unknown): DatabaseError {
  return new DatabaseError(
    'DATABASE_SCHEMA_MISMATCH',
    'Database idempotency receipt is incompatible.',
    cause === undefined ? undefined : { cause },
  );
}

class ExpiredReceiptError extends DatabaseError {
  constructor() {
    super(
      'DATABASE_OUTCOME_UNKNOWN',
      'Database idempotency receipt result is no longer retained.',
      {
        retryable: false,
        outcome: 'unknown',
        details: { receiptState: 'expired' },
      },
    );
  }
}

function receiptExpired(): DatabaseError {
  return new ExpiredReceiptError();
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
    if (error instanceof ExpiredReceiptError) return error;
    if (error.outcome === 'not-started' || error.outcome === 'not-committed') {
      return error;
    }
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
        details: { conflictType: mutationConflictType(error) },
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

function isSQLiteFull(error: unknown): boolean {
  try {
    if (!error || typeof error !== 'object') return false;
    let cursor: object | null = error;
    for (let depth = 0; cursor && depth < 4; depth += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(cursor, 'code');
      if (descriptor) {
        return 'value' in descriptor
          && typeof descriptor.value === 'string'
          && (descriptor.value === 'SQLITE_FULL'
            || descriptor.value.startsWith('SQLITE_FULL_'));
      }
      cursor = Object.getPrototypeOf(cursor) as object | null;
    }
  } catch {
    // Hostile error objects cannot widen the database failure contract.
  }
  return false;
}

function mutationConflictType(error: unknown): 'primary-key' | 'constraint' {
  if (!error || typeof error !== 'object') return 'constraint';
  const candidate = error as { code?: unknown; message?: unknown };
  if ((typeof candidate.code === 'string'
      && /(?:PRIMARYKEY|UNIQUE)$/u.test(candidate.code))
    || (typeof candidate.message === 'string'
      && /already exists|identity conflict|primary key|unique/iu.test(
        candidate.message,
      ))) return 'primary-key';
  return 'constraint';
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

function hasPortableDatabaseAffinity(declaredType: string): boolean {
  const normalized = declaredType.trim().toUpperCase();
  // SQLite assigns BLOB affinity to both explicit BLOB and typeless columns;
  // Bun returns binary values for either, which are outside durable JSON
  // receipts and Zero's DatabaseSerializableValue contract.
  return normalized.length > 0 && !normalized.includes('BLOB');
}
