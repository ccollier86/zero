/** Closed input readers used inside actor-local Data Studio handlers. */

import type {
  DataStudioColumn,
  DataStudioSchema,
  DataStudioTableStatus,
} from './data-studio-contracts';
import {
  normalizeDataStudioSchema,
  normalizeDataStudioValueForColumn,
} from './data-studio-codec';
import { DataStudioError } from './data-studio-error';
import type {
  DataStudioActorInput,
  DataStudioFilterOperator,
  DataStudioRowCreateInput,
  DataStudioRowDeleteInput,
  DataStudioRowFilter,
  DataStudioRowGetInput,
  DataStudioRowListInput,
  DataStudioRowReplaceInput,
  DataStudioSchemaVersionListInput,
  DataStudioTableCreateInput,
  DataStudioTableGetInput,
  DataStudioTableListInput,
  DataStudioTableStatusInput,
  DataStudioTableUpdateInput,
} from './data-studio-operation-contracts';
import {
  DATA_STUDIO_MAX_PAGE_SIZE,
  DATA_STUDIO_MAX_SCHEMA_PAGE_SIZE,
} from './data-studio-operation-contracts';
import {
  normalizeDataStudioActorId,
  normalizeDataStudioValues,
  normalizeDataStudioColumnId,
  normalizeDataStudioDescription,
  normalizeDataStudioId,
  normalizeDataStudioRevision,
  normalizeDataStudioTableKey,
  normalizeDataStudioTableName,
  readDataStudioRecord,
} from './data-studio-operation-validation';

const FILTER_OPERATORS = new Set<DataStudioFilterOperator>([
  'eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'contains',
]);

/** Read only the routing id needed to load a schema before full validation. */
export function peekDataStudioTableId(value: unknown): string {
  const record = readDataStudioRecord(value, 'Data Studio operation input');
  return normalizeDataStudioId(
    record.tableId,
    'Data Studio table id',
  );
}

export function readDataStudioTableCreateInput(
  value: unknown,
): DataStudioTableCreateInput {
  const record = inputRecord(value, [
    'tableId', 'key', 'name', 'description', 'schema',
    'userId', 'membershipId',
  ]);
  return Object.freeze({
    ...readActor(record),
    tableId: normalizeDataStudioId(record.tableId, 'Data Studio table id'),
    key: normalizeDataStudioTableKey(record.key),
    name: normalizeDataStudioTableName(record.name),
    description: normalizeDataStudioDescription(record.description),
    schema: normalizeDataStudioSchema(record.schema),
  });
}

export function readDataStudioTableUpdateInput(
  value: unknown,
): DataStudioTableUpdateInput {
  const record = inputRecord(value, [
    'tableId', 'expectedRevision', 'name', 'description',
    'schema', 'userId', 'membershipId',
  ], ['name', 'description', 'schema']);
  if (!Object.hasOwn(record, 'name')
    && !Object.hasOwn(record, 'description')
    && !Object.hasOwn(record, 'schema')) {
    throw invalid('Data Studio table update is empty.');
  }
  return Object.freeze({
    ...readActor(record),
    tableId: normalizeDataStudioId(record.tableId, 'Data Studio table id'),
    expectedRevision: normalizeDataStudioRevision(record.expectedRevision),
    ...(Object.hasOwn(record, 'name')
      ? { name: normalizeDataStudioTableName(record.name) }
      : {}),
    ...(Object.hasOwn(record, 'description')
      ? { description: normalizeDataStudioDescription(record.description) }
      : {}),
    ...(Object.hasOwn(record, 'schema')
      ? { schema: normalizeDataStudioSchema(record.schema) }
      : {}),
  });
}

export function readDataStudioTableStatusInput(
  value: unknown,
): DataStudioTableStatusInput {
  const record = inputRecord(value, [
    'tableId', 'expectedRevision', 'status', 'userId', 'membershipId',
  ]);
  return Object.freeze({
    ...readActor(record),
    tableId: normalizeDataStudioId(record.tableId, 'Data Studio table id'),
    expectedRevision: normalizeDataStudioRevision(record.expectedRevision),
    status: readStatus(record.status),
  });
}

export function readDataStudioRowCreateInput(
  value: unknown,
  schema: DataStudioSchema,
): DataStudioRowCreateInput {
  const record = inputRecord(value, [
    'rowId', 'tableId', 'values', 'userId', 'membershipId',
  ]);
  return Object.freeze({
    ...readActor(record),
    rowId: normalizeDataStudioId(record.rowId, 'Data Studio row id'),
    tableId: normalizeDataStudioId(record.tableId, 'Data Studio table id'),
    values: normalizeDataStudioValues(schema, record.values),
  });
}

