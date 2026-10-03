/** Atomic derived-count maintenance for bounded schema evolution checks. */

import type { DatabaseWriteCommandCapability } from '../databases/database-realm';
import type { Row } from '../sync/types';
import type { DataStudioRowValues } from './data-studio-contracts';
import { DataStudioError } from './data-studio-error';
import { DATA_STUDIO_COLUMN_STATS_TABLE_NAME } from './data-studio-tenant-schema';

export interface DataStudioColumnStats {
  readonly exists: boolean;
  readonly valueCount: number;
  readonly nonNullCount: number;
}

export function getDataStudioColumnStats(
  db: DatabaseWriteCommandCapability,
  tableId: string,
  columnId: string,
): DataStudioColumnStats {
  const row = db.queryByIdentity(DATA_STUDIO_COLUMN_STATS_TABLE_NAME, {
    table_id: tableId,
    column_id: columnId,
  });
  if (!row) return Object.freeze({ exists: false, valueCount: 0, nonNullCount: 0 });
  return Object.freeze({
    exists: true,
    valueCount: storedCount(row, 'value_count'),
    nonNullCount: storedCount(row, 'non_null_count'),
  });
}

/** Reserve a stable column id even while it has no stored values. */
export function reserveDataStudioColumnId(
  db: DatabaseWriteCommandCapability,
  tableId: string,
  columnId: string,
  now: number,
): void {
  const identity = { table_id: tableId, column_id: columnId };
  if (db.queryByIdentity(DATA_STUDIO_COLUMN_STATS_TABLE_NAME, identity)) return;
  db.createStrict(DATA_STUDIO_COLUMN_STATS_TABLE_NAME, {
    stat_id: db.identityKey(DATA_STUDIO_COLUMN_STATS_TABLE_NAME, identity),
    ...identity,
    value_count: 0,
    non_null_count: 0,
    updated_at: now,
  });
}

/** Apply the exact presence/non-null delta between two canonical row payloads. */
export function updateDataStudioColumnStats(
  db: DatabaseWriteCommandCapability,
  input: {
    tableId: string;
    previous: DataStudioRowValues;
    next: DataStudioRowValues;
    now: number;
  },
): void {
  const columnIds = new Set([
    ...Object.keys(input.previous),
    ...Object.keys(input.next),
  ]);
  for (const columnId of columnIds) {
    const previousPresent = Object.hasOwn(input.previous, columnId);
    const nextPresent = Object.hasOwn(input.next, columnId);
    const valueDelta = Number(nextPresent) - Number(previousPresent);
    const nonNullDelta = Number(nextPresent && input.next[columnId] !== null)
      - Number(previousPresent && input.previous[columnId] !== null);
    if (valueDelta === 0 && nonNullDelta === 0) continue;
    applyDelta(db, input.tableId, columnId, valueDelta, nonNullDelta, input.now);
  }
}

function applyDelta(
  db: DatabaseWriteCommandCapability,
  tableId: string,
  columnId: string,
  valueDelta: number,
  nonNullDelta: number,
  now: number,
): void {
  const identity = { table_id: tableId, column_id: columnId };
  const current = db.queryByIdentity(DATA_STUDIO_COLUMN_STATS_TABLE_NAME, identity);
  const valueCount = (current ? storedCount(current, 'value_count') : 0) + valueDelta;
  const nonNullCount = (current ? storedCount(current, 'non_null_count') : 0)
    + nonNullDelta;
  if (valueCount < 0 || nonNullCount < 0 || nonNullCount > valueCount) {
    throw corrupt();
  }
  if (current) {
    db.updateByIdentity(DATA_STUDIO_COLUMN_STATS_TABLE_NAME, identity, {
      value_count: valueCount,
      non_null_count: nonNullCount,
      updated_at: now,
    });
    return;
  }
  db.createStrict(DATA_STUDIO_COLUMN_STATS_TABLE_NAME, {
    stat_id: db.identityKey(DATA_STUDIO_COLUMN_STATS_TABLE_NAME, identity),
    ...identity,
    value_count: valueCount,
    non_null_count: nonNullCount,
    updated_at: now,
  });
}

function storedCount(row: Row, field: string): number {
  const value = row[field];
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw corrupt();
  return value as number;
}

function corrupt(): DataStudioError {
  return new DataStudioError(
    'DATA_STUDIO_INTERNAL_ERROR',
    'Data Studio column statistics are inconsistent.',
  );
}
