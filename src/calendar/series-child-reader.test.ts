/** The first fixture is query-specific synthetic SQLite MEMORY: header-column
 * fidelity, NOT migration/actor qualification. The final integration uses real
 *022 DDL and native realm writers in MEMORY; physical actor transport and real
 * Guardian DatabaseCommitAuthority qualification remain separate gates. */
import { Database, type SQLQueryBindings } from 'bun:sqlite';
import { expect, test } from 'bun:test';
import { createDatabaseReadQuerySession, type DatabaseReadQueryConnection, type DatabaseReadQueryContext } from '../databases/database-read-query-capability';
import { CALENDAR_SERIES_CHILD_ADDITIONS, CALENDAR_SERIES_CHILD_TABLES as t } from './realm-series-children-migration';
import { CALENDAR_SERIES_MATERIALIZATION_TABLES as n } from './realm-series-materialization-migration';
import { CalendarError, readCalendarRejection, type CalendarErrorCode } from './error';
import { calendarHash, calendarJson } from './validation';
import { normalizeCalendarTimedInterval, calendarOverlapSearchStart } from './time';
import { grantId } from './realm-model';
import { calendarSeriesCurrentChildHeadSql, calendarSeriesQualifiedChildViewSql } from './series-child-selection-sql';
import { calendarSelectedSeriesChildView, readCalendarAppointmentWithSeries, readCalendarSeriesChild, readCalendarSeriesChildManageTarget,
  readCalendarSeriesChildParticipants, resolveNativeSeriesChild, queryCalendarSeriesChildren, queryCalendarSeriesChildBusy,
  CALENDAR_SERIES_READ_PARTITION_LIMIT } from './series-child-reader';

