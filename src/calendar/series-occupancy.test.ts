/** Query-specific synthetic SQLite MEMORY fixtures only, not full migration,
 * physical-file or runtime qualification. Every owned session/DB closes finally;
 * no filesystem fixture/dependency/build/server is created. */
import { expect, test } from 'bun:test';
import type { SQLQueryBindings } from 'bun:sqlite';
import { createReactiveDB } from '../sync/reactive-db';
import { defineDatabaseRealm, runDatabaseRealmCommand } from '../databases/database-realm';
import { createDatabaseReadQuerySession, type DatabaseReadQueryContext, type DatabaseReadQuerySession } from '../databases/database-read-query-capability';
import { createDatabaseWriteCommandSession } from '../databases/database-write-command-capability';
import { CalendarError, type CalendarErrorCode } from './error';
import { createCalendarReadContext } from './calendar-read-store';
import { assertCalendarHardResourcesAvailable, assertCalendarResourcesAvailable } from './occupancy';
import { readCalendarSeriesOccupancy, assertCalendarSeriesResourcesAvailable, CALENDAR_SERIES_OCCUPANCY_QUERY } from './series-occupancy';
import { CALENDAR_SERIES_MATERIALIZATION_TABLES } from './realm-series-materialization-migration';
import { normalizeCalendarTimedInterval } from './time';

const t = CALENDAR_SERIES_MATERIALIZATION_TABLES, scopeId = 'application';
const interval = normalizeCalendarTimedInterval({ startAt: '2026-01-01T09:00:00.000Z', endAt: '2026-01-01T10:00:00.000Z', timeZone: 'UTC' });
const nowMs = Date.parse('2025-12-01T00:00:00.000Z'), day = Date.parse('2026-01-01T00:00:00.000Z');
const requested = { scopeId, resourceIds: ['resource'], occupiedStartMs: interval.occupiedStartMs, occupiedEndMs: interval.occupiedEndMs, nowMs };
const reservation = { id: 'TEXT PRIMARY KEY', scope_id: 'TEXT', resource_id: 'TEXT', active: 'INTEGER', occupied_start_ms: 'INTEGER', occupied_end_ms: 'INTEGER',
  appointment_id: 'TEXT', block_id: 'TEXT', hold_id: 'TEXT', expires_ms: 'INTEGER' };
