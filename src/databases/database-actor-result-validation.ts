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
import type {
  DatabaseChangeReplayResult,
  DatabaseMutationEffect,
  DatabaseWriterCommitValue,
} from './database-writer-engine';

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
const textEncoder = new TextEncoder();

export type DatabaseActorExecuteResult =
  | DatabaseReadResult
  | DatabaseCommitResult<DatabaseWriterCommitValue>;

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
): DatabaseMutationEffect {
  const effect = exactRecord(value, MUTATION_EFFECT_FIELDS);
  if (effect.type !== mutation.type
    || effect.table !== mutation.table
    || !isRowId(effect.rowId)
    || typeof effect.changed !== 'boolean') {
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
      if (!isRowId(submittedId) || effect.rowId !== submittedId) {
        throw protocolFailure(true);
      }
    }
  }

  if (!effect.changed) {
    if ((mutation.type !== 'update' && mutation.type !== 'delete')
      || effect.op !== null
      || effect.sequence !== null) {
      throw protocolFailure(true);
    }
    return effect as unknown as DatabaseMutationEffect;
  }

  const expectedOp = mutation.type === 'create'
    ? effect.op === 'INSERT'
    : mutation.type === 'upsert'
      ? effect.op === 'INSERT' || effect.op === 'UPDATE'
      : mutation.type === 'update'
        ? effect.op === 'UPDATE'
        : effect.op === 'DELETE';
  if (!expectedOp) throw protocolFailure(true);
  readSequence(effect.sequence, true);
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
