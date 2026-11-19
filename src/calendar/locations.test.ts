/** Native memory-only directory qualification; every query copy and database closes in finally. */
import { Database, type SQLQueryBindings } from 'bun:sqlite';
import { expect, spyOn, test } from 'bun:test';
import type { DatabaseSerializableValue } from '../databases/database-operations';
import { createDatabaseReadQuerySession, withDatabaseReadQuerySession } from '../databases/database-read-query-capability';
import { runDatabaseRealmCommand, runDatabaseRealmQuery } from '../databases/database-realm';
import { createReactiveDB } from '../sync/reactive-db';
import type { CalendarActor } from './contracts';
import { CalendarError, readCalendarRejection, type CalendarErrorCode } from './error';
import { calendarRealm } from './realm';
import { CALENDAR_LIMITS } from './realm-model';
import { calendarLocationCurrentId } from './locations-model';

const actor: CalendarActor = { scopeId: 'tenant:synthetic-locations', userId: 'owner', principal: 'owner-session', manageAll: false, createOwn: true };
const manager: CalendarActor = { ...actor, userId: 'manager', principal: 'manager-session', manageAll: true };
const reader: CalendarActor = { ...actor, userId: 'reader', principal: 'reader-session', createOwn: false };
const timed = { startAt: '2030-01-01T10:00:00.000Z', endAt: '2030-01-01T11:00:00.000Z', timeZone: 'UTC' };
function fixture() {
  const db = createReactiveDB({ mode: 'memory' });
  try {
    const raw = db.getRawDatabase(); raw.run('PRAGMA temp_store=MEMORY');
    for (const [name, schema] of Object.entries(calendarRealm.tables)) db.defineTable(name, schema);
    for (const migration of calendarRealm.migrations) migration.up(raw);
    const command = (name: string, input: unknown): any => {
      const result = runDatabaseRealmCommand(calendarRealm, db, 'calendar.' + name, input as DatabaseSerializableValue) as any;
      return result.value;
    };
    const plans: { sql: string; detail: string; rowsReturned: number }[] = [];
    const query = (name: string, input: unknown, recordPlans = false): any => {
      const copy = Database.deserialize(raw.serialize(), { readonly: true, strict: true });
      const original = copy.prepare.bind(copy);
      const observer = recordPlans ? spyOn(copy, 'prepare').mockImplementation(<TRow, TParams extends SQLQueryBindings | SQLQueryBindings[]>(sql: string, parameters?: TParams) => {
        const statement = original<TRow, TParams>(sql, parameters);
        return new Proxy(statement, { get(target, key) {
          const member = Reflect.get(target, key);
          if ((key === 'all' || key === 'get') && sql.includes('_calendar_resource_location_current')) return (...params: never[]) => {
            const result = member.apply(target, params), explain = original('EXPLAIN QUERY PLAN ' + sql);
            try {
              plans.push({ sql, detail: (explain.all(...params) as { detail: string }[]).map(row => row.detail).join('\n'),
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
    command('owner.bind', { ownerId: 'synthetic-owner', scopeId: actor.scopeId });
    const resource = (id = 'person', ownerId: string | null = actor.userId) => command('resource.create', { actor: manager, requestId: 'resource-' + id,
      id, label: 'PRIVATE_RESOURCE', kind: ownerId === null ? 'room' : 'person', ownerId, timeZone: 'UTC' });
    const location = (id = 'location', overrides: Record<string, unknown> = {}) => command('location.create', { actor: manager,
      requestId: 'location-' + id, id, label: 'PRIVATE_LOCATION_' + id, ...overrides });
    const replace = (id: string, overrides: Record<string, unknown> = {}) => command('location.replace', { actor: manager,
      id, requestId: 'replace-' + id + '-' + db.currentSeq, expectedRevision: db.get('calendar_locations', id)!.revision,
      label: 'PRIVATE_RENAMED_' + id, region: null, active: true, ...overrides });
    const assign = (id: string, locationIds: string[], overrides: Record<string, unknown> = {}) => {
      const subject = (overrides.actor ?? manager) as CalendarActor;
      return command('resource.locations', { actor: manager, id, requestId: 'assignment-' + id + '-' + db.currentSeq,
        expectedRevision: db.get('calendar_resources', id)!.revision, locationIds, locationWitnesses: query('locationAssignmentWitnesses', { actor: subject, locationIds }), ...overrides });
    };
    const grant = (id: string, grants: string[], user = reader) => command('resource.grant', { actor: manager, id, requestId: 'grant-' + id + '-' + db.currentSeq,
      expectedRevision: db.get('calendar_resources', id)!.revision, userId: user.userId, grants });
    const snapshot = () => Object.fromEntries(Object.keys(calendarRealm.tables).map(table => [table, raw.query(`SELECT * FROM ${table} ORDER BY id`).all()]));
    return { db, raw, command, query, plans, resource, location, replace, assign, grant, snapshot, close: () => db.dispose() };
  } catch (error) { db.dispose(); throw error; }
}
function rejects(run: () => unknown, code: CalendarErrorCode): void {
  try { run(); throw new Error('Expected rejection'); }
  catch (error) { expect((error instanceof CalendarError ? error : readCalendarRejection(error))?.code).toBe(code); }
}

test('directory starts empty; only current global managers write and unassigned/inactive locations stay manager-only', () => {
  const f = fixture();
  try {
    expect(f.query('locations', { actor })).toEqual({ items: [], truncated: false, nextAfter: null });
    f.resource();
    for (const subject of [actor, reader]) rejects(() => f.location('denied', { actor: subject }), 'CALENDAR_FORBIDDEN');
    f.location('inactive', { active: false, region: 'US-IN' }); f.location('unassigned');
    expect(f.query('locations', { actor: manager }).items.map((row: any) => row.id)).toEqual(['inactive', 'unassigned']);
    expect(f.query('location', { actor: manager, id: 'inactive' })).toEqual({ id: 'inactive', label: 'PRIVATE_LOCATION_inactive', region: 'US-IN', active: false, revision: 1 });
    expect(f.query('locations', { actor }).items).toEqual([]);
    for (const id of ['inactive', 'unassigned', 'missing']) rejects(() => f.query('location', { actor, id }), 'CALENDAR_NOT_FOUND');
    rejects(() => f.replace('inactive', { actor }), 'CALENDAR_FORBIDDEN');
    rejects(() => f.query('locations', { actor: { ...manager, scopeId: 'tenant:other' } }), 'CALENDAR_STATE_INVALID');
  } finally { f.close(); }
});

test('location replacement keeps immutable revisions, explicit fields, safe receipts and canonical no-op/replay', () => {
  const f = fixture();
  try {
    const create = { actor: manager, id: 'location', requestId: 'create', label: 'PRIVATE_FIRST', region: 'US-IN', active: true };
    const accepted = f.command('location.create', create), seq = f.db.currentSeq;
    expect(f.command('location.create', create)).toEqual(accepted); expect(f.db.currentSeq).toBe(seq);
    rejects(() => f.command('location.create', { ...create, label: 'PRIVATE_OTHER' }), 'CALENDAR_INTENT_CONFLICT');
    rejects(() => f.command('location.create', { ...create, requestId: 'duplicate' }), 'CALENDAR_INTENT_CONFLICT');
    const update = { actor: manager, id: 'location', requestId: 'update', expectedRevision: 1, label: 'PRIVATE_SECOND', region: null, active: false };
    rejects(() => f.command('location.replace', { ...update, expectedRevision: 2 }), 'CALENDAR_REVISION_CONFLICT');
    const changed = f.command('location.replace', update), changedSeq = f.db.currentSeq;
    expect(changed).toEqual({ requestId: 'update', operation: 'location.updated', id: 'location', revision: 2, changed: true });
    expect(f.command('location.replace', update)).toEqual(changed); expect(f.db.currentSeq).toBe(changedSeq);
    expect(f.command('location.replace', { ...update, requestId: 'noop', expectedRevision: 2 })).toMatchObject({ revision: 2, changed: false });
    expect(f.query('location', { actor: manager, id: 'location' })).toEqual({ id: 'location', label: 'PRIVATE_SECOND', region: null, active: false, revision: 2 });
    expect(f.raw.query('SELECT location_revision,label,region,active FROM _calendar_location_history ORDER BY location_revision').all()).toEqual([
      { location_revision: 1, label: 'PRIVATE_FIRST', region: 'US-IN', active: 1 }, { location_revision: 2, label: 'PRIVATE_SECOND', region: null, active: 0 },
    ]);
    expect(f.db.list('_calendar_location_receipts')).toHaveLength(3); expect(f.db.list('_calendar_location_effect_intents')).toHaveLength(2);
    expect(f.query('receipt', { actor: manager, requestId: 'create' })).toEqual(accepted);
    expect(JSON.stringify(f.query('receipt', { actor: manager, requestId: 'update' }))).not.toContain('PRIVATE');
    const demoted = { ...manager, manageAll: false };
    rejects(() => f.command('location.replace', { ...update, actor: demoted }), 'CALENDAR_FORBIDDEN');
    rejects(() => f.query('receipt', { actor: demoted, requestId: 'update' }), 'CALENDAR_FORBIDDEN');
  } finally { f.close(); }
});

test('any current resource right reveals only associated directory entries, with authorization before page limits', () => {
  const f = fixture();
  try {
    f.resource('visible'); f.resource('hidden', null);
    for (const id of ['a-hidden', 'b-shared', 'c-visible', 'd-unassigned']) f.location(id);
    f.assign('hidden', ['a-hidden', 'b-shared']); f.assign('visible', ['b-shared', 'c-visible']);
    expect(f.query('locations', { actor: reader, limit: 1 })).toEqual({ items: [], truncated: false, nextAfter: null });
    for (const right of ['busy', 'details', 'book', 'manage']) {
      f.grant('visible', [right]);
      const page = f.query('locations', { actor: reader, limit: 1 });
      expect(page.items.map((row: any) => row.id)).toEqual(['b-shared']); expect(page.truncated).toBe(true); expect(page.nextAfter).toBe('b-shared');
      expect(f.query('locations', { actor: reader, limit: 1, after: page.nextAfter }).items.map((row: any) => row.id)).toEqual(['c-visible']);
      expect(f.query('resourceLocations', { actor: reader, id: 'visible' })).toEqual({ resourceId: 'visible', resourceRevision: f.db.get('calendar_resources', 'visible')!.revision, locationIds: ['b-shared', 'c-visible'] });
      expect(Object.keys(f.query('location', { actor: reader, id: 'b-shared' })).sort()).toEqual(['active', 'id', 'label', 'region', 'revision']);
      for (const id of ['a-hidden', 'd-unassigned', 'missing']) rejects(() => f.query('location', { actor: reader, id }), 'CALENDAR_NOT_FOUND');
      rejects(() => f.query('resourceLocations', { actor: reader, id: 'hidden' }), 'CALENDAR_NOT_FOUND');
    }
    f.grant('visible', []);
    expect(f.query('locations', { actor: reader, limit: 1 })).toEqual({ items: [], truncated: false, nextAfter: null });
    expect(f.query('locations', { actor }).items.map((row: any) => row.id)).toEqual(['b-shared', 'c-visible']);
  } finally { f.close(); }
});

test('assignment replacement is resource-manage-only, revisioned, sorted, no-op aware and replay needs current manage', () => {
  const f = fixture();
  try {
    f.resource(); f.resource('source'); f.location('a'); f.location('z'); f.assign('source', ['a', 'z']);
    expect(f.query('resourceLocations', { actor, id: 'person' })).toEqual({ resourceId: 'person', resourceRevision: 1, locationIds: [] });
    expect(f.assign('person', [], { actor })).toMatchObject({ revision: 1, changed: false });
    f.grant('person', ['book']); rejects(() => f.assign('person', ['a'], { actor: reader }), 'CALENDAR_NOT_FOUND');
    const assignment = { actor, id: 'person', requestId: 'assign', expectedRevision: 2, locationIds: ['z', 'a'], locationWitnesses: f.query('locationAssignmentWitnesses', { actor, locationIds: ['a', 'z'] }) };
    const result = f.command('resource.locations', assignment), seq = f.db.currentSeq;
    expect(result).toMatchObject({ operation: 'resource.locations-changed', revision: 3, changed: true });
    expect(f.command('resource.locations', { ...assignment, locationIds: ['a', 'z'] })).toEqual(result); expect(f.db.currentSeq).toBe(seq);
    rejects(() => f.command('resource.locations', { ...assignment, locationIds: ['a'], locationWitnesses: assignment.locationWitnesses.filter((witness: any) => witness.locationId === 'a') }), 'CALENDAR_INTENT_CONFLICT');
    expect(f.assign('person', ['a', 'z'], { actor })).toMatchObject({ revision: 3, changed: false });
    expect(f.query('resourceLocations', { actor, id: 'person' }).locationIds).toEqual(['a', 'z']);
    expect(f.db.list('_calendar_resource_location_history')).toHaveLength(2); expect(f.db.list('_calendar_resource_location_members')).toHaveLength(4);
    f.grant('person', ['manage']);
    const delegated = { actor: reader, id: 'person', requestId: 'delegated', expectedRevision: 4, locationIds: ['a'] };
    f.command('resource.locations', delegated); f.grant('person', ['busy']);
    rejects(() => f.command('resource.locations', delegated), 'CALENDAR_NOT_FOUND');
    rejects(() => f.query('receipt', { actor: reader, requestId: 'delegated' }), 'CALENDAR_NOT_FOUND');
    expect(f.query('resourceLocations', { actor, id: 'person' }).resourceRevision).toBe(6);
    expect(f.db.get('_calendar_resource_locations', 'person')!.resource_revision).toBe(5);
  } finally { f.close(); }
});

test('inactive locations may be retained but not newly assigned, and deactivation preserves appointments and all history', () => {
  const f = fixture();
  try {
    f.resource(); f.resource('other', null); f.resource('source'); f.location('a'); f.location('b'); f.assign('person', ['a']); f.assign('source', ['b']);
    f.command('appointment.create', { actor, id: 'appointment', requestId: 'appointment', title: 'PRIVATE_APPOINTMENT', resourceIds: ['person'], ...timed });
    f.replace('a', { active: false, region: 'opaque:west' });
    expect(f.query('location', { actor, id: 'a' }).active).toBe(false);
    expect(f.assign('person', ['a', 'b'], { actor })).toMatchObject({ changed: true, revision: 3 });
    rejects(() => f.assign('other', ['a']), 'CALENDAR_NOT_FOUND');
    f.assign('person', ['b']); rejects(() => f.assign('person', ['a', 'b']), 'CALENDAR_NOT_FOUND');
    rejects(() => f.query('location', { actor, id: 'a' }), 'CALENDAR_NOT_FOUND');
    expect(f.db.get('calendar_appointments', 'appointment')!.status).toBe('confirmed'); expect(f.db.get('calendar_appointments', 'appointment')!.revision).toBe(1);
    expect(f.db.list('_calendar_resource_location_history')).toHaveLength(4);
    expect(f.raw.query("SELECT location_ids_json FROM _calendar_resource_location_history WHERE resource_id='person' ORDER BY resource_revision").all()).toEqual([
      { location_ids_json: '["a"]' }, { location_ids_json: '["a","b"]' }, { location_ids_json: '["b"]' },
    ]);
  } finally { f.close(); }
});

test('nonmanager assignment cannot discover hidden IDs and live witnesses fail closed after rights or membership changes', () => {
  const f = fixture();
  try {
    f.resource(); f.resource('witness', null); f.resource('hidden', null);
    f.location('a'); f.location('hidden-location'); f.assign('witness', ['a']); f.assign('hidden', ['hidden-location']);
    const assignment = { actor, id: 'person', requestId: 'assignment', expectedRevision: 1, locationIds: ['a'] };
    const before = f.snapshot();
    rejects(() => f.command('resource.locations', assignment), 'CALENDAR_NOT_FOUND');
    rejects(() => f.command('resource.locations', { ...assignment, locationIds: ['hidden-location'], locationWitnesses: [{ locationId: 'hidden-location', resourceId: 'hidden' }] }), 'CALENDAR_NOT_FOUND');
    expect(f.query('locationAssignmentWitnesses', { actor, locationIds: ['a', 'hidden-location', 'missing'] })).toEqual([]);
    expect(f.snapshot()).toEqual(before);
    f.grant('witness', ['busy'], actor);
    const witnesses = f.query('locationAssignmentWitnesses', { actor, locationIds: ['a', 'hidden-location', 'missing'] });
    expect(witnesses).toEqual([{ locationId: 'a', resourceId: 'witness' }]);
    f.grant('witness', [], actor);
    rejects(() => f.command('resource.locations', { ...assignment, locationWitnesses: witnesses }), 'CALENDAR_NOT_FOUND');
    f.grant('witness', ['busy'], actor); f.assign('witness', []);
    rejects(() => f.command('resource.locations', { ...assignment, locationWitnesses: witnesses }), 'CALENDAR_NOT_FOUND');
    f.assign('witness', ['a']);
    const accepted = f.command('resource.locations', { ...assignment, locationWitnesses: witnesses });
    expect(accepted).toMatchObject({ revision: 2, changed: true });
    f.grant('witness', [], actor); f.assign('witness', []);
    expect(f.command('resource.locations', assignment)).toEqual(accepted);
    expect(f.query('location', { actor, id: 'a' }).id).toBe('a');
    expect(f.db.list('_calendar_resource_location_current')).toHaveLength(2);
    expect(f.db.list('_calendar_resource_location_members').length).toBeGreaterThan(2);
    rejects(() => f.command('resource.locations', { ...assignment, requestId: 'bad-witness', expectedRevision: 2, locationWitnesses: [{ locationId: 'hidden-location', resourceId: 'hidden' }] }), 'CALENDAR_INPUT_INVALID');
  } finally { f.close(); }
});

test('resource filtering is OR within IDs/regions and AND across dimensions, and never expands existing rights', () => {
  const f = fixture();
  try {
    for (const id of ['a-hidden', 'b-east', 'c-west', 'd-both', 'e-empty']) f.resource(id, id === 'a-hidden' ? null : actor.userId);
    f.location('east', { region: 'region:1' }); f.location('west', { region: 'region:2' }); f.location('null', { region: null });
    f.assign('a-hidden', ['east']); f.assign('b-east', ['east']); f.assign('c-west', ['west']); f.assign('d-both', ['east', 'west']);
    const ids = (filters: Record<string, unknown> = {}) => f.query('resources', { actor, ...filters }).items.map((row: any) => row.id);
    expect(ids({ locationIds: ['east'] })).toEqual(['b-east', 'd-both']);
    expect(ids({ regions: ['region:2'] })).toEqual(['c-west', 'd-both']);
    expect(ids({ locationIds: ['east'], regions: ['region:2'] })).toEqual([]);
    expect(ids({ locationIds: ['west', 'east'], regions: ['region:2', 'region:1'] })).toEqual(['b-east', 'c-west', 'd-both']);
    expect(ids({ locationIds: [], regions: [] })).toEqual(['b-east', 'c-west', 'd-both', 'e-empty']);
    expect(ids({ locationIds: ['missing'] })).toEqual([]);
    expect(f.query('resources', { actor, locationIds: ['east'], limit: 1 })).toMatchObject({ truncated: true, nextAfter: 'b-east' });
    expect(ids({ locationIds: ['east'], after: 'b-east', limit: 1 })).toEqual(['d-both']);
    expect(f.query('resources', { actor: reader, locationIds: ['east'], limit: 1 })).toEqual({ items: [], truncated: false, nextAfter: null });
    f.replace('east', { region: 'region:3', active: false });
    expect(ids({ regions: ['region:1'] })).toEqual([]); expect(ids({ regions: ['region:3'] })).toEqual(['b-east', 'd-both']);
  } finally { f.close(); }
});

test('assignment changes fence captured hold resource revisions but location metadata alone does not bind or authorize bookings', () => {
  const clock = spyOn(Date, 'now').mockReturnValue(Date.parse('2030-01-01T09:00:00.000Z')), f = fixture();
  try {
    f.resource(); f.location();
    f.command('hold.acquire', { actor, id: 'hold', requestId: 'hold', resourceIds: ['person'], ...timed });
    f.assign('person', ['location']);
    rejects(() => f.command('hold.confirm', { actor, id: 'hold', appointmentId: 'appointment', requestId: 'confirm', expectedRevision: 1, title: 'PRIVATE' }), 'CALENDAR_HOLD_STALE');
    expect(f.db.get('calendar_holds', 'hold')!.status).toBe('held'); expect(f.db.get('calendar_appointments', 'appointment')).toBeNull();
    f.command('hold.release', { actor, id: 'hold', requestId: 'release', expectedRevision: 1, confirmed: true });
    f.replace('location', { active: false });
    f.command('appointment.create', { actor, id: 'appointment', requestId: 'book', resourceIds: ['person'], title: 'PRIVATE', ...timed });
    expect(f.db.get('calendar_appointments', 'appointment')!.status).toBe('confirmed');
    expect(f.db.get('calendar_appointments', 'appointment')!.location_id).toBeUndefined();
  } finally { f.close(); clock.mockRestore(); }
});

test('strict metadata/selection validation rejects missing replacement fields, excess, duplicates and scope injection without writes', () => {
  const f = fixture();
  try {
    f.resource(); f.location(); const before = f.snapshot(), seq = f.db.currentSeq;
    for (const fields of [{ label: '' }, { label: 'x'.repeat(257) }, { region: '' }, { region: 'x'.repeat(65) }, { region: 'a b' }, { region: 'é' }, { active: 1 }, { scopeId: 'tenant:other' }]) {
      rejects(() => f.location('invalid', { requestId: 'invalid', ...fields }), 'CALENDAR_INPUT_INVALID');
    }
    for (const field of ['label', 'region', 'active']) {
      const replacement: Record<string, unknown> = { actor: manager, id: 'location', requestId: 'missing-field', expectedRevision: 1, label: 'PRIVATE', region: null, active: true };
      delete replacement[field]; rejects(() => f.command('location.replace', replacement), 'CALENDAR_INPUT_INVALID');
    }
    for (const locationIds of [['location', 'location'], Array.from({ length: 17 }, (_, i) => 'l' + i), ['bad id'], null]) {
      rejects(() => f.assign('person', locationIds as string[]), 'CALENDAR_INPUT_INVALID');
    }
    for (const filters of [{ regions: ['US-IN', 'US-IN'] }, { regions: [null] }, { regions: ['bad region'] }, { regions: Array.from({ length: 17 }, (_, i) => 'r' + i) }, { locationIds: ['location', 'location'] }]) {
      rejects(() => f.query('resources', { actor, ...filters }), 'CALENDAR_INPUT_INVALID');
    }
    rejects(() => f.query('locations', { actor, locationIds: ['location'] }), 'CALENDAR_INPUT_INVALID');
    rejects(() => f.query('resourceLocations', { actor, id: 'person', resourceRevision: 1 }), 'CALENDAR_INPUT_INVALID');
    expect(f.snapshot()).toEqual(before); expect(f.db.currentSeq).toBe(seq);
  } finally { f.close(); }
});

test('late history/member failures atomically roll back revision, pointer, receipts, usage and prior assignments', () => {
  const f = fixture();
  try {
    f.resource(); f.location('a'); f.location('b'); f.assign('person', ['a']);
    let before = f.snapshot(), seq = f.db.currentSeq;
    f.raw.run("CREATE TRIGGER synthetic_member_failure BEFORE INSERT ON _calendar_resource_location_members WHEN NEW.location_id='b' BEGIN SELECT RAISE(ABORT,'synthetic failure'); END");
    expect(() => f.assign('person', ['a', 'b'])).toThrow(); expect(f.snapshot()).toEqual(before); expect(f.db.currentSeq).toBe(seq);
    f.raw.run('DROP TRIGGER synthetic_member_failure');
    f.raw.run("CREATE TRIGGER synthetic_current_failure BEFORE INSERT ON _calendar_resource_location_current WHEN NEW.location_id='b' BEGIN SELECT RAISE(ABORT,'synthetic failure'); END");
    expect(() => f.assign('person', ['a', 'b'])).toThrow(); expect(f.snapshot()).toEqual(before); expect(f.db.currentSeq).toBe(seq);
    f.raw.run('DROP TRIGGER synthetic_current_failure');
    f.raw.run("CREATE TRIGGER synthetic_pointer_failure BEFORE UPDATE ON calendar_locations BEGIN SELECT RAISE(ABORT,'synthetic failure'); END");
    expect(() => f.replace('a')).toThrow(); expect(f.snapshot()).toEqual(before); expect(f.db.currentSeq).toBe(seq);
    f.raw.run('DROP TRIGGER synthetic_pointer_failure');
    f.raw.run("CREATE TRIGGER synthetic_location_failure BEFORE INSERT ON calendar_locations BEGIN SELECT RAISE(ABORT,'synthetic failure'); END");
    expect(() => f.location('c')).toThrow(); expect(f.snapshot()).toEqual(before); expect(f.db.currentSeq).toBe(seq);
  } finally { f.close(); }
});

test('directory and assignment history budgets and the global receipt budget fail atomically without consuming identities', () => {
  for (const budget of ['locations', 'locationHistory', 'resourceLocationHistory', 'receipts'] as const) {
    const f = fixture();
    try {
      f.resource(); f.location('a');
      const prior = f.db.get('_calendar_usage', budget);
      if (prior) f.db.update('_calendar_usage', budget, { count: CALENDAR_LIMITS[budget] });
      else f.db.createStrict('_calendar_usage', { id: budget, count: CALENDAR_LIMITS[budget] });
      const before = f.snapshot(), seq = f.db.currentSeq;
      rejects(() => budget === 'resourceLocationHistory' ? f.assign('person', ['a']) : f.location('b'), 'CALENDAR_CAPACITY');
      expect(f.snapshot()).toEqual(before); expect(f.db.currentSeq).toBe(seq);
    } finally { f.close(); }
  }
});

test('location pointers, immutable histories and indexed memberships resist replacement, deletion, rewind and append after sealing', () => {
  const f = fixture();
  try {
    f.resource(); f.location('a'); f.location('b'); f.assign('person', ['a', 'b']);
    f.raw.run('PRAGMA recursive_triggers=OFF');
    for (const table of ['_calendar_location_history', '_calendar_resource_location_history', '_calendar_resource_location_members', '_calendar_location_receipts', '_calendar_location_effect_intents']) {
      const before = f.raw.query(`SELECT * FROM ${table} ORDER BY id`).all();
      expect(() => f.raw.run(`UPDATE ${table} SET id=id`)).toThrow(); expect(() => f.raw.run(`DELETE FROM ${table}`)).toThrow();
      expect(() => f.raw.run(`INSERT OR REPLACE INTO ${table} SELECT * FROM ${table} LIMIT 1`)).toThrow();
      expect(f.raw.query(`SELECT * FROM ${table} ORDER BY id`).all()).toEqual(before);
    }
    for (const table of ['calendar_locations', '_calendar_resource_locations']) {
      expect(() => f.raw.run(`INSERT OR REPLACE INTO ${table} SELECT * FROM ${table} LIMIT 1`)).toThrow();
      expect(() => f.raw.run(`DELETE FROM ${table}`)).toThrow();
    }
    expect(() => f.db.update('calendar_locations', 'a', { revision: 2 })).toThrow();
    expect(() => f.db.update('_calendar_resource_locations', 'person', { resource_revision: 1 })).toThrow();
    expect(() => f.db.update('_calendar_resource_locations', 'person', { resource_revision: 3 })).toThrow();
    expect(() => f.db.createStrict('_calendar_resource_location_members', { id: 'late', scope_id: actor.scopeId, resource_id: 'person', resource_revision: 2, location_id: 'a' })).toThrow();
    expect(f.raw.query('PRAGMA foreign_key_check').all()).toEqual([]);
  } finally { f.close(); }
});

test('all four receipt stores enforce one global request namespace and retain true location/resource target kinds', () => {
  const f = fixture();
  try {
    f.resource(); f.location(); f.assign('person', ['location']);
    f.command('block.create', { actor: manager, id: 'block', requestId: 'block', resourceIds: ['person'], title: 'PRIVATE', ...timed });
    f.command('hold.acquire', { actor: manager, id: 'hold', requestId: 'hold', resourceIds: ['person'], ...timed, startAt: '2030-01-01T12:00:00.000Z', endAt: '2030-01-01T13:00:00.000Z' });
    const stores = ['_calendar_receipts', '_calendar_block_receipts', '_calendar_hold_receipts', '_calendar_location_receipts'];
    const columns = ['id', 'scope_id', 'principal', 'request_id', 'digest', 'result_json', 'target_kind', 'target_id', 'required_right'];
    f.raw.run('PRAGMA recursive_triggers=OFF');
    for (const target of stores) for (const source of stores) {
      if (source === target) continue;
      const template = f.raw.query<Record<string, string>, []>(`SELECT * FROM ${target} ORDER BY id LIMIT 1`).get()!;
      const identity = f.raw.query<Record<string, string>, []>(`SELECT * FROM ${source} ORDER BY id LIMIT 1`).get()!;
      for (const [id, principal, requestId] of [[identity.id, 'different-principal', 'different-request'], ['different-' + target + '-' + source, identity.principal, identity.request_id]]) {
        const before = f.raw.query(`SELECT * FROM ${target} ORDER BY id`).all();
        const values: Record<string, string> = { ...template, id: id!, principal: principal!, request_id: requestId!, result_json: JSON.stringify({ ...JSON.parse(template.result_json!), requestId }) };
        expect(() => f.raw.query(`INSERT OR REPLACE INTO ${target} (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})`).run(...columns.map(column => values[column]!))).toThrow();
        expect(f.raw.query(`SELECT * FROM ${target} ORDER BY id`).all()).toEqual(before);
      }
    }
    for (const requestId of ['resource-person', 'block', 'hold']) rejects(() => f.location('another', { requestId }), 'CALENDAR_INTENT_CONFLICT');
    rejects(() => f.assign('person', [], { requestId: 'location-location' }), 'CALENDAR_INTENT_CONFLICT');
    expect(f.db.list('_calendar_location_receipts').every(row => row.target_kind === 'location')).toBe(true);
    expect(f.db.list('_calendar_location_effect_intents').every(row => row.target_kind === 'location')).toBe(true);
    expect(f.db.list('_calendar_receipts').some(row => row.target_kind === 'resource' && JSON.parse(String(row.result_json)).operation === 'resource.locations-changed')).toBe(true);
  } finally { f.close(); }
});

test('current-directory catalog, facets and witness plans stay indexed and bounded after 1000 retained assignment revisions', () => {
  const f = fixture();
  try {
    f.resource('a-churn'); f.resource('a-hidden-resource', null); f.resource('b-visible'); f.resource('c-visible');
    for (const id of ['a-hidden', 'a-retired', 'b-retired', 'c-visible', 'd-visible']) f.location(id, { region: id.includes('visible') ? 'visible' : 'retired' });
    f.grant('a-churn', ['busy']); f.grant('b-visible', ['book']); f.grant('c-visible', ['details']);

    // Exact synthetic setup in this already-owned native memory fixture. The
    // original guards stay enabled: resource revision, immutable header/member,
    // sealed pointer, replaceable current projection and018 legacy eligibility
    // selector advance in source order. No fabricated effective source is added.
    // Prepared statements and the single transaction keep this small; no 1000
    // receipt images or per-flip read-database snapshots are generated.
    const statements: ReturnType<typeof f.raw.prepare>[] = [];
    try {
      const prepare = (sql: string) => { const statement = f.raw.prepare(sql); statements.push(statement); return statement; };
      const resource = prepare("UPDATE calendar_resources SET revision=revision+1 WHERE id='a-churn'");
      const history = prepare('INSERT INTO _calendar_resource_location_history(id,scope_id,resource_id,resource_revision,location_ids_json) VALUES(?,?,\'a-churn\',?,?)');
      const member = prepare('INSERT INTO _calendar_resource_location_members(id,scope_id,resource_id,resource_revision,location_id) VALUES(?,?,\'a-churn\',?,?)');
      const first = prepare('INSERT INTO _calendar_resource_locations(id,scope_id,resource_id,resource_revision) VALUES(\'a-churn\',?,\'a-churn\',?)');
      const pointer = prepare("UPDATE _calendar_resource_locations SET resource_revision=? WHERE id='a-churn'");
      const remove = prepare("DELETE FROM _calendar_resource_location_current WHERE resource_id='a-churn'");
      const current = prepare('INSERT INTO _calendar_resource_location_current(id,scope_id,resource_id,resource_revision,location_id) VALUES(?,?,\'a-churn\',?,?)');
      const policy = prepare("UPDATE _calendar_resource_location_policy_current SET resource_revision=? WHERE id='a-churn' AND source_kind='legacy'");
      const initialRevision = Number(f.db.get('calendar_resources', 'a-churn')!.revision);
      f.raw.transaction(() => {
        for (let i = 0; i < 1000; i++) {
          const revision = initialRevision + i + 1, locationId = i % 2 ? 'b-retired' : 'a-retired';
          resource.run(); history.run('synthetic-history-' + i, actor.scopeId, revision, JSON.stringify([locationId]));
          member.run('synthetic-member-' + i, actor.scopeId, revision, locationId);
          if (i === 0) first.run(actor.scopeId, revision); else pointer.run(revision);
          remove.run(); current.run(calendarLocationCurrentId(actor.scopeId, 'a-churn', locationId), actor.scopeId, revision, locationId);
          expect(policy.run(revision).changes).toBe(1);
        }
      })();
    } finally { for (const statement of statements) statement.finalize(); }
    expect(f.db.get('_calendar_resource_location_policy_current', 'a-churn')).toMatchObject({ source_kind: 'legacy', history_id: null,
      resource_revision: f.db.get('_calendar_resource_locations', 'a-churn')!.resource_revision });
    f.db.createStrict('_calendar_usage', { id: 'resourceLocationHistory', count: 1000 });
    f.assign('a-churn', []); f.assign('a-hidden-resource', ['a-hidden']); f.assign('b-visible', ['c-visible']); f.assign('c-visible', ['d-visible']);
    expect(f.db.list('_calendar_resource_location_history')).toHaveLength(1004);
    expect(f.db.list('_calendar_resource_location_members')).toHaveLength(1003);
    expect(f.db.list('_calendar_resource_location_current')).toHaveLength(3);
    const seq = f.db.currentSeq;

    const page = f.query('locations', { actor: reader, limit: 1 }, true);
    expect(page).toMatchObject({ items: [{ id: 'c-visible' }], truncated: true, nextAfter: 'c-visible' });
    expect(f.query('locations', { actor: reader, limit: 1, after: page.nextAfter }, true)).toMatchObject({ items: [{ id: 'd-visible' }], truncated: false, nextAfter: null });
    expect(f.query('location', { actor: reader, id: 'c-visible' }, true).id).toBe('c-visible');
    expect(f.query('resources', { actor: reader, locationIds: ['a-retired', 'c-visible', 'd-visible'], regions: ['retired', 'visible'], limit: 1 }, true))
      .toMatchObject({ items: [{ id: 'b-visible' }], truncated: true, nextAfter: 'b-visible' });
    expect(f.query('resources', { actor: reader, locationIds: ['a-retired'], regions: ['retired'], limit: 1 }, true))
      .toEqual({ items: [], truncated: false, nextAfter: null });
    expect(f.query('locationAssignmentWitnesses', { actor: reader, locationIds: ['a-hidden', 'a-retired', 'b-retired', 'c-visible', 'd-visible'] }, true))
      .toEqual([{ locationId: 'c-visible', resourceId: 'b-visible' }, { locationId: 'd-visible', resourceId: 'c-visible' }]);

    // Inspect plans of the exact registered-query SQL with its actual bound
    // parameters, not a hand-written equivalent. Retained assignment history
    // may grow, but none of these selection paths may traverse it or materialize
    // an unbounded result before applying current authority and page limits.
    expect(f.plans).toHaveLength(10);
    for (const plan of f.plans) {
      expect(plan.sql).toContain('_calendar_resource_location_current');
      expect(plan.sql).toContain('_calendar_resource_locations p');
      expect(plan.sql).toMatch(/(?:p\.resource_revision=m\.resource_revision|m\.resource_revision=p\.resource_revision)/);
      expect(plan.sql).not.toMatch(/_calendar_resource_location_(?:members|history)\b/);
      expect(plan.detail).toMatch(/SEARCH m USING (?:COVERING )?INDEX calendar_resource_location_current_(?:identity|lookup)/);
      expect(plan.detail).toContain('calendar_resource_locations_identity');
      expect(plan.detail).not.toMatch(/calendar_resource_location_(?:lookup|history_identity)\b|SCAN m\b|TEMP B-TREE/);
      expect(plan.rowsReturned).toBeLessThanOrEqual(2);
      if (plan.sql.startsWith('SELECT m.resource_id')) {
        expect(plan.sql).toContain('LIMIT 1'); expect(plan.rowsReturned).toBeLessThanOrEqual(1);
      }
    }
    expect(f.db.currentSeq).toBe(seq); expect(f.raw.query('PRAGMA foreign_key_check').all()).toEqual([]);
  } finally { f.close(); }
});