const tables = {
  [t.state]: { id: 'TEXT PRIMARY KEY', version: 'INTEGER' },
  calendar_series: { id: 'TEXT PRIMARY KEY', scope_id: 'TEXT', published_publication_id: 'TEXT', lifecycle: 'TEXT' },
  [t.runs]: { id: 'TEXT PRIMARY KEY', scope_id: 'TEXT', expires_ms: 'INTEGER' },
  [t.runState]: { id: 'TEXT PRIMARY KEY', scope_id: 'TEXT', state: 'TEXT', projection_complete: 'INTEGER' },
  [t.cellSets]: { id: 'TEXT PRIMARY KEY', scope_id: 'TEXT', run_id: 'TEXT', series_id: 'TEXT', resource_id: 'TEXT', cell_start_ms: 'INTEGER' },
  [t.claims]: { id: 'TEXT PRIMARY KEY', scope_id: 'TEXT', resource_id: 'TEXT', run_id: 'TEXT', version_id: 'TEXT', from_ms: 'INTEGER', until_ms: 'INTEGER', expires_ms: 'INTEGER' },
  [t.selectors]: { id: 'TEXT PRIMARY KEY', scope_id: 'TEXT', resource_id: 'TEXT', cell_start_ms: 'INTEGER', source_publication_id: 'TEXT', series_id: 'TEXT', cell_set_id: 'TEXT' },
  [t.workingMembers]: { id: 'TEXT PRIMARY KEY', scope_id: 'TEXT', selector_id: 'TEXT', cell_set_id: 'TEXT', resource_id: 'TEXT', version_id: 'TEXT', from_ms: 'INTEGER', until_ms: 'INTEGER' },
  _calendar_reservations: reservation, _calendar_block_reservations: reservation, _calendar_hold_reservations: reservation,
  changes: { id: 'TEXT PRIMARY KEY', value: 'TEXT' },
};
function fixture(profile = true) {
  const db = createReactiveDB({ mode: 'memory' }), sessions: DatabaseReadQuerySession[] = [];
  try {
    for (const [name, schema] of Object.entries(tables)) if (profile || name !== t.state) db.defineTable(name, schema);
    if (profile) db.createStrict(t.state, { id: 'application', version: 21 });
    const raw = db.getRawDatabase();
    raw.run(`CREATE INDEX calendar_series_claim_overlap ON ${t.claims}(scope_id,resource_id,from_ms,until_ms,run_id)`);
    raw.run(`CREATE INDEX calendar_series_selected_cell ON ${t.selectors}(scope_id,resource_id,cell_start_ms,source_publication_id,series_id,id)`);
    raw.run(`CREATE INDEX calendar_series_selected_member ON ${t.workingMembers}(selector_id,cell_set_id,from_ms,until_ms,version_id)`);
    const session = createDatabaseReadQuerySession(raw); sessions.push(session);
    const read = createCalendarReadContext(session.context);
    function selected(prefix = 'current', publication = 'published', selectedPublication = publication, asScope = scopeId, resourceId = 'resource', lifecycle = 'active') {
      const series = 'series-' + prefix, selector = 'selector-' + prefix, cell = 'cell-' + prefix;
      db.createStrict('calendar_series', { id: series, scope_id: asScope, published_publication_id: selectedPublication, lifecycle });
      db.createStrict(t.runState, { id: 'selected-run-' + prefix, scope_id: asScope, state: 'published', projection_complete: 1 });
      db.createStrict(t.cellSets, { id: cell, scope_id: asScope, run_id: 'selected-run-' + prefix, series_id: series, resource_id: resourceId, cell_start_ms: day });
      db.createStrict(t.selectors, { id: selector, scope_id: asScope, resource_id: resourceId, cell_start_ms: day, source_publication_id: publication, series_id: series, cell_set_id: cell });
      db.createStrict(t.workingMembers, { id: 'member-' + prefix, scope_id: asScope, selector_id: selector, cell_set_id: cell, resource_id: resourceId,
        version_id: 'version-' + prefix, from_ms: interval.occupiedStartMs, until_ms: interval.occupiedEndMs });
    }
    function pending(prefix = 'pending', state = 'preparing', expires = nowMs + 1000, resourceId = 'resource', asScope = scopeId) {
      db.createStrict(t.runs, { id: 'run-' + prefix, scope_id: asScope, expires_ms: expires });
      db.createStrict(t.runState, { id: 'run-' + prefix, scope_id: asScope, state, projection_complete: 0 });
      db.createStrict(t.claims, { id: 'claim-' + prefix, scope_id: asScope, resource_id: resourceId, run_id: 'run-' + prefix, version_id: 'version-' + prefix,
        from_ms: interval.occupiedStartMs, until_ms: interval.occupiedEndMs, expires_ms: expires });
    }
    return { db, raw, session, read, selected, pending, query: (value: unknown = requested) => readCalendarSeriesOccupancy(session.context, value),
      close() { for (const owned of sessions.reverse()) owned.close(); db.dispose(); } };
  } catch (error) { for (const owned of sessions.reverse()) owned.close(); db.dispose(); throw error; }
}
function rejects(run: () => unknown, code: CalendarErrorCode) {
  try { run(); throw new Error('Expected series occupancy rejection'); }
  catch (error) { expect(error).toBeInstanceOf(CalendarError); expect((error as CalendarError).code).toBe(code); }
}

test('current source selection happens inside SQL before LIMIT and retired source authority does not erase published bookings', () => {
  const f = fixture();
  try {
    for (let index = 0; index < 100; index++) f.selected('a-retired-' + index, 'old-publication', 'new-publication');
    f.selected('z-current', 'selected-publication', 'selected-publication', scopeId, 'resource', 'retired');
    const before = f.raw.serialize(), seq = f.db.currentSeq;
    expect(f.query()).toEqual({ currentConflict: true, pendingConflict: false, reconciliationNeeded: false });
    expect(f.query({ ...requested, excludeVersionIds: ['version-z-current'] })).toEqual({ currentConflict: false, pendingConflict: false, reconciliationNeeded: false });
    expect(f.raw.serialize()).toEqual(before); expect(f.db.currentSeq).toBe(seq);
    rejects(() => assertCalendarResourcesAvailable(f.read, scopeId, ['resource'], interval, undefined, nowMs), 'CALENDAR_BOOKING_CONFLICT');
    rejects(() => assertCalendarHardResourcesAvailable(f.read, scopeId, ['resource'], interval, nowMs), 'CALENDAR_BOOKING_CONFLICT');
  } finally { f.close(); }
});

