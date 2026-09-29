/**
 * database-actor-result-validation.ts
 *
 * Shared semantic validation for results crossing the database actor boundary.
 * Both the child and parent must correlate an otherwise-portable response with
 * the exact validated operation which produced it.
 */

import { DatabaseError } from './database-error';
import {
  DATABASE_ACTOR_MAX_REPLAY_CHANGES,
  type DatabaseActorReplayPayload,
} from './database-actor-protocol';
import {
  DATABASE_OPERATION_MAX_ID_BYTES,
  isDatabaseRegistryName,
  isDatabaseTableName,
  validateDatabaseCommitResult,
  validateDatabaseReadResult,
  type DatabaseCommitResult,
  type DatabaseFindOperation,
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
  hasExactDatabaseExecutorKeys,
  readDatabaseExecutorDataRecord,
} from './database-executor-validation';
import {
  DATABASE_WRITER_MAX_RECEIPT_KEYS,
  DATABASE_WRITER_MAX_RECEIPT_RESULT_BYTES,
  DATABASE_WRITER_MAX_RECEIPTS,
  DATABASE_WRITER_MAX_RETAINED_RECEIPT_BYTES,
  type DatabaseChangeReplayResult,
  type DatabaseMutationEffect,
  type DatabaseWriterReceiptCompaction,
  type DatabaseWriterCommitValue,
} from './database-writer-engine';
import type {
  DatabaseTrustedReceiptLookup,
} from './database-trusted-writer';

const MUTATION_VALUE_FIELDS = new Set(['kind', 'mutation']);
const BATCH_VALUE_FIELDS = new Set(['kind', 'mutations']);
const COMMAND_VALUE_FIELDS = new Set(['kind', 'name', 'output']);
const MUTATION_EFFECT_FIELDS = new Set([
  'type',
  'table',
  'rowId',
  'changed',
  'op',
  'sequence',
  'row',
  'previousRow',
]);
const LEGACY_MUTATION_EFFECT_FIELDS = new Set([
  'type',
  'table',
  'rowId',
  'changed',
  'op',
  'sequence',
]);
const SEQUENCE_FIELDS = new Set(['seq']);
const REPLAY_PAGE_FIELDS = new Set([
  'afterSeq',
  'throughSeq',
  'nextAfterSeq',
  'changes',
]);
const REPLAY_CHANGE_FIELDS = new Set([
  'seq',
  'table',
  'op',
  'rowId',
  'row',
  'previousRow',
  'ts',
]);
const RECEIPT_MISS_FIELDS = new Set(['status']);
const RECEIPT_HIT_FIELDS = new Set(['status', 'result']);
const EXECUTION_OUTCOME_FIELDS = new Set(['result', 'receiptCompaction']);
const RECEIPT_COMPACTION_FIELDS = new Set([
  'totalKeys',
  'retainedResults',
  'expiredTombstones',
  'retainedResultBytes',
  'keyLimit',
  'retainedByteLimit',
  'resultByteLimit',
  'prunedCount',
  'prunedResultBytes',
  'retainedLimit',
]);
const textEncoder = new TextEncoder();

export type DatabaseActorExecuteResult =
  | DatabaseReadResult
  | DatabaseCommitResult<DatabaseWriterCommitValue>;

/** Internal result plus optional aggregate receipt-maintenance telemetry. */
export interface DatabaseActorExecuteOutcome<
  Result extends DatabaseActorExecuteResult = DatabaseActorExecuteResult,
> {
  readonly result: Result;
  readonly receiptCompaction: DatabaseWriterReceiptCompaction | null;
}

export type DatabaseActorReplayExpectation = Pick<
  DatabaseActorReplayPayload,
  'afterSeq' | 'limit'
>;

