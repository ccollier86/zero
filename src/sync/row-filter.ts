/**
 * row-filter.ts
 *
 * Owns projection of ReactiveDB rows and changes through per-connection sync
 * row filters. This file keeps filtered snapshot/catchup/live behavior
 * consistent; it does not evaluate auth policy or send WebSocket messages.
 */

import type { Change, ChangeOp, Row, SyncRowFilter } from './types';

/** Wire-compatible change payload after row-filter projection. */
export interface ProjectedSyncChange {
  seq: number;
  table: string;
  op: ChangeOp;
  rowId: string;
  row: Row | null;
  ts: number;
}

/** Return only visible rows, applying any wire projection after authorization. */
export function filterSyncRows(rows: readonly Row[], filter?: SyncRowFilter): Row[] {
  if (!filter) return [...rows];
  return rows
    .filter((row) => filter.matches(row))
    .map((row) => projectRow(row, filter));
}

/**
 * Project one ReactiveDB change through an optional row filter.
 *
 * Updates that move a row out of scope become DELETE messages so clients remove
 * stale rows. Updates that move a row into scope remain UPDATE messages because
 * the client reducer upserts UPDATE rows into the local table.
 */
export function projectSyncChange(
  change: Change,
  filter?: SyncRowFilter
): ProjectedSyncChange | null {
  if (!filter) {
    return {
      seq: change.seq,
      table: change.table,
      op: change.op,
      rowId: change.rowId,
      row: change.row,
      ts: change.ts,
    };
  }

  const currentMatches = change.row ? filter.matches(change.row) : false;
  const previousMatches = change.previousRow ? filter.matches(change.previousRow) : false;

  if (change.op === 'INSERT') {
    if (!currentMatches) return null;
    return toProjectedChange(change, 'INSERT', projectNullableRow(change.row, filter));
  }

  if (change.op === 'UPDATE') {
    if (currentMatches) {
      return toProjectedChange(change, 'UPDATE', projectNullableRow(change.row, filter));
    }
    if (previousMatches) return toProjectedChange(change, 'DELETE', null);
    return null;
  }

  if (!previousMatches) return null;
  return toProjectedChange(change, 'DELETE', null);
}

function projectNullableRow(row: Row | null, filter: SyncRowFilter): Row | null {
  return row ? projectRow(row, filter) : null;
}

function projectRow(row: Row, filter: SyncRowFilter): Row {
  return filter.project?.(row) ?? row;
}

function toProjectedChange(
  change: Change,
  op: ChangeOp,
  row: Row | null
): ProjectedSyncChange {
  return {
    seq: change.seq,
    table: change.table,
    op,
    rowId: change.rowId,
    row,
    ts: change.ts,
  };
}
