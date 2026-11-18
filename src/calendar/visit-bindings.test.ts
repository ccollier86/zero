/** All fixtures and read copies are memory-only and always close in finally. */
import { Database, type SQLQueryBindings } from 'bun:sqlite';
import { expect, spyOn, test } from 'bun:test';
import type { DatabaseSerializableValue } from '../databases/database-operations';
import { createDatabaseReadQuerySession, withDatabaseReadQuerySession } from '../databases/database-read-query-capability';
import { runDatabaseRealmCommand, runDatabaseRealmQuery } from '../databases/database-realm';
import { LoggingActorSource, normalizeLoggingActorSourceBinding } from '../logging/logging-actor-source';
import { loggingContext } from '../logging/test-support/logging-fixture';
import { createReactiveDB } from '../sync/reactive-db';
import type { CalendarActor } from './contracts';
import { CalendarError, readCalendarRejection, type CalendarErrorCode } from './error';
import { calendarRealm } from './realm';
import { CALENDAR_LIMITS } from './realm-model';
import { normalizeCalendarTimedInterval } from './time';
import { calendarHash } from './validation';

const owner: CalendarActor = { scopeId: 'tenant:synthetic', userId: 'owner', principal: 'session.owner', manageAll: false, createOwn: true };
const manager: CalendarActor = { ...owner, userId: 'manager', principal: 'session.manager', manageAll: true };
const reader: CalendarActor = { ...owner, userId: 'reader', principal: 'session.reader', createOwn: false };
const timed = { startAt: '2030-01-01T10:00:00.000Z', endAt: '2030-01-01T11:00:00.000Z', timeZone: 'UTC' };
const later = { startAt: '2030-01-01T12:00:00.000Z', endAt: '2030-01-01T13:00:00.000Z', timeZone: 'UTC' };
const range = { startAt: '2030-01-01T00:00:00.000Z', endAt: '2030-01-02T00:00:00.000Z' };
const visit = { mode: 'in-person', location: { id: 'office', revision: 1 } };
const snapshot = { ...visit, location: { ...visit.location, label: 'PRIVATE_OFFICE_LABEL', region: 'us:ny' } };

