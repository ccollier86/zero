/** Physical-row projection for the fixed Data Studio tenant schema. */

import type { Row } from '../sync/types';
import {
  encodeDataStudioCellValue,
  parseDataStudioRowValues,
  parseDataStudioSchema,
} from './data-studio-codec';
import type {
  DataStudioRow,
  DataStudioRowValues,
  DataStudioSchema,
  DataStudioSchemaVersion,
  DataStudioTable,
  DataStudioTableSummary,
} from './data-studio-contracts';
import { DataStudioError } from './data-studio-error';

export function dataStudioTableFromRow(row: Row): DataStudioTable {
  return Object.freeze({
    tableId: storedString(row, 'table_id'),
    key: storedString(row, 'key'),
    name: storedString(row, 'name'),
    description: storedNullableString(row, 'description'),
    status: storedStatus(row.status),
    schema: parseDataStudioSchema(storedString(row, 'schema_json')),
    schemaRevision: storedPositiveInteger(row, 'schema_revision'),
    revision: storedPositiveInteger(row, 'revision'),
    rowCount: storedNonNegativeInteger(row, 'row_count'),
    createdAt: storedNonNegativeInteger(row, 'created_at'),
    updatedAt: storedNonNegativeInteger(row, 'updated_at'),
  });
}

export function dataStudioTableSummaryFromRow(row: Row): DataStudioTableSummary {
  const table = dataStudioTableFromRow(row);
  const { schema: _schema, ...summary } = table;
  return Object.freeze(summary);
}

export function dataStudioRowFromRow(
  row: Row,
  schema: DataStudioSchema,
): DataStudioRow {
  return Object.freeze({
    rowId: storedString(row, 'row_id'),
    tableId: storedString(row, 'table_id'),
    schemaRevision: storedPositiveInteger(row, 'schema_revision'),
    revision: storedPositiveInteger(row, 'revision'),
    values: parseDataStudioRowValues(
      schema,
      storedString(row, 'values_json'),
    ),
    createdAt: storedNonNegativeInteger(row, 'created_at'),
    updatedAt: storedNonNegativeInteger(row, 'updated_at'),
  });
}

export function dataStudioSchemaVersionFromRow(
  row: Row,
): DataStudioSchemaVersion {
  return Object.freeze({
    schemaVersionId: storedString(row, 'schema_version_id'),
    tableId: storedString(row, 'table_id'),
    schemaRevision: storedPositiveInteger(row, 'schema_revision'),
    schema: parseDataStudioSchema(storedString(row, 'schema_json')),
    createdAt: storedNonNegativeInteger(row, 'created_at'),
  });
}

/** Build complete cell projection rows for one canonical logical row. */
export function dataStudioCellRows(input: {
  rowRecordId: string;
  schema: DataStudioSchema;
  values: DataStudioRowValues;
  userId: string;
  membershipId: string;
  now: number;
}): readonly Row[] {
  const columns = new Map(input.schema.columns.map((column) => [
    column.columnId,
    column,
  ]));
  return Object.freeze(Object.entries(input.values).map(([columnId, value]) => {
    const column = columns.get(columnId);
    if (!column) throw corrupt('Canonical Data Studio row contains an unknown column.');
    const encoded = encodeDataStudioCellValue(column, value);
    return Object.freeze({
      row_record_id: input.rowRecordId,
      column_id: columnId,
      value_json: encoded.valueJson,
      value_type: encoded.valueType,
      text_value: encoded.textValue,
      number_value: encoded.numberValue,
      boolean_value: encoded.booleanValue,
      updated_by_user_id: input.userId,
      updated_by_membership_id: input.membershipId,
      updated_at: input.now,
    });
  }));
}

export function storedString(row: Row, field: string): string {
  const value = row[field];
  if (typeof value !== 'string') throw corrupt('Stored Data Studio data is invalid.');
  return value;
}

export function storedPositiveInteger(row: Row, field: string): number {
  const value = row[field];
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw corrupt('Stored Data Studio data is invalid.');
  }
  return value as number;
}

export function storedNonNegativeInteger(row: Row, field: string): number {
  const value = row[field];
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw corrupt('Stored Data Studio data is invalid.');
  }
  return value as number;
}

function storedNullableString(row: Row, field: string): string | null {
  const value = row[field];
  if (value === null) return null;
  if (typeof value !== 'string') throw corrupt('Stored Data Studio data is invalid.');
  return value;
}

function storedStatus(value: unknown): 'active' | 'archived' {
  if (value !== 'active' && value !== 'archived') {
    throw corrupt('Stored Data Studio data is invalid.');
  }
  return value;
}

function corrupt(message: string): DataStudioError {
  return new DataStudioError('DATA_STUDIO_INTERNAL_ERROR', message);
}
