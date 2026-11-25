/** Fixed022 occupancy bridge. Promoted child heads replace old day-cell
 * projections; both unfinished claim families remain conservative reservations.
 * Returns existence only: no private identifiers or availability certificate. */
import type { DatabaseReadQueryContext } from '../databases/database-read-query-capability';
import { CalendarError } from './error';
import { admitCalendarSeriesOccupancyInput, type CalendarSeriesOccupancyResult } from './series-occupancy';
import { CALENDAR_SERIES_MATERIALIZATION_TABLES as n } from './realm-series-materialization-migration';
import { CALENDAR_SERIES_CHILD_TABLES as t, CALENDAR_SERIES_CHILD_LIMITS } from './realm-series-children-migration';
import { calendarSeriesCurrentChildHeadSql, calendarSeriesQualifiedChildViewSql } from './series-child-selection-sql';
import { calendarOverlapSearchStart } from './time';

const DAY_MS = 86_400_000;
export function readCalendarSelectedSeriesOccupancy(context: DatabaseReadQueryContext, requested: unknown): CalendarSeriesOccupancyResult {
  const r = admitCalendarSeriesOccupancyInput(requested), marks = r.resourceIds.map(() => '?').join(','), excluded = r.excludeVersionIds!;
  const marker = context.database.query<{ version: number }>(`SELECT version FROM ${t.state} WHERE id='application' LIMIT 1`).get();
  if (marker?.version !== 22) throw new CalendarError('CALENDAR_NOT_READY');
  const exclusion = (alias: string, column = 'version_id') => excluded.length ? ` AND ${alias}.${column} NOT IN (${excluded.map(() => '?').join(',')})` : '';
  // Directory first: interval probes touch only bounded current resource/view
  // partitions, not every retained superseded view. No DISTINCT over day cells.
  const partitions = context.database.query<{ view_id: string; resource_id: string }>(`SELECT d.view_id,d.resource_id
    FROM ${t.directory} d JOIN ${t.current} c ON c.scope_id=d.scope_id AND c.series_id=d.series_id AND c.current_view_id=d.view_id
    JOIN calendar_series s ON s.scope_id=c.scope_id AND s.id=c.series_id
    WHERE d.scope_id=? AND d.resource_id IN (${marks}) AND ${calendarSeriesQualifiedChildViewSql(t, 's')}
    ORDER BY d.resource_id,d.view_id LIMIT ?`).all(r.scopeId, ...r.resourceIds, CALENDAR_SERIES_CHILD_LIMITS.selectedPartitionsPerRead + 1);
  if (partitions.length > CALENDAR_SERIES_CHILD_LIMITS.selectedPartitionsPerRead) throw new CalendarError('CALENDAR_CAPACITY');
  let selected = false;
  for (const part of partitions) {
    selected = context.database.query(`SELECT 1 AS present FROM ${t.resources} m CROSS JOIN ${t.heads} h
      WHERE m.scope_id=? AND m.view_id=? AND m.resource_id=? AND m.occupies=1
        AND m.occupied_from_ms>=? AND m.occupied_from_ms<? AND m.occupied_until_ms>?
        AND h.id=m.head_id AND h.scope_id=m.scope_id AND h.view_id=m.view_id AND h.appointment_id=m.appointment_id
        AND h.status='confirmed' AND h.version_id=m.version_id AND h.selection_revision=m.selection_revision
        AND ${calendarSeriesCurrentChildHeadSql(t, 'h', 'm')}${exclusion('m')} LIMIT 1`)
      .get(r.scopeId, part.view_id, part.resource_id, calendarOverlapSearchStart(r.occupiedStartMs), r.occupiedEndMs, r.occupiedStartMs, ...excluded) !== null;
    if (selected) break;
  }
  // An admitted but not yet promoted021 source retains its existing occupancy.
  // Once exactly promoted, only its selected022 heads count: cancelled or moved
  // children cannot be resurrected by stale021 cells. Readiness is NOT coverage.
  const firstCell = Math.floor(r.occupiedStartMs / DAY_MS) * DAY_MS, lastCell = Math.floor((r.occupiedEndMs - 1) / DAY_MS) * DAY_MS;
  const legacy = selected ? false : context.database.query(`SELECT 1 AS present FROM ${n.selectors} z
    JOIN calendar_series s ON s.id=z.series_id AND s.scope_id=z.scope_id AND s.published_publication_id=z.source_publication_id
    JOIN ${n.cellSets} x ON x.id=z.cell_set_id AND x.scope_id=z.scope_id AND x.series_id=z.series_id AND x.resource_id=z.resource_id AND x.cell_start_ms=z.cell_start_ms
    JOIN ${n.runState} q ON q.id=x.run_id AND q.scope_id=x.scope_id AND q.state='published'
    JOIN ${n.workingMembers} m ON m.selector_id=z.id AND m.cell_set_id=z.cell_set_id AND m.scope_id=z.scope_id AND m.resource_id=z.resource_id
    WHERE z.scope_id=? AND z.resource_id IN (${marks}) AND z.cell_start_ms>=? AND z.cell_start_ms<=?
      AND m.from_ms<? AND m.until_ms>? AND NOT ${calendarSeriesQualifiedChildViewSql(t, 's')}${exclusion('m')} LIMIT 1`)
    .get(r.scopeId, ...r.resourceIds, firstCell, lastCell, r.occupiedEndMs, r.occupiedStartMs, ...excluded) !== null;
  const nativePending = `FROM ${n.claims} c JOIN ${n.runs} p ON p.id=c.run_id AND p.scope_id=c.scope_id
    JOIN ${n.runState} q ON q.id=p.id AND q.scope_id=p.scope_id
    WHERE c.scope_id=? AND c.resource_id IN (${marks}) AND c.from_ms>=? AND c.from_ms<? AND c.until_ms>?
      AND q.state IN ('preparing','blocked','sealed','aborted')${exclusion('c')}`;
  const params = [r.scopeId, ...r.resourceIds, calendarOverlapSearchStart(r.occupiedStartMs), r.occupiedEndMs, r.occupiedStartMs, ...excluded];
  const nativeConflict = context.database.query(`SELECT 1 AS present ${nativePending} AND q.state<>'aborted' AND c.expires_ms>? AND p.expires_ms>? LIMIT 1`)
    .get(...params, r.nowMs, r.nowMs) !== null;
  const nativeReconcile = context.database.query(`SELECT 1 AS present ${nativePending} AND (q.state='aborted' OR c.expires_ms<=? OR p.expires_ms<=?) LIMIT 1`)
    .get(...params, r.nowMs, r.nowMs) !== null;
  // Published021 claims used to be redundant with the accepted day cells. A
  // later022 replacement can move/cancel that child before every physical old
  // claim is drained. The final SQL guard still honors the claim: do not show
  // false free time merely because its original run is published.
  const stalePublished = context.database.query(`SELECT 1 AS present FROM ${n.claims} c
    JOIN ${n.runs} p ON p.id=c.run_id AND p.scope_id=c.scope_id
    JOIN ${n.runState} q ON q.id=p.id AND q.scope_id=p.scope_id AND q.state='published'
    JOIN calendar_series s ON s.id=p.series_id AND s.scope_id=p.scope_id
    WHERE c.scope_id=? AND c.resource_id IN (${marks}) AND c.from_ms>=? AND c.from_ms<? AND c.until_ms>?
      AND ${calendarSeriesQualifiedChildViewSql(t, 's')}${exclusion('c')}
      AND NOT EXISTS(SELECT 1 FROM ${n.versions} origin CROSS JOIN ${t.current} pointer
        CROSS JOIN ${t.heads} h CROSS JOIN ${t.resources} m
        WHERE origin.id=c.version_id AND origin.scope_id=c.scope_id AND origin.series_id=p.series_id
          AND pointer.id=p.series_id AND pointer.scope_id=p.scope_id
          AND h.scope_id=c.scope_id AND h.view_id=pointer.current_view_id AND h.appointment_id=origin.occurrence_id
          AND m.scope_id=c.scope_id AND m.view_id=pointer.current_view_id AND m.appointment_id=h.appointment_id
          AND m.selection_revision=h.selection_revision AND m.resource_id=c.resource_id AND m.version_id=c.version_id
          AND m.occupies=1 AND h.status='confirmed' AND ${calendarSeriesCurrentChildHeadSql(t, 'h', 'm')}) LIMIT 1`)
    .get(...params) !== null;
  const childPending = `FROM ${t.claims} c JOIN ${t.changes} p ON p.id=c.change_id AND p.scope_id=c.scope_id
    WHERE c.scope_id=? AND c.resource_id IN (${marks}) AND c.occupied_from_ms>=? AND c.occupied_from_ms<? AND c.occupied_until_ms>?
      AND p.state IN ('preparing','blocked','aborted')${exclusion('c', 'variant_id')}`;
  const childConflict = context.database.query(`SELECT 1 AS present ${childPending} AND p.state<>'aborted' AND c.expires_ms>? AND p.expires_ms>? LIMIT 1`)
    .get(...params, r.nowMs, r.nowMs) !== null;
  const childReconcile = context.database.query(`SELECT 1 AS present ${childPending} AND (p.state='aborted' OR c.expires_ms<=? OR p.expires_ms<=?) LIMIT 1`)
    .get(...params, r.nowMs, r.nowMs) !== null;
  return Object.freeze({ currentConflict: selected || legacy, pendingConflict: nativeConflict || childConflict,
    reconciliationNeeded: nativeReconcile || stalePublished || childReconcile });
}