const scopeId = 'tenant:synthetic-selected-child', ownerId = 'native-owner';
const actor = { scopeId, userId: 'reader', principal: 'human', manageAll: false, createOwn: false };
const manager = { ...actor, userId: 'manager', manageAll: true };
const range = { startAt: '2030-01-01T00:00:00.000Z', endAt: '2030-01-02T00:00:00.000Z' };
type RecordRow = Record<string, SQLQueryBindings>;
function fixture() {
  const raw = new Database(':memory:'); let session: ReturnType<typeof createDatabaseReadQuerySession> | undefined;
  try {
    raw.run('PRAGMA temp_store=MEMORY');
    for (const [table, declaration] of Object.entries(CALENDAR_SERIES_CHILD_ADDITIONS)) {
      // Query-only column fidelity, not counterfeit DDL qualification.
      raw.run(`CREATE TABLE ${table}(${Object.entries(declaration).map(([name, definition]) => `${name} ${name === 'id' ? 'TEXT PRIMARY KEY' : String(definition).includes('INTEGER') ? 'INTEGER' : 'TEXT'}`).join(',')})`);
    }
    raw.run('CREATE TABLE _calendar_owner(id TEXT PRIMARY KEY,scope_id TEXT,owner_id TEXT)');
    raw.run('CREATE TABLE calendar_series(id TEXT PRIMARY KEY,scope_id TEXT,owner_id TEXT,source_id TEXT,lifecycle TEXT,published_generation_id TEXT,published_publication_id TEXT)');
    raw.run(`CREATE TABLE ${n.occurrences}(id TEXT PRIMARY KEY,scope_id TEXT,series_id TEXT,appointment_id TEXT,logical_segment_id TEXT,nominal_key TEXT)`);
    raw.run(`CREATE TABLE ${n.versions}(id TEXT PRIMARY KEY,scope_id TEXT,series_id TEXT,occurrence_id TEXT,run_id TEXT,version_digest TEXT,resource_digest TEXT,binding_digest TEXT,booking_json TEXT,start_ms INTEGER,end_ms INTEGER,occupied_from_ms INTEGER,occupied_until_ms INTEGER,resource_ids_json TEXT)`);
    raw.run(`CREATE TABLE ${n.runs}(id TEXT PRIMARY KEY,scope_id TEXT,series_id TEXT,generation_id TEXT,source_publication_id TEXT)`);
    raw.run(`CREATE TABLE ${n.runState}(id TEXT PRIMARY KEY,scope_id TEXT,state TEXT)`);
    raw.run('CREATE TABLE _calendar_series_generations(id TEXT PRIMARY KEY,scope_id TEXT,series_id TEXT,generation INTEGER)');
    raw.run('CREATE TABLE calendar_resources(id TEXT PRIMARY KEY,scope_id TEXT,label TEXT,kind TEXT,owner_id TEXT,time_zone TEXT,revision INTEGER,active INTEGER)');
    raw.run('CREATE TABLE _calendar_grants(id TEXT PRIMARY KEY,scope_id TEXT,resource_id TEXT,user_id TEXT,manage INTEGER,details INTEGER,busy INTEGER,book INTEGER)');
    raw.run('CREATE TABLE calendar_appointments(id TEXT PRIMARY KEY,scope_id TEXT)');
    raw.run(`CREATE INDEX test_child_head_range ON ${t.heads}(scope_id,view_id,status,occupied_from_ms,appointment_id)`);
    raw.run(`CREATE UNIQUE INDEX test_child_head_point ON ${t.heads}(scope_id,view_id,appointment_id)`);
    raw.run(`CREATE INDEX test_child_resource_range ON ${t.resources}(scope_id,view_id,resource_id,occupies,occupied_from_ms,appointment_id)`);
    raw.run(`CREATE INDEX test_child_resource_point ON ${t.resources}(scope_id,view_id,appointment_id,selection_revision,resource_id)`);
    raw.run(`CREATE INDEX test_child_directory_resource ON ${t.directory}(scope_id,resource_id,view_id)`);
    raw.run(`CREATE INDEX calendar_series_child_native_occurrence ON ${n.versions}(scope_id,occurrence_id,id)`);
    const insert = (table: string, row: RecordRow) => raw.query(`INSERT INTO ${table}(${Object.keys(row).join(',')}) VALUES(${Object.keys(row).map(() => '?').join(',')})`).run(...Object.values(row));
    insert(t.state, { id: 'application', version: 22, ranges_ready: 1 });
    insert('_calendar_owner', { id: 'application', scope_id: scopeId, owner_id: ownerId });
    const resource = (id: string, owner: string | null = actor.userId) => insert('calendar_resources', { id, scope_id: scopeId, label: id, kind: 'person', owner_id: owner, time_zone: 'UTC', revision: 1, active: 1 });
    const grant = (resourceId: string, right: 'details' | 'manage' | 'busy', userId = actor.userId) => insert('_calendar_grants', {
      id: grantId(scopeId, resourceId, userId), scope_id: scopeId, resource_id: resourceId, user_id: userId, manage: Number(right === 'manage'), details: Number(right === 'details'), busy: Number(right === 'busy'), book: 0,
    });
    const source = (seriesId = 'series', viewId: string | null = 'view', lifecycle = 'active') => {
      insert('calendar_series', { id: seriesId, scope_id: scopeId, owner_id: ownerId, source_id: 'source-' + seriesId, lifecycle,
        published_generation_id: 'generation-' + seriesId, published_publication_id: 'publication-' + seriesId });
      insert('_calendar_series_generations', { id: 'generation-' + seriesId, scope_id: scopeId, series_id: seriesId, generation: 1 });
      if (viewId !== null) {
        insert(t.current, { id: seriesId, scope_id: scopeId, series_id: seriesId, owner_id: ownerId, current_view_id: viewId, pointer_revision: 1, content_revision: 1, exception_revision: 0 });
        const publicationId = 'view-publication-' + viewId, adoption = calendarHash(['adoption', viewId]);
        insert(t.views, { id: viewId, scope_id: scopeId, series_id: seriesId, owner_id: ownerId, source_publication_id: 'publication-' + seriesId, source_generation: 1, phase: 'current', publication_id: publicationId, adoption_digest: adoption });
        insert(t.viewPublications, { id: publicationId, scope_id: scopeId, view_id: viewId, series_id: seriesId, source_publication_id: 'publication-' + seriesId, adoption_digest: adoption });
      }
    };
    const child = (id: string, options: { seriesId?: string; viewId?: string | null; ids?: string[]; state?: string; startAt?: string; endAt?: string; bufferBeforeMinutes?: number; bufferAfterMinutes?: number; participants?: { kind: 'guardian-user'; userId: string }[] } = {}) => {
      const seriesId = options.seriesId ?? 'series', viewId = options.viewId === undefined ? 'view' : options.viewId, ids = [...(options.ids ?? ['r'])].sort();
      const fact = normalizeCalendarTimedInterval({ startAt: options.startAt ?? '2030-01-01T10:00:00.000Z', endAt: options.endAt ?? '2030-01-01T11:00:00.000Z', timeZone: 'UTC', bufferBeforeMinutes: options.bufferBeforeMinutes ?? 15, bufferAfterMinutes: options.bufferAfterMinutes ?? 10 });
      const effective = { booking: { resourceIds: ids, interval: fact }, title: 'PRIVATE_CHILD_TITLE', participants: options.participants ?? [], admittedType: null, admittedVisit: null };
      const runId = 'run-' + id, versionId = 'version-' + id, headId = 'head-' + (viewId ?? 'missing') + '-' + id;
      insert(n.occurrences, { id, scope_id: scopeId, series_id: seriesId, appointment_id: id, logical_segment_id: 'logical-segment', nominal_key: '2030-01-01T10:00:00.000' });
      insert(n.runs, { id: runId, scope_id: scopeId, series_id: seriesId, generation_id: 'generation-' + seriesId, source_publication_id: 'publication-' + seriesId });
      insert(n.runState, { id: runId, scope_id: scopeId, state: options.state ?? 'published' });
      const bounds = { start_ms: fact.startMs, end_ms: fact.endMs, occupied_from_ms: fact.occupiedStartMs, occupied_until_ms: fact.occupiedEndMs };
      insert(n.versions, { id: versionId, scope_id: scopeId, series_id: seriesId, occurrence_id: id, run_id: runId, version_digest: calendarHash(['version', id]), resource_digest: calendarHash(ids), binding_digest: calendarHash(['binding', id]), booking_json: calendarJson(effective), resource_ids_json: calendarJson(ids), ...bounds });
      if (viewId !== null) {
        insert(t.heads, { id: headId, scope_id: scopeId, series_id: seriesId, view_id: viewId, appointment_id: id, occurrence_id: id, logical_segment_id: 'logical-segment', nominal_key: '2030-01-01T10:00:00.000', origin_kind: 'native21', version_id: versionId, native_version_id: versionId, variant_version_id: null, native_run_id: runId,
          child_revision: 1, selection_revision: 1, child_exception_revision: 0, status: 'confirmed', created_by: 'original-human', authority_resource_ids_json: calendarJson(ids), resource_digest: calendarHash(ids), binding_digest: calendarHash(['binding', id]), ...bounds });
        for (const resourceId of ids) {
          insert(t.resources, { id: headId + '-' + resourceId, scope_id: scopeId, head_id: headId, view_id: viewId, series_id: seriesId, appointment_id: id, selection_revision: 1, child_revision: 1, version_id: versionId, resource_id: resourceId, resource_revision: 1, status: 'confirmed', occupies: 1, occupied_from_ms: fact.occupiedStartMs, occupied_until_ms: fact.occupiedEndMs });
          raw.query(`INSERT OR IGNORE INTO ${t.directory}(id,scope_id,view_id,series_id,resource_id) VALUES(?,?,?,?,?)`).run(viewId + '-' + resourceId, scopeId, viewId, seriesId, resourceId);
        }
      }
      return { id, seriesId, viewId, headId, runId, versionId, fact, effective, ids };
    };
    const variant = (previous: ReturnType<typeof child>, status: 'confirmed' | 'cancelled', startAt = previous.fact.startAt, endAt = previous.fact.endAt) => {
      const fact = normalizeCalendarTimedInterval({ startAt, endAt, timeZone: 'UTC', bufferBeforeMinutes: 15, bufferAfterMinutes: 10 }), versionId = 'variant-' + previous.id;
      const effective = { ...previous.effective, booking: { resourceIds: previous.ids, interval: fact } }, bounds = { start_ms: fact.startMs, end_ms: fact.endMs, occupied_from_ms: fact.occupiedStartMs, occupied_until_ms: fact.occupiedEndMs };
      const bindingDigest = calendarHash(['variant-binding', previous.id]);
      insert(t.variants, { id: versionId, scope_id: scopeId, series_id: previous.seriesId, occurrence_id: previous.id, change_id: 'change-' + previous.id, source_generation: 7, child_revision: 2, child_exception_revision: 1, status, version_digest: calendarHash(['variant', previous.id]), resource_digest: calendarHash(previous.ids), binding_digest: bindingDigest, booking_json: calendarJson(effective), ...bounds });
      insert(t.changes, { id: 'change-' + previous.id, scope_id: scopeId, state: 'published' });
      insert(t.publications, { id: 'published-' + previous.id, scope_id: scopeId, change_id: 'change-' + previous.id, new_variant_id: versionId, appointment_id: previous.id, new_child_revision: 2, new_selection_revision: 2 });
      raw.query(`UPDATE ${t.heads} SET origin_kind='variant22',version_id=?,native_version_id=NULL,native_run_id=NULL,variant_version_id=?,child_revision=2,selection_revision=2,child_exception_revision=1,status=?,binding_digest=?,start_ms=?,end_ms=?,occupied_from_ms=?,occupied_until_ms=? WHERE id=?`)
        .run(versionId, versionId, status, bindingDigest, fact.startMs, fact.endMs, fact.occupiedStartMs, fact.occupiedEndMs, previous.headId);
      raw.query(`UPDATE ${t.resources} SET version_id=?,selection_revision=2,child_revision=2,status=?,occupies=?,occupied_from_ms=?,occupied_until_ms=? WHERE head_id=?`)
        .run(versionId, status, Number(status === 'confirmed'), fact.occupiedStartMs, fact.occupiedEndMs, previous.headId);
    };
    session = createDatabaseReadQuerySession(raw);
    const sql: string[] = [];
    const query: DatabaseReadQueryConnection['query'] = function <TRow = unknown, TParams extends SQLQueryBindings | SQLQueryBindings[] = SQLQueryBindings[]>(statement: string) {
      sql.push(statement); return session!.context.database.query<TRow, TParams>(statement);
    };
    const context: DatabaseReadQueryContext = { database: { query, prepare: session.context.database.prepare } };
    return { raw, context, sql, insert, source, child, variant, resource, grant,
      point: (id: string, asActor = actor) => readCalendarSeriesChild(context, { actor: asActor, id }),
      children: (options: Record<string, unknown> = {}) => queryCalendarSeriesChildren(context, { actor, resourceIds: ['r'], ...range, ...options }),
      busy: (options: Record<string, unknown> = {}) => queryCalendarSeriesChildBusy(context, { actor, resourceIds: ['r'], ...range, ...options }),
      close() { session?.close(); raw.close(); } };
  } catch (error) { session?.close(); raw.close(); throw error; }
}
function rejects(run: () => unknown, code: CalendarErrorCode) {
  try { run(); throw new Error('Expected selected-child rejection'); }
  catch (error) { const rejection = error instanceof CalendarError ? error : readCalendarRejection(error); expect(rejection).toBeInstanceOf(CalendarError); expect(rejection?.code).toBe(code); }
}

