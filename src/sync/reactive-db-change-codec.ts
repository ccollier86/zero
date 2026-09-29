/**
 * Canonical durable-change encoding and validation for ReactiveDB.
 *
 * This module owns the on-disk v1 payload contract. Keeping it independent of
 * the ReactiveDB facade makes replay, startup validation, and replica polling
 * use exactly the same decoder and history rules.
 */

import type { Change, ChangeRow, Row } from './types';

export const CHANGE_LOG_SCHEMA_VERSION = 1;
export const CHANGE_LOG_FORMAT_VERSION = 1;
export const CHANGE_LOG_MIN_READER_FORMAT = 0;

export interface ChangeLogStateRow {
  singleton: number;
  schema_version: number;
  write_format: number;
  min_reader_format: number;
  seq: number;
  prune_through: number;
}

export function cloneChange(change: Change): Change {
  return {
    seq: change.seq,
    table: change.table,
    op: change.op,
    rowId: change.rowId,
    row: cloneCanonicalRow(change.row),
    previousRow: cloneCanonicalRow(change.previousRow ?? null),
    ts: change.ts,
  };
}

function cloneCanonicalRow(row: Row | null): Row | null {
  return row === null ? null : JSON.parse(JSON.stringify(row)) as Row;
}

export function deserializeChangeRow(row: ChangeRow): Change {
  if (!Number.isSafeInteger(row.seq) || row.seq <= 0) {
    throw new Error('ZERO_SYNC_LOG_FORMAT_INCOMPATIBLE: invalid change sequence');
  }
  const legacyFormat = row.format_version === null
    && row.format_version_type === 'null';
  const currentFormat = row.format_version === CHANGE_LOG_FORMAT_VERSION
    && row.format_version_type === 'integer';
  if (!legacyFormat && !currentFormat) {
    throw new Error(
      `ZERO_SYNC_LOG_FORMAT_INCOMPATIBLE: unsupported format ${String(row.format_version)}`,
    );
  }
  if (row.op !== 'INSERT' && row.op !== 'UPDATE' && row.op !== 'DELETE') {
    throw new Error(`ZERO_SYNC_LOG_FORMAT_INCOMPATIBLE: invalid operation ${row.op}`);
  }
  if (typeof row.tbl !== 'string' || row.tbl.length === 0) {
    throw new Error('ZERO_SYNC_LOG_FORMAT_INCOMPATIBLE: invalid table name');
  }
  if (typeof row.row_id !== 'string' || row.row_id.length === 0) {
    throw new Error('ZERO_SYNC_LOG_FORMAT_INCOMPATIBLE: invalid row id');
  }
  if (!isNonNegativeSafeInteger(row.ts)) {
    throw new Error('ZERO_SYNC_LOG_FORMAT_INCOMPATIBLE: invalid timestamp');
  }
  if (row.origin !== null
    && row.origin !== undefined
    && typeof row.origin !== 'string') {
    throw new Error('ZERO_SYNC_LOG_FORMAT_INCOMPATIBLE: invalid origin');
  }

  const data = deserializeChangeObject(row.data, 'data');
  const previousData = deserializeChangeObject(row.previous_data ?? null, 'previous_data');
  if ((row.op === 'INSERT' || row.op === 'UPDATE') && data === null) {
    throw new Error(`ZERO_SYNC_LOG_FORMAT_INCOMPATIBLE: ${row.op} requires row data`);
  }
  if (row.op === 'DELETE' && data !== null) {
    throw new Error('ZERO_SYNC_LOG_FORMAT_INCOMPATIBLE: DELETE row data must be null');
  }
  if (currentFormat) {
    if (row.op === 'INSERT' && previousData !== null) {
      throw new Error('ZERO_SYNC_LOG_FORMAT_INCOMPATIBLE: INSERT previous_data must be null');
    }
    if ((row.op === 'UPDATE' || row.op === 'DELETE') && previousData === null) {
      throw new Error(`ZERO_SYNC_LOG_FORMAT_INCOMPATIBLE: ${row.op} requires previous_data`);
    }
  }
  return {
    seq: row.seq,
    table: row.tbl,
    op: row.op,
    rowId: row.row_id,
    row: data,
    previousRow: previousData,
    ts: row.ts,
  };
}