test('partial preparation and blocked/sealed plans reserve complete intervals on every bound resource before cell projection', () => {
  for (const state of ['preparing', 'blocked', 'sealed']) {
    const f = fixture();
    try {
      f.pending('whole-' + state, state); f.pending('other-' + state, state, nowMs + 1000, 'other-resource');
      expect(f.query()).toEqual({ currentConflict: false, pendingConflict: true, reconciliationNeeded: false });
      expect(f.db.get(t.runState, 'run-whole-' + state)?.projection_complete).toBe(0);
      rejects(() => assertCalendarResourcesAvailable(f.read, scopeId, ['resource'], interval, undefined, nowMs), 'CALENDAR_BOOKING_CONFLICT');
      rejects(() => assertCalendarHardResourcesAvailable(f.read, scopeId, ['other-resource'], interval, nowMs), 'CALENDAR_BOOKING_CONFLICT');
      expect(f.query({ ...requested, excludeVersionIds: ['version-whole-' + state] }).pendingConflict).toBe(false);
      expect(f.query({ ...requested, resourceIds: ['resource', 'other-resource'], excludeVersionIds: ['version-whole-' + state] }).pendingConflict).toBe(true);
    } finally { f.close(); }
  }
});

test('horizon cells sharing the current source publication remain unselected until their actual native run publication', () => {
  const f = fixture();
  try {
    f.selected('horizon', 'already-selected-source', 'already-selected-source');
    f.db.update(t.runState, 'selected-run-horizon', { state: 'sealed' });
    expect(f.query()).toEqual({ currentConflict: false, pendingConflict: false, reconciliationNeeded: false });
    f.pending('horizon', 'sealed');
    expect(f.query()).toEqual({ currentConflict: false, pendingConflict: true, reconciliationNeeded: false });
    f.db.update(t.runState, 'selected-run-horizon', { state: 'published' });
    expect(f.query().currentConflict).toBe(true);
  } finally { f.close(); }
});

test('expired pending claims require canonical reconciliation until the aborted claim is physically withdrawn', () => {
  const f = fixture();
  try {
    f.pending('expired', 'preparing', nowMs);
    expect(f.query()).toEqual({ currentConflict: false, pendingConflict: false, reconciliationNeeded: true });
    rejects(() => assertCalendarResourcesAvailable(f.read, scopeId, ['resource'], interval, undefined, nowMs), 'CALENDAR_NOT_READY');
    rejects(() => assertCalendarHardResourcesAvailable(f.read, scopeId, ['resource'], interval, nowMs), 'CALENDAR_NOT_READY');
    // Abort revokes preparation authority, but a bounded cleanup may still have
    // physical claims to drain. Match the conservative reservation SQL guard.
    f.db.update(t.runState, 'run-expired', { state: 'aborted' });
    expect(f.query()).toEqual({ currentConflict: false, pendingConflict: false, reconciliationNeeded: true });
    rejects(() => assertCalendarResourcesAvailable(f.read, scopeId, ['resource'], interval, undefined, nowMs), 'CALENDAR_NOT_READY');
    f.db.delete(t.claims, 'claim-expired');
    expect(f.query()).toEqual({ currentConflict: false, pendingConflict: false, reconciliationNeeded: false });
    expect(() => assertCalendarResourcesAvailable(f.read, scopeId, ['resource'], interval, undefined, nowMs)).not.toThrow();
  } finally { f.close(); }
});

test('aborted live claims remain reconciliation work through every bounded drain page with exact scope/resource/exclusions', () => {
  const f = fixture();
  try {
    for (let index = 0; index < 3; index++) f.pending('aborted-' + index, 'aborted', nowMs + 100000);
    f.pending('aborted-other-scope', 'aborted', nowMs + 100000, 'resource', 'tenant:other');
    f.pending('aborted-other-resource', 'aborted', nowMs + 100000, 'other-resource');
    expect(f.query()).toEqual({ currentConflict: false, pendingConflict: false, reconciliationNeeded: true });
    expect(f.query({ ...requested, excludeVersionIds: ['version-aborted-0', 'version-aborted-1', 'version-aborted-2'] })).toEqual({ currentConflict: false, pendingConflict: false, reconciliationNeeded: false });
    const before = f.raw.serialize(), sequence = f.db.currentSeq;
    rejects(() => assertCalendarResourcesAvailable(f.read, scopeId, ['resource'], interval, undefined, nowMs), 'CALENDAR_NOT_READY');
    rejects(() => assertCalendarHardResourcesAvailable(f.read, scopeId, ['resource'], interval, nowMs), 'CALENDAR_NOT_READY');
    expect(f.raw.serialize()).toEqual(before); expect(f.db.currentSeq).toBe(sequence);
    for (let index = 0; index < 3; index++) {
      f.db.delete(t.claims, 'claim-aborted-' + index);
      expect(f.query()).toEqual({ currentConflict: false, pendingConflict: false, reconciliationNeeded: index < 2 });
    }
    expect(() => assertCalendarResourcesAvailable(f.read, scopeId, ['resource'], interval, undefined, nowMs)).not.toThrow();
  } finally { f.close(); }
});