export function readDataStudioRowReplaceInput(
  value: unknown,
  schema: DataStudioSchema,
): DataStudioRowReplaceInput {
  const record = inputRecord(value, [
    'rowId', 'tableId', 'expectedRevision', 'values', 'userId',
    'membershipId',
  ]);
  return Object.freeze({
    ...readActor(record),
    rowId: normalizeDataStudioId(record.rowId, 'Data Studio row id'),
    tableId: normalizeDataStudioId(record.tableId, 'Data Studio table id'),
    expectedRevision: normalizeDataStudioRevision(record.expectedRevision),
    values: normalizeDataStudioValues(schema, record.values),
  });
}

export function readDataStudioRowDeleteInput(
  value: unknown,
): DataStudioRowDeleteInput {
  const record = inputRecord(value, [
    'rowId', 'tableId', 'expectedRevision', 'userId', 'membershipId',
  ]);
  return Object.freeze({
    ...readActor(record),
    rowId: normalizeDataStudioId(record.rowId, 'Data Studio row id'),
    tableId: normalizeDataStudioId(record.tableId, 'Data Studio table id'),
    expectedRevision: normalizeDataStudioRevision(record.expectedRevision),
  });
}

export function readDataStudioTableListInput(
  value: unknown,
): DataStudioTableListInput {
  const record = inputRecord(value, ['status']);
  return Object.freeze({
    status: record.status === 'all' ? 'all' : readStatus(record.status),
  });
}

export function readDataStudioTableGetInput(
  value: unknown,
): DataStudioTableGetInput {
  const record = inputRecord(value, ['tableId', 'key'], ['tableId', 'key']);
  const hasId = Object.hasOwn(record, 'tableId');
  const hasKey = Object.hasOwn(record, 'key');
  if (hasId === hasKey) {
    throw invalid('Specify exactly one Data Studio table id or key.');
  }
  return Object.freeze(hasId
    ? { tableId: normalizeDataStudioId(record.tableId, 'Data Studio table id') }
    : { key: normalizeDataStudioTableKey(record.key) });
}

export function readDataStudioRowGetInput(value: unknown): DataStudioRowGetInput {
  const record = inputRecord(value, ['tableId', 'rowId']);
  return Object.freeze({
    tableId: normalizeDataStudioId(record.tableId, 'Data Studio table id'),
    rowId: normalizeDataStudioId(record.rowId, 'Data Studio row id'),
  });
}

export function readDataStudioRowListInput(
  value: unknown,
  columns: readonly DataStudioColumn[],
): DataStudioRowListInput {
  const record = inputRecord(value, [
    'tableId', 'limit', 'offset', 'search', 'filters', 'sortColumnId',
    'sortDirection',
  ], ['search', 'filters', 'sortColumnId', 'sortDirection']);
  const limit = boundedInteger(
    record.limit,
    1,
    DATA_STUDIO_MAX_PAGE_SIZE,
    'Data Studio row page limit',
  );
  const offset = boundedInteger(record.offset, 0, 100_000, 'Data Studio row page offset');
  const columnIds = new Set(columns.map((column) => column.columnId));
  const columnsByKey = new Map(columns.map((column) => [column.key, column]));
  const sortColumnId = Object.hasOwn(record, 'sortColumnId')
    ? normalizeDataStudioColumnId(record.sortColumnId)
    : undefined;
  if (sortColumnId && !columnIds.has(sortColumnId)) {
    throw invalid('Data Studio row sort column is unknown.');
  }
  if (sortColumnId
    && columns.find((column) => column.columnId === sortColumnId)?.type === 'json') {
    throw invalid('Data Studio JSON columns cannot be sorted.');
  }
  const sortDirection = Object.hasOwn(record, 'sortDirection')
    ? readSortDirection(record.sortDirection)
    : undefined;
  if (sortDirection && !sortColumnId) {
    throw invalid('Data Studio row sort direction requires a column.');
  }
  return Object.freeze({
    tableId: normalizeDataStudioId(record.tableId, 'Data Studio table id'),
    limit,
    offset,
    ...(Object.hasOwn(record, 'search')
      ? { search: boundedSearch(record.search) }
      : {}),
    ...(Object.hasOwn(record, 'filters')
      ? { filters: readFilters(record.filters, columnsByKey) }
      : {}),
    ...(sortColumnId ? { sortColumnId } : {}),
    ...(sortDirection ? { sortDirection } : {}),
  });
}

