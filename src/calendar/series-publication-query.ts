/** Fixed native publication preparation reads. Cursor arguments select bounded
 * read pages, never durable progress or booking/publication authority. Actual
 * commands derive them from their owned q.publication_cursor_json and recheck
 * its exact CAS plus current source/selector state in the real transaction. */
import { cloneDatabaseSerializableValue } from '../databases/database-operations';
import type { DatabaseReadQueryContext } from '../databases/database-read-query-capability';
import type { Row } from '../sync/types';
import { CALENDAR_SERIES_MATERIALIZATION_TABLES as t } from './realm-series-materialization-migration';
import { CalendarError } from './error';
import { calendarInteger, calendarKey, calendarRecord, calendarScope } from './validation';

export const CALENDAR_SERIES_PUBLICATION_QUERY = 'calendar.series.publicationWork';
export interface CalendarSeriesPublicationWorkInput {
  readonly scopeId: string; readonly ownerId: string; readonly seriesId: string; readonly runId: string;
  readonly kind: 'cell' | 'carry' | 'members' | 'final' | 'cleanup';
  readonly after?: string; readonly cellSetId?: string; readonly selectorId?: string; readonly baseCellSetId?: string; readonly limit?: number;
}
export type CalendarSeriesPublicationWork =
  | { readonly cell: Row | null; readonly selector: Row | null; readonly builder: Row | null; readonly seal: Row | null }
  | { readonly selector: Row | null; readonly items: readonly Row[]; readonly more: boolean }
  | { readonly items: readonly Row[]; readonly more: boolean }
  | { readonly items: readonly { readonly cell: Row; readonly seal: Row; readonly selector: Row }[]; readonly more: boolean };
function invalid(): never { throw new CalendarError('CALENDAR_INPUT_INVALID'); }
function forbidden(): never { throw new CalendarError('CALENDAR_FORBIDDEN'); }
function state(): never { throw new CalendarError('CALENDAR_STATE_INVALID'); }
function frozen<T>(value: T): T { return cloneDatabaseSerializableValue(value) as T; }

