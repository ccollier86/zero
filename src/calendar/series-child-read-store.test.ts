/** Actual019 review preparation on an owned MEMORY DB, with query-specific
 * synthetic021/022 selected rows. This proves adapter composition, NOT native
 * replacement/DDL/physical actor or Guardian qualification. */
import { expect, test } from 'bun:test';
import type { SQLQueryBindings } from 'bun:sqlite';
import { createReactiveDB } from '../sync/reactive-db';
import { runDatabaseRealmCommand } from '../databases/database-realm';
import { createDatabaseReadQuerySession } from '../databases/database-read-query-capability';
import { calendarRealm } from './realm';
import { CALENDAR_SERIES_CHILD_ADDITIONS, CALENDAR_SERIES_CHILD_TABLES as t } from './realm-series-children-migration';
import { CALENDAR_SERIES_MATERIALIZATION_TABLES as n } from './realm-series-materialization-migration';
import { reviewCalendarAppointmentCreate, reviewCalendarAppointmentUpdate } from './override-review';
import { createCalendarSelectedReadContext, reviewCalendarSelectedAppointmentCreate, reviewCalendarSelectedAppointmentUpdate } from './series-child-read-store';
import { calendarHash } from './validation';

function fixture() {
  const db = createReactiveDB({ mode: 'memory' }); let session: ReturnType<typeof createDatabaseReadQuerySession> | undefined;
  try {
    const raw = db.getRawDatabase(); raw.run('PRAGMA temp_store=MEMORY');
    for (const [name, schema] of Object.entries(calendarRealm.tables)) db.defineTable(name, schema);
    for (const migration of calendarRealm.migrations) migration.up(raw);
    const scopeId = 'tenant:synthetic-selected-review', actor = { scopeId, userId: 'human', principal: 'human-principal', manageAll: true, createOwn: true,
      overrides: { policyVersion: 'appointment-overlap-v1' as const, policyHash: calendarHash('review-policy'), use: true, manageGrants: true } };
    runDatabaseRealmCommand(calendarRealm, db, 'calendar.owner.bind', { scopeId, ownerId: 'owner' });
    runDatabaseRealmCommand(calendarRealm, db, 'calendar.resource.create', { actor, requestId: 'resource', id: 'resource', label: 'Resource', kind: 'person', ownerId: actor.userId, timeZone: 'UTC' });
    runDatabaseRealmCommand(calendarRealm, db, 'calendar.resource.override-grant', { actor, requestId: 'override-grant', id: 'resource', expectedRevision: 1, userId: actor.userId, categories: ['appointment-overlap'] });
    runDatabaseRealmCommand(calendarRealm, db, 'calendar.appointment.create', { actor, requestId: 'ordinary', id: 'ordinary', resourceIds: ['resource'], title: 'Ordinary',
      startAt: '2030-01-01T07:00:00.000Z', endAt: '2030-01-01T08:00:00.000Z', timeZone: 'UTC' });
    for (const [table, schema] of Object.entries(CALENDAR_SERIES_CHILD_ADDITIONS)) raw.run(`CREATE TABLE ${table}(${Object.entries(schema)
      .map(([column, definition]) => `${column} ${column === 'id' ? 'TEXT PRIMARY KEY' : String(definition).includes('INTEGER') ? 'INTEGER' : 'TEXT'}`).join(',')})`);
    for (const [table, columns] of Object.entries({
      calendar_series: 'id TEXT PRIMARY KEY,scope_id TEXT,owner_id TEXT,published_publication_id TEXT',
      [n.state]: 'id TEXT PRIMARY KEY,version INTEGER',
      [n.selectors]: 'id TEXT PRIMARY KEY,scope_id TEXT,series_id TEXT,source_publication_id TEXT,cell_set_id TEXT,resource_id TEXT,cell_start_ms INTEGER',
      [n.cellSets]: 'id TEXT PRIMARY KEY,scope_id TEXT,series_id TEXT,run_id TEXT,resource_id TEXT,cell_start_ms INTEGER',
      [n.workingMembers]: 'id TEXT PRIMARY KEY,scope_id TEXT,selector_id TEXT,cell_set_id TEXT,resource_id TEXT,version_id TEXT,from_ms INTEGER,until_ms INTEGER',
      [n.versions]: 'id TEXT PRIMARY KEY,scope_id TEXT,series_id TEXT,occurrence_id TEXT,run_id TEXT',
      [n.runs]: 'id TEXT PRIMARY KEY,scope_id TEXT,series_id TEXT,expires_ms INTEGER',
      [n.runState]: 'id TEXT PRIMARY KEY,scope_id TEXT,state TEXT',
      [n.claims]: 'id TEXT PRIMARY KEY,scope_id TEXT,resource_id TEXT,run_id TEXT,version_id TEXT,from_ms INTEGER,until_ms INTEGER,expires_ms INTEGER',
    })) raw.run(`CREATE TABLE ${table}(${columns})`);
    const insert = (table: string, row: Record<string, SQLQueryBindings>) => raw.query(`INSERT INTO ${table}(${Object.keys(row).join(',')}) VALUES(${Object.keys(row).map(() => '?').join(',')})`).run(...Object.values(row));
    const oldFrom = Date.parse('2030-01-01T10:00:00.000Z'), oldUntil = oldFrom + 3600000, from = Date.parse('2030-01-01T12:00:00.000Z'), until = from + 3600000, day = Math.floor(oldFrom / 86400000) * 86400000;
    insert(n.state, { id: 'application', version: 21 }); insert(t.state, { id: 'application', version: 22, ranges_ready: 1 });
    insert('calendar_series', { id: 'series', scope_id: scopeId, owner_id: 'owner', published_publication_id: 'source-publication' });
    insert(n.runs, { id: 'run', scope_id: scopeId, series_id: 'series', expires_ms: Date.now() + 10000 }); insert(n.runState, { id: 'run', scope_id: scopeId, state: 'published' });
    insert(n.selectors, { id: 'selector', scope_id: scopeId, series_id: 'series', source_publication_id: 'source-publication', cell_set_id: 'cell', resource_id: 'resource', cell_start_ms: day });
    insert(n.cellSets, { id: 'cell', scope_id: scopeId, series_id: 'series', run_id: 'run', resource_id: 'resource', cell_start_ms: day });
    insert(n.workingMembers, { id: 'old-member', scope_id: scopeId, selector_id: 'selector', cell_set_id: 'cell', resource_id: 'resource', version_id: 'old-version', from_ms: oldFrom, until_ms: oldUntil });
    insert(t.current, { id: 'series', scope_id: scopeId, series_id: 'series', owner_id: 'owner', current_view_id: 'view' });
    insert(t.views, { id: 'view', scope_id: scopeId, series_id: 'series', owner_id: 'owner', phase: 'current', source_publication_id: 'source-publication', publication_id: 'view-publication', adoption_digest: calendarHash('adoption') });
    insert(t.viewPublications, { id: 'view-publication', scope_id: scopeId, series_id: 'series', view_id: 'view', source_publication_id: 'source-publication', adoption_digest: calendarHash('adoption') });
    insert(t.directory, { id: 'directory', scope_id: scopeId, series_id: 'series', view_id: 'view', resource_id: 'resource' });
    insert(t.changes, { id: 'change', scope_id: scopeId, state: 'published' });
    insert(t.variants, { id: 'new-version', scope_id: scopeId, series_id: 'series', occurrence_id: 'child', change_id: 'change', status: 'confirmed', child_revision: 2, child_exception_revision: 1 });
    insert(t.publications, { id: 'child-publication', scope_id: scopeId, change_id: 'change', new_variant_id: 'new-version', appointment_id: 'child', new_child_revision: 2, new_selection_revision: 2 });
    insert(t.heads, { id: 'head', scope_id: scopeId, series_id: 'series', view_id: 'view', appointment_id: 'child', occurrence_id: 'child', origin_kind: 'variant22', version_id: 'new-version', variant_version_id: 'new-version', status: 'confirmed', child_revision: 2, selection_revision: 2, child_exception_revision: 1, occupied_from_ms: from, occupied_until_ms: until });
    insert(t.resources, { id: 'new-resource', scope_id: scopeId, series_id: 'series', view_id: 'view', head_id: 'head', appointment_id: 'child', version_id: 'new-version', resource_id: 'resource', status: 'confirmed', child_revision: 2, selection_revision: 2, occupies: 1, occupied_from_ms: from, occupied_until_ms: until });
    session = createDatabaseReadQuerySession(raw);
    const candidate = (hour: string, requestId: string) => ({ actor, requestId, id: requestId, resourceIds: ['resource'], title: 'Candidate', startAt: '2030-01-01T' + hour + ':00:00.000Z', endAt: '2030-01-01T' + String(Number(hour) + 1).padStart(2, '0') + ':00:00.000Z', timeZone: 'UTC', bufferBeforeMinutes: 0, bufferAfterMinutes: 0 });
    return { db, raw, context: session.context, candidate,
      update: (hour: string, key: string) => ({ ...candidate(hour, key), id: 'ordinary', expectedRevision: 1 }),
      cancelSynthetic() { raw.query(`UPDATE ${t.heads} SET status='cancelled'`).run(); raw.query(`UPDATE ${t.variants} SET status='cancelled'`).run(); raw.query(`UPDATE ${t.resources} SET status='cancelled',occupies=0`).run(); },
      close() { session?.close(); db.dispose(); } };
  } catch (error) { session?.close(); db.dispose(); throw error; }
}

