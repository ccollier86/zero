/** Validation and normalization for operation envelopes and actor results. */

import {
  DATABASE_LIST_MAX_ROWS,
  type DatabaseAssertion,
  type DatabaseCommitResult,
  type DatabaseMutation,
  type DatabaseOperation,
  type DatabaseOperationCatalog,
  type DatabaseOperationRow,
  type DatabaseReadResult,
} from './database-operation-contracts';
import { DatabaseError } from './database-error';
import {
  validateDatabaseFindFilters,
  validateDatabaseFindOperation,
} from './database-find-validation';
import {
  optionalDatabaseConsistency,
  validateDatabaseBoundedArray,
  validateDatabaseHandlerName,
  validateDatabaseIdempotencyKey,
  validateDatabaseRowId,
  validateDatabaseSequenceToken,
  validateDatabaseTable,
} from './database-operation-fields';
import {
  assertExactDatabaseFields,
  cloneDatabaseSerializableValue,
  databaseOperationRecord,
  databasePayloadInvalid,
  hasDatabaseOwnField,
  isDatabaseTableName,
  requireDatabaseOwnField,
  requireDatabaseStringField,
} from './database-operation-payload';

/**
 * Validate an untrusted operation, reject extensions, and return an immutable
 * detached envelope safe to enqueue or structured-clone to an actor.
 */
export function validateDatabaseOperation(
  value: unknown,
  catalog: DatabaseOperationCatalog = {},
): DatabaseOperation {
  // Validate the complete untrusted envelope against one shared budget before
  // cloning individual rows. Otherwise a large batch could contain many
  // values which each sit just below the per-value limit.
  const detached = cloneDatabaseSerializableValue(value);
  const record = databaseOperationRecord(detached);
  const type = requireDatabaseStringField(record, 'type');

  switch (type) {
    case 'get': {
      assertExactDatabaseFields(record, ['type', 'table', 'id', 'consistency']);
      return finalizeOperation({
        type,
        table: validateDatabaseTable(record.table, catalog),
        id: validateDatabaseRowId(record.id),
        ...optionalDatabaseConsistency(record, 'consistency'),
      });
    }
    case 'list': {
      assertExactDatabaseFields(record, [
        'type',
        'table',
        'limit',
        'after',
        'filters',
        'consistency',
      ]);
      const limit = record.limit;
      if (!Number.isSafeInteger(limit)
        || (limit as number) < 1
        || (limit as number) > DATABASE_LIST_MAX_ROWS) {
        throw databasePayloadInvalid(
          `Database list limit must be between 1 and ${DATABASE_LIST_MAX_ROWS}.`,
        );
      }
      const table = validateDatabaseTable(record.table, catalog);
      return finalizeOperation({
        type,
        table,
        limit: limit as number,
        ...(!hasDatabaseOwnField(record, 'after')
          ? {}
          : { after: validateDatabaseRowId(record.after) }),
        ...(!hasDatabaseOwnField(record, 'filters')
          ? {}
          : { filters: validateDatabaseFindFilters(record.filters, table, catalog) }),
        ...optionalDatabaseConsistency(record, 'consistency'),
      });
    }
    case 'find':
      return finalizeOperation(validateDatabaseFindOperation(record, catalog));
    case 'query': {
      assertExactDatabaseFields(record, ['type', 'name', 'input', 'consistency']);
      requireDatabaseOwnField(record, 'input');
      const name = validateDatabaseHandlerName(
        record.name,
        catalog.queries,
        'query',
      );
      return finalizeOperation({
        type,
        name,
        input: cloneDatabaseSerializableValue(record.input),
        ...optionalDatabaseConsistency(record, 'consistency'),
      });
    }
    case 'mutate': {
      assertExactDatabaseFields(record, ['type', 'idempotencyKey', 'mutation']);
      requireDatabaseOwnField(record, 'mutation');
      return finalizeOperation({
        type,
        idempotencyKey: validateDatabaseIdempotencyKey(record.idempotencyKey),
        mutation: validateMutation(record.mutation, catalog),
      });
    }
    case 'batch': {
      assertExactDatabaseFields(record, [
        'type',
        'idempotencyKey',
        'assertions',
        'mutations',
      ]);
      requireDatabaseOwnField(record, 'mutations');
      const assertions = !hasDatabaseOwnField(record, 'assertions')
        ? undefined
        : validateDatabaseBoundedArray(
          record.assertions,
          'assertions',
          (entry) => validateAssertion(entry, catalog),
        );
      const mutations = validateDatabaseBoundedArray(
        record.mutations,
        'mutations',
        (entry) => validateMutation(entry, catalog),
      );
      if (mutations.length === 0) {
        throw databasePayloadInvalid(
          'A database batch must contain at least one mutation.',
        );
      }
      return finalizeOperation({
        type,
        idempotencyKey: validateDatabaseIdempotencyKey(record.idempotencyKey),
        ...(assertions === undefined ? {} : { assertions }),
        mutations,
      });
    }
    case 'command': {
      assertExactDatabaseFields(record, [
        'type',
        'name',
        'input',
        'idempotencyKey',
      ]);
      requireDatabaseOwnField(record, 'input');
      const name = validateDatabaseHandlerName(
        record.name,
        catalog.commands,
        'command',
      );
      return finalizeOperation({
        type,
        name,
        input: cloneDatabaseSerializableValue(record.input),
        idempotencyKey: validateDatabaseIdempotencyKey(record.idempotencyKey),
      });
    }
    default:
      throw new DatabaseError(
        'DATABASE_OPERATION_UNSUPPORTED',
        'Unsupported database operation type.',
      );
  }
}