function fixture(logging = false, maxEvents = 10_000) {
  const clock = spyOn(Date, 'now').mockReturnValue(Date.parse('2030-01-01T09:00:00.000Z'));
  const db = createReactiveDB({ mode: 'memory' });
  let source: LoggingActorSource | null = null;
  try {
    db.getRawDatabase().run('PRAGMA temp_store=MEMORY');
    for (const [name, schema] of Object.entries(calendarRealm.tables)) db.defineTable(name, schema);
    for (const migration of calendarRealm.migrations) migration.up(db.getRawDatabase());
    if (logging) source = new LoggingActorSource(db, normalizeLoggingActorSourceBinding({ records: false, workflow: true,
      policyVersion: 'calendar-visits-synthetic', scope: { kind: 'tenant', tenantId: 'synthetic' }, sourceQueue: { maxEvents } }));
    const command = (name: string, input: Record<string, unknown>): any => {
      const run = () => runDatabaseRealmCommand(calendarRealm, db, 'calendar.' + name,
        Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)) as DatabaseSerializableValue);
      return source ? source.run(loggingContext('synthetic'), run) : run();
    };
    const plans: { sql: string; detail: string; params: unknown[]; rowsReturned: number }[] = [];
    const query = (name: string, input: Record<string, unknown>, recordPlans = false): any => {
      const copy = Database.deserialize(db.getRawDatabase().serialize(), { readonly: true, strict: true });
      const original = copy.prepare.bind(copy);
      const observer = recordPlans ? spyOn(copy, 'prepare').mockImplementation(<TRow, TParams extends SQLQueryBindings | SQLQueryBindings[]>(sql: string, parameters?: TParams) => {
        const statement = original<TRow, TParams>(sql, parameters);
        return new Proxy(statement, { get(target, key) {
          const member = Reflect.get(target, key);
          if ((key === 'all' || key === 'get') && sql.includes('_calendar_resource_location_current')) return (...params: never[]) => {
            const result = member.apply(target, params), explain = original('EXPLAIN QUERY PLAN ' + sql);
            try {
              plans.push({ sql, params, detail: (explain.all(...params) as { detail: string }[]).map(row => row.detail).join('\n'),
                rowsReturned: Array.isArray(result) ? result.length : result == null ? 0 : 1 });
            } finally { explain.finalize(); }
            return result;
          };
          return typeof member === 'function' ? member.bind(target) : member;
        } });
      }) : null;
      try {
        copy.run('PRAGMA temp_store=MEMORY');
        return withDatabaseReadQuerySession(createDatabaseReadQuerySession(copy), context => runDatabaseRealmQuery(calendarRealm, context, 'calendar.' + name, input as DatabaseSerializableValue));
      } finally { observer?.mockRestore(); copy.close(); }
    };
    command('owner.bind', { ownerId: 'synthetic-owner', scopeId: owner.scopeId });
    const resource = (id = 'person', ownerId: string | null = owner.userId) => command('resource.create', { actor: manager, requestId: 'resource-' + id, id,
      label: 'PRIVATE_RESOURCE_LABEL', kind: ownerId === null ? 'room' : 'person', ownerId, timeZone: 'UTC' });
    const location = (id = 'office', fields: Record<string, unknown> = {}) => command('location.create', { actor: manager, requestId: 'location-' + id,
      id, label: 'PRIVATE_OFFICE_LABEL', region: 'us:ny', active: true, ...fields });
    const replace = (fields: Record<string, unknown> = {}, id = 'office') => command('location.replace', { actor: manager, requestId: 'replace-' + db.currentSeq,
      id, expectedRevision: db.get('calendar_locations', id)!.revision, label: 'PRIVATE_OFFICE_LABEL', region: 'us:ny', active: true, ...fields });
    const assign = (locationIds = ['office'], id = 'person') => command('resource.locations', { actor: manager, requestId: 'assign-' + db.currentSeq,
      id, expectedRevision: db.get('calendar_resources', id)!.revision, locationIds });
    const grant = (grants: string[], id = 'person') => command('resource.grant', { actor: manager, requestId: 'grant-' + db.currentSeq,
      id, expectedRevision: db.get('calendar_resources', id)!.revision, userId: reader.userId, grants });
    const appointment = (id = 'visit', fields: Record<string, unknown> = {}) => command('appointment.create', { actor: owner, requestId: 'create-' + id,
      id, resourceIds: ['person'], title: 'PRIVATE_TITLE', ...timed, visit, ...fields });
    const hold = (id = 'lease', fields: Record<string, unknown> = {}) => command('hold.acquire', { actor: owner, requestId: 'hold-' + id,
      id, resourceIds: ['person'], ...timed, visit, ...fields });
    const confirm = (id = 'lease', fields: Record<string, unknown> = {}) => command('hold.confirm', { actor: owner, requestId: 'confirm-' + id,
      id, expectedRevision: 1, appointmentId: 'appointment-' + id, title: 'PRIVATE_TITLE', ...fields });
    const reschedule = (fields: Record<string, unknown> = {}) => command('appointment.reschedule', { actor: owner, requestId: 'move-' + db.currentSeq,
      id: 'visit', expectedRevision: db.get('calendar_appointments', 'visit')!.revision, ...timed, bufferBeforeMinutes: 0, bufferAfterMinutes: 0, ...fields });
    return { db, source, command, query, plans, resource, location, replace, assign, grant, appointment, hold, confirm, reschedule,
      drain() { const page = source!.control({}); source!.control({ acknowledge: page.rows.map(row => row.id) }); },
      setup() { resource(); location(); assign(); }, close() { try { source?.close(); } finally { try { db.dispose(); } finally { clock.mockRestore(); } } } };
  } catch (error) { try { source?.close(); } finally { try { db.dispose(); } finally { clock.mockRestore(); } } throw error; }
}
function rejects(run: () => unknown, code: CalendarErrorCode) {
  try { run(); throw new Error('Expected rejection'); }
  catch (error) { expect((error instanceof CalendarError ? error : readCalendarRejection(error))?.code).toBe(code); }
}

