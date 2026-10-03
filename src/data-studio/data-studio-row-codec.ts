/** Schema-aware logical row admission and persistence encoding. */

import {
  DATA_STUDIO_MAX_ROW_VALUES_BYTES,
  type DataStudioRowValues,
  type DataStudioSchema,
  type DataStudioValue,
} from './data-studio-contracts';
import { DataStudioError } from './data-studio-error';
import {
  assertDataStudioUtf8Limit,
  canonicalDataStudioJson,
  invalidDataStudioValue,
  readDataStudioRecord,
} from './data-studio-codec-common';
import { normalizeDataStudioSchema } from './data-studio-schema-codec';
import {
  normalizeDataStudioValue,
  normalizeValueForDataStudioColumn,
} from './data-studio-value-codec';

export function normalizeDataStudioRowValues(
  schema: DataStudioSchema,
  value: unknown,
): DataStudioRowValues {
  const normalizedSchema = normalizeDataStudioSchema(schema);
  const input = readRowRecord(value, 'Data Studio row values must be a data object.');
  const columns = new Map(normalizedSchema.columns.map((column) => [
    column.columnId,
    column,
  ]));
  for (const columnId of Object.keys(input)) {
    if (!columns.has(columnId)) {
      throw invalidDataStudioValue('Data Studio row contains an unknown column id.');
    }
  }

  const result: Record<string, DataStudioValue> = Object.create(null);
  for (const column of normalizedSchema.columns) {
    if (Object.hasOwn(input, column.columnId)) {
      result[column.columnId] = normalizeValueForDataStudioColumn(
        column,
        input[column.columnId],
      );
    } else if (column.defaultValue !== undefined) {
      result[column.columnId] = normalizeDataStudioValue(column.defaultValue);
    } else if (column.required) {
      throw invalidDataStudioValue('Data Studio row is missing a required column.');
    }
  }
  return finishRow(result, 'Data Studio row values exceed their byte limit.');
}

/** Validate physically present cells without materializing later schema defaults. */
export function normalizeDataStudioStoredRowValues(
  schema: DataStudioSchema,
  value: unknown,
): DataStudioRowValues {
  const normalizedSchema = normalizeDataStudioSchema(schema);
  const input = readRowRecord(
    value,
    'Stored Data Studio row values must be a data object.',
  );
  const columns = new Map(normalizedSchema.columns.map((column) => [
    column.columnId,
    column,
  ]));
  const result: Record<string, DataStudioValue> = Object.create(null);
  for (const [columnId, candidate] of Object.entries(input)) {
    const column = columns.get(columnId);
    if (!column) {
      throw invalidDataStudioValue(
        'Stored Data Studio row contains an unknown column id.',
      );
    }
    result[columnId] = normalizeValueForDataStudioColumn(column, candidate);
  }
  return finishRow(
    result,
    'Stored Data Studio row values exceed their byte limit.',
  );
}

export function serializeDataStudioRowValues(
  schema: DataStudioSchema,
  value: unknown,
): string {
  const serialized = canonicalDataStudioJson(normalizeDataStudioRowValues(schema, value));
  assertDataStudioUtf8Limit(
    serialized,
    DATA_STUDIO_MAX_ROW_VALUES_BYTES,
    'Data Studio row values exceed their byte limit.',
  );
  return serialized;
}

export function parseDataStudioRowValues(
  schema: DataStudioSchema,
  text: string,
): DataStudioRowValues {
  if (typeof text !== 'string') {
    throw invalidDataStudioValue(
      'Data Studio row values must be encoded as JSON text.',
    );
  }
  assertDataStudioUtf8Limit(
    text,
    DATA_STUDIO_MAX_ROW_VALUES_BYTES,
    'Data Studio row values exceed their byte limit.',
  );
  try {
    return normalizeDataStudioStoredRowValues(schema, JSON.parse(text));
  } catch (error) {
    if (error instanceof DataStudioError) throw error;
    throw invalidDataStudioValue('Data Studio row value JSON is malformed.', error);
  }
}

function readRowRecord(value: unknown, message: string): Record<string, unknown> {
  try {
    return readDataStudioRecord(value);
  } catch (error) {
    if (error instanceof DataStudioError
      && error.code === 'DATA_STUDIO_LIMIT_EXCEEDED') throw error;
    throw invalidDataStudioValue(message, error);
  }
}

function finishRow(
  result: Record<string, DataStudioValue>,
  message: string,
): DataStudioRowValues {
  const normalized = Object.freeze(result);
  assertDataStudioUtf8Limit(
    canonicalDataStudioJson(normalized),
    DATA_STUDIO_MAX_ROW_VALUES_BYTES,
    message,
  );
  return normalized;
}