test('selected point uses accepted snapshots and logical child revision; retired source remains visible and native owner is not a fake human', () => {
  const f = fixture(); try {
    f.resource('r'); f.source('series', 'view', 'retired'); f.child('child');
    const before = f.raw.serialize(), point = f.point('child');
    expect(point).toMatchObject({ id: 'child', revision: 1, title: 'PRIVATE_CHILD_TITLE', createdBy: 'original-human', series: { kind: 'series-child-v1', sourceGeneration: 1, editPolicy: 'canonical-series-action' } });
    expect(point).not.toHaveProperty('participants'); expect(point).not.toHaveProperty('versionId');
    const native = resolveNativeSeriesChild(f.context, { scopeId, ownerId, seriesId: 'series', appointmentId: 'child' });
    expect(native.versionId).toBe('version-child'); expect(calendarSelectedSeriesChildView(native)).toEqual(point); expect(Object.isFrozen(native.booking.interval)).toBe(true);
    rejects(() => resolveNativeSeriesChild(f.context, { scopeId, ownerId: 'other', seriesId: 'series', appointmentId: 'child' }), 'CALENDAR_FORBIDDEN');
    expect(f.raw.serialize()).toEqual(before);
  } finally { f.close(); }
});

test('pending occurrence/head and absent selected head remain not found; only published unpromoted children become permission-first not ready', () => {
  const f = fixture(); try {
    f.resource('r', null); f.source(); f.child('pending', { state: 'preparing' }); f.child('missing');
    f.raw.query(`DELETE FROM ${t.heads} WHERE appointment_id='missing'`).run();
    rejects(() => f.point('pending'), 'CALENDAR_NOT_FOUND'); rejects(() => f.point('missing'), 'CALENDAR_NOT_FOUND');
    f.source('old', null); f.child('old-child', { seriesId: 'old', viewId: null });
    rejects(() => f.point('old-child'), 'CALENDAR_NOT_FOUND');
    f.grant('r', 'details'); rejects(() => f.point('old-child'), 'CALENDAR_NOT_READY');
    f.source('unpublished', null); f.child('never-visible', { seriesId: 'unpublished', viewId: null, state: 'blocked' });
    rejects(() => f.point('never-visible'), 'CALENDAR_NOT_FOUND');
  } finally { f.close(); }
});

