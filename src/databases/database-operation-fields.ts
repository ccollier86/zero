/** Shared scalar, catalog, consistency, and bounded-array validators. */

import {
  DATABASE_OPERATION_MAX_BATCH_ITEMS,
  DATABASE_OPERATION_MAX_ID_BYTES,
  type DatabaseOperationCatalog,
  type DatabaseReadConsistency,
  type DatabaseSequenceToken,
} from './database-operation-contracts';
import { DatabaseError } from './database-error';
import {
  assertExactDatabaseFields,
  createDatabaseSequenceToken,
  databaseOperationRecord,
  databasePayloadInvalid,
  databasePayloadLimit,
  databaseUtf8ByteLength,
  hasDatabaseOwnField,
  isDatabaseIdempotencyKey,
  isDatabasePayloadProxy,
  isDatabaseRegistryName,
  isDatabaseTableName,
  isWellFormedDatabaseUnicode,
  requireDatabaseStringField,
  safeDatabasePayloadDescriptors,
  safeDatabasePayloadOwnKeys,
  type DatabaseOperationRecord,
} from './database-operation-payload';

export function optionalDatabaseConsistency(
  record: DatabaseOperationRecord,
  field: string,
): { consistency?: DatabaseReadConsistency } {
  return !hasDatabaseOwnField(record, field)
    ? {}
    : { consistency: validateDatabaseConsistency(record[field]) };
}

export function validateDatabaseConsistency(
  value: unknown,
): DatabaseReadConsistency {
  const record = databaseOperationRecord(value);
  const mode = requireDatabaseStringField(record, 'mode');
  switch (mode) {
    case 'snapshot':
    case 'strong':
      assertExactDatabaseFields(record, ['mode']);
      return Object.freeze({ mode });
    case 'read-your-writes':
      assertExactDatabaseFields(record, ['mode', 'minSeq']);
      return Object.freeze({
        mode,
        minSeq: validateDatabaseSequenceToken(record.minSeq),
      });
    default:
      throw databasePayloadInvalid('Invalid database read consistency mode.');
  }
}

export function validateDatabaseSequenceToken(
  value: unknown,
): DatabaseSequenceToken {
  const record = databaseOperationRecord(value);
  assertExactDatabaseFields(record, ['seq']);
  return createDatabaseSequenceToken(record.seq as number);
}

export function validateDatabaseTable(
  value: unknown,
  catalog: DatabaseOperationCatalog,
): string {
  if (!isDatabaseTableName(value)) {
    throw databasePayloadInvalid('Invalid database table name.');
  }
  if (catalog.tables && !catalog.tables.includes(value)) {
    throw databasePayloadInvalid(
      'Database operation references an unregistered table.',
    );
  }
  return value;
}

export function validateDatabaseHandlerName(
  value: unknown,
  registry: readonly string[] | undefined,
  kind: 'query' | 'command',
): string {
  if (!isDatabaseRegistryName(value)) {
    throw databasePayloadInvalid(`Invalid database ${kind} name.`);
  }
  if (registry && !registry.includes(value)) {
    throw new DatabaseError(
      'DATABASE_OPERATION_UNSUPPORTED',
      `Database ${kind} is not registered.`,
    );
  }
  return value;
}

export function validateDatabaseIdempotencyKey(value: unknown): string {
  if (!isDatabaseIdempotencyKey(value)) {
    throw databasePayloadInvalid('Invalid database idempotency key.');
  }
  return value;
}

export function validateDatabaseRowId(value: unknown): string {
  if (typeof value !== 'string'
    || value.length === 0
    || value.length > DATABASE_OPERATION_MAX_ID_BYTES
    || !isWellFormedDatabaseUnicode(value)
    || /[\u0000-\u001f\u007f-\u009f]/u.test(value)
    || databaseUtf8ByteLength(value) > DATABASE_OPERATION_MAX_ID_BYTES) {
    throw databasePayloadInvalid('Invalid database row id.');
  }
  return value;
}

export function validateDatabaseBoundedArray<T>(
  value: unknown,
  field: string,
  parse: (entry: unknown) => T,
): readonly T[] {
  if (!Array.isArray(value) || isDatabasePayloadProxy(value)) {
    throw databasePayloadInvalid(`Database ${field} must be an array.`);
  }
  if (value.length > DATABASE_OPERATION_MAX_BATCH_ITEMS) {
    throw databasePayloadLimit(`Database ${field} limit exceeded.`);
  }
  const descriptors = safeDatabasePayloadDescriptors(value);
  const ownKeys = safeDatabasePayloadOwnKeys(value);
  if (ownKeys.length !== value.length + 1 || !ownKeys.includes('length')) {
    throw databasePayloadInvalid(
      `Database ${field} must be dense and unextended.`,
    );
  }
  const result: T[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) {
      throw databasePayloadInvalid(
        `Database ${field} must contain data elements.`,
      );
    }
    result.push(parse(descriptor.value));
  }
  return Object.freeze(result);
}
