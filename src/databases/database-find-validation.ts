/** Schema-aware validation for the bounded structured-find operation. */

import {
  DATABASE_FIND_MAX_FILTER_DEPTH,
  DATABASE_FIND_MAX_FILTERS,
  DATABASE_FIND_MAX_IN_VALUES,
  DATABASE_FIND_MAX_OFFSET,
  DATABASE_FIND_MAX_ORDER_FIELDS,
  DATABASE_FIND_MAX_PARAMETERS,
  DATABASE_FIND_MAX_PROJECTION_FIELDS,
  DATABASE_FIND_MAX_ROWS,
  type DatabaseFindFilter,
  type DatabaseFindFilterOperator,
  type DatabaseFindOperation,
  type DatabaseFindOrder,
  type DatabaseOperationCatalog,
  type DatabaseSerializableScalar,
} from './database-operation-contracts';
import { validateStringArrayOverlapValues } from '../lib/string-array-overlap';
import {
  optionalDatabaseConsistency,
  validateDatabaseTable,
} from './database-operation-fields';
import {
  assertExactDatabaseFields,
  databaseOperationRecord,
  databasePayloadInvalid,
  databasePayloadLimit,
  hasDatabaseOwnField,
  isDatabasePayloadProxy,
  isDatabaseTableName,
  requireDatabaseOwnField,
  requireDatabaseStringField,
  safeDatabasePayloadDescriptors,
  safeDatabasePayloadOwnKeys,
  type DatabaseOperationRecord,
} from './database-operation-payload';
import { DatabaseError } from './database-error';

interface FindFilterValidationState {
  nodes: number;
  parameters: number;
}

/** Validate and normalize a complete structured-find operation record. */
export function validateDatabaseFindOperation(
  record: DatabaseOperationRecord,
  catalog: DatabaseOperationCatalog,
): DatabaseFindOperation {
  assertExactDatabaseFields(record, [
    'type',
    'table',
    'select',
    'filters',
    'order',
    'limit',
    'offset',
    'consistency',
  ]);
  const table = validateDatabaseTable(record.table, catalog);
  const columns = requireFindColumns(table, catalog);
  requireFindPrimaryKey(table, columns, catalog);
  const limit = record.limit;
  if (!Number.isSafeInteger(limit)
    || (limit as number) < 1
    || (limit as number) > DATABASE_FIND_MAX_ROWS) {
    throw databasePayloadInvalid(
      `Database find limit must be between 1 and ${DATABASE_FIND_MAX_ROWS}.`,
    );
  }
  const offset = !hasDatabaseOwnField(record, 'offset')
    ? undefined
    : validateFindOffset(record.offset);
  const select = !hasDatabaseOwnField(record, 'select')
    ? undefined
    : validateFindProjection(record.select, columns);
  if (select === undefined
    && columns.length > DATABASE_FIND_MAX_PROJECTION_FIELDS) {
    throw databasePayloadLimit('Database find projection limit exceeded.');
  }
  const filters = !hasDatabaseOwnField(record, 'filters')
    ? undefined
    : validateDatabaseFindFilters(record.filters, table, catalog);
  const order = !hasDatabaseOwnField(record, 'order')
    ? undefined
    : validateFindOrder(record.order, columns);
  return {
    type: 'find',
    table,
    ...(select === undefined ? {} : { select }),
    ...(filters === undefined ? {} : { filters }),
    ...(order === undefined ? {} : { order }),
    limit: limit as number,
    ...(offset === undefined ? {} : { offset }),
    ...optionalDatabaseConsistency(record, 'consistency'),
  };
}

/** Shared schema/parameter admission for find and filtered keyset-list reads. */
export function validateDatabaseFindFilters(
  value: unknown,
  table: string,
  catalog: DatabaseOperationCatalog,
): readonly DatabaseFindFilter[] {
  const columns = requireFindColumns(table, catalog);
  requireFindPrimaryKey(table, columns, catalog);
  // Reserve LIMIT plus OFFSET (find) or an optional cursor (list).
  return validateFindFilters(value, columns, { nodes: 0, parameters: 2 }, 0);
}

function requireFindColumns(
  table: string,
  catalog: DatabaseOperationCatalog,
): readonly string[] {
  const columns = catalog.columns?.[table];
  if (!columns || columns.length === 0) {
    throw new DatabaseError(
      'DATABASE_SCHEMA_MISMATCH',
      'Database find requires an immutable table-column catalog.',
    );
  }
  return columns;
}