export function validateDatabaseActorExecuteResult(
  value: unknown,
  operation: DatabaseReadOperation,
  catalog?: DatabaseOperationCatalog,
): DatabaseReadResult;
export function validateDatabaseActorExecuteResult(
  value: unknown,
  operation: DatabaseWriteOperation,
  catalog?: DatabaseOperationCatalog,
): DatabaseCommitResult<DatabaseWriterCommitValue>;
export function validateDatabaseActorExecuteResult(
  value: unknown,
  operation: DatabaseOperation,
  catalog?: DatabaseOperationCatalog,
): DatabaseActorExecuteResult;
/** Validate, detach, and correlate one actor execution result. */
export function validateDatabaseActorExecuteResult(
  value: unknown,
  operation: DatabaseOperation,
  catalog: DatabaseOperationCatalog = {},
): DatabaseActorExecuteResult {
  const write = isWriteOperation(operation);
  return resultBoundary(write, () => {
    if (write) return validateWriteResult(value, operation, catalog);
    const result = validateDatabaseReadResult(value);
    if (operation.consistency?.mode === 'read-your-writes'
      && result.sequence.seq < operation.consistency.minSeq.seq) {
      throw protocolFailure(false);
    }
    if (operation.type === 'find') {
      validateFindResult(result.value, operation, catalog);
    }
    return result;
  });
}

/** Validate an execution result and detach its privacy-safe actor telemetry. */
export function validateDatabaseActorExecuteOutcome(
  value: unknown,
  operation: DatabaseOperation,
  catalog: DatabaseOperationCatalog = {},
): DatabaseActorExecuteOutcome {
  const write = isWriteOperation(operation);
  return resultBoundary(write, () => {
    const envelope = readExecutionOutcome(value);
    const result = validateDatabaseActorExecuteResult(
      envelope.result,
      operation,
      catalog,
    );
    if (envelope.receiptCompaction !== null
      && (!write || (result as DatabaseCommitResult).replayed)) {
      throw protocolFailure(write);
    }
    return Object.freeze({
      result,
      receiptCompaction: envelope.receiptCompaction,
    });
  });
}

/** Validate one contiguous replay page against its exact request cursor. */
export function validateDatabaseActorReplayResult(
  value: unknown,
  expectation: DatabaseActorReplayExpectation,
): DatabaseChangeReplayResult {
  return resultBoundary(false, () => {
    if (!isNonNegativeSafeInteger(expectation.afterSeq)
      || !Number.isSafeInteger(expectation.limit)
      || expectation.limit < 1
      || expectation.limit > DATABASE_ACTOR_MAX_REPLAY_CHANGES) {
      throw protocolFailure(false);
    }

    const result = validateDatabaseReadResult(value);
    const page = exactRecord(result.value, REPLAY_PAGE_FIELDS);
    const head = result.sequence.seq;
    if (expectation.afterSeq > head
      || page.afterSeq !== expectation.afterSeq
      || !Array.isArray(page.changes)
      || page.changes.length > expectation.limit) {
      throw protocolFailure(false);
    }

    // A producer may choose a page smaller than the requested maximum, but it
    // must make progress whenever the durable head is still ahead.
    if (head > expectation.afterSeq && page.changes.length === 0) {
      throw protocolFailure(false);
    }

    let expectedSeq = expectation.afterSeq + 1;
    for (const candidate of page.changes) {
      validateReplayChange(candidate, expectedSeq);
      expectedSeq += 1;
    }

    const throughSeq = expectation.afterSeq + page.changes.length;
    const nextAfterSeq = throughSeq < head ? throughSeq : null;
    if (page.throughSeq !== throughSeq
      || page.nextAfterSeq !== nextAfterSeq) {
      throw protocolFailure(false);
    }
    return result as DatabaseChangeReplayResult;
  });
}