/** Validate and detach an untrusted actor read result. */
export function validateDatabaseReadResult(value: unknown): DatabaseReadResult {
  const record = databaseOperationRecord(cloneDatabaseSerializableValue(value));
  assertExactDatabaseFields(record, ['value', 'sequence']);
  requireDatabaseOwnField(record, 'value');
  requireDatabaseOwnField(record, 'sequence');
  return finalizeResult({
    value: cloneDatabaseSerializableValue(record.value),
    sequence: validateDatabaseSequenceToken(record.sequence),
  });
}

/** Validate and detach an untrusted actor commit/idempotency result. */
export function validateDatabaseCommitResult(
  value: unknown,
): DatabaseCommitResult {
  const record = databaseOperationRecord(cloneDatabaseSerializableValue(value));
  assertExactDatabaseFields(record, [
    'value',
    'sequence',
    'idempotencyKey',
    'replayed',
  ]);
  requireDatabaseOwnField(record, 'value');
  requireDatabaseOwnField(record, 'sequence');
  const replayed = record.replayed;
  if (typeof replayed !== 'boolean') {
    throw databasePayloadInvalid(
      'Database commit replayed flag must be a boolean.',
    );
  }
  return finalizeResult({
    value: cloneDatabaseSerializableValue(record.value),
    sequence: validateDatabaseSequenceToken(record.sequence),
    idempotencyKey: validateDatabaseIdempotencyKey(record.idempotencyKey),
    replayed,
  });
}

function validateMutation(
  value: unknown,
  catalog: DatabaseOperationCatalog,
): DatabaseMutation {
  const record = databaseOperationRecord(value);
  const type = requireDatabaseStringField(record, 'type');
  switch (type) {
    case 'create':
    case 'upsert': {
      assertExactDatabaseFields(record, ['type', 'table', 'row']);
      requireDatabaseOwnField(record, 'row');
      const table = validateDatabaseTable(record.table, catalog);
      return Object.freeze({
        type,
        table,
        row: validateRow(record.row, table, catalog, false),
      });
    }
    case 'update': {
      assertExactDatabaseFields(record, ['type', 'table', 'id', 'patch']);
      requireDatabaseOwnField(record, 'patch');
      const table = validateDatabaseTable(record.table, catalog);
      return Object.freeze({
        type,
        table,
        id: validateDatabaseRowId(record.id),
        patch: validateRow(record.patch, table, catalog, true),
      });
    }
    case 'delete': {
      assertExactDatabaseFields(record, ['type', 'table', 'id']);
      return Object.freeze({
        type,
        table: validateDatabaseTable(record.table, catalog),
        id: validateDatabaseRowId(record.id),
      });
    }
    default:
      throw new DatabaseError(
        'DATABASE_OPERATION_UNSUPPORTED',
        'Unsupported database mutation type.',
      );
  }
}

function validateAssertion(
  value: unknown,
  catalog: DatabaseOperationCatalog,
): DatabaseAssertion {
  const record = databaseOperationRecord(value);
  const type = requireDatabaseStringField(record, 'type');
  switch (type) {
    case 'row-exists':
    case 'row-missing': {
      assertExactDatabaseFields(record, ['type', 'table', 'id']);
      return Object.freeze({
        type,
        table: validateDatabaseTable(record.table, catalog),
        id: validateDatabaseRowId(record.id),
      });
    }
    case 'row-equals': {
      assertExactDatabaseFields(record, ['type', 'table', 'id', 'row']);
      requireDatabaseOwnField(record, 'row');
      const table = validateDatabaseTable(record.table, catalog);
      return Object.freeze({
        type,
        table,
        id: validateDatabaseRowId(record.id),
        row: validateRow(record.row, table, catalog, false),
      });
    }
    case 'sequence-equals': {
      assertExactDatabaseFields(record, ['type', 'sequence']);
      return Object.freeze({
        type,
        sequence: validateDatabaseSequenceToken(record.sequence),
      });
    }
    default:
      throw new DatabaseError(
        'DATABASE_OPERATION_UNSUPPORTED',
        'Unsupported database assertion type.',
      );
  }
}

function validateRow(
  value: unknown,
  table: string,
  catalog: DatabaseOperationCatalog,
  partial: boolean,
): DatabaseOperationRow {
  const clone = cloneDatabaseSerializableValue(value);
  if (clone === null || Array.isArray(clone) || typeof clone !== 'object') {
    throw databasePayloadInvalid('Database mutation row must be a plain object.');
  }
  const registeredColumns = catalog.columns?.[table];
  for (const column of Object.keys(clone)) {
    if (!isDatabaseTableName(column)) {
      throw databasePayloadInvalid(
        'Database mutation row contains an invalid column name.',
      );
    }
    if (registeredColumns && !registeredColumns.includes(column)) {
      throw databasePayloadInvalid(
        'Database mutation row contains an unregistered column.',
      );
    }
  }
  const primaryKey = catalog.primaryKeys?.[table];
  if (partial
    && primaryKey
    && Object.prototype.hasOwnProperty.call(clone, primaryKey)) {
    throw databasePayloadInvalid(
      'Database update patches must not contain the primary key.',
    );
  }
  return clone as DatabaseOperationRow;
}

function finalizeOperation<T extends DatabaseOperation>(operation: T): T {
  // Re-validate the complete normalized envelope as one payload so arrays of
  // individually-valid rows cannot bypass the aggregate message budget.
  return cloneDatabaseSerializableValue(operation) as unknown as T;
}

function finalizeResult<
  T extends DatabaseReadResult | DatabaseCommitResult,
>(result: T): T {
  return cloneDatabaseSerializableValue(result) as unknown as T;
}
