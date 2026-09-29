/**
 * database-receipt-ledger.ts
 *
 * Actor-private durable idempotency ledger. Receipt identities are permanent,
 * while bounded full results are compacted to tombstones in the same SQLite
 * transaction as the write they acknowledge.
 */

import type { Statement } from 'bun:sqlite';
import { DatabaseError } from './database-error';
import type { DatabaseRuntime } from './database-runtime';
import {
  DATABASE_WRITER_MAX_RECEIPT_KEYS,
  DATABASE_WRITER_MAX_RECEIPT_RESULT_BYTES,
  DATABASE_WRITER_MAX_RECEIPTS,
  DATABASE_WRITER_MAX_RETAINED_RECEIPT_BYTES,
  DATABASE_WRITER_RECEIPT_SCHEMA_VERSION,
  type DatabaseWriterReceiptCompaction,
  type DatabaseWriterReceiptRetentionCounts,
} from './database-receipt-contract';
import {
  assertDatabaseReceiptRow,
  databaseReceiptCorrupt,
  DATABASE_RECEIPT_RESULT_VERSION_CURRENT,
  DATABASE_RECEIPT_STATE_EXPIRED,
  DATABASE_RECEIPT_STATE_RETAINED,
  DATABASE_RECEIPT_STATS_TABLE,
  DATABASE_RECEIPT_TABLE,
  initializeDatabaseReceiptSchema,
  type DatabaseReceiptRow,
} from './database-receipt-schema';
export {
  DATABASE_WRITER_MAX_RECEIPT_KEYS,
  DATABASE_WRITER_MAX_RECEIPT_RESULT_BYTES,
  DATABASE_WRITER_MAX_RECEIPTS,
  DATABASE_WRITER_MAX_RETAINED_RECEIPT_BYTES,
  DATABASE_WRITER_RECEIPT_SCHEMA_VERSION,
} from './database-receipt-contract';
export type {
  DatabaseWriterReceiptCompaction,
  DatabaseWriterReceiptRetentionCounts,
} from './database-receipt-contract';
const textEncoder = new TextEncoder();

interface ReceiptStatsRow {
  singleton?: unknown;
  schema_version?: unknown;
  total_keys?: unknown;
  retained_results?: unknown;
  retained_result_bytes?: unknown;
  singleton_type?: unknown;
  schema_version_type?: unknown;
  total_keys_type?: unknown;
  retained_results_type?: unknown;
  retained_result_bytes_type?: unknown;
}

interface ReceiptStats {
  readonly totalKeys: number;
  readonly retainedResults: number;
  readonly retainedResultBytes: number;
}

interface ReceiptPruneResult {
  readonly prunedCount: number;
  readonly prunedResultBytes: number;
}

/** @internal Lower-only limits used by focused ledger tests and embeddings. */
export interface DatabaseReceiptLedgerLimits {
  readonly keyLimit: number;
  readonly retainedLimit: number;
  readonly resultByteLimit: number;
  readonly retainedByteLimit: number;
}

const DEFAULT_RECEIPT_LIMITS: DatabaseReceiptLedgerLimits = Object.freeze({
  keyLimit: DATABASE_WRITER_MAX_RECEIPT_KEYS,
  retainedLimit: DATABASE_WRITER_MAX_RECEIPTS,
  resultByteLimit: DATABASE_WRITER_MAX_RECEIPT_RESULT_BYTES,
  retainedByteLimit: DATABASE_WRITER_MAX_RETAINED_RECEIPT_BYTES,
});

export type DatabaseStoredReceiptLookup<Result> =
  | Readonly<{ readonly status: 'miss' }>
  | Readonly<{ readonly status: 'expired' }>
  | Readonly<{ readonly status: 'retained'; readonly result: Result }>;

export interface DatabaseReceiptLedgerOptions<Result> {
  readonly runtime: DatabaseRuntime;
  readonly realmFingerprint: string;
  readonly parseRetainedResult: (
    row: Readonly<{ resultJson: string; finalSeq: number }>,
    idempotencyKey: string,
    resultVersion: number,
  ) => Result;
  /** @internal Test/embedding seam; every value may only reduce a hard maximum. */
  readonly limits?: DatabaseReceiptLedgerLimits;
  /** @internal Deterministic statement-cleanup failure seam. */
  readonly finalizeStatement?: (statement: Statement) => void;
}

