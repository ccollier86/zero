/** Managed mutation, batch assertion, and realm-command execution. */

import { stableStringify } from '../migrations/schema-snapshot';
import { validateSyncMutation } from '../sync/sync-mutation-validation';
import {
  SYNC_TABLE_MUTATION_VALIDATOR,
  type Change,
  type Row,
  type SyncTableMutationValidator,
} from '../sync/types';
import { DatabaseError } from './database-error';
import { readDatabaseCaughtErrorDataProperty } from './database-error-inspection';
import {
  createDatabaseSequenceToken,
  type DatabaseAssertion,
  type DatabaseBatchOperation,
  type DatabaseMutation,
  type DatabaseOperationRow,
  type DatabaseWriteOperation,
} from './database-operations';
import { runDatabaseRealmCommand, type DatabaseRealm } from './database-realm';
import type { DatabaseRuntime } from './database-runtime';
import type {
  DatabaseBatchCommitValue,
  DatabaseMutationEffect,
  DatabaseWriterCommitValue,
} from './database-writer-contracts';

export function executeDatabaseWriterWriteValue(
  runtime: DatabaseRuntime,
  realm: DatabaseRealm,
  operation: DatabaseWriteOperation,
): DatabaseWriterCommitValue {
  switch (operation.type) {
    case 'mutate':
      return {
        kind: 'mutation',
        mutation: applyMutation(runtime, realm, operation.mutation),
      };
    case 'batch':
      return executeBatch(runtime, realm, operation);
    case 'command':
      return {
        kind: 'command',
        name: operation.name,
        output: runDatabaseRealmCommand(
          realm,
          runtime.db,
          operation.name,
          operation.input,
        ),
      };
  }
}

export function isExpectedDatabaseMutationConflict(error: unknown): boolean {
  const code = readDatabaseCaughtErrorDataProperty(error, 'code');
  const message = readDatabaseCaughtErrorDataProperty(error, 'message');
  if (typeof code === 'string'
    && code.startsWith('SQLITE_CONSTRAINT')) return true;
  return typeof message === 'string'
    && /already exists|constraint|identity conflict|immutable/iu.test(message);
}

export function databaseMutationConflictType(
  error: unknown,
): 'primary-key' | 'constraint' {
  const code = readDatabaseCaughtErrorDataProperty(error, 'code');
  const message = readDatabaseCaughtErrorDataProperty(error, 'message');
  if ((typeof code === 'string'
      && /(?:PRIMARYKEY|UNIQUE)$/u.test(code))
    || (typeof message === 'string'
      && /already exists|identity conflict|primary key|unique/iu.test(
        message,
      ))) return 'primary-key';
  return 'constraint';
}

function executeBatch(
  runtime: DatabaseRuntime,
  realm: DatabaseRealm,
  operation: DatabaseBatchOperation,
): DatabaseBatchCommitValue {
  for (let index = 0; index < (operation.assertions?.length ?? 0); index += 1) {
    evaluateAssertion(runtime, operation.assertions![index]!, index);
  }
  return {
    kind: 'batch',
    mutations: operation.mutations.map((mutation) =>
      applyMutation(runtime, realm, mutation)),
  };
}

function evaluateAssertion(
  runtime: DatabaseRuntime,
  assertion: DatabaseAssertion,
  index: number,
): void {
  let matches: boolean;
  switch (assertion.type) {
    case 'row-exists':
      matches = runtime.db.get(assertion.table, assertion.id) !== null;
      break;
    case 'row-missing':
      matches = runtime.db.get(assertion.table, assertion.id) === null;
      break;
    case 'row-equals': {
      const row = runtime.db.get(assertion.table, assertion.id);
      matches = row !== null
        && stableStringify(row) === stableStringify(assertion.row);
      break;
    }
    case 'sequence-equals':
      matches = runtime.db.currentSeq === assertion.sequence.seq;
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

function applyMutation(
  runtime: DatabaseRuntime,
  realm: DatabaseRealm,
  mutation: DatabaseMutation,
): DatabaseMutationEffect {
  if ((mutation.type === 'update' || mutation.type === 'delete')
    && runtime.db.get(mutation.table, mutation.id) === null) {
    return noChangeEffect(mutation);
  }

  const validator = realm.tables[mutation.table]?.[
    SYNC_TABLE_MUTATION_VALIDATOR
  ];
  let row: Row | Partial<Row> | undefined;
  if (mutation.type === 'create' || mutation.type === 'upsert') {
    row = validateMutationRow(
      runtime,
      mutation.table,
      'INSERT',
      undefined,
      mutation.row,
      validator,
    );
  } else if (mutation.type === 'update') {
    row = validateMutationRow(
      runtime,
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
        change = runtime.db.createStrict(mutation.table, row as Row);
        break;
      case 'upsert':
        change = runtime.db.create(mutation.table, row as Row);
        break;
      case 'update':
        change = runtime.db.update(
          mutation.table,
          mutation.id,
          row as Partial<Row>,
        );
        break;
      case 'delete':
        change = runtime.db.delete(mutation.table, mutation.id);
        break;
    }
  } catch (error) {
    if (isExpectedDatabaseMutationConflict(error)) {
      throw new DatabaseError(
        'DATABASE_CONFLICT',
        'Database mutation conflicted.',
        {
          cause: error,
          retryable: false,
          outcome: 'not-committed',
          details: { conflictType: databaseMutationConflictType(error) },
        },
      );
    }
    throw error;
  }
  if (!change) return noChangeEffect(mutation);
  const committedRow = change.op === 'DELETE'
    ? null
    : runtime.db.get(mutation.table, change.rowId);
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

function validateMutationRow(
  runtime: DatabaseRuntime,
  table: string,
  op: 'INSERT' | 'UPDATE',
  rowId: string | undefined,
  row: DatabaseOperationRow,
  validator: SyncTableMutationValidator | undefined,
): Row | Partial<Row> {
  const result = validateSyncMutation(
    runtime.db,
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