export function readCalendarSeriesPublicationWork(context: DatabaseReadQueryContext, input: unknown): CalendarSeriesPublicationWork {
  const r = calendarRecord(cloneDatabaseSerializableValue(input), ['scopeId', 'ownerId', 'seriesId', 'runId', 'kind', 'after', 'cellSetId', 'selectorId', 'baseCellSetId', 'limit']);
  const scopeId = calendarScope(r.scopeId), ownerId = calendarKey(r.ownerId), seriesId = calendarKey(r.seriesId), runId = calendarKey(r.runId);
  const kind = r.kind, limit = calendarInteger(r.limit ?? 64, 1, 64), after = r.after === undefined ? '' : calendarKey(r.after);
  if (kind !== 'cell' && kind !== 'carry' && kind !== 'members' && kind !== 'final' && kind !== 'cleanup') return invalid();
  const db = context.database, owner = db.query<Row>("SELECT scope_id,owner_id FROM _calendar_owner WHERE id='application' LIMIT 1").get();
  if (owner?.scope_id !== scopeId || owner.owner_id !== ownerId) return forbidden();
  const source = db.query<Row>('SELECT id,scope_id,owner_id,source_id FROM calendar_series WHERE id=? AND scope_id=? LIMIT 1').get(seriesId, scopeId);
  if (!source || source.owner_id !== ownerId) return forbidden();
  const run = db.query<Row>(`SELECT id,scope_id,series_id,owner_id,source_id,source_publication_id FROM ${t.runs} WHERE id=? AND scope_id=? AND series_id=? LIMIT 1`).get(runId, scopeId, seriesId);
  if (!run || run.owner_id !== ownerId || run.source_id !== source.source_id) return forbidden();
  const head = db.query<Row>(`SELECT id,state FROM ${t.runState} WHERE id=? AND scope_id=? LIMIT 1`).get(runId, scopeId); if (!head) return state();
  if (kind === 'cleanup') {
    if (head.state === 'published') {
      // A new run's finite immutable manifest names exactly the superseded base
      // working projections it owns retiring. CROSS JOIN fixes manifest-first
      // planning; neither pagination nor GC scans all retained run history.
      const rows = db.query<Row>(`SELECT 'working-member' AS kind,m.id,m.scope_id,m.selector_id,m.cell_set_id,m.version_id
        FROM ${t.cellSeals} z INDEXED BY calendar_series_cell_seal_run
        CROSS JOIN ${t.workingMembers} m INDEXED BY calendar_series_working_member_page
        WHERE z.run_id=? AND z.scope_id=? AND z.base_selector_id IS NOT NULL
          AND m.selector_id=z.base_selector_id AND m.cell_set_id=z.base_cell_set_id AND m.scope_id=z.scope_id
          AND NOT EXISTS(SELECT 1 FROM ${t.selectors} x WHERE x.id=m.selector_id AND x.scope_id=m.scope_id AND x.cell_set_id=m.cell_set_id)
        ORDER BY m.id LIMIT ?`).all(runId, scopeId, limit + 1);
      return frozen({ items: rows.slice(0, limit), more: rows.length > limit });
    }
    if (head.state !== 'aborted') return frozen({ items: [], more: false });
    const rows = db.query<Row>(`SELECT 'working-member' AS kind,m.id,m.scope_id,m.selector_id,m.cell_set_id,m.version_id
      FROM ${t.cellSets} c INDEXED BY calendar_series_cell_set_scope_run
      CROSS JOIN ${t.workingMembers} m INDEXED BY calendar_series_working_member_cell_page
      WHERE c.scope_id=? AND c.run_id=? AND m.cell_set_id=c.id AND m.scope_id=c.scope_id
        AND NOT EXISTS(SELECT 1 FROM ${t.selectors} x JOIN calendar_series p ON p.id=x.series_id AND p.scope_id=x.scope_id AND p.published_publication_id=x.source_publication_id
          JOIN ${t.cellSets} z ON z.id=x.cell_set_id AND z.scope_id=x.scope_id JOIN ${t.runState} q ON q.id=z.run_id AND q.scope_id=z.scope_id AND q.state='published'
          WHERE x.id=m.selector_id AND x.scope_id=m.scope_id AND x.cell_set_id=m.cell_set_id)
      ORDER BY m.id LIMIT ?`).all(scopeId, runId, limit + 1);
    // Removing this final hidden member can make a selector header newly
    // eligible. Conservatively require one subsequent read to prove full EOF.
    if (rows.length) return frozen({ items: rows.slice(0, limit), more: true });
    const selectors = db.query<Row>(`SELECT 'selector' AS kind,s.id,s.scope_id,s.id AS selector_id,s.cell_set_id,NULL AS version_id
      FROM ${t.cellSets} c INDEXED BY calendar_series_cell_set_scope_run
      CROSS JOIN ${t.selectors} s INDEXED BY calendar_series_selector_cell
      WHERE c.scope_id=? AND c.run_id=? AND s.cell_set_id=c.id AND s.scope_id=c.scope_id
        AND NOT EXISTS(SELECT 1 FROM ${t.workingMembers} m WHERE m.selector_id=s.id)
      ORDER BY s.id LIMIT ?`).all(scopeId, runId, limit + 1);
    return frozen({ items: selectors.slice(0, limit), more: selectors.length > limit });
  }
  const ownedCell = (id: string) => {
    const cell = db.query<Row>(`SELECT * FROM ${t.cellSets} WHERE id=? AND scope_id=? AND run_id=? AND series_id=? LIMIT 1`).get(id, scopeId, runId, seriesId);
    if (!cell) return forbidden(); return cell;
  };
  const selectorFor = (cell: Row) => db.query<Row>(`SELECT * FROM ${t.selectors}
    WHERE scope_id=? AND series_id=? AND source_publication_id=? AND resource_id=? AND cell_start_ms=? LIMIT 1`)
    .get(scopeId, seriesId, String(run.source_publication_id), String(cell.resource_id), Number(cell.cell_start_ms));
  if (kind === 'cell') {
    const cell = db.query<Row>(`SELECT * FROM ${t.cellSets} WHERE scope_id=? AND run_id=? AND id>? ORDER BY id LIMIT 1`).get(scopeId, runId, after);
    if (!cell) return frozen({ cell: null, selector: null, builder: null, seal: null });
    if (cell.series_id !== seriesId) return state();
    return frozen({ cell, selector: selectorFor(cell),
      builder: db.query<Row>(`SELECT * FROM ${t.cellBuilders} WHERE id=? AND scope_id=? AND run_id=? LIMIT 1`).get(String(cell.id), scopeId, runId),
      seal: db.query<Row>(`SELECT * FROM ${t.cellSeals} WHERE cell_set_id=? AND scope_id=? AND run_id=? LIMIT 1`).get(String(cell.id), scopeId, runId) });
  }
  if (kind === 'carry') {
    const selectorId = calendarKey(r.selectorId), baseCellSetId = calendarKey(r.baseCellSetId);
    const selector = db.query<Row>(`SELECT * FROM ${t.selectors} WHERE id=? AND scope_id=? AND series_id=? AND source_publication_id=? LIMIT 1`)
      .get(selectorId, scopeId, seriesId, String(run.source_publication_id));
    if (!selector) return forbidden();
    if (r.cellSetId !== undefined) {
      const cell = ownedCell(calendarKey(r.cellSetId));
      if (cell.resource_id !== selector.resource_id || cell.cell_start_ms !== selector.cell_start_ms) return forbidden();
    }
    const rows = db.query<Row>(`SELECT m.id,m.scope_id,m.selector_id,m.cell_set_id,m.version_id,m.resource_id,m.from_ms,m.until_ms
      FROM ${t.workingMembers} m JOIN ${t.selectors} s ON s.id=m.selector_id AND s.cell_set_id=m.cell_set_id AND s.scope_id=m.scope_id AND s.resource_id=m.resource_id
      JOIN calendar_series p ON p.id=s.series_id AND p.scope_id=s.scope_id AND p.published_publication_id=s.source_publication_id
      JOIN ${t.cellSets} c ON c.id=s.cell_set_id AND c.scope_id=s.scope_id AND c.series_id=s.series_id AND c.resource_id=s.resource_id AND c.cell_start_ms=s.cell_start_ms
      JOIN ${t.runState} q ON q.id=c.run_id AND q.scope_id=c.scope_id AND q.state='published'
      WHERE s.id=? AND s.cell_set_id=? AND s.scope_id=? AND s.series_id=? AND s.source_publication_id=? AND m.id>? ORDER BY m.id LIMIT ?`)
      .all(selectorId, baseCellSetId, scopeId, seriesId, String(run.source_publication_id), after, limit + 1);
    return frozen({ selector, items: rows.slice(0, limit), more: rows.length > limit });
  }
  if (kind === 'members') {
    const cell = ownedCell(calendarKey(r.cellSetId));
    const rows = db.query<Row>(`SELECT id,scope_id,cell_set_id,version_id,resource_id,cell_start_ms,from_ms,until_ms FROM ${t.members}
      WHERE cell_set_id=? AND scope_id=? AND id>? ORDER BY id LIMIT ?`).all(String(cell.id), scopeId, after, limit + 1);
    return frozen({ items: rows.slice(0, limit), more: rows.length > limit });
  }
  // Even the finite 2,048-cell final publication must stream bounded pages: a
  // single row-object array would exceed the actor's unchanged 10K-node/1MiB
  // serialization contract. The canonical final writer separately enforces its
  // total 2,048-cell ceiling and atomically rolls back an overflowing manifest.
  const cells = db.query<Row>(`SELECT * FROM ${t.cellSets} WHERE scope_id=? AND run_id=? AND id>? ORDER BY id LIMIT ?`).all(scopeId, runId, after, limit + 1);
  const items = cells.slice(0, limit).map(cell => {
    if (cell.series_id !== seriesId) return state();
    const seal = db.query<Row>(`SELECT * FROM ${t.cellSeals} WHERE cell_set_id=? AND scope_id=? AND run_id=? LIMIT 1`).get(String(cell.id), scopeId, runId);
    const selector = selectorFor(cell); if (!seal || !selector) return state();
    return { cell, seal, selector };
  });
  return frozen({ items, more: cells.length > limit });
}