test('complete co-resource authorization and native publication filter run before LIMIT without duplicate resource joins', () => {
  const f = fixture(); try {
    f.resource('r'); f.resource('hidden', null); f.source();
    for (let n = 0; n < 110; n++) f.child('a-hidden-' + String(n).padStart(3, '0'), { ids: ['hidden', 'r'] });
    f.child('b-pending', { state: 'sealed' }); f.child('z-visible');
    expect(f.children({ limit: 1 })).toMatchObject({ items: [{ id: 'z-visible' }], truncated: false });
    f.grant('hidden', 'details'); expect(f.children({ resourceIds: ['r', 'hidden'], limit: 100 }).items).toHaveLength(100);
    expect(f.sql.some(sql => /\bDISTINCT\b|GROUP BY|_calendar_series_working_members|_calendar_series_cell_members/i.test(sql))).toBe(false);
    const intervals = f.sql.filter(sql => sql.includes('ORDER BY h.occupied_from_ms,h.appointment_id LIMIT 1'));
    expect(intervals.every(sql => sql.includes("h.view_id=?") && sql.includes('NOT EXISTS') && sql.includes('LIMIT 1'))).toBe(true);
  } finally { f.close(); }
});

test('maximum 544-cell footprint remains one detail child and sixteen whole-resource busy rows without reading day cells', () => {
  const f = fixture(); try {
    const ids = Array.from({ length: 16 }, (_, index) => 'resource-' + String(index).padStart(2, '0'));
    for (const id of ids) f.resource(id); f.source();
    const child = f.child('max-child', { ids, startAt: '2030-01-01T12:00:00.000Z', endAt: '2030-02-01T12:00:00.000Z', bufferBeforeMinutes: 1440, bufferAfterMinutes: 1440 });
    expect((Math.floor((child.fact.occupiedEndMs - 1) / 86400000) - Math.floor(child.fact.occupiedStartMs / 86400000) + 1) * ids.length).toBe(544);
    expect(f.children({ resourceIds: ids })).toMatchObject({ items: [{ id: 'max-child', resourceIds: ids }], truncated: false });
    expect(f.busy({ resourceIds: ids }).items).toHaveLength(16);
    expect(f.sql.some(sql => sql.includes(n.members) || sql.includes(n.workingMembers))).toBe(false);
  } finally { f.close(); }
});