/** Validate a writer-only logical receipt lookup across the actor boundary. */
export function validateDatabaseActorReceiptLookupResult(
  value: unknown,
  idempotencyKey: string,
  catalog: DatabaseOperationCatalog,
): DatabaseTrustedReceiptLookup {
  return resultBoundary(false, () => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw protocolFailure(false);
    }
    const status = (value as { status?: unknown }).status;
    if (status === 'miss') {
      exactRecord(value, RECEIPT_MISS_FIELDS);
      return Object.freeze({ status: 'miss' });
    }
    const record = exactRecord(value, RECEIPT_HIT_FIELDS);
    if (record.status !== 'hit') throw protocolFailure(false);
    const result = validateDatabaseCommitResult(record.result);
    if (result.idempotencyKey !== idempotencyKey || !result.replayed) {
      throw protocolFailure(false);
    }
    validateTrustedCommitValue(result, catalog);
    return Object.freeze({
      status: 'hit',
      result: result as DatabaseCommitResult<DatabaseWriterCommitValue>,
    });
  });
}

/**
 * Validate a trusted logical-receipt write without correlating its replayed
 * result to a newly reconstructed CAS operation.
 */
export function validateDatabaseActorTrustedWriteResult(
  value: unknown,
  idempotencyKey: string,
  catalog: DatabaseOperationCatalog,
): DatabaseCommitResult<DatabaseWriterCommitValue> {
  return resultBoundary(true, () => {
    const result = validateDatabaseCommitResult(value) as DatabaseCommitResult<
      DatabaseWriterCommitValue
    >;
    if (result.idempotencyKey !== idempotencyKey) throw protocolFailure(true);
    validateTrustedCommitValue(result, catalog);
    return result;
  });
}

/** Validate a trusted write result with optional aggregate compaction data. */
export function validateDatabaseActorTrustedWriteOutcome(
  value: unknown,
  idempotencyKey: string,
  catalog: DatabaseOperationCatalog,
): DatabaseActorExecuteOutcome<DatabaseCommitResult<DatabaseWriterCommitValue>> {
  return resultBoundary(true, () => {
    const envelope = readExecutionOutcome(value);
    const result = validateDatabaseActorTrustedWriteResult(
      envelope.result,
      idempotencyKey,
      catalog,
    );
    if (envelope.receiptCompaction !== null && result.replayed) {
      throw protocolFailure(true);
    }
    return Object.freeze({
      result,
      receiptCompaction: envelope.receiptCompaction,
    });
  });
}

/** Attach actor-local aggregate telemetry without changing the public result. */
export function attachDatabaseActorReceiptCompaction(
  result: DatabaseActorExecuteResult,
  receiptCompaction: DatabaseWriterReceiptCompaction | null,
): DatabaseActorExecuteResult | Readonly<{
  readonly result: DatabaseActorExecuteResult;
  readonly receiptCompaction: DatabaseWriterReceiptCompaction;
}> {
  return receiptCompaction === null
    ? result
    : Object.freeze({ result, receiptCompaction });
}

/**
 * Validate an on-disk receipt written by either the current schema or the
 * exact v1 writer contract. Legacy mutation effects intentionally remain in
 * their original shape: their historical result did not contain canonical
 * row images, and inventing those values during migration would be unsafe.
 */
export function validateDatabaseActorLegacyReceiptResult(
  value: unknown,
  idempotencyKey: string,
  catalog: DatabaseOperationCatalog,
): DatabaseCommitResult<DatabaseWriterCommitValue> {
  return resultBoundary(true, () => {
    const result = validateDatabaseCommitResult(value) as DatabaseCommitResult<
      DatabaseWriterCommitValue
    >;
    if (result.idempotencyKey !== idempotencyKey) throw protocolFailure(true);
    validateTrustedCommitValue(result, catalog, 'legacy');
    return result;
  });
}

type MutationEffectFormat = 'current' | 'legacy' | 'either';