test('current member and pending claim scope, resource, selected cell-set and half-open adjacency are exact', () => {
  const f = fixture();
  try {
    f.selected('other-scope', 'published', 'published', 'tenant:other'); f.pending('other-scope', 'preparing', nowMs + 1000, 'resource', 'tenant:other');
    f.selected('other-resource', 'published', 'published', scopeId, 'other');
    f.selected('wrong-cell'); f.db.update(t.workingMembers, 'member-wrong-cell', { cell_set_id: 'superseded-cell' });
    f.pending('published', 'published'); f.pending('aborted', 'aborted', nowMs + 1000, 'other-resource');
    f.pending('adjacent'); f.db.update(t.claims, 'claim-adjacent', { from_ms: interval.occupiedEndMs, until_ms: interval.occupiedEndMs + 1000 });
    expect(f.query()).toEqual({ currentConflict: false, pendingConflict: false, reconciliationNeeded: false });
    f.db.update(t.claims, 'claim-adjacent', { from_ms: interval.occupiedStartMs - 1000, until_ms: interval.occupiedStartMs });
    expect(f.query().pendingConflict).toBe(false);
    f.db.update(t.claims, 'claim-adjacent', { from_ms: interval.occupiedStartMs - 1, until_ms: interval.occupiedStartMs + 1 });
    expect(f.query().pendingConflict).toBe(true);
  } finally { f.close(); }
});

test('old profiles do not invoke a series query, while 021 missing/corrupt query bridges fail closed', () => {
  const old = fixture(false), current = fixture();
  try {
    let invoked = false;
    const oldContext = { db: old.read.db, query() { invoked = true; throw new Error('must not invoke'); } };
    expect(() => assertCalendarSeriesResourcesAvailable(oldContext, scopeId, ['resource'], interval, nowMs)).not.toThrow(); expect(invoked).toBe(false);
    rejects(() => assertCalendarSeriesResourcesAvailable({ db: current.read.db }, scopeId, ['resource'], interval, nowMs), 'CALENDAR_NOT_READY');
    rejects(() => assertCalendarSeriesResourcesAvailable({ db: current.read.db, query: () => ({ currentConflict: false }) }, scopeId, ['resource'], interval, nowMs), 'CALENDAR_NOT_READY');
    const writer = createDatabaseWriteCommandSession(current.db);
    try { rejects(() => assertCalendarResourcesAvailable(writer.context, scopeId, ['resource'], interval, undefined, nowMs), 'CALENDAR_NOT_READY'); }
    finally { writer.close(); }
    current.db.update(t.state, 'application', { version: 22 });
    rejects(() => assertCalendarSeriesResourcesAvailable(current.read, scopeId, ['resource'], interval, nowMs), 'CALENDAR_NOT_READY');
  } finally { old.close(); current.close(); }
});

test('actual registered query bridge blocks ordinary and hard-override writers inside their current transaction and rolls back', () => {
  const f = fixture();
  const realm = defineDatabaseRealm({ name: 'calendar-series-occupancy-query-fixture', version: '1', tables,
    queries: { [CALENDAR_SERIES_OCCUPANCY_QUERY]: (context, value) => readCalendarSeriesOccupancy(context, value) as never },
    commands: { check: (context, value) => {
      context.db.createStrict('changes', { id: 'before', value: 'must roll back' });
      // A fresh claim created by this command is visible to its registered read.
      context.db.createStrict(t.runs, { id: 'run-current-write', scope_id: scopeId, expires_ms: nowMs + 1000 });
      context.db.createStrict(t.runState, { id: 'run-current-write', scope_id: scopeId, state: 'preparing', projection_complete: 0 });
      context.db.createStrict(t.claims, { id: 'claim-current-write', scope_id: scopeId, resource_id: 'resource', run_id: 'run-current-write', version_id: 'version-current-write',
        from_ms: interval.occupiedStartMs, until_ms: interval.occupiedEndMs, expires_ms: nowMs + 1000 });
      if (value === 'hard') assertCalendarHardResourcesAvailable(context, scopeId, ['resource'], interval, nowMs);
      else assertCalendarResourcesAvailable(context, scopeId, ['resource'], interval, undefined, nowMs);
      return null;
    } } });
  try {
    const before = f.raw.serialize(), seq = f.db.currentSeq;
    for (const value of ['ordinary', 'hard']) {
      rejects(() => runDatabaseRealmCommand(realm, f.db, 'check', value), 'CALENDAR_BOOKING_CONFLICT');
      expect(f.raw.serialize()).toEqual(before); expect(f.db.currentSeq).toBe(seq); expect(f.db.get('changes', 'before')).toBeNull();
      expect(f.raw.query('PRAGMA query_only').get()).toEqual({ query_only: 0 });
    }
  } finally { f.close(); }
});