test('moved child keeps nominal identity and old revision provenance changes only at selected variant; cancellation tombstone retains authority but no occupancy', () => {
  const f = fixture(); try {
    f.resource('r'); f.source(); const moved = f.child('moved', { startAt: '2029-06-01T10:00:00.000Z', endAt: '2029-06-01T11:00:00.000Z' });
    f.variant(moved, 'confirmed', '2030-01-01T12:00:00.000Z', '2030-01-01T13:00:00.000Z');
    expect(f.children().items.map(item => item.id)).toEqual(['moved']);
    expect(f.point('moved')).toMatchObject({ revision: 2, startAt: '2030-01-01T12:00:00.000Z', series: { nominalKey: '2030-01-01T10:00:00.000', exceptionRevision: 1, sourceGeneration: 7 } });
    const cancelled = f.child('cancelled'); f.variant(cancelled, 'cancelled');
    expect(f.point('cancelled')).toMatchObject({ status: 'cancelled', revision: 2, resourceIds: ['r'] });
    expect(f.children().items.map(item => item.id)).toEqual(['moved']);
    const busy = f.busy(); expect(busy.items).toEqual([{ resourceId: 'r', startAt: '2030-01-01T11:45:00.000Z', endAt: '2030-01-01T13:10:00.000Z' }]);
    expect(JSON.stringify(busy)).not.toContain('PRIVATE'); expect(JSON.stringify(busy)).not.toContain('moved');
  } finally { f.close(); }
});

test('participants stay manager-only and exact-version while fixed legacy target admits manage without disclosing references or caller-selected rights', () => {
  const f = fixture(); try {
    f.resource('r'); f.source(); f.child('child', { participants: [{ kind: 'guardian-user', userId: 'private-target' }] });
    rejects(() => readCalendarSeriesChildParticipants(f.context, { actor, id: 'child' }), 'CALENDAR_FORBIDDEN');
    expect(readCalendarSeriesChildParticipants(f.context, { actor: manager, id: 'child' })).toEqual({ id: 'child', revision: 1, references: [{ kind: 'guardian-user', userId: 'private-target' }] });
    expect(readCalendarSeriesChildManageTarget(f.context, { actor, id: 'child' })).toEqual({ kind: 'series-child', id: 'child', revision: 1 });
    rejects(() => readCalendarSeriesChildManageTarget(f.context, { actor, id: 'child', right: 'busy' }), 'CALENDAR_INPUT_INVALID');
    expect(readCalendarAppointmentWithSeries(f.context, { actor, id: 'child' })).toEqual(f.point('child'));
  } finally { f.close(); }
});

test('selected-view directory precedes interval partitions, old views never consume page limits, and exceeding explicit partition work fails closed', () => {
  const f = fixture(); try {
    f.resource('r'); f.source(); f.child('old-child');
    f.insert(t.views, { id: 'new-view', scope_id: scopeId, series_id: 'series', owner_id: ownerId, source_publication_id: 'publication-series', phase: 'current', publication_id: 'new-view-publication', adoption_digest: calendarHash('new-adoption') });
    f.insert(t.viewPublications, { id: 'new-view-publication', scope_id: scopeId, view_id: 'new-view', series_id: 'series', source_publication_id: 'publication-series', adoption_digest: calendarHash('new-adoption') });
    f.raw.query(`UPDATE ${t.current} SET current_view_id='new-view',pointer_revision=2 WHERE id='series'`).run();
    f.child('selected-child', { viewId: 'new-view' });
    expect(f.children({ limit: 1 })).toMatchObject({ items: [{ id: 'selected-child' }], truncated: false });
    const directoryAt = f.sql.findIndex(sql => sql.includes(`FROM ${t.directory} d`)), intervalAt = f.sql.findIndex(sql => sql.includes('ORDER BY h.occupied_from_ms,h.appointment_id LIMIT 1'));
    expect(directoryAt).toBeGreaterThanOrEqual(0); expect(intervalAt).toBeGreaterThan(directoryAt);
    for (let n = 0; n < CALENDAR_SERIES_READ_PARTITION_LIMIT; n++) { const seriesId = 'series-' + n, viewId = 'view-' + n; f.source(seriesId, viewId); f.insert(t.directory, { id: 'directory-' + n, scope_id: scopeId, series_id: seriesId, view_id: viewId, resource_id: 'r' }); }
    rejects(() => f.children(), 'CALENDAR_CAPACITY');
  } finally { f.close(); }
});