function validateTrustedCommitValue(
  result: DatabaseCommitResult,
  catalog: DatabaseOperationCatalog,
  mutationEffectFormat: MutationEffectFormat = 'current',
): void {
  if (typeof result.value !== 'object'
    || result.value === null
    || Array.isArray(result.value)) throw protocolFailure(true);
  const kind = (result.value as { kind?: unknown }).kind;
  if (kind === 'mutation') {
    const value = exactRecord(result.value, MUTATION_VALUE_FIELDS);
    const effect = validateStoredMutationEffect(
      value.mutation,
      catalog,
      mutationEffectFormat,
    );
    if (effect.changed && effect.sequence!.seq !== result.sequence.seq) {
      throw protocolFailure(true);
    }
    return;
  }
  if (kind === 'batch') {
    const value = exactRecord(result.value, BATCH_VALUE_FIELDS);
    if (!Array.isArray(value.mutations) || value.mutations.length > 256) {
      throw protocolFailure(true);
    }
    let previousSequence: number | null = null;
    for (const candidate of value.mutations) {
      const effect = validateStoredMutationEffect(
        candidate,
        catalog,
        mutationEffectFormat,
      );
      if (!effect.changed) continue;
      const sequence = effect.sequence!.seq;
      if (previousSequence !== null && sequence !== previousSequence + 1) {
        throw protocolFailure(true);
      }
      previousSequence = sequence;
    }
    if (previousSequence !== null && previousSequence !== result.sequence.seq) {
      throw protocolFailure(true);
    }
    return;
  }
  if (kind === 'command') {
    const value = exactRecord(result.value, COMMAND_VALUE_FIELDS);
    if (!isDatabaseRegistryName(value.name)
      || (catalog.commands && !catalog.commands.includes(value.name))) {
      throw protocolFailure(true);
    }
    return;
  }
  throw protocolFailure(true);
}

function validateWriteResult(
  value: unknown,
  operation: DatabaseWriteOperation,
  catalog: DatabaseOperationCatalog,
): DatabaseCommitResult<DatabaseWriterCommitValue> {
  const result = validateDatabaseCommitResult(value);
  if (result.idempotencyKey !== operation.idempotencyKey) {
    throw protocolFailure(true);
  }

  const commitValue = exactRecord(result.value, fieldsForOperation(operation));
  switch (operation.type) {
    case 'mutate': {
      if (commitValue.kind !== 'mutation') throw protocolFailure(true);
      const effect = validateMutationEffect(
        commitValue.mutation,
        operation.mutation,
        catalog,
        result.replayed ? 'either' : 'current',
      );
      if (effect.changed && effect.sequence!.seq !== result.sequence.seq) {
        throw protocolFailure(true);
      }
      break;
    }
    case 'batch': {
      if (commitValue.kind !== 'batch'
        || !Array.isArray(commitValue.mutations)
        || commitValue.mutations.length !== operation.mutations.length) {
        throw protocolFailure(true);
      }
      let priorChangedSeq: number | null = null;
      for (let index = 0; index < operation.mutations.length; index += 1) {
        const effect = validateMutationEffect(
          commitValue.mutations[index],
          operation.mutations[index]!,
          catalog,
          result.replayed ? 'either' : 'current',
        );
        if (!effect.changed) continue;
        const seq = effect.sequence!.seq;
        if (priorChangedSeq !== null && seq !== priorChangedSeq + 1) {
          throw protocolFailure(true);
        }
        priorChangedSeq = seq;
      }
      if (priorChangedSeq !== null && priorChangedSeq !== result.sequence.seq) {
        throw protocolFailure(true);
      }
      break;
    }
    case 'command':
      if (commitValue.kind !== 'command'
        || commitValue.name !== operation.name) {
        throw protocolFailure(true);
      }
      // validateDatabaseCommitResult already cloned and bounded the output as
      // part of the complete result graph. Requiring the own field prevents a
      // missing value from becoming an implicit undefined result.
      if (!Object.hasOwn(commitValue, 'output')) throw protocolFailure(true);
      break;
  }
  return result as DatabaseCommitResult<DatabaseWriterCommitValue>;
}