test('1000 exact native exclusions are supported without widening ordinary wrappers or leaking private IDs', () => {
  const f = fixture();
  try {
    f.selected(); f.pending();
    const excludeVersionIds = Array.from({ length: 998 }, (_, index) => `version-${index.toString().padStart(4, '0')}-` + 'x'.repeat(100));
    excludeVersionIds.push('version-current', 'version-pending'); expect(JSON.stringify(excludeVersionIds).length).toBeGreaterThan(32 * 1024);
    expect(f.query({ ...requested, excludeVersionIds })).toEqual({ currentConflict: false, pendingConflict: false, reconciliationNeeded: false });
    const result = f.query(); expect(Object.keys(result).sort()).toEqual(['currentConflict', 'pendingConflict', 'reconciliationNeeded']);
    expect(Object.values(result).every(value => typeof value === 'boolean')).toBe(true);
    rejects(() => assertCalendarResourcesAvailable(f.read, scopeId, ['resource'], interval, undefined, nowMs), 'CALENDAR_BOOKING_CONFLICT');
    for (const patch of [{ excludeVersionIds: [...excludeVersionIds, 'extra'] }, { excludeVersionIds: ['same', 'same'] }, { excludeVersionIds: ['bad key'] },
      { resourceIds: [] }, { resourceIds: ['same', 'same'] }, { resourceIds: Array.from({ length: 17 }, (_, index) => `r${index}`) },
      { occupiedEndMs: interval.occupiedStartMs }, { nowMs: -1 }, { scopeId: 'unknown' }, { excludeSeriesId: 'all' }])
      rejects(() => f.query({ ...requested, ...patch }), 'CALENDAR_INPUT_INVALID');
    let touched = false;
    const getter = { ...requested }; Object.defineProperty(getter, 'resourceIds', { enumerable: true, get() { touched = true; return ['resource']; } });
    rejects(() => f.query(getter), 'CALENDAR_INPUT_INVALID'); expect(touched).toBe(false);
    rejects(() => f.query(new Proxy(requested, { ownKeys() { touched = true; return []; } })), 'CALENDAR_INPUT_INVALID'); expect(touched).toBe(false);
  } finally { f.close(); }
});

test('working overlap queries use indexed current selection rather than an immutable-history scan', () => {
  const f = fixture();
  try {
    f.selected(); f.pending();
    const observed: { sql: string; params: SQLQueryBindings[] }[] = [], database = f.session.context.database;
    const traced: DatabaseReadQueryContext = { database: { ...database, query<TRow = unknown, TParams extends SQLQueryBindings | SQLQueryBindings[] = SQLQueryBindings[]>(sql: string) {
      const statement = database.query<TRow, TParams>(sql);
      return { ...statement, get(...params: Parameters<typeof statement.get>) { observed.push({ sql, params: [...params] }); return statement.get(...params); } };
    } } };
    expect(readCalendarSeriesOccupancy(traced, requested).currentConflict).toBe(true);
    expect(observed).toHaveLength(3);
    const plans = observed.map(({ sql, params }) => f.raw.query<{ detail: string }, SQLQueryBindings[]>('EXPLAIN QUERY PLAN ' + sql).all(...params).map(row => row.detail).join('\n'));
    expect(plans[0]).toContain('calendar_series_selected_cell'); expect(plans[0]).toContain('calendar_series_selected_member');
    expect(plans[1]).toContain('calendar_series_claim_overlap'); expect(plans[2]).toContain('calendar_series_claim_overlap');
    for (const { sql } of observed) { expect(sql).not.toContain('_calendar_series_cell_members '); expect(sql).not.toContain('COUNT('); expect(sql).not.toContain("lifecycle='active'"); }
  } finally { f.close(); }
});
