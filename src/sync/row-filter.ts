/**
 * row-filter.ts
 *
 * Owns projection of ReactiveDB rows and changes through per-connection sync
 * row filters. This file keeps filtered snapshot/catchup/live behavior
 * consistent; it does not evaluate auth policy or send WebSocket messages.
 */

import type {
  Change,
  ChangeOp,
  Row,
  SyncRowFilter,
  SyncRowProjector,
} from './types';

/** Wire-compatible change payload after row-filter projection. */
export interface ProjectedSyncChange {
  seq: number;
  table: string;
  op: ChangeOp;
  rowId: string;
  row: Row | null;
  ts: number;
}

/** Return only visible rows, applying wire projections after authorization. */
export function filterSyncRows(
  rows: readonly Row[],
  filter?: SyncRowFilter,
  projector?: SyncRowProjector,
): Row[] {
  const filtered = filter ? rows.filter((row) => filter.matches(row)) : rows;
  if (!filter?.project && !projector) return [...filtered];
  return filtered.map((row) => projectRow(row, filter, projector));
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
  filter?: SyncRowFilter,
  projector?: SyncRowProjector,
): ProjectedSyncChange | null {
  if (!filter) {
    return {
      seq: change.seq,
      table: change.table,
      op: change.op,
      rowId: change.rowId,
      row: change.row ? projectRow(change.row, undefined, projector) : change.row,
      ts: change.ts,
    };
  }

  const currentMatches = change.row ? filter.matches(change.row) : false;
  const previousMatches = change.previousRow ? filter.matches(change.previousRow) : false;

  if (change.op === 'INSERT') {
    if (!currentMatches) return null;
    return toProjectedChange(
      change,
      'INSERT',
      projectNullableRow(change.row, filter, projector),
    );
  }

  if (change.op === 'UPDATE') {
    if (currentMatches) {
      return toProjectedChange(
        change,
        'UPDATE',
        projectNullableRow(change.row, filter, projector),
      );
    }
    if (previousMatches) return toProjectedChange(change, 'DELETE', null);
    return null;
  }

  if (!previousMatches) return null;
  return toProjectedChange(change, 'DELETE', null);
}

function projectNullableRow(
  row: Row | null,
  filter?: SyncRowFilter,
  projector?: SyncRowProjector,
): Row | null {
  return row ? projectRow(row, filter, projector) : null;
}

function projectRow(
  row: Row,
  filter?: SyncRowFilter,
  projector?: SyncRowProjector,
): Row {
  const filteredProjection = filter?.project?.(row) ?? row;
  return projector?.project(filteredProjection) ?? filteredProjection;
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