test('visit locations are the paginated current active all-resource intersection; explicit empty stays empty for everyone', () => {
  const f = fixture();
  try {
    f.setup(); f.resource('room', null); f.location('second'); f.location('inactive', { active: false });
    f.assign(['office', 'second']); f.assign(['office'], 'room');
    expect(f.query('visitLocations', { actor: manager, resourceIds: [] })).toEqual({ items: [], truncated: false, nextAfter: null });
    expect(f.query('visitLocations', { actor: owner, resourceIds: [] }).items).toEqual([]);
    const first = f.query('visitLocations', { actor: owner, resourceIds: ['person'], limit: 1 });
    expect(first).toMatchObject({ truncated: true, nextAfter: 'office' }); expect(first.items[0].id).toBe('office');
    expect(f.query('visitLocations', { actor: owner, resourceIds: ['person'], after: first.nextAfter }).items.map((item: any) => item.id)).toEqual(['second']);
    expect(f.query('visitLocations', { actor: manager, resourceIds: ['room', 'person'] }).items.map((item: any) => item.id)).toEqual(['office']);
    f.replace({ active: false }); expect(f.query('visitLocations', { actor: manager, resourceIds: ['room', 'person'] }).items).toEqual([]);
    f.assign([], 'room'); expect(f.query('visitLocations', { actor: manager, resourceIds: ['room'] }).items).toEqual([]);
  } finally { f.close(); }
});

test('visit location selection requires book/manage on every co-resource, never busy/details alone', () => {
  const f = fixture();
  try {
    f.setup(); f.resource('room', null); f.assign(['office'], 'room'); f.grant(['details', 'busy']);
    rejects(() => f.query('visitLocations', { actor: reader, resourceIds: ['person'] }), 'CALENDAR_NOT_FOUND');
    f.grant(['book']); expect(f.query('visitLocations', { actor: reader, resourceIds: ['person'] }).items[0].id).toBe('office');
    rejects(() => f.query('visitLocations', { actor: reader, resourceIds: ['person', 'room'] }), 'CALENDAR_NOT_FOUND');
    f.grant(['manage'], 'room'); expect(f.query('visitLocations', { actor: reader, resourceIds: ['person', 'room'] }).items[0].id).toBe('office');
  } finally { f.close(); }
});