export function readDataStudioSchemaVersionListInput(
  value: unknown,
): DataStudioSchemaVersionListInput {
  const record = inputRecord(
    value,
    ['tableId', 'limit', 'beforeRevision'],
    ['beforeRevision'],
  );
  return Object.freeze({
    tableId: normalizeDataStudioId(record.tableId, 'Data Studio table id'),
    limit: boundedInteger(
      record.limit,
      1,
      DATA_STUDIO_MAX_SCHEMA_PAGE_SIZE,
      'Data Studio schema page limit',
    ),
    ...(Object.hasOwn(record, 'beforeRevision')
      ? { beforeRevision: normalizeDataStudioRevision(record.beforeRevision) }
      : {}),
  });
}

function readActor(record: Record<string, unknown>): DataStudioActorInput {
  return Object.freeze({
    userId: normalizeDataStudioActorId(record.userId, 'Data Studio actor user id'),
    membershipId: normalizeDataStudioActorId(
      record.membershipId,
      'Data Studio actor membership id',
    ),
  });
}

function readFilters(
  value: unknown,
  columnsByKey: ReadonlyMap<string, DataStudioColumn>,
): readonly DataStudioRowFilter[] {
  if (!Array.isArray(value) || value.length > 8) {
    throw invalid('Data Studio row filters are invalid.');
  }
  const filters = value.map((candidate) => {
    const record = inputRecord(candidate, ['columnKey', 'operator', 'value']);
    const columnKey = typeof record.columnKey === 'string'
      && record.columnKey.length >= 1
      && record.columnKey.length <= 64
      ? record.columnKey
      : null;
    if (!columnKey) throw invalid('Data Studio filter column is invalid.');
    const column = columnsByKey.get(columnKey);
    if (!column) throw invalid('Data Studio filter column is unknown.');
    if (typeof record.operator !== 'string'
      || !FILTER_OPERATORS.has(record.operator as DataStudioFilterOperator)) {
      throw invalid('Data Studio filter operator is invalid.');
    }
    const rawValue = record.value;
    if (rawValue !== null
      && typeof rawValue !== 'string'
      && typeof rawValue !== 'number'
      && typeof rawValue !== 'boolean') {
      throw invalid('Data Studio filter value must be scalar.');
    }
    if (typeof rawValue === 'number' && !Number.isFinite(rawValue)) {
      throw invalid('Data Studio filter number must be finite.');
    }
    let scalar: string | number | boolean | null = rawValue;
    if (scalar !== null) {
      const normalized = normalizeDataStudioValueForColumn(column, scalar);
      if (typeof normalized === 'object') {
        throw invalid('Data Studio filter value must be scalar.');
      }
      scalar = normalized;
    }
    return Object.freeze({
      columnId: column.columnId,
      operator: record.operator as DataStudioFilterOperator,
      value: scalar,
    });
  });
  return Object.freeze(filters);
}

function inputRecord(
  value: unknown,
  fields: readonly string[],
  optional: readonly string[] = [],
): Record<string, unknown> {
  const record = readDataStudioRecord(value, 'Data Studio operation input');
  const keys = Object.keys(record);
  if (keys.some((key) => !fields.includes(key))) {
    throw invalid('Data Studio operation input contains an unknown field.');
  }
  for (const field of fields) {
    if (!optional.includes(field) && !Object.hasOwn(record, field)) {
      throw invalid('Data Studio operation input is missing a required field.');
    }
  }
  return record;
}

function readStatus(value: unknown): DataStudioTableStatus {
  if (value !== 'active' && value !== 'archived') {
    throw invalid('Data Studio table status is invalid.');
  }
  return value;
}

function readSortDirection(value: unknown): 'asc' | 'desc' {
  if (value !== 'asc' && value !== 'desc') {
    throw invalid('Data Studio sort direction is invalid.');
  }
  return value;
}

function boundedSearch(value: unknown): string {
  if (typeof value !== 'string' || value.length > 200) {
    throw invalid('Data Studio search text is invalid.');
  }
  return value.trim();
}

function boundedInteger(
  value: unknown,
  minimum: number,
  maximum: number,
  label: string,
): number {
  if (!Number.isSafeInteger(value)
    || (value as number) < minimum
    || (value as number) > maximum) {
    throw invalid(`${label} is invalid.`);
  }
  return value as number;
}

function invalid(message: string): DataStudioError {
  return new DataStudioError('DATA_STUDIO_VALUE_INVALID', message);
}