function requireFindPrimaryKey(
  table: string,
  columns: readonly string[],
  catalog: DatabaseOperationCatalog,
): string {
  const primaryKey = catalog.primaryKeys?.[table];
  if (!primaryKey || !columns.includes(primaryKey)) {
    throw new DatabaseError(
      'DATABASE_SCHEMA_MISMATCH',
      'Database find requires a declared table primary key.',
    );
  }
  return primaryKey;
}

function validateFindOffset(value: unknown): number {
  if (!Number.isSafeInteger(value)
    || (value as number) < 0
    || (value as number) > DATABASE_FIND_MAX_OFFSET) {
    throw databasePayloadInvalid(
      `Database find offset must be between 0 and ${DATABASE_FIND_MAX_OFFSET}.`,
    );
  }
  return value as number;
}

function validateFindProjection(
  value: unknown,
  columns: readonly string[],
): readonly string[] {
  const fields = validateFindArray(
    value,
    'projection',
    DATABASE_FIND_MAX_PROJECTION_FIELDS,
    (entry) => validateFindField(entry, columns),
  );
  if (fields.length === 0) {
    throw databasePayloadInvalid('Database find projection must not be empty.');
  }
  assertUniqueFindFields(fields, 'projection');
  return fields;
}

function validateFindOrder(
  value: unknown,
  columns: readonly string[],
): readonly DatabaseFindOrder[] {
  const order = validateFindArray(
    value,
    'order',
    DATABASE_FIND_MAX_ORDER_FIELDS,
    (entry): DatabaseFindOrder => {
      const record = databaseOperationRecord(entry);
      assertExactDatabaseFields(record, ['field', 'direction']);
      const field = validateFindField(record.field, columns);
      if (record.direction !== 'asc' && record.direction !== 'desc') {
        throw databasePayloadInvalid(
          'Database find order direction must be asc or desc.',
        );
      }
      return Object.freeze({ field, direction: record.direction });
    },
  );
  if (order.length === 0) {
    throw databasePayloadInvalid('Database find order must not be empty.');
  }
  assertUniqueFindFields(order.map((entry) => entry.field), 'order');
  return order;
}

function validateFindFilters(
  value: unknown,
  columns: readonly string[],
  state: FindFilterValidationState,
  depth: number,
): readonly DatabaseFindFilter[] {
  if (depth > DATABASE_FIND_MAX_FILTER_DEPTH) {
    throw databasePayloadLimit('Database find filter nesting limit exceeded.');
  }
  const filters = validateFindArray(
    value,
    'filters',
    DATABASE_FIND_MAX_FILTERS,
    (entry) => validateFindFilter(entry, columns, state, depth),
  );
  if (filters.length === 0) {
    throw databasePayloadInvalid(
      'Database find filter groups must not be empty.',
    );
  }
  return filters;
}

function validateFindFilter(
  value: unknown,
  columns: readonly string[],
  state: FindFilterValidationState,
  depth: number,
): DatabaseFindFilter {
  state.nodes += 1;
  if (state.nodes > DATABASE_FIND_MAX_FILTERS) {
    throw databasePayloadLimit('Database find filter limit exceeded.');
  }
  const record = databaseOperationRecord(value);
  const type = requireDatabaseStringField(record, 'type');
  if (type === 'allOf' || type === 'anyOf') {
    assertExactDatabaseFields(record, ['type', 'filters']);
    requireDatabaseOwnField(record, 'filters');
    return Object.freeze({
      type,
      filters: validateFindFilters(record.filters, columns, state, depth + 1),
    });
  }
  if (type !== 'field') {
    throw databasePayloadInvalid('Database find filter type is invalid.');
  }

  assertExactDatabaseFields(record, [
    'type',
    'field',
    'operator',
    'value',
    'match',
  ]);
  requireDatabaseOwnField(record, 'value');
  const field = validateFindField(record.field, columns);
  const operator = validateFindOperator(record.operator);
  const match = !hasDatabaseOwnField(record, 'match')
    ? undefined
    : record.match;
  if (match !== undefined
    && (match !== 'exact' || (operator !== 'eq' && operator !== 'ne'))) {
    throw databasePayloadInvalid(
      'Database find exact matching is valid only for eq/ne.',
    );
  }
  if (operator === 'arrayOverlaps') {
    const validated = validateStringArrayOverlapValues(record.value);
    if (!validated.ok) {
      throw validated.kind === 'limit'
        ? databasePayloadLimit(validated.error)
        : databasePayloadInvalid(validated.error);
    }
    addFindFilterParameters(state, operator, validated.value, false);
    return Object.freeze({ type, field, operator, value: validated.value });
  }
  const filterValue = validateFindFilterValue(operator, record.value);
  addFindFilterParameters(state, operator, filterValue, match === 'exact');
  return Object.freeze({
    type,
    field,
    operator,
    value: filterValue,
    ...(match === undefined ? {} : { match }),
  });
}