test('fixed selected review adapter uses moved/cancelled current heads rather than stale native21 cells, for both create and update', () => {
  const f = fixture(); try {
    const before = f.raw.serialize(), sequence = f.db.currentSeq;
    expect(reviewCalendarAppointmentCreate(f.context, f.candidate('10', 'legacy-old'))).toEqual({ status: 'non-reviewable' });
    expect(reviewCalendarSelectedAppointmentCreate(f.context, f.candidate('10', 'selected-old'))).toEqual({ status: 'clear' });
    expect(reviewCalendarAppointmentCreate(f.context, f.candidate('12', 'legacy-new'))).toEqual({ status: 'clear' });
    expect(reviewCalendarSelectedAppointmentCreate(f.context, f.candidate('12', 'selected-new'))).toEqual({ status: 'non-reviewable' });
    expect(reviewCalendarAppointmentUpdate(f.context, f.update('12', 'legacy-update'))).toEqual({ status: 'clear' });
    expect(reviewCalendarSelectedAppointmentUpdate(f.context, f.update('12', 'selected-update'))).toEqual({ status: 'non-reviewable' });
    expect(f.raw.serialize()).toEqual(before); expect(f.db.currentSeq).toBe(sequence);
    f.cancelSynthetic(); expect(reviewCalendarSelectedAppointmentCreate(f.context, f.candidate('12', 'selected-cancelled'))).toEqual({ status: 'clear' });
  } finally { f.close(); }
});

test('selected review context remains a readonly fixed adapter and is not a structured022 table capability', () => {
  const f = fixture(); try {
    const context = createCalendarSelectedReadContext(f.context);
    expect(Object.isFrozen(context)).toBe(true); expect(Object.keys(context.db).sort()).toEqual(['find', 'get', 'hasTable']);
    expect(() => context.db.find(t.heads, { limit: 1 })).toThrow();
    expect(context).not.toHaveProperty('command'); expect(context).not.toHaveProperty('sql');
  } finally { f.close(); }
});