test('scope range adoption gate runs only after requested-resource admission and cannot return a misleading partial page', () => {
  const f = fixture(); try {
    f.resource('r', null); f.source(); f.child('child'); f.raw.query(`UPDATE ${t.state} SET ranges_ready=0`).run();
    rejects(() => f.children(), 'CALENDAR_NOT_FOUND'); rejects(() => f.busy(), 'CALENDAR_NOT_FOUND');
    f.grant('r', 'details'); rejects(() => f.children(), 'CALENDAR_NOT_READY'); rejects(() => f.busy(), 'CALENDAR_NOT_READY');
    expect(f.children({ resourceIds: [] })).toEqual({ items: [], truncated: false });
    f.raw.query(`UPDATE ${t.state} SET ranges_ready=1`).run(); expect(f.children().items).toHaveLength(1);
  } finally { f.close(); }
});

test('lazy selected-view merge bounds returned candidates by partitions plus page work and unrelated append leaves child CAS unchanged', () => {
  const f = fixture(); try {
    f.resource('r');
    for (let index = 0; index < 20; index++) {
      const seriesId = 'series-' + index, viewId = 'view-' + index; f.source(seriesId, viewId);
      for (let child = 0; child < 3; child++) f.child('child-' + String(index).padStart(2, '0') + '-' + child, { seriesId, viewId });
    }
    const result = f.children({ limit: 5 }); expect(result.items).toHaveLength(5); expect(result.truncated).toBe(true);
    const queries = f.sql.filter(sql => sql.includes('ORDER BY h.occupied_from_ms,h.appointment_id LIMIT 1')); expect(queries.length).toBeLessThanOrEqual(20 + 5);
    const original = f.point('child-00-0');
    f.raw.query(`UPDATE ${t.current} SET content_revision=content_revision+1 WHERE id='series-0'`).run();
    expect(f.point('child-00-0')).toEqual(original);
    const target = resolveNativeSeriesChild(f.context, { scopeId, ownerId, seriesId: 'series-0', appointmentId: 'child-00-0' });
    expect(target.childRevision).toBe(1); expect(target.selectionRevision).toBe(1); expect(target.viewContentRevision).toBe(2);
  } finally { f.close(); }
});

test('a synthetic unqualified variant head is not authority to expose prepared private facts', () => {
  const f = fixture(); try {
    f.resource('r'); f.source(); const child = f.child('child'); f.variant(child, 'confirmed');
    f.raw.query(`UPDATE ${t.changes} SET state='preparing' WHERE id='change-child'`).run();
    rejects(() => f.point('child'), 'CALENDAR_NOT_FOUND'); expect(f.children()).toEqual({ items: [], truncated: false }); expect(f.busy()).toEqual({ items: [], truncated: false });
  } finally { f.close(); }
});

test('details permission cannot weaken the fixed legacy manage bridge or expose another scoped child', () => {
  const f = fixture(); try {
    f.resource('r', null); f.source(); f.child('child'); f.grant('r', 'details');
    expect(f.point('child').id).toBe('child');
    rejects(() => readCalendarSeriesChildManageTarget(f.context, { actor, id: 'child' }), 'CALENDAR_NOT_FOUND');
    rejects(() => f.point('child', { ...actor, scopeId: 'tenant:other' }), 'CALENDAR_STATE_INVALID');
    f.raw.query(`DELETE FROM _calendar_grants WHERE resource_id='r'`).run(); rejects(() => f.point('child'), 'CALENDAR_NOT_FOUND');
  } finally { f.close(); }
});

test('per-view detail interval planning uses the selected whole-interval prefix instead of a retained-view global range scan', () => {
  const f = fixture(); try {
    f.resource('r'); f.source(); f.child('child'); f.children({ limit: 1 });
    const sql = f.sql.find(statement => statement.includes(`SELECT h.* FROM ${t.heads}`) && statement.includes('h.occupied_from_ms>=?')); if (!sql) throw new Error('Missing synthetic interval query');
    const start = Date.parse(range.startAt), end = Date.parse(range.endAt);
    const plan = f.raw.query('EXPLAIN QUERY PLAN ' + sql).all(scopeId, 'view', 'series', calendarOverlapSearchStart(start), end, start, 'r', actor.userId, actor.userId) as { detail: string }[];
    expect(plan.some(row => row.detail.includes('SEARCH h USING INDEX test_child_head_range') && row.detail.includes('view_id=?'))).toBe(true);
    expect(plan.some(row => /SCAN h\b/.test(row.detail))).toBe(false);
  } finally { f.close(); }
});

