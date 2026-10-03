/** Validation for values returned across the Fabric actor boundary. */

import {
  DATA_STUDIO_MAX_COLUMNS,
  type DataStudioRow,
  type DataStudioRowValues,
  type DataStudioSchemaVersion,
  type DataStudioTable,
  type DataStudioTableSummary,
  type DataStudioValue,
} from './data-studio-contracts';
import {
  normalizeDataStudioSchema,
  normalizeDataStudioValue,
} from './data-studio-codec';
import {
  DataStudioError,
  isDataStudioErrorCode,
  type DataStudioOperationOutcome,
} from './data-studio-error';
import {
  DATA_STUDIO_MAX_PAGE_SIZE,
  DATA_STUDIO_MAX_SCHEMA_PAGE_SIZE,
  DATA_STUDIO_MAX_TABLES,
  type DataStudioRowDeleteResult,
  type DataStudioRowPage,
} from './data-studio-operation-contracts';
import {
  normalizeDataStudioColumnId,
  normalizeDataStudioId,
  normalizeDataStudioTableKey,
  normalizeDataStudioTableName,
} from './data-studio-operation-validation';

/** Validate and unwrap the named-command envelope returned by Fabric. */
export function readDataStudioCommandOutput(
  value: unknown,
  expectedName: string,
): unknown {
  const record = resultRecord(value);
  if (record.kind !== 'command'
    || record.name !== expectedName
    || !Object.hasOwn(record, 'output')
    || Object.keys(record).length !== 3) {
    throw corrupt();
  }
  return record.output;
}

/** Unwrap one closed actor result union and revalidate its success payload. */
export function readDataStudioOperationResult<T>(
  value: unknown,
  readSuccess: (candidate: unknown) => T,
): T {
  const record = resultRecord(value);
  if (record.ok === true && Object.hasOwn(record, 'value')) {
    return readSuccess(record.value);
  }
  if (record.ok !== false || !isDataStudioErrorCode(record.code)) throw corrupt();
  if (typeof record.retryable !== 'boolean' || !isOutcome(record.outcome)) throw corrupt();
  const currentRevision = record.currentRevision;
  try {
    throw new DataStudioError(record.code, 'Data Studio operation was rejected.', {
      retryable: record.retryable,
      outcome: record.outcome,
      ...(positiveIntegerOrUndefined(currentRevision) === undefined
        ? {}
        : { details: { currentRevision: currentRevision as number } }),
    });
  } catch (error) {
    if (error instanceof DataStudioError) throw error;
    throw corrupt();
  }
}

export function readDataStudioTable(value: unknown): DataStudioTable {
  const record = resultRecord(value);
  const tableId = canonicalId(record.tableId, 'Data Studio table id');
  const key = canonicalTableKey(record.key);
  const name = canonicalTableName(record.name);
  const description = nullableString(record.description, 2_000);
  if (record.status !== 'active' && record.status !== 'archived') throw corrupt();
  const schema = normalizeDataStudioSchema(record.schema);
  const schemaRevision = positiveInteger(record.schemaRevision);
  const revision = positiveInteger(record.revision);
  const rowCount = nonNegativeInteger(record.rowCount);
  const createdAt = nonNegativeInteger(record.createdAt);
  const updatedAt = nonNegativeInteger(record.updatedAt);
  if (schema.columns.length > DATA_STUDIO_MAX_COLUMNS
    || schemaRevision > revision
    || updatedAt < createdAt) throw corrupt();
  return Object.freeze({
    tableId,
    key,
    name,
    description,
    status: record.status,
    schema,
    schemaRevision,
    revision,
    rowCount,
    createdAt,
    updatedAt,
  });
}

export function readDataStudioTables(value: unknown): readonly DataStudioTableSummary[] {
  if (!Array.isArray(value) || value.length > DATA_STUDIO_MAX_TABLES) throw corrupt();
  return Object.freeze(value.map(readDataStudioTableSummary));
}

export function readDataStudioTableSummary(value: unknown): DataStudioTableSummary {
  const record = resultRecord(value);
  const schemaRevision = positiveInteger(record.schemaRevision);
  const revision = positiveInteger(record.revision);
  const createdAt = nonNegativeInteger(record.createdAt);
  const updatedAt = nonNegativeInteger(record.updatedAt);
  if (record.status !== 'active' && record.status !== 'archived') throw corrupt();
  if (schemaRevision > revision || updatedAt < createdAt) throw corrupt();
  return Object.freeze({
    tableId: canonicalId(record.tableId, 'Data Studio table id'),
    key: canonicalTableKey(record.key),
    name: canonicalTableName(record.name),
    description: nullableString(record.description, 2_000),
    status: record.status,
    schemaRevision,
    revision,
    rowCount: nonNegativeInteger(record.rowCount),
    createdAt,
    updatedAt,
  });
}