function deserializeChangeObject(value: unknown, field: string): Row | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') {
    throw new Error(`ZERO_SYNC_LOG_FORMAT_INCOMPATIBLE: invalid ${field}`);
  }
  let decoded: unknown;
  try {
    decoded = JSON.parse(value);
  } catch {
    throw new Error(`ZERO_SYNC_LOG_FORMAT_INCOMPATIBLE: invalid ${field} JSON`);
  }
  if (decoded === null || typeof decoded !== 'object' || Array.isArray(decoded)) {
    throw new Error(`ZERO_SYNC_LOG_FORMAT_INCOMPATIBLE: ${field} must be a JSON object`);
  }
  if (!isSerializableRowObject(decoded)) {
    throw new Error(
      `ZERO_SYNC_LOG_FORMAT_INCOMPATIBLE: ${field} must be a canonical JSON object`,
    );
  }
  return decoded as Row;
}

export function isSerializableRowObject(value: unknown): value is Row {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && isCanonicalJsonValue(value, new Set());
}

export function canonicalizeChangeRow(value: Row | null, field: string): Row | null {
  if (value === null) return null;
  if (!isSerializableRowObject(value)) {
    throw new Error(
      `ReactiveDB change ${field} must be a lossless JSON object`,
    );
  }
  // Use the exact representation persisted in `_changes` for local listeners
  // too. This also detaches listener payloads from caller-owned objects.
  return JSON.parse(JSON.stringify(value)) as Row;
}

function isCanonicalJsonValue(value: unknown, ancestors: Set<object>): boolean {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return true;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) && !Object.is(value, -0);
  }
  if (typeof value !== 'object') return false;
  if (ancestors.has(value)) return false;

  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      const keys = Reflect.ownKeys(value);
      if (keys.length !== value.length + 1 || !keys.includes('length')) return false;
      for (let index = 0; index < value.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (!descriptor?.enumerable || !('value' in descriptor)
          || !isCanonicalJsonValue(descriptor.value, ancestors)) {
          return false;
        }
      }
      return true;
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return false;
    const keys = Reflect.ownKeys(value);
    if (keys.some((key) => typeof key !== 'string')) return false;
    for (const key of keys as string[]) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor?.enumerable || !('value' in descriptor)
        || !isCanonicalJsonValue(descriptor.value, ancestors)) {
        return false;
      }
    }
    return true;
  } finally {
    ancestors.delete(value);
  }
}

export function validateRetainedChangeRows(rows: readonly ChangeRow[]): void {
  let previousSeq: number | null = null;
  let observedVersionedRow = false;
  for (const row of rows) {
    deserializeChangeRow(row);
    if (previousSeq !== null && row.seq !== previousSeq + 1) {
      throw new Error('ZERO_SYNC_LOG_STATE_INVALID: retained change history is not contiguous');
    }
    if (row.format_version === CHANGE_LOG_FORMAT_VERSION) {
      observedVersionedRow = true;
    } else if (observedVersionedRow) {
      throw new Error(
        'ZERO_SYNC_LOG_STATE_INVALID: legacy history follows versioned history',
      );
    }
    previousSeq = row.seq;
  }
}

export function validateRetainedHistory(
  state: ChangeLogStateRow,
  rows: readonly ChangeRow[],
): void {
  validateRetainedChangeRows(rows);
  if (rows.length === 0) {
    if (state.prune_through !== state.seq) {
      throw new Error('ZERO_SYNC_LOG_STATE_INVALID: retained history is missing');
    }
    return;
  }
  const first = rows[0]!.seq;
  const last = rows.at(-1)!.seq;
  if (first !== state.prune_through + 1
    || last !== state.seq
    || rows.length !== state.seq - state.prune_through) {
    throw new Error('ZERO_SYNC_LOG_STATE_INVALID: retained history does not match log state');
  }
}

export function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

export function validateChangeLogStateRow(
  row: ChangeLogStateRow | null,
): ChangeLogStateRow {
  if (!row
    || row.singleton !== 1
    || row.schema_version !== CHANGE_LOG_SCHEMA_VERSION
    || row.write_format !== CHANGE_LOG_FORMAT_VERSION
    || row.min_reader_format !== CHANGE_LOG_MIN_READER_FORMAT
    || !isNonNegativeSafeInteger(row.seq)
    || !isNonNegativeSafeInteger(row.prune_through)
    || row.prune_through > row.seq) {
    throw new Error('ZERO_SYNC_LOG_STATE_INVALID: unsupported or malformed log state');
  }
  return {
    singleton: row.singleton,
    schema_version: row.schema_version,
    write_format: row.write_format,
    min_reader_format: row.min_reader_format,
    seq: row.seq,
    prune_through: row.prune_through,
  };
}

export function isChangeLogFormatIncompatibleError(error: unknown): boolean {
  return error instanceof Error
    && error.message.startsWith('ZERO_SYNC_LOG_FORMAT_INCOMPATIBLE:');
}