test('a current pointer without the exact immutable adoption publication is not a selected child; SQL aliases are closed code-owned choices', () => {
  const f = fixture(); try {
    f.resource('r'); f.source(); f.child('child');
    f.raw.query(`UPDATE ${t.viewPublications} SET adoption_digest=?`).run(calendarHash('different-adoption'));
    rejects(() => f.point('child'), 'CALENDAR_NOT_FOUND'); expect(f.children()).toEqual({ items: [], truncated: false }); expect(f.busy()).toEqual({ items: [], truncated: false });
    rejects(() => calendarSeriesQualifiedChildViewSql(t, 's JOIN private' as never), 'CALENDAR_CONFIG_INVALID');
    rejects(() => calendarSeriesCurrentChildHeadSql(t, 'h' as const, 'm WHERE 1=1' as never), 'CALENDAR_CONFIG_INVALID');
  } finally { f.close(); }
});

test('actual022 native MEMORY publication feeds common ordinary/child point, range and redacted busy reads atomically', async () => {
  const { seriesMaterializationWriterFixture } = await import('./test-support/series-materialization-writer-fixture');
  const { calendarSeriesChildrenRealm } = await import('./series-children-realm');
  const { migrateCalendarSeriesChildren } = await import('./realm-series-children-migration');
  const { inspectCalendarSeriesProjection } = await import('./series-projection');
  const f = seriesMaterializationWriterFixture({ count: 2, resources: 2 }, { realm: calendarSeriesChildrenRealm, install: migrateCalendarSeriesChildren });
  try {
    f.begin(); let cursor = f.projection;
    for (let turn = 0; turn < 100; turn++) { const step = f.stage(cursor, 153).step; cursor = step.cursor; if (step.progress.checkpoint.phase === 'complete') break; }
    expect(inspectCalendarSeriesProjection(cursor).checkpoint.phase).toBe('complete');
    const first = f.batch.evidence.candidates[0]!.id;
    rejects(() => f.query('calendar.appointment', { actor: f.actor, id: first }), 'CALENDAR_NOT_FOUND');
    f.prepare(64); f.publish();
    const directorySession = createDatabaseReadQuerySession(f.db);
    try {
      const statements: string[] = [];
      const query: DatabaseReadQueryConnection['query'] = function <TRow = unknown, TParams extends SQLQueryBindings | SQLQueryBindings[] = SQLQueryBindings[]>(statement: string) {
        statements.push(statement); return directorySession.context.database.query<TRow, TParams>(statement);
      };
      queryCalendarSeriesChildren({ database: { query, prepare: directorySession.context.database.prepare } }, { actor: f.actor, resourceIds: f.resources, ...range });
      const directory = statements.find(statement => statement.includes(`FROM ${t.directory} d`)); if (!directory) throw new Error('Missing actual directory query');
      const plan = f.db.query('EXPLAIN QUERY PLAN ' + directory).all(f.snapshot.scopeId, ...f.resources, CALENDAR_SERIES_READ_PARTITION_LIMIT + 1) as { detail: string }[];
      expect(plan.some(row => row.detail.includes('calendar_series_child_directory_range'))).toBe(true);
      expect(plan.some(row => /TEMP B-TREE|USE TEMP/i.test(row.detail))).toBe(false);
    } finally { directorySession.close(); }
    const point = f.query('calendar.appointment', { actor: f.actor, id: first });
    expect(point).toMatchObject({ id: first, revision: 1, title: 'PRIVATE_NATIVE_TITLE', createdBy: f.actor.userId,
      series: { kind: 'series-child-v1', seriesId: f.snapshot.seriesId, sourceGeneration: 1, exceptionRevision: 0 } });
    f.command('calendar.appointment.create', { id: 'ordinary', requestId: 'ordinary-create', resourceIds: ['r'], title: 'ORDINARY_TITLE',
      startAt: '2030-01-01T07:00:00.000Z', endAt: '2030-01-01T08:00:00.000Z', timeZone: 'UTC' });
    const page = f.query('calendar.appointments', { actor: f.actor, resourceIds: ['r'], startAt: '2030-01-01T00:00:00.000Z', endAt: '2030-01-03T00:00:00.000Z', limit: 100 }) as { items: { id: string; series?: unknown }[]; truncated: boolean };
    expect(page.items.map(item => item.id)).toEqual(['ordinary', ...f.batch.evidence.candidates.map(candidate => candidate.id)]);
    expect(page.items[0]).not.toHaveProperty('series'); expect(page.truncated).toBe(false);
    const busy = f.query('calendar.busy', { actor: f.actor, resourceIds: ['r'], startAt: '2030-01-01T00:00:00.000Z', endAt: '2030-01-03T00:00:00.000Z' }) as { items: unknown[] };
    expect(busy.items).toHaveLength(3); expect(JSON.stringify(busy)).not.toContain('TITLE'); expect(JSON.stringify(busy)).not.toContain('series');
    expect(f.query('calendar.appointmentParticipants', { actor: f.actor, id: first })).toEqual({ id: first, revision: 1, references: [] });
    f.cleanup(); expect(f.query('calendar.appointment', { actor: f.actor, id: first })).toEqual(point);
    expect(f.db.query('PRAGMA foreign_key_check').all()).toEqual([]);
  } finally { f.close(); }
}, 30_000);

