/**
 * data-studio-response.ts
 *
 * Closed response validation and normalization for the Data Studio browser
 * transport. Stored-row parsing intentionally never materializes defaults.
 */

import type {
  DataStudioRow,
  DataStudioRowValues,
  DataStudioSchema,
  DataStudioSchemaVersion,
  DataStudioTable,
  DataStudioTableSummary,
  DataStudioValue,
} from '../../data-studio/data-studio-contracts';
import {
  normalizeDataStudioSchema,
  normalizeDataStudioStoredRowValues,
  normalizeDataStudioValue,
} from '../../data-studio/data-studio-codec';
import type {
  DataStudioCapabilities,
  DataStudioRowPage,
} from './data-studio-client-types';

export function parseCapabilities(value: unknown): DataStudioCapabilities {
  const record = responseRecord(value, 'capabilities');
  const permissions = responseRecord(record.permissions, 'capabilities permissions');
  const limits = responseRecord(record.limits, 'capabilities limits');
  if (typeof record.enabled !== 'boolean'
    || record.scope !== 'organization'
    || typeof permissions.read !== 'boolean'
    || typeof permissions.write !== 'boolean'
    || typeof permissions.manage !== 'boolean') {
    throw invalidResponse('capabilities');
  }
  return Object.freeze({
    enabled: record.enabled,
    scope: 'organization' as const,
    permissions: Object.freeze({
      read: permissions.read,
      write: permissions.write,
      manage: permissions.manage,
    }),
    limits: Object.freeze({
      maxTables: responseNonNegativeInteger(limits.maxTables, 'capabilities'),
      maxRowsPerTable: responseNonNegativeInteger(limits.maxRowsPerTable, 'capabilities'),
      maxColumns: responseNonNegativeInteger(limits.maxColumns, 'capabilities'),
      maxPageSize: responseNonNegativeInteger(limits.maxPageSize, 'capabilities'),
      maxRowBytes: responsePositiveInteger(limits.maxRowBytes, 'capabilities'),
    }),
  });
}

export function parseTable(value: unknown): DataStudioTable {
  const summary = parseTableSummary(value);
  const record = responseRecord(value, 'table');
  return Object.freeze({
    ...summary,
    schema: normalizeDataStudioSchema(record.schema),
  });
}

export function parseTableSummary(value: unknown): DataStudioTableSummary {
  const record = responseRecord(value, 'table');
  if (typeof record.tableId !== 'string'
    || typeof record.key !== 'string'
    || typeof record.name !== 'string'
    || (record.description !== null && typeof record.description !== 'string')
    || (record.status !== 'active' && record.status !== 'archived')) {
    throw invalidResponse('table');
  }
  return Object.freeze({
    tableId: record.tableId,
    key: record.key,
    name: record.name,
    description: record.description,
    status: record.status,
    schemaRevision: responsePositiveInteger(record.schemaRevision, 'table'),
    revision: responsePositiveInteger(record.revision, 'table'),
    rowCount: responseNonNegativeInteger(record.rowCount, 'table'),
    createdAt: responseTimestamp(record.createdAt, 'table'),
    updatedAt: responseTimestamp(record.updatedAt, 'table'),
  });
}

export function tableSummary(table: DataStudioTable): DataStudioTableSummary {
  const { schema: _schema, ...summary } = table;
  return Object.freeze(summary);
}

export function parseRow(value: unknown, schema?: DataStudioSchema): DataStudioRow {
  const record = responseRecord(value, 'row');
  if (typeof record.rowId !== 'string' || typeof record.tableId !== 'string') {
    throw invalidResponse('row');
  }
  const values = schema
    ? normalizeDataStudioStoredRowValues(schema, record.values)
    : parseUnboundRowValues(record.values);
  return Object.freeze({
    rowId: record.rowId,
    tableId: record.tableId,
    schemaRevision: responsePositiveInteger(record.schemaRevision, 'row'),
    revision: responsePositiveInteger(record.revision, 'row'),
    values,
    createdAt: responseTimestamp(record.createdAt, 'row'),
    updatedAt: responseTimestamp(record.updatedAt, 'row'),
  });
}

export function parseRowPage(value: unknown, schema?: DataStudioSchema): DataStudioRowPage {
  const record = responseRecord(value, 'row page');
  const total = responseNonNegativeInteger(record.total, 'row page');
  const limit = responsePositiveInteger(record.limit, 'row page');
  const offset = responseNonNegativeInteger(record.offset, 'row page');
  const nextOffset = record.nextOffset === null
    ? null
    : responseNonNegativeInteger(record.nextOffset, 'row page');
  if (nextOffset !== null && (nextOffset <= offset || nextOffset > total)) {
    throw invalidResponse('row page');
  }
  const rows = responseArray(record.rows, 'row page').map((row) => parseRow(row, schema));
  if (rows.length > limit) throw invalidResponse('row page');
  return Object.freeze({
    rows: Object.freeze(rows),
    total,
    limit,
    offset,
    nextOffset,
    ...(record.readSequence === undefined ? {} : {
      readSequence: responseNonNegativeInteger(record.readSequence, 'row page'),
    }),
  });
}

export function parseSchemaVersion(value: unknown): DataStudioSchemaVersion {
  const record = responseRecord(value, 'schema version');
  if (typeof record.schemaVersionId !== 'string' || typeof record.tableId !== 'string') {
    throw invalidResponse('schema version');
  }
  return Object.freeze({
    schemaVersionId: record.schemaVersionId,
    tableId: record.tableId,
    schemaRevision: responsePositiveInteger(record.schemaRevision, 'schema version'),
    schema: normalizeDataStudioSchema(record.schema),
    createdAt: responseTimestamp(record.createdAt, 'schema version'),
  });
}

export function responseRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) throw invalidResponse(label);
  return value;
}

export function responseArray(value: unknown, label: string): readonly unknown[] {
  if (!Array.isArray(value)) throw invalidResponse(label);
  return value;
}

export function invalidResponse(label: string): TypeError {
  return new TypeError(`Invalid Data Studio ${label} response.`);
}

function parseUnboundRowValues(value: unknown): DataStudioRowValues {
  const record = responseRecord(value, 'row values');
  const result: Record<string, DataStudioValue> = Object.create(null);
  for (const [columnId, item] of Object.entries(record)) {
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/u.test(columnId)
      || columnId === 'constructor'
      || columnId === 'prototype'
      || columnId === '__proto__') {
      throw invalidResponse('row values');
    }
    result[columnId] = normalizeDataStudioValue(item);
  }
  return Object.freeze(result);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function responsePositiveInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) throw invalidResponse(label);
  return value as number;
}

function responseNonNegativeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw invalidResponse(label);
  return value as number;
}

function responseTimestamp(value: unknown, label: string): number {
  return responseNonNegativeInteger(value, label);
}
