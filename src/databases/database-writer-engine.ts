/**
 * Actor-local orchestration for one writer-owned DatabaseRuntime.
 *
 * Declarative reads and writes are delegated to focused executors while this
 * engine owns operation admission, exact receipt transactions, and lifecycle.
 */

import { DatabaseError } from './database-error';
import { validateDatabaseActorExecuteResult } from './database-actor-result-validation';
import {
  createDatabaseSequenceToken,
  validateDatabaseCommitResult,
  validateDatabaseOperation,
  type DatabaseCommitResult,
  type DatabaseOperation,
  type DatabaseOperationCatalog,
  type DatabaseReadOperation,
  type DatabaseWriteOperation,
} from './database-operations';
import {
  createDatabaseRealmOperationCatalog,
  type DatabaseRealm,
} from './database-realm';
import {
  DatabaseReceiptLedger,
  type DatabaseWriterReceiptCompaction,
  type DatabaseWriterReceiptRetentionCounts,
} from './database-receipt-ledger';
import type { DatabaseRuntime } from './database-runtime';
import {
  validateDatabaseLogicalReceiptFingerprint,
  validateDatabaseReceiptLookupIdentity,
  type DatabaseLogicalReceiptFingerprint,
  type DatabaseTrustedReceiptLookup,
} from './database-trusted-writer';
import type {
  DatabaseChangeReplayResult,
  DatabaseWriterCommitValue,
  DatabaseWriterOperationResult,
} from './database-writer-contracts';
import {
  isDatabaseWriterSQLiteFull,
  normalizeDatabaseWriterFailure,
  databaseWriterReceiptExpired,
} from './database-writer-errors';
import { executeDatabaseWriterWriteValue } from './database-writer-mutation-executor';
import {
  executeDatabaseWriterRead,
  replayDatabaseWriterChanges,
} from './database-writer-read-executor';
import { assertDatabaseWriterRealmMatchesRuntime } from './database-writer-realm-validation';
import {
  fingerprintDatabaseWriterLogicalReceipt,
  fingerprintDatabaseWriterOperation,
  parseRetainedDatabaseWriterReceipt,
} from './database-writer-receipts';

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
export { DATABASE_WRITER_MAX_REPLAY_CHANGES } from './database-writer-contracts';
export type {
  DatabaseBatchCommitValue,
  DatabaseChangeReplayPage,
  DatabaseChangeReplayResult,
  DatabaseCommandCommitValue,
  DatabaseMutationCommitValue,
  DatabaseMutationEffect,
  DatabaseReplayChange,
  DatabaseWriterCommitValue,
  DatabaseWriterOperationResult,
} from './database-writer-contracts';

export interface DatabaseWriterOperationEngineOptions {
  /** Open, writer-owned runtime dedicated to this engine's database file. */
  readonly runtime: DatabaseRuntime;
  /** Realm imported independently inside this actor process. */
  readonly realm: DatabaseRealm;
}

interface WriteExecution {
  result: DatabaseCommitResult<DatabaseWriterCommitValue>;
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
  private pendingReceiptCompaction: DatabaseWriterReceiptCompaction | null = null;
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

    assertDatabaseWriterRealmMatchesRuntime(
      this.runtime,
      this.realm,
      this.catalog,
    );
    this.receipts = new DatabaseReceiptLedger({
      runtime: this.runtime,
      realmFingerprint: this.realm.fingerprint,
      parseRetainedResult: (row, idempotencyKey, resultVersion) =>
        parseRetainedDatabaseWriterReceipt(
          this.runtime,
          this.catalog,
          row,
          idempotencyKey,
          resultVersion,
        ),
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
      ? executeDatabaseWriterRead(
        this.runtime,
        this.realm,
        this.catalog,
        operation,
      )
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
    const fingerprint = fingerprintDatabaseWriterLogicalReceipt(
      this.realm.fingerprint,
      identity.logicalReceiptFingerprint,
    );
    const receipt = this.receipts.lookup(identity.idempotencyKey, fingerprint);
    if (receipt.status === 'expired') {
      throw databaseWriterReceiptExpired();
    }
    return receipt.status === 'retained'
      ? Object.freeze({
        status: 'hit',
        result: Object.freeze({ ...receipt.result, replayed: true }),
      })
      : Object.freeze({ status: 'miss' });
  }

  /** Aggregate-only durable receipt retention counters. */
  receiptRetentionCounts(): DatabaseWriterReceiptRetentionCounts {
    this.assertOpen();
    return this.receipts.retentionCounts();
  }

  /** Read one bounded contiguous retained-change page. */
  replayChanges(afterSeq: number, limit: number): DatabaseChangeReplayResult {
    this.assertOpen();
    return replayDatabaseWriterChanges(this.runtime, afterSeq, limit);
  }

  /** Finalize engine-owned statements; the caller still owns the runtime. */
  close(): void {
    if (this.closed) return;
    this.closing = true;
    this.receipts.close();
    this.closed = true;
  }

  private executeWrite(
    operation: DatabaseWriteOperation,
    logicalReceiptFingerprint?: DatabaseLogicalReceiptFingerprint,
  ): DatabaseCommitResult<DatabaseWriterCommitValue> {
    const fingerprint = logicalReceiptFingerprint === undefined
      ? fingerprintDatabaseWriterOperation(this.realm.fingerprint, operation)
      : fingerprintDatabaseWriterLogicalReceipt(
        this.realm.fingerprint,
        logicalReceiptFingerprint,
      );
    try {
      const execution = this.runtime.db.transaction((): WriteExecution => {
        const receipt = this.receipts.lookup(
          operation.idempotencyKey,
          fingerprint,
        );
        if (receipt.status === 'expired') {
          throw databaseWriterReceiptExpired();
        }
        if (receipt.status === 'retained') {
          return {
            result: validateDatabaseCommitResult({
              ...receipt.result,
              replayed: true,
            }) as DatabaseCommitResult<DatabaseWriterCommitValue>,
            receiptCompaction: null,
          };
        }

        // Exact replay and expiry take precedence over permanent key capacity.
        this.receipts.assertCanInsert();
        const value = executeDatabaseWriterWriteValue(
          this.runtime,
          this.realm,
          operation,
        );
        const finalSeq = this.runtime.db.currentSeq;
        // Validate and correlate the producer-owned value in one result
        // boundary. Malformed/oversized handler output is a result failure,
        // while caller input was already admitted before this transaction.
        const result = validateDatabaseActorExecuteResult(
          {
            value,
            sequence: createDatabaseSequenceToken(finalSeq),
            idempotencyKey: operation.idempotencyKey,
            replayed: false,
          },
          operation,
          this.catalog,
        );
        const receiptCompaction = this.receipts.save(
          operation.idempotencyKey,
          fingerprint,
          result,
          result.sequence.seq,
        );
        return { result, receiptCompaction };
      });

      // Derived while saving; the write path never scans permanent tombstones.
      this.pendingReceiptCompaction = execution.receiptCompaction;
      return execution.result;
    } catch (error) {
      if (this.runtime.sqlite.mode === 'hot'
        && isDatabaseWriterSQLiteFull(error)) {
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
      throw normalizeDatabaseWriterFailure(error);
    }
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

function isReadOperation(
  operation: DatabaseOperation,
): operation is DatabaseReadOperation {
  return operation.type === 'get'
    || operation.type === 'list'
    || operation.type === 'find'
    || operation.type === 'query';
}