function validateMutationEffect(
  value: unknown,
  mutation: DatabaseMutation,
  catalog: DatabaseOperationCatalog,
  format: MutationEffectFormat = 'current',
): DatabaseMutationEffect {
  const effect = validateStoredMutationEffect(value, catalog, format);
  if (effect.type !== mutation.type || effect.table !== mutation.table) {
    throw protocolFailure(true);
  }
  if ((mutation.type === 'update' || mutation.type === 'delete')
    && effect.rowId !== mutation.id) {
    throw protocolFailure(true);
  }
  if (mutation.type === 'create' || mutation.type === 'upsert') {
    const primaryKey = catalog.primaryKeys?.[mutation.table];
    if (primaryKey) {
      const submittedId = mutation.row[primaryKey];
      const canonicalSubmittedId = canonicalRowId(submittedId);
      if (submittedId !== undefined
        && (canonicalSubmittedId === null
          || effect.rowId !== canonicalSubmittedId)) {
        throw protocolFailure(true);
      }
    }
  }

  return effect;
}

function validateStoredMutationEffect(
  value: unknown,
  catalog: DatabaseOperationCatalog,
  format: MutationEffectFormat = 'current',
): DatabaseMutationEffect {
  const legacy = format === 'legacy'
    || (format === 'either'
      && hasExactFields(value, LEGACY_MUTATION_EFFECT_FIELDS));
  const effect = exactRecord(
    value,
    legacy ? LEGACY_MUTATION_EFFECT_FIELDS : MUTATION_EFFECT_FIELDS,
  );
  if ((effect.type !== 'create'
      && effect.type !== 'upsert'
      && effect.type !== 'update'
      && effect.type !== 'delete')
    || typeof effect.table !== 'string'
    || !catalog.tables?.includes(effect.table)
    || !isRowId(effect.rowId)
    || typeof effect.changed !== 'boolean') {
    throw protocolFailure(true);
  }
  if (!effect.changed) {
    if ((effect.type !== 'update' && effect.type !== 'delete')
      || effect.op !== null
      || effect.sequence !== null
      || (!legacy && (effect.row !== null || effect.previousRow !== null))) {
      throw protocolFailure(true);
    }
    return effect as unknown as DatabaseMutationEffect;
  }

  const expectedOp = effect.type === 'create'
    ? effect.op === 'INSERT'
    : effect.type === 'upsert'
      ? effect.op === 'INSERT' || effect.op === 'UPDATE'
      : effect.type === 'update'
        ? effect.op === 'UPDATE'
        : effect.op === 'DELETE';
  if (!expectedOp) throw protocolFailure(true);
  readSequence(effect.sequence, true);
  if (legacy) return effect as unknown as DatabaseMutationEffect;
  const columns = catalog.columns?.[effect.table];
  const primaryKey = catalog.primaryKeys?.[effect.table];
  if (!columns || !primaryKey) throw protocolFailure(true);
  if (effect.type === 'delete') {
    if (effect.row !== null) throw protocolFailure(true);
  } else {
    const row = effect.row;
    if (!isCanonicalEffectRow(row, columns, primaryKey, effect.rowId)) {
      throw protocolFailure(true);
    }
  }
  if (effect.op === 'INSERT') {
    if (effect.previousRow !== null) throw protocolFailure(true);
  } else if (!isCanonicalEffectRow(
    effect.previousRow,
    columns,
    primaryKey,
    effect.rowId,
  )) {
    throw protocolFailure(true);
  }
  return effect as unknown as DatabaseMutationEffect;
}

