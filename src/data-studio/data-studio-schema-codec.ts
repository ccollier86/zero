/** Logical Data Studio schema admission and canonical serialization. */

import {
  DATA_STUDIO_COLUMN_TYPES,
  DATA_STUDIO_MAX_COLUMN_DESCRIPTION_LENGTH,
  DATA_STUDIO_MAX_COLUMN_ID_LENGTH,
  DATA_STUDIO_MAX_COLUMN_KEY_LENGTH,
  DATA_STUDIO_MAX_COLUMN_LABEL_LENGTH,
  DATA_STUDIO_MAX_COLUMNS,
  DATA_STUDIO_MAX_SCHEMA_BYTES,
  DATA_STUDIO_SCHEMA_VERSION,
  type DataStudioColumn,
  type DataStudioColumnType,
  type DataStudioSchema,
} from './data-studio-contracts';
import { DataStudioError } from './data-studio-error';
import {
  assertDataStudioUtf8Limit,
  assertDenseDataStudioArray,
  boundedDataStudioDisplayString,
  boundedDataStudioString,
  canonicalDataStudioJson,
  DATA_STUDIO_BLOCKED_OBJECT_KEYS,
  dataStudioLimitExceeded,
  invalidDataStudioSchema,
  readClosedDataStudioRecord,
} from './data-studio-codec-common';
import { normalizeValueForDataStudioColumn } from './data-studio-value-codec';

const COLUMN_TYPE_SET: ReadonlySet<string> = new Set(DATA_STUDIO_COLUMN_TYPES);
const COLUMN_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/u;
const COLUMN_KEY_PATTERN = /^[a-z][a-z0-9_]{0,63}$/u;
const SCHEMA_KEYS = new Set(['version', 'columns']);
const COLUMN_KEYS = new Set([
  'columnId', 'key', 'label', 'type', 'required', 'description', 'defaultValue',
]);

export function normalizeDataStudioSchema(value: unknown): DataStudioSchema {
  try {
    const record = readClosedDataStudioRecord(value, SCHEMA_KEYS, 'schema');
    if (record.version !== DATA_STUDIO_SCHEMA_VERSION) {
      throw invalidDataStudioSchema('Data Studio schema version is unsupported.');
    }
    if (!Array.isArray(record.columns)) {
      throw invalidDataStudioSchema('Data Studio schema columns must be an array.');
    }
    assertDenseDataStudioArray(record.columns, 'schema columns');
    if (record.columns.length > DATA_STUDIO_MAX_COLUMNS) {
      throw dataStudioLimitExceeded('Data Studio schema has too many columns.');
    }

    const columnIds = new Set<string>();
    const keys = new Set<string>();
    const columns = record.columns.map((candidate) => {
      const column = normalizeDataStudioColumn(candidate);
      const foldedId = column.columnId.toLowerCase();
      if (columnIds.has(foldedId)) {
        throw invalidDataStudioSchema(
          'Data Studio schema contains a duplicate column id.',
        );
      }
      if (keys.has(column.key)) {
        throw invalidDataStudioSchema(
          'Data Studio schema contains a duplicate column key.',
        );
      }
      columnIds.add(foldedId);
      keys.add(column.key);
      return column;
    });

    const result: DataStudioSchema = Object.freeze({
      version: DATA_STUDIO_SCHEMA_VERSION,
      columns: Object.freeze(columns),
    });
    assertDataStudioUtf8Limit(
      canonicalDataStudioJson(result),
      DATA_STUDIO_MAX_SCHEMA_BYTES,
      'Data Studio schema exceeds its byte limit.',
    );
    return result;
  } catch (error) {
    if (error instanceof DataStudioError) {
      if (error.code === 'DATA_STUDIO_LIMIT_EXCEEDED'
        || error.code === 'DATA_STUDIO_SCHEMA_INVALID') throw error;
      throw invalidDataStudioSchema('Data Studio schema is invalid.', error);
    }
    throw invalidDataStudioSchema('Data Studio schema is invalid.', error);
  }
}

export function serializeDataStudioSchema(value: unknown): string {
  const serialized = canonicalDataStudioJson(normalizeDataStudioSchema(value));
  assertDataStudioUtf8Limit(
    serialized,
    DATA_STUDIO_MAX_SCHEMA_BYTES,
    'Data Studio schema exceeds its byte limit.',
  );
  return serialized;
}

export function parseDataStudioSchema(text: string): DataStudioSchema {
  if (typeof text !== 'string') {
    throw invalidDataStudioSchema('Data Studio schema must be encoded as JSON text.');
  }
  assertDataStudioUtf8Limit(
    text,
    DATA_STUDIO_MAX_SCHEMA_BYTES,
    'Data Studio schema exceeds its byte limit.',
  );
  try {
    return normalizeDataStudioSchema(JSON.parse(text));
  } catch (error) {
    if (error instanceof DataStudioError) throw error;
    throw invalidDataStudioSchema('Data Studio schema JSON is malformed.', error);
  }
}

/** Admit one standalone column through the same boundary as a full schema. */
export function normalizeDataStudioColumn(value: unknown): DataStudioColumn {
  const record = readClosedDataStudioRecord(value, COLUMN_KEYS, 'column');
  const columnId = boundedDataStudioString(
    record.columnId,
    DATA_STUDIO_MAX_COLUMN_ID_LENGTH,
    'Data Studio column id is invalid.',
  );
  if (!COLUMN_ID_PATTERN.test(columnId)
    || DATA_STUDIO_BLOCKED_OBJECT_KEYS.has(columnId)) {
    throw invalidDataStudioSchema('Data Studio column id is invalid.');
  }
  const key = boundedDataStudioString(
    record.key,
    DATA_STUDIO_MAX_COLUMN_KEY_LENGTH,
    'Data Studio column key is invalid.',
  );
  if (!COLUMN_KEY_PATTERN.test(key) || DATA_STUDIO_BLOCKED_OBJECT_KEYS.has(key)) {
    throw invalidDataStudioSchema('Data Studio column key is invalid.');
  }
  const label = boundedDataStudioDisplayString(
    record.label,
    DATA_STUDIO_MAX_COLUMN_LABEL_LENGTH,
    'Data Studio column label is invalid.',
  );
  if (typeof record.type !== 'string' || !COLUMN_TYPE_SET.has(record.type)) {
    throw invalidDataStudioSchema('Data Studio column type is invalid.');
  }
  if (typeof record.required !== 'boolean') {
    throw invalidDataStudioSchema('Data Studio column required flag is invalid.');
  }

  let description: string | undefined;
  if (Object.hasOwn(record, 'description')) {
    description = boundedDataStudioDisplayString(
      record.description,
      DATA_STUDIO_MAX_COLUMN_DESCRIPTION_LENGTH,
      'Data Studio column description is invalid.',
    );
  }
  const base: DataStudioColumn = {
    columnId,
    key,
    label,
    type: record.type as DataStudioColumnType,
    required: record.required,
    ...(description === undefined ? {} : { description }),
  };
  return Object.freeze(Object.hasOwn(record, 'defaultValue')
    ? {
        ...base,
        defaultValue: normalizeValueForDataStudioColumn(base, record.defaultValue),
      }
    : base);
}