function validateFindOperator(value: unknown): DatabaseFindFilterOperator {
  switch (value) {
    case 'eq':
    case 'ne':
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte':
    case 'like':
    case 'contains':
    case 'in':
    case 'arrayOverlaps':
      return value;
    default:
      throw databasePayloadInvalid('Database find filter operator is invalid.');
  }
}

function validateFindFilterValue(
  operator: DatabaseFindFilterOperator,
  value: unknown,
): DatabaseSerializableScalar | readonly DatabaseSerializableScalar[] {
  if (operator === 'in') {
    const values = validateFindArray(
      value,
      'in values',
      DATABASE_FIND_MAX_IN_VALUES,
      validateFindScalar,
    );
    if (values.length === 0) {
      throw databasePayloadInvalid(
        'Database find in filter must contain a value.',
      );
    }
    return values;
  }
  const scalar = validateFindScalar(value);
  if ((operator === 'like' || operator === 'contains')
    && typeof scalar !== 'string') {
    throw databasePayloadInvalid(
      `Database find ${operator} filter requires a string.`,
    );
  }
  if ((operator === 'gt'
      || operator === 'gte'
      || operator === 'lt'
      || operator === 'lte')
    && scalar === null) {
    throw databasePayloadInvalid(
      `Database find ${operator} filter does not accept null.`,
    );
  }
  return scalar;
}

function validateFindScalar(value: unknown): DatabaseSerializableScalar {
  if (value === null
    || typeof value === 'string'
    || typeof value === 'boolean'
    || (typeof value === 'number'
      && Number.isFinite(value)
      && !Object.is(value, -0))) {
    return value;
  }
  throw databasePayloadInvalid('Database find filter values must be scalar.');
}

function addFindFilterParameters(
  state: FindFilterValidationState,
  operator: DatabaseFindFilterOperator,
  value: DatabaseSerializableScalar | readonly DatabaseSerializableScalar[],
  exact: boolean,
): void {
  let additional: number;
  if (operator === 'arrayOverlaps') {
    additional = (value as readonly string[]).length;
  } else if (operator === 'in') {
    additional = (value as readonly DatabaseSerializableScalar[])
      .filter((entry) => entry !== null).length;
  } else if ((operator === 'eq' || operator === 'ne') && value === null) {
    additional = 0;
  } else if (exact && typeof value === 'boolean') {
    additional = 6;
  } else if (exact) {
    additional = 2;
  } else {
    additional = 1;
  }
  state.parameters += additional;
  if (state.parameters > DATABASE_FIND_MAX_PARAMETERS) {
    throw databasePayloadLimit('Database find parameter limit exceeded.');
  }
}

function validateFindField(value: unknown, columns: readonly string[]): string {
  if (!isDatabaseTableName(value) || !columns.includes(value)) {
    throw databasePayloadInvalid(
      'Database find references an unregistered field.',
    );
  }
  return value;
}

function assertUniqueFindFields(
  fields: readonly string[],
  label: 'projection' | 'order',
): void {
  if (new Set(fields).size !== fields.length) {
    throw databasePayloadInvalid(
      `Database find ${label} fields must be unique.`,
    );
  }
}

function validateFindArray<T>(
  value: unknown,
  label: string,
  maximum: number,
  parse: (entry: unknown) => T,
): readonly T[] {
  if (!Array.isArray(value) || isDatabasePayloadProxy(value)) {
    throw databasePayloadInvalid(`Database find ${label} must be an array.`);
  }
  if (value.length > maximum) {
    throw databasePayloadLimit(`Database find ${label} limit exceeded.`);
  }
  const descriptors = safeDatabasePayloadDescriptors(value);
  const ownKeys = safeDatabasePayloadOwnKeys(value);
  if (ownKeys.length !== value.length + 1 || !ownKeys.includes('length')) {
    throw databasePayloadInvalid(
      `Database find ${label} must be dense and unextended.`,
    );
  }
  const result: T[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) {
      throw databasePayloadInvalid(
        `Database find ${label} must contain data elements.`,
      );
    }
    result.push(parse(descriptor.value));
  }
  return Object.freeze(result);
}