test('tied lazy cursors seek the complete interval and appointment tuple instead of rescanning the original prefix', () => {
  const f = fixture(); try {
    f.resource('r'); f.source();
    for (let index = 0; index < 80; index++) f.child('child-' + String(index).padStart(3, '0'));
    expect(f.children({ limit: 5 }).items.map(item => item.id)).toEqual(['child-000', 'child-001', 'child-002', 'child-003', 'child-004']);
    expect(f.busy({ limit: 5 }).items).toHaveLength(5);
    const start = Date.parse(range.startAt), end = Date.parse(range.endAt), occupied = Date.parse('2030-01-01T09:45:00.000Z');
    for (const [indexName, search, params, fields] of [
      ['test_child_head_range', '(h.occupied_from_ms,h.appointment_id)>(?,?)', [scopeId, 'view', 'series', occupied, 'child-004', end, start, 'r', actor.userId, actor.userId], 5],
      ['test_child_resource_range', '(m.occupied_from_ms,m.appointment_id)>(?,?)', [scopeId, 'view', 'r', occupied, 'child-004', end, start], 6],
    ] as const) {
      const sql = f.sql.find(statement => statement.includes(search)); if (!sql) throw new Error('Missing full tuple cursor');
      const root = f.raw.query('SELECT rootpage FROM sqlite_schema WHERE name=?').get(indexName) as { rootpage: number };
      const vm = f.raw.query('EXPLAIN ' + sql).all(...params) as { opcode: string; p1: number; p2: number; p4: string | number | null }[];
      const open = vm.find(row => row.opcode === 'OpenRead' && row.p2 === root.rootpage); if (!open) throw new Error('Missing actual cursor index');
      const seeks = vm.filter(row => /^Seek(?:GE|GT)$/.test(row.opcode) && row.p1 === open.p1);
      // A prefix-only Seek would revisit tied appointment IDs on every step.
      // The actual VDBE must bind every equality prefix plus BOTH cursor keys.
      expect(seeks).toHaveLength(1); expect(Number(seeks[0]!.p4)).toBe(fields);
      expect(sql).not.toContain('occupied_from_ms>=?');
    }
  } finally { f.close(); }
});

test('actual populated021 adoption uses the real022 occurrence-leading point index before permission-first not-ready', async () => {
  const { seriesMaterializationWriterFixture } = await import('./test-support/series-materialization-writer-fixture');
  const { migrateCalendarSeriesChildren } = await import('./realm-series-children-migration');
  const f = seriesMaterializationWriterFixture({ count: 1 }); let session: ReturnType<typeof createDatabaseReadQuerySession> | undefined;
  try {
    f.begin(); let cursor = f.projection;
    for (let turn = 0; turn < 100; turn++) { const step = f.stage(cursor).step; cursor = step.cursor; if (step.progress.checkpoint.phase === 'complete') break; }
    f.prepare(); f.publish(); f.cleanup(); migrateCalendarSeriesChildren(f.db);
    expect(f.db.query(`SELECT ranges_ready FROM ${t.state} WHERE id='application'`).get()).toEqual({ ranges_ready: 0 });
    session = createDatabaseReadQuerySession(f.db); const sql: string[] = [];
    const query: DatabaseReadQueryConnection['query'] = function <TRow = unknown, TParams extends SQLQueryBindings | SQLQueryBindings[] = SQLQueryBindings[]>(statement: string) {
      sql.push(statement); return session!.context.database.query<TRow, TParams>(statement);
    };
    const context: DatabaseReadQueryContext = { database: { query, prepare: session.context.database.prepare } }, first = f.batch.evidence.candidates[0]!.id;
    rejects(() => readCalendarSeriesChild(context, { actor: f.actor, id: first }), 'CALENDAR_NOT_READY');
    const statement = sql.find(value => value.includes('SELECT v.resource_ids_json')); if (!statement) throw new Error('Missing exact legacy child point proof');
    const plan = f.db.query('EXPLAIN QUERY PLAN ' + statement).all(f.beginPayload.sourcePublicationId, f.snapshot.scopeId, first, f.snapshot.seriesId) as { detail: string }[];
    expect(plan.some(row => row.detail.includes('calendar_series_child_native_occurrence') && row.detail.includes('occurrence_id=?'))).toBe(true);
    expect(plan.some(row => /SCAN v\b/.test(row.detail))).toBe(false);
    expect(f.db.query('PRAGMA foreign_key_check').all()).toEqual([]);
  } finally { session?.close(); f.close(); }
}, 30_000);