/** Writer-authority-only receipt storage and compaction. */
export class DatabaseReceiptLedger<Result> {
  private readonly runtime: DatabaseRuntime;
  private readonly realmFingerprint: string;
  private readonly parseRetainedResult: DatabaseReceiptLedgerOptions<Result>[
    'parseRetainedResult'
  ];
  private readonly limits: DatabaseReceiptLedgerLimits;
  private readonly receiptGet: Statement;
  private readonly receiptInsert: Statement;
  private readonly receiptStats: Statement;
  private readonly receiptPruneThrough: Statement;
  private readonly receiptPruneCandidates: Statement;
  private readonly statements: readonly Statement[];
  private readonly finalizeStatement: (statement: Statement) => void;
  private readonly finalizedStatements = new Set<Statement>();
  private closing = false;
  private closed = false;

  constructor(options: DatabaseReceiptLedgerOptions<Result>) {
    this.runtime = options.runtime;
    this.realmFingerprint = options.realmFingerprint;
    this.parseRetainedResult = options.parseRetainedResult;
    this.limits = validateReceiptLimits(options.limits ?? DEFAULT_RECEIPT_LIMITS);
    this.finalizeStatement = options.finalizeStatement
      ?? ((statement) => statement.finalize());
    initializeDatabaseReceiptSchema({
      runtime: this.runtime,
      realmFingerprint: this.realmFingerprint,
      validateLegacyResult: (row, idempotencyKey, resultVersion) => {
        this.parseRetainedResult(row, idempotencyKey, resultVersion);
      },
    });

    const statements: Statement[] = [];
    try {
      this.receiptGet = prepare(this.runtime, statements, `
        SELECT
          receipt_key,
          realm_fingerprint,
          operation_fingerprint,
          receipt_state,
          result_json,
          final_seq,
          result_version,
          schema_version,
          created_at,
          insertion_ordinal,
          typeof(receipt_key) AS receipt_key_type,
          typeof(realm_fingerprint) AS realm_fingerprint_type,
          typeof(operation_fingerprint) AS operation_fingerprint_type,
          typeof(receipt_state) AS receipt_state_type,
          typeof(result_json) AS result_json_type,
          typeof(final_seq) AS final_seq_type,
          typeof(result_version) AS result_version_type,
          typeof(schema_version) AS schema_version_type,
          typeof(created_at) AS created_at_type,
          typeof(insertion_ordinal) AS insertion_ordinal_type
        FROM main.${DATABASE_RECEIPT_TABLE}
        WHERE receipt_key = ?
      `);
      this.receiptInsert = prepare(this.runtime, statements, `
        INSERT INTO main.${DATABASE_RECEIPT_TABLE} (
          receipt_key,
          realm_fingerprint,
          operation_fingerprint,
          receipt_state,
          result_json,
          final_seq,
          result_version,
          schema_version,
          created_at,
          insertion_ordinal
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      this.receiptStats = prepare(this.runtime, statements, `
        SELECT
          singleton,
          schema_version,
          total_keys,
          retained_results,
          retained_result_bytes,
          typeof(singleton) AS singleton_type,
          typeof(schema_version) AS schema_version_type,
          typeof(total_keys) AS total_keys_type,
          typeof(retained_results) AS retained_results_type,
          typeof(retained_result_bytes) AS retained_result_bytes_type
        FROM main.${DATABASE_RECEIPT_STATS_TABLE}
        WHERE singleton = 1
      `);
      this.receiptPruneThrough = prepare(this.runtime, statements, `
        UPDATE main.${DATABASE_RECEIPT_TABLE}
        SET
          receipt_state = '${DATABASE_RECEIPT_STATE_EXPIRED}',
          result_json = NULL,
          final_seq = NULL
        WHERE receipt_state = '${DATABASE_RECEIPT_STATE_RETAINED}'
          AND insertion_ordinal <= ?
      `);
      this.receiptPruneCandidates = prepare(this.runtime, statements, `
        SELECT
          insertion_ordinal,
          length(CAST(result_json AS BLOB)) AS result_bytes,
          typeof(insertion_ordinal) AS insertion_ordinal_type,
          typeof(length(CAST(result_json AS BLOB))) AS result_bytes_type
        FROM main.${DATABASE_RECEIPT_TABLE}
        WHERE receipt_state = '${DATABASE_RECEIPT_STATE_RETAINED}'
        ORDER BY insertion_ordinal ASC
      `);
    } catch (cause) {
      const cleanupFailures = finalizeAll(statements, this.finalizeStatement);
      if (cleanupFailures.length > 0) {
        throw new DatabaseError(
          'DATABASE_EXECUTOR_FAILED',
          'Database receipt statement cleanup failed.',
          {
            cause: new AggregateError(
              [cause, ...cleanupFailures],
              'Database receipt preparation and cleanup failed.',
            ),
            retryable: false,
            outcome: 'unknown',
          },
        );
      }
      throw new DatabaseError(
        'DATABASE_SCHEMA_MISMATCH',
        'Database receipt statements could not be prepared.',
        { cause },
      );
    }
    this.statements = Object.freeze([...statements]);
  }

  lookup(
    idempotencyKey: string,
    operationFingerprint: string,
  ): DatabaseStoredReceiptLookup<Result> {
    this.assertOpen();
    const row = this.receiptGet.get(idempotencyKey) as DatabaseReceiptRow | null;
    if (!row) return Object.freeze({ status: 'miss' });
    assertDatabaseReceiptRow(row, idempotencyKey);
    if (row.realm_fingerprint !== this.realmFingerprint
      || row.operation_fingerprint !== operationFingerprint) {
      throw new DatabaseError(
        'DATABASE_CONFLICT',
        'Database idempotency key was already used for another operation.',
        {
          retryable: false,
          outcome: 'not-committed',
          details: { conflictType: 'idempotency-key-reused' },
        },
      );
    }
    if (row.receipt_state === DATABASE_RECEIPT_STATE_EXPIRED) {
      return Object.freeze({ status: 'expired' });
    }
    return Object.freeze({
      status: 'retained',
      result: this.parseResult(row, idempotencyKey),
    });
  }

  /** Reject a new identity before any application mutation is evaluated. */
  assertCanInsert(): void {
    const stats = this.readStats();
    if (stats.totalKeys >= this.limits.keyLimit) {
      throw receiptKeyQuotaReached(this.limits.keyLimit);
    }
  }

  save(
    idempotencyKey: string,
    operationFingerprint: string,
    result: Result,
    finalSeq: number,
  ): DatabaseWriterReceiptCompaction | null {
    this.assertOpen();
    let encoded: string;
    try {
      const value = JSON.stringify(result);
      if (typeof value !== 'string') throw new TypeError('receipt result is not JSON');
      encoded = value;
    } catch (cause) {
      throw databaseReceiptCorrupt(cause);
    }
    const encodedBytes = textEncoder.encode(encoded).byteLength;
    if (encodedBytes > this.limits.resultByteLimit) {
      throw receiptResultTooLarge();
    }

    this.assertCanInsert();
    const before = this.readStats();
    const prune = this.pruneForInsert(before, encodedBytes);
    const afterPrune = this.readStats();
    const insertionOrdinal = afterPrune.totalKeys + 1;
    if (!Number.isSafeInteger(insertionOrdinal) || insertionOrdinal < 1) {
      throw databaseReceiptCorrupt();
    }
    this.receiptInsert.run(
      idempotencyKey,
      this.realmFingerprint,
      operationFingerprint,
      DATABASE_RECEIPT_STATE_RETAINED,
      encoded,
      finalSeq,
      DATABASE_RECEIPT_RESULT_VERSION_CURRENT,
      DATABASE_WRITER_RECEIPT_SCHEMA_VERSION,
      Date.now(),
      insertionOrdinal,
    );
    const after = this.readStats();
    if (after.totalKeys !== insertionOrdinal
      || after.retainedResults !== afterPrune.retainedResults + 1
      || after.retainedResultBytes !== afterPrune.retainedResultBytes + encodedBytes) {
      throw databaseReceiptCorrupt();
    }
    if (prune.prunedCount === 0) return null;
    return Object.freeze({
      totalKeys: after.totalKeys,
      retainedResults: after.retainedResults,
      expiredTombstones: after.totalKeys - after.retainedResults,
      retainedResultBytes: after.retainedResultBytes,
      keyLimit: this.limits.keyLimit,
      retainedLimit: this.limits.retainedLimit,
      retainedByteLimit: this.limits.retainedByteLimit,
      resultByteLimit: this.limits.resultByteLimit,
      prunedCount: prune.prunedCount,
      prunedResultBytes: prune.prunedResultBytes,
    });
  }

  retentionCounts(): DatabaseWriterReceiptRetentionCounts {
    const stats = this.readStats();
    return Object.freeze({
      totalKeys: stats.totalKeys,
      retainedResults: stats.retainedResults,
      expiredTombstones: stats.totalKeys - stats.retainedResults,
      retainedResultBytes: stats.retainedResultBytes,
      keyLimit: this.limits.keyLimit,
      retainedLimit: this.limits.retainedLimit,
      retainedByteLimit: this.limits.retainedByteLimit,
      resultByteLimit: this.limits.resultByteLimit,
    });
  }

  close(): void {
    if (this.closed) return;
    this.closing = true;
    const failures = finalizeRemaining(
      this.statements,
      this.finalizedStatements,
      this.finalizeStatement,
    );
    if (failures.length > 0) {
      throw new AggregateError(
        failures,
        'Database receipt ledger failed to finalize its statements.',
      );
    }
    this.closed = true;
  }

  private pruneForInsert(
    stats: ReceiptStats,
    insertedBytes: number,
  ): ReceiptPruneResult {
    const countToRemove = Math.max(
      0,
      stats.retainedResults + 1 - this.limits.retainedLimit,
    );
    const bytesToRemove = Math.max(
      0,
      stats.retainedResultBytes
        + insertedBytes
        - this.limits.retainedByteLimit,
    );
    if (countToRemove === 0 && bytesToRemove === 0) {
      return Object.freeze({ prunedCount: 0, prunedResultBytes: 0 });
    }

    let prunedCount = 0;
    let prunedBytes = 0;
    let cutoff: number | null = null;
    for (const candidate of this.receiptPruneCandidates.iterate() as Iterable<{
      insertion_ordinal?: unknown;
      result_bytes?: unknown;
      insertion_ordinal_type?: unknown;
      result_bytes_type?: unknown;
    }>) {
      if (candidate.insertion_ordinal_type !== 'integer'
        || candidate.result_bytes_type !== 'integer'
        || !Number.isSafeInteger(candidate.insertion_ordinal)
        || (candidate.insertion_ordinal as number) < 1
        || !isSafeCount(candidate.result_bytes)) {
        throw databaseReceiptCorrupt();
      }
      prunedCount += 1;
      prunedBytes += candidate.result_bytes as number;
      cutoff = candidate.insertion_ordinal as number;
      if (!Number.isSafeInteger(prunedCount)
        || !Number.isSafeInteger(prunedBytes)) throw databaseReceiptCorrupt();
      if (prunedCount >= countToRemove && prunedBytes >= bytesToRemove) break;
    }
    if (cutoff === null
      || prunedCount < countToRemove
      || prunedBytes < bytesToRemove) {
      throw databaseReceiptCorrupt();
    }
    this.receiptPruneThrough.run(cutoff);
    const after = this.readStats();
    if (after.totalKeys !== stats.totalKeys
      || after.retainedResults !== stats.retainedResults - prunedCount
      || after.retainedResultBytes !== stats.retainedResultBytes - prunedBytes) {
      throw databaseReceiptCorrupt();
    }
    return Object.freeze({ prunedCount, prunedResultBytes: prunedBytes });
  }

  private readStats(): ReceiptStats {
    this.assertOpen();
    const row = this.receiptStats.get() as ReceiptStatsRow | null;
    if (!row
      || row.singleton !== 1
      || row.schema_version !== 1
      || row.singleton_type !== 'integer'
      || row.schema_version_type !== 'integer'
      || row.total_keys_type !== 'integer'
      || row.retained_results_type !== 'integer'
      || row.retained_result_bytes_type !== 'integer'
      || !isSafeCount(row.total_keys)
      || !isSafeCount(row.retained_results)
      || !isSafeCount(row.retained_result_bytes)
      || (row.total_keys as number) > DATABASE_WRITER_MAX_RECEIPT_KEYS
      || (row.retained_results as number) > (row.total_keys as number)
      || (row.retained_results as number) > DATABASE_WRITER_MAX_RECEIPTS
      || (row.retained_result_bytes as number)
        > DATABASE_WRITER_MAX_RETAINED_RECEIPT_BYTES) {
      throw databaseReceiptCorrupt();
    }
    return Object.freeze({
      totalKeys: row.total_keys as number,
      retainedResults: row.retained_results as number,
      retainedResultBytes: row.retained_result_bytes as number,
    });
  }

  private parseResult(row: DatabaseReceiptRow, idempotencyKey: string): Result {
    if (row.final_seq === null || row.result_json === null) {
      throw databaseReceiptCorrupt();
    }
    try {
      return this.parseRetainedResult({
        resultJson: row.result_json,
        finalSeq: row.final_seq,
      }, idempotencyKey, row.result_version);
    } catch (cause) {
      if (cause instanceof DatabaseError
        && cause.code === 'DATABASE_SCHEMA_MISMATCH') throw cause;
      throw databaseReceiptCorrupt(cause);
    }
  }

  private assertOpen(): void {
    if (this.closing || this.closed || this.runtime.diagnostics().closed) {
      throw new DatabaseError(
        'DATABASE_CLOSED',
        'Database receipt ledger is closed.',
      );
    }
  }
}

function prepare(
  runtime: DatabaseRuntime,
  statements: Statement[],
  sql: string,
): Statement {
  const statement = runtime.db.prepare(sql);
  statements.push(statement);
  return statement;
}

function finalizeAll(
  statements: readonly Statement[],
  finalizeStatement: (statement: Statement) => void = (statement) => statement.finalize(),
): unknown[] {
  const failures: unknown[] = [];
  for (const statement of statements) {
    try {
      finalizeStatement(statement);
    } catch (error) {
      failures.push(error);
    }
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

function receiptKeyQuotaReached(capacityLimit: number): DatabaseError {
  return new DatabaseError(
    'DATABASE_CAPACITY_EXHAUSTED',
    'Database durable receipt capacity is exhausted.',
    {
      retryable: false,
      outcome: 'not-started',
      details: { capacityType: 'receipts', capacityLimit },
    },
  );
}

function receiptResultTooLarge(): DatabaseError {
  return new DatabaseError(
    'DATABASE_RESULT_LIMIT',
    'Database receipt result exceeds its durable byte limit.',
    { retryable: false, outcome: 'not-committed' },
  );
}

function validateReceiptLimits(
  value: DatabaseReceiptLedgerLimits,
): DatabaseReceiptLedgerLimits {
  const limits = [
    [value.keyLimit, DATABASE_WRITER_MAX_RECEIPT_KEYS],
    [value.retainedLimit, DATABASE_WRITER_MAX_RECEIPTS],
    [value.resultByteLimit, DATABASE_WRITER_MAX_RECEIPT_RESULT_BYTES],
    [value.retainedByteLimit, DATABASE_WRITER_MAX_RETAINED_RECEIPT_BYTES],
  ] as const;
  if (limits.some(([limit, maximum]) =>
    !Number.isSafeInteger(limit) || limit < 1 || limit > maximum)
    || value.resultByteLimit > value.retainedByteLimit) {
    throw new TypeError('Database receipt limits must reduce the hard maxima.');
  }
  return Object.freeze({ ...value });
}

function isSafeCount(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}