test('visit picker queries seed at most sixteen indexed current candidates and ignore a dense unassigned catalog', () => {
  const f = fixture();
  try {
    f.resource(); f.resource('room', null);
    const assigned = Array.from({ length: CALENDAR_LIMITS.selection }, (_, i) => 'selected-' + String(i).padStart(2, '0'));
    for (const id of assigned) f.location(id);
    f.assign(assigned); f.assign(assigned.filter((_, i) => i % 2 === 0), 'room');
    const input = { actor: manager, resourceIds: ['person', 'room'], limit: 3 };
    const before = f.query('visitLocations', input, true);
    expect(before).toMatchObject({ items: [{ id: 'selected-00' }, { id: 'selected-02' }, { id: 'selected-04' }], truncated: true, nextAfter: 'selected-04' });
    // This already-owned memory fixture needs directory density, not thousands
    // of extra command receipts. Keep every original SQL guard enabled while
    // inserting synthetic unassigned catalog entries in one bounded transaction.
    const raw = f.db.getRawDatabase();
    const history = raw.prepare('INSERT INTO _calendar_location_history(id,scope_id,location_id,location_revision,label,region,active) VALUES(?,?,?,1,\'PRIVATE_UNASSIGNED\',NULL,1)');
    const pointer = raw.prepare('INSERT INTO calendar_locations(id,scope_id,revision) VALUES(?,?,1)');
    try {
      raw.transaction(() => {
        for (let i = 0; i < 2048; i++) {
          const id = 'a-unassigned-' + String(i).padStart(4, '0');
          history.run('history-' + id, owner.scopeId, id); pointer.run(id, owner.scopeId);
        }
      })();
    } finally { history.finalize(); pointer.finalize(); }
    const seq = f.db.currentSeq, after = f.query('visitLocations', input, true);
    expect(after).toEqual(before);
    expect(f.query('visitLocations', { ...input, after: before.nextAfter }, true))
      .toMatchObject({ items: [{ id: 'selected-06' }, { id: 'selected-08' }, { id: 'selected-10' }], truncated: true, nextAfter: 'selected-10' });
    expect(f.plans).toHaveLength(6);
    for (const plan of f.plans) {
      expect(plan.sql).not.toMatch(/_calendar_resource_location_(?:members|history)\b/);
      expect(plan.detail).not.toMatch(/SCAN [mlhp]\b|TEMP B-TREE/);
      expect(plan.detail).toContain('calendar_resource_locations_identity');
      if (plan.sql.startsWith('SELECT m.location_id')) {
        expect(plan.params).toEqual([owner.scopeId, 'person', 17]); expect(plan.rowsReturned).toBe(16);
        expect(plan.detail).toMatch(/SEARCH m USING (?:COVERING )?INDEX calendar_resource_location_current_identity \(scope_id=\? AND resource_id=\?\)/);
      } else {
        // Inspect the exact registered SQL and bound candidate IDs: the scope
        // directory/history are point-lookups on <=16 candidates, not a scan.
        expect(plan.sql).toContain('l.id IN (' + assigned.map(() => '?').join(',') + ')');
        expect(plan.params.slice(2, 18)).toEqual(assigned);
        expect(plan.detail).toMatch(/SEARCH l USING INDEX calendar_location_catalog \(scope_id=\? AND id=\?/);
        expect(plan.detail).toContain('calendar_location_history_identity');
        expect(plan.rowsReturned).toBeLessThanOrEqual(input.limit + 1);
      }
    }
    expect(f.db.currentSeq).toBe(seq); expect(raw.query('PRAGMA foreign_key_check').all()).toEqual([]);
    f.plans.length = 0;
    rejects(() => f.query('visitLocations', { actor: owner, resourceIds: ['person', 'room'] }, true), 'CALENDAR_NOT_FOUND');
    expect(f.plans).toEqual([]); // Full co-resource admission precedes candidate lookup.
    f.assign([], 'person');
    expect(f.query('visitLocations', input, true)).toEqual({ items: [], truncated: false, nextAfter: null });
    expect(f.plans).toHaveLength(1); expect(f.plans[0]!.rowsReturned).toBe(0);
  } finally { f.close(); }
});

test('an oversized corrupt current assignment rejects at the seventeen-row probe before directory lookup', () => {
  const f = fixture();
  try {
    f.setup();
    // Explicit corruption injection in this disposable memory database only;
    // normal assignment writes cannot exceed the schema's sixteen-member cap.
    const raw = f.db.getRawDatabase(); raw.run('DROP TRIGGER calendar_resource_location_current_parent');
    const current = raw.prepare('INSERT INTO _calendar_resource_location_current(id,scope_id,resource_id,resource_revision,location_id) VALUES(?,?,\'person\',?,?)');
    try {
      for (let i = 0; i < 16; i++) {
        const id = 'corrupt-' + i; f.location(id);
        current.run('corrupt-member-' + i, owner.scopeId, f.db.get('_calendar_resource_locations', 'person')!.resource_revision as number, id);
      }
    } finally { current.finalize(); }
    rejects(() => f.query('visitLocations', { actor: manager, resourceIds: ['person'] }, true), 'CALENDAR_STATE_INVALID');
    expect(f.plans).toHaveLength(1); expect(f.plans[0]!.params.at(-1)).toBe(17); expect(f.plans[0]!.rowsReturned).toBe(17);
  } finally { f.close(); }
});

test('booking and hold visit snapshots are private historical facts; busy projection contains neither mode nor location', () => {
  const f = fixture();
  try {
    f.setup(); f.appointment(); f.hold('later', later); f.replace({ label: 'RELABELLED_PRIVATE', region: 'us:ca', active: false });
    expect(f.query('appointment', { actor: owner, id: 'visit' }).visit).toEqual(snapshot);
    expect(f.query('appointments', { actor: owner, resourceIds: ['person'], ...range }).items[0].visit).toEqual(snapshot);
    expect(f.query('hold', { actor: owner, id: 'later' }).visit).toEqual(snapshot);
    expect(f.query('holds', { actor: owner, resourceIds: ['person'], ...range }).items[0].visit).toEqual(snapshot);
    f.grant(['busy']); const busy = f.query('busy', { actor: reader, resourceIds: ['person'], ...range });
    expect(busy.items).toHaveLength(2); expect(JSON.stringify(busy)).not.toContain('office'); expect(JSON.stringify(busy)).not.toContain('visit');
    rejects(() => f.query('appointment', { actor: reader, id: 'visit' }), 'CALENDAR_NOT_FOUND');
    rejects(() => f.query('hold', { actor: reader, id: 'later' }), 'CALENDAR_NOT_FOUND');
  } finally { f.close(); }
});

test('missing, hidden and nonassigned IDs uniformly conflict before version lookup, including global managers', () => {
  const f = fixture();
  try {
    f.setup(); f.location('hidden'); f.resource('room', null); f.grant(['book']);
    for (const id of ['missing', 'hidden']) for (const revision of [1, 99]) {
      const probe = { mode: 'in-person', location: { id, revision } };
      rejects(() => f.appointment('probe', { actor: manager, visit: probe }), 'CALENDAR_VISIT_CONFLICT');
      rejects(() => f.hold('probe', { actor: manager, visit: probe }), 'CALENDAR_VISIT_CONFLICT');
    }
    rejects(() => f.appointment('probe', { actor: reader, resourceIds: ['person', 'room'], visit }), 'CALENDAR_NOT_FOUND');
    rejects(() => f.appointment('probe', { actor: manager, resourceIds: ['person', 'room'], visit }), 'CALENDAR_VISIT_CONFLICT');
    f.replace({ active: false });
    rejects(() => f.appointment('old'), 'CALENDAR_VISIT_STALE');
    rejects(() => f.hold('inactive', { visit: { mode: 'in-person', location: { id: 'office', revision: 2 } } }), 'CALENDAR_VISIT_STALE');
    expect(f.db.list('calendar_appointments')).toHaveLength(0); expect(f.db.list('calendar_holds')).toHaveLength(0);
  } finally { f.close(); }
});

test('remote visits carry only fixed modes and never accept URLs, addresses or a location field', () => {
  const f = fixture();
  try {
    f.resource(); f.appointment('video', { visit: { mode: 'video' } }); f.hold('phone', { ...later, visit: { mode: 'phone' } });
    expect(f.query('appointment', { actor: owner, id: 'video' }).visit).toEqual({ mode: 'video' });
    expect(f.query('hold', { actor: owner, id: 'phone' }).visit).toEqual({ mode: 'phone' });
    for (const value of [{ mode: 'video', location: null }, { mode: 'phone', location: visit.location }, { mode: 'video', url: 'https://private.test' },
      { mode: 'in-person', address: 'private address' }, { ...visit, location: { ...visit.location, label: 'spoofed' } }]) {
      rejects(() => f.appointment('invalid', { ...later, visit: value }), 'CALENDAR_INPUT_INVALID');
    }
  } finally { f.close(); }
});

test('visit create/acquire exact replays survive retirement and changed assignments but still require current resource rights', () => {
  const f = fixture();
  try {
    f.setup(); f.grant(['book']); const fields = { actor: reader };
    const accepted = f.appointment('visit', fields), held = f.hold('lease', { ...fields, ...later });
    f.replace({ active: false }); f.assign([]); const seq = f.db.currentSeq;
    expect(f.appointment('visit', fields)).toEqual(accepted); expect(f.hold('lease', { ...fields, ...later })).toEqual(held); expect(f.db.currentSeq).toBe(seq);
    rejects(() => f.appointment('visit', { ...fields, visit: { mode: 'video' } }), 'CALENDAR_INTENT_CONFLICT');
    f.grant(['details']); rejects(() => f.appointment('visit', fields), 'CALENDAR_NOT_FOUND');
  } finally { f.close(); }
});

test('reschedule supports preserve/replace/clear with original-revision replay identity and immutable clear history', () => {
  const f = fixture();
  try {
    f.setup(); f.appointment(); const move = { requestId: 'accepted-move', expectedRevision: 1, ...later };
    const accepted = f.reschedule(move); expect(f.query('appointment', { actor: owner, id: 'visit' }).visit).toEqual(snapshot);
    f.reschedule({ ...later, visit: { mode: 'video' } }); f.reschedule({ ...later, visit: null });
    expect(Object.hasOwn(f.query('appointment', { actor: owner, id: 'visit' }), 'visit')).toBe(false);
    const seq = f.db.currentSeq; expect(f.reschedule(move)).toEqual(accepted); expect(f.db.currentSeq).toBe(seq);
    expect(f.db.list('_calendar_appointment_visit_bindings').map(row => [row.appointment_revision, row.visit_mode])).toEqual([[1, 'in-person'], [3, 'video'], [4, null]]);
    const pointers = f.db.list('_calendar_appointment_visit_current');
    f.command('appointment.cancel', { actor: owner, id: 'visit', requestId: 'cancel', expectedRevision: 4, confirmed: true });
    expect(f.db.list('_calendar_appointment_visit_current')).toEqual(pointers);
  } finally { f.close(); }
});

test('retired visit binding permits no-op and zone-only correction, but occupancy and visit edits require fresh admission', () => {
  const f = fixture();
  try {
    f.setup(); f.appointment(); f.replace({ active: false });
    expect(f.reschedule({ visit }).value.changed).toBe(false);
    expect(f.reschedule({ timeZone: 'America/New_York' }).value.revision).toBe(2);
    rejects(() => f.reschedule({ ...later }), 'CALENDAR_VISIT_STALE');
    f.assign([]); rejects(() => f.reschedule({ ...later }), 'CALENDAR_VISIT_CONFLICT');
    expect(f.reschedule({ timeZone: 'America/New_York', visit: { mode: 'phone' } }).value.revision).toBe(3);
    expect(f.query('appointment', { actor: owner, id: 'visit' }).visit).toEqual({ mode: 'phone' });
  } finally { f.close(); }
});

test('visit-only changes do not recheck availability but occupancy changes do', () => {
  const f = fixture();
  try {
    f.setup(); f.appointment();
    f.command('resource.availability', { actor: owner, requestId: 'availability', id: 'person', expectedRevision: f.db.get('calendar_resources', 'person')!.revision,
      mode: 'windows', windows: [] });
    expect(f.reschedule({ visit: { mode: 'phone' } }).value.revision).toBe(2);
    rejects(() => f.reschedule({ ...later }), 'CALENDAR_AVAILABILITY_CONFLICT');
  } finally { f.close(); }
});

test('legacy wire digests and omitted visit shapes are unchanged even after a later visit generation', () => {
  const f = fixture();
  try {
    f.resource(); f.appointment('visit', { visit: undefined }); f.hold('lease', { ...later, visit: undefined });
    const interval = normalizeCalendarTimedInterval(timed);
    expect(f.db.list('_calendar_receipts').find(row => row.request_id === 'create-visit')!.digest).toBe(calendarHash(['appointment.create', 'visit', ['person'], 'PRIVATE_TITLE', interval]));
    expect(f.db.list('_calendar_hold_receipts')[0]!.digest).toBe(calendarHash(['hold.acquire', 'lease', ['person'], normalizeCalendarTimedInterval(later), 300]));
    const move = { requestId: 'legacy-move', expectedRevision: 1, timeZone: 'America/New_York' };
    const accepted = f.reschedule(move);
    expect(f.db.list('_calendar_receipts').find(row => row.request_id === 'legacy-move')!.digest)
      .toBe(calendarHash(['appointment.reschedule', 'visit', 1, normalizeCalendarTimedInterval({ ...timed, timeZone: 'America/New_York' })]));
    f.reschedule({ timeZone: 'America/New_York', visit: { mode: 'video' } });
    const seq = f.db.currentSeq; expect(f.reschedule(move)).toEqual(accepted); expect(f.db.currentSeq).toBe(seq);
    expect(Object.hasOwn(f.query('hold', { actor: owner, id: 'lease' }), 'visit')).toBe(false);
  } finally { f.close(); }
});

test('typed defaults and visit intersection are checked without hidden catalog lookup; visit wire replay survives both catalogs retiring', () => {
  const f = fixture();
  try {
    f.setup();
    f.command('type.create', { actor: manager, requestId: 'type', id: 'consult', label: 'PRIVATE_TYPE', durationMinutes: 60, bufferBeforeMinutes: 5, bufferAfterMinutes: 10, colorKey: null, active: true });
    const typed = { appointmentType: { id: 'consult', revision: 1 } };
    const accepted = f.appointment('visit', typed);
    expect(f.query('appointment', { actor: owner, id: 'visit' })).toMatchObject({ visit: snapshot, bufferBeforeMinutes: 5, bufferAfterMinutes: 10 });
    const hidden = { ...typed, appointmentType: { id: 'missing', revision: 1 }, visit: { mode: 'in-person', location: { id: 'hidden', revision: 99 } } };
    rejects(() => f.appointment('probe', { ...later, ...hidden }), 'CALENDAR_VISIT_CONFLICT');
    f.command('resource.types', { actor: manager, requestId: 'required', id: 'person', expectedRevision: f.db.get('calendar_resources', 'person')!.revision, mode: 'required', typeIds: [] });
    f.replace({ active: false }); const seq = f.db.currentSeq;
    expect(f.appointment('visit', typed)).toEqual(accepted); expect(f.db.currentSeq).toBe(seq);
  } finally { f.close(); }
});

test('hold confirmation transfers the exact immutable visit and rejects stale catalogs atomically', () => {
  const f = fixture();
  try {
    f.setup(); f.hold(); const accepted = f.confirm();
    expect(f.query('appointment', { actor: owner, id: 'appointment-lease' }).visit).toEqual(snapshot);
    f.hold('later', later); f.replace({ label: 'UPDATED' }); const seq = f.db.currentSeq;
    rejects(() => f.confirm('later'), 'CALENDAR_VISIT_STALE'); expect(f.db.currentSeq).toBe(seq);
    expect(f.db.get('calendar_holds', 'later')!.status).toBe('held'); expect(f.db.get('calendar_appointments', 'appointment-later')).toBeNull();
    expect(f.confirm()).toEqual(accepted); expect(f.db.currentSeq).toBe(seq);
    expect(f.query('hold', { actor: owner, id: 'later' }).visit).toEqual(snapshot);
  } finally { f.close(); }
});

test('visit history capacity and late reservation failures roll back every parent, binding, receipt and budget', () => {
  const f = fixture();
  try {
    f.setup(); f.appointment();
    f.db.update('_calendar_usage', 'appointmentVisitHistory', { count: CALENDAR_LIMITS.appointmentVisitHistory });
    const seq = f.db.currentSeq;
    rejects(() => f.appointment('full', later), 'CALENDAR_CAPACITY'); rejects(() => f.reschedule({ visit: { mode: 'video' } }), 'CALENDAR_CAPACITY');
    f.hold('full', later); const held = f.db.currentSeq; rejects(() => f.confirm('full'), 'CALENDAR_CAPACITY'); expect(f.db.currentSeq).toBe(held);
    expect(f.db.get('calendar_holds', 'full')!.status).toBe('held'); expect(f.db.get('calendar_appointments', 'visit')!.revision).toBe(1);
    f.db.update('_calendar_usage', 'appointmentVisitHistory', { count: 1 });
    f.resource('room', null); f.assign(['office'], 'room');
    f.db.getRawDatabase().run("CREATE TRIGGER synthetic_failure BEFORE INSERT ON _calendar_reservations WHEN NEW.resource_id='room' BEGIN SELECT RAISE(ABORT,'synthetic failure'); END");
    const before = f.db.currentSeq, budget = f.db.get('_calendar_usage', 'appointmentVisitHistory');
    expect(() => f.appointment('failed', { actor: manager, resourceIds: ['person', 'room'], startAt: '2030-01-01T14:00:00.000Z', endAt: '2030-01-01T15:00:00.000Z' })).toThrow();
    expect(f.db.currentSeq).toBe(before); expect(f.db.get('calendar_appointments', 'failed')).toBeNull();
    expect(f.db.list('_calendar_appointment_visit_bindings')).toHaveLength(1); expect(f.db.get('_calendar_usage', 'appointmentVisitHistory')).toEqual(budget);
    expect(seq).toBeLessThan(held);
  } finally { f.close(); }
});

test('visit semantic audit uses fixed mode/change facts only and emits no replay/no-op success evidence', () => {
  const f = fixture(true);
  try {
    f.setup(); f.drain(); const accepted = f.appointment(); expect(f.appointment()).toEqual(accepted);
    expect(f.reschedule({ visit }).value.changed).toBe(false); f.reschedule({ visit: { mode: 'phone' } }); f.reschedule({ visit: null });
    const events = f.source!.control({}).rows.map(row => row.event);
    expect(events.map(event => event.action)).toEqual(['calendar.appointment.created', 'calendar.appointment.rescheduled', 'calendar.appointment.rescheduled']);
    expect(events.map(event => [event.metadata.visitMode ?? null, event.metadata.visitChanged ?? null])).toEqual([['in-person', null], ['phone', true], [null, true]]);
    expect(events.every(event => Object.keys(event.metadata).every(key => ['sequence', 'revision', 'resourceCount', 'status', 'visitMode', 'visitChanged'].includes(key)))).toBe(true);
    for (const privateValue of ['office', 'PRIVATE_OFFICE_LABEL', 'us:ny', timed.startAt]) expect(JSON.stringify(events)).not.toContain(privateValue);
  } finally { f.close(); }
});

test('late semantic audit pressure rolls back visit-only reschedule and hold confirmation before consuming the lease', () => {
  const f = fixture(true, 1);
  try {
    f.resource(); f.drain(); f.location(); f.drain(); f.assign(); f.drain(); f.hold(); f.drain();
    const seq = f.db.currentSeq;
    expect(() => f.confirm()).toThrow(expect.objectContaining({ code: 'DATABASE_BACKPRESSURE', outcome: 'not-committed' }));
    expect(f.db.currentSeq).toBe(seq); expect(f.db.list('calendar_appointments')).toHaveLength(0);
    expect(f.db.list('_calendar_appointment_visit_bindings')).toHaveLength(0); expect(f.db.list('_calendar_appointment_visit_current')).toHaveLength(0);
    expect(f.db.get('calendar_holds', 'lease')!.status).toBe('held'); expect(f.source!.control({}).rows).toHaveLength(0);
    f.command('hold.release', { actor: owner, id: 'lease', requestId: 'release', expectedRevision: 1, confirmed: true }); f.drain();
    f.appointment(); const original = f.query('appointment', { actor: owner, id: 'visit' }), before = f.db.currentSeq;
    expect(() => f.reschedule({ visit: { mode: 'video' } })).toThrow(expect.objectContaining({ code: 'DATABASE_BACKPRESSURE' }));
    expect(f.db.currentSeq).toBe(before); expect(f.query('appointment', { actor: owner, id: 'visit' })).toEqual(original);
    expect(f.db.list('_calendar_appointment_visit_bindings')).toHaveLength(1);
  } finally { f.close(); }
});