function validateReplayChange(value: unknown, expectedSeq: number): void {
  const change = exactRecord(value, REPLAY_CHANGE_FIELDS);
  if (change.seq !== expectedSeq
    || !isDatabaseTableName(change.table)
    || !isRowId(change.rowId)
    || !isNonNegativeSafeInteger(change.ts)
    || (change.op !== 'INSERT'
      && change.op !== 'UPDATE'
      && change.op !== 'DELETE')) {
    throw protocolFailure(false);
  }

  const row = isRow(change.row);
  const previousRow = isRow(change.previousRow);
  if (change.op === 'INSERT') {
    if (!row || change.previousRow !== null) throw protocolFailure(false);
  } else if (change.op === 'UPDATE') {
    if (!row || !previousRow) throw protocolFailure(false);
  } else if (change.row !== null || !previousRow) {
    throw protocolFailure(false);
  }
}

function validateFindResult(
  value: DatabaseSerializableValue,
  operation: DatabaseFindOperation,
  catalog: DatabaseOperationCatalog,
): void {
  if (!Array.isArray(value) || value.length > operation.limit) {
    throw protocolFailure(false);
  }
  const expected = operation.select ?? catalog.columns?.[operation.table];
  if (!expected || expected.length === 0) throw protocolFailure(false);
  const expectedFields = new Set(expected);
  for (const row of value) {
    if (!isRow(row)) throw protocolFailure(false);
    const fields = Object.keys(row);
    if (fields.length !== expectedFields.size
      || fields.some((field) => !expectedFields.has(field))) {
      throw protocolFailure(false);
    }
  }
}

function fieldsForOperation(
  operation: DatabaseWriteOperation,
): ReadonlySet<string> {
  switch (operation.type) {
    case 'mutate':
      return MUTATION_VALUE_FIELDS;
    case 'batch':
      return BATCH_VALUE_FIELDS;
    case 'command':
      return COMMAND_VALUE_FIELDS;
  }
}

function readExecutionOutcome(value: unknown): Readonly<{
  readonly result: unknown;
  readonly receiptCompaction: DatabaseWriterReceiptCompaction | null;
}> {
  const record = readDatabaseExecutorDataRecord(value);
  if (!record || !hasExactDatabaseExecutorKeys(record, EXECUTION_OUTCOME_FIELDS)) {
    return Object.freeze({ result: value, receiptCompaction: null });
  }
  return Object.freeze({
    result: record.result,
    receiptCompaction: validateReceiptCompaction(record.receiptCompaction),
  });
}

function validateReceiptCompaction(
  value: unknown,
): DatabaseWriterReceiptCompaction {
  const record = readDatabaseExecutorDataRecord(value);
  if (!record
    || !hasExactDatabaseExecutorKeys(record, RECEIPT_COMPACTION_FIELDS)) {
    throw protocolFailure(true);
  }
  const totalKeys = record.totalKeys;
  const retainedResults = record.retainedResults;
  const expiredTombstones = record.expiredTombstones;
  const retainedResultBytes = record.retainedResultBytes;
  const keyLimit = record.keyLimit;
  const retainedByteLimit = record.retainedByteLimit;
  const resultByteLimit = record.resultByteLimit;
  const prunedCount = record.prunedCount;
  const prunedResultBytes = record.prunedResultBytes;
  const retainedLimit = record.retainedLimit;
  if (!isNonNegativeSafeInteger(totalKeys)
    || !isNonNegativeSafeInteger(retainedResults)
    || !isNonNegativeSafeInteger(expiredTombstones)
    || !isNonNegativeSafeInteger(retainedResultBytes)
    || !Number.isSafeInteger(prunedCount)
    || (prunedCount as number) < 1
    || !Number.isSafeInteger(prunedResultBytes)
    || (prunedResultBytes as number) < 1
    || keyLimit !== DATABASE_WRITER_MAX_RECEIPT_KEYS
    || retainedLimit !== DATABASE_WRITER_MAX_RECEIPTS
    || retainedByteLimit !== DATABASE_WRITER_MAX_RETAINED_RECEIPT_BYTES
    || resultByteLimit !== DATABASE_WRITER_MAX_RECEIPT_RESULT_BYTES
    || (totalKeys as number) > keyLimit
    || (retainedResults as number) > retainedLimit
    || (retainedResultBytes as number) > retainedByteLimit
    || retainedResults + expiredTombstones !== totalKeys
    || (prunedCount as number) > expiredTombstones) {
    throw protocolFailure(true);
  }
  return Object.freeze({
    totalKeys,
    retainedResults,
    expiredTombstones,
    retainedResultBytes,
    keyLimit,
    retainedByteLimit,
    resultByteLimit,
    prunedCount: prunedCount as number,
    prunedResultBytes: prunedResultBytes as number,
    retainedLimit,
  });
}