export function readDataStudioRow(value: unknown): DataStudioRow {
  const record = resultRecord(value);
  const createdAt = nonNegativeInteger(record.createdAt);
  const updatedAt = nonNegativeInteger(record.updatedAt);
  if (updatedAt < createdAt) throw corrupt();
  return Object.freeze({
    rowId: canonicalId(record.rowId, 'Data Studio row id'),
    tableId: canonicalId(record.tableId, 'Data Studio table id'),
    schemaRevision: positiveInteger(record.schemaRevision),
    revision: positiveInteger(record.revision),
    values: readUnboundValues(record.values),
    createdAt,
    updatedAt,
  });
}

export function readDataStudioRowPage(value: unknown): DataStudioRowPage {
  const record = resultRecord(value);
  if (!Array.isArray(record.rows)
    || record.rows.length > DATA_STUDIO_MAX_PAGE_SIZE) throw corrupt();
  const limit = positiveInteger(record.limit);
  const offset = nonNegativeInteger(record.offset);
  const total = nonNegativeInteger(record.total);
  const nextOffset = record.nextOffset === null
    ? null
    : nonNegativeInteger(record.nextOffset);
  if (limit > DATA_STUDIO_MAX_PAGE_SIZE || record.rows.length > limit) throw corrupt();
  if (nextOffset !== null
    && (nextOffset <= offset || nextOffset > total)) throw corrupt();
  return Object.freeze({
    rows: Object.freeze(record.rows.map(readDataStudioRow)),
    total,
    limit,
    offset,
    nextOffset,
  });
}

export function readDataStudioSchemaVersions(
  value: unknown,
): readonly DataStudioSchemaVersion[] {
  if (!Array.isArray(value)
    || value.length > DATA_STUDIO_MAX_SCHEMA_PAGE_SIZE) throw corrupt();
  return Object.freeze(value.map((candidate) => {
    const record = resultRecord(candidate);
    return Object.freeze({
      schemaVersionId: canonicalId(
        record.schemaVersionId,
        'Data Studio schema version id',
      ),
      tableId: canonicalId(record.tableId, 'Data Studio table id'),
      schemaRevision: positiveInteger(record.schemaRevision),
      schema: normalizeDataStudioSchema(record.schema),
      createdAt: nonNegativeInteger(record.createdAt),
    });
  }));
}

export function readDataStudioRowDeleteResult(
  value: unknown,
): DataStudioRowDeleteResult {
  const record = resultRecord(value);
  if (record.deleted !== true) throw corrupt();
  return Object.freeze({
    deleted: true,
    rowId: canonicalId(record.rowId, 'Data Studio row id'),
  });
}

function readUnboundValues(value: unknown): DataStudioRowValues {
  const record = resultRecord(value);
  const result: Record<string, DataStudioValue> = Object.create(null);
  for (const [columnId, candidate] of Object.entries(record)) {
    const normalizedId = normalizeDataStudioColumnId(columnId);
    if (normalizedId !== columnId) throw corrupt();
    result[columnId] = normalizeDataStudioValue(candidate);
  }
  return Object.freeze(result);
}

function resultRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw corrupt();
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw corrupt();
  return value as Record<string, unknown>;
}

function canonicalId(value: unknown, label: string): string {
  try {
    return normalizeDataStudioId(value, label);
  } catch {
    throw corrupt();
  }
}

function canonicalTableKey(value: unknown): string {
  try {
    const normalized = normalizeDataStudioTableKey(value);
    if (normalized !== value) throw corrupt();
    return normalized;
  } catch {
    throw corrupt();
  }
}

function canonicalTableName(value: unknown): string {
  try {
    const normalized = normalizeDataStudioTableName(value);
    if (normalized !== value) throw corrupt();
    return normalized;
  } catch {
    throw corrupt();
  }
}

function nullableString(value: unknown, maximum: number): string | null {
  if (value === null) return null;
  if (typeof value !== 'string'
    || value.length < 1
    || value.length > maximum
    || value.trim() !== value) throw corrupt();
  return value;
}

function positiveInteger(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) throw corrupt();
  return value as number;
}

function positiveIntegerOrUndefined(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  return positiveInteger(value);
}

function nonNegativeInteger(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw corrupt();
  return value as number;
}

function isOutcome(value: unknown): value is DataStudioOperationOutcome | null {
  return value === null
    || value === 'not-started'
    || value === 'not-committed'
    || value === 'unknown';
}

function corrupt(): DataStudioError {
  return new DataStudioError(
    'DATA_STUDIO_INTERNAL_ERROR',
    'Data Studio actor returned an invalid result.',
  );
}