function readSequence(value: unknown, write: boolean): number {
  const record = exactRecord(value, SEQUENCE_FIELDS);
  if (!isNonNegativeSafeInteger(record.seq)) throw protocolFailure(write);
  return record.seq;
}

function exactRecord(
  value: unknown,
  fields: ReadonlySet<string>,
): Record<string, DatabaseSerializableValue> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw protocolFailure(false);
  }
  const record = value as Record<string, DatabaseSerializableValue>;
  const keys = Object.keys(record);
  if (keys.length !== fields.size || keys.some((key) => !fields.has(key))) {
    throw protocolFailure(false);
  }
  return record;
}

function hasExactFields(value: unknown, fields: ReadonlySet<string>): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const keys = Object.keys(value);
  return keys.length === fields.size && keys.every((key) => fields.has(key));
}

function isRow(value: unknown): value is DatabaseOperationRow {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const keys = Object.keys(value);
  return keys.length > 0 && keys.every(isDatabaseTableName);
}

function isRowId(value: unknown): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= DATABASE_OPERATION_MAX_ID_BYTES
    && !/[\u0000-\u001f\u007f-\u009f]/u.test(value)
    && textEncoder.encode(value).byteLength <= DATABASE_OPERATION_MAX_ID_BYTES;
}

function canonicalRowId(value: unknown): string | null {
  if (typeof value !== 'string'
    && (typeof value !== 'number' || !Number.isFinite(value))) return null;
  const canonical = String(value);
  return isRowId(canonical) ? canonical : null;
}

function isCanonicalEffectRow(
  value: unknown,
  columns: readonly string[],
  primaryKey: string,
  rowId: string,
): value is DatabaseOperationRow {
  if (!isRow(value)) return false;
  const rowFields = Object.keys(value);
  const expectedFields = new Set(columns);
  return rowFields.length === expectedFields.size
    && rowFields.every((field) => expectedFields.has(field))
    && canonicalRowId(value[primaryKey]) === rowId;
}

function isWriteOperation(
  operation: DatabaseOperation,
): operation is DatabaseWriteOperation {
  return operation.type === 'mutate'
    || operation.type === 'batch'
    || operation.type === 'command';
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function resultBoundary<T>(write: boolean, validate: () => T): T {
  try {
    return validate();
  } catch (error) {
    if (error instanceof DatabaseError
      && error.code === 'DATABASE_RESULT_LIMIT') {
      throw resultLimitFailure(write);
    }
    if (error instanceof DatabaseError
      && error.code === 'DATABASE_PAYLOAD_LIMIT') {
      throw resultLimitFailure(write);
    }
    throw protocolFailure(write);
  }
}

function resultLimitFailure(write: boolean): DatabaseError {
  return new DatabaseError(
    'DATABASE_RESULT_LIMIT',
    'Database actor result is outside the supported contract.',
    { retryable: false, outcome: write ? 'unknown' : null },
  );
}

function protocolFailure(write: boolean): DatabaseError {
  return new DatabaseError(
    'DATABASE_PROTOCOL_ERROR',
    'Database actor returned an invalid result.',
    {
      retryable: false,
      // A malformed write response cannot prove whether its commit happened.
      outcome: write ? 'unknown' : null,
    },
  );
}
