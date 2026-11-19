/** Actor-free policy factoring against native MEMORY only; every owned session/database closes in finally. */
import { expect, spyOn, test } from 'bun:test';
import type { DatabaseSerializableValue } from '../databases/database-operations';
import { createDatabaseWriteCommandSession } from '../databases/database-write-command-capability';
import { runDatabaseRealmCommand, type DatabaseWriteCommandContext } from '../databases/database-realm';
import { hashMigration, hashSchemaSnapshot, snapshotDeclaredTables } from '../migrations/schema-snapshot';
import { createReactiveDB } from '../sync/reactive-db';
import { admitCalendarBookingCandidate, type CalendarBookingCandidate, type CalendarBookingRevalidation } from './booking-admission';
import { assertCalendarBookingType, assertCalendarBookingTypeForScope, assertCalendarTypePolicy, assertCalendarTypePolicyForScope } from './appointment-type-bindings';
import { assertCalendarBookingVisit, assertCalendarBookingVisitForScope, assertCalendarVisitPolicy, assertCalendarVisitPolicyForScope } from './visit-bindings';
import { assertCalendarAvailability } from './availability-model';
import type { CalendarActor, CalendarVisitInput } from './contracts';
import { CalendarError, readCalendarRejection } from './error';
import { calendarRealm } from './realm';
import { normalizeCalendarTimedInterval } from './time';

const actor: CalendarActor = { scopeId: 'tenant:synthetic-admission-parity', userId: 'synthetic-user', principal: 'synthetic-session', manageAll: true, createOwn: true };
const outsider: CalendarActor = { ...actor, userId: 'unauthorized', principal: 'unauthorized-session', manageAll: false, createOwn: false };
const timed = { startAt: '2030-01-07T10:00:00.000Z', endAt: '2030-01-07T11:00:00.000Z', timeZone: 'UTC', bufferBeforeMinutes: 5, bufferAfterMinutes: 10 };
const type = { id: 'type', revision: 1 };
const typeFields = { label: 'PRIVATE_TYPE', durationMinutes: 60, bufferBeforeMinutes: 5, bufferAfterMinutes: 10, colorKey: null, active: true };
const visit: CalendarVisitInput = { mode: 'in-person', location: { id: 'office', revision: 1 } };
const candidate: CalendarBookingCandidate = { resourceIds: ['a', 'b'], interval: normalizeCalendarTimedInterval(timed), appointmentType: type, visit };
const full: CalendarBookingRevalidation = { type: true, visit: true, availabilityResourceIds: candidate.resourceIds, occupancy: {} };

function outcome<T>(run: () => T): { value: T } | { error: string } {
  try { return { value: run() }; }
  catch (error) {
    const rejected = error instanceof CalendarError ? error : readCalendarRejection(error);
    if (!rejected) throw error;
    return { error: rejected.code };
  }
}
function fixture() {
  const db = createReactiveDB({ mode: 'memory' });
  try {
    const raw = db.getRawDatabase(); raw.run('PRAGMA temp_store=MEMORY');
    for (const [name, schema] of Object.entries(calendarRealm.tables)) db.defineTable(name, schema);
    for (const migration of calendarRealm.migrations) migration.up(raw);
    const command = (name: string, input: Record<string, unknown>): any => (runDatabaseRealmCommand(calendarRealm, db, 'calendar.' + name, input as DatabaseSerializableValue) as any).value;
    const run = <T>(check: (context: DatabaseWriteCommandContext) => T, gets?: string[]): T => {
      const session = createDatabaseWriteCommandSession(db);
      try {
        const context = gets === undefined ? session.context : Object.freeze({ db: Object.freeze({ ...session.context.db,
          get(table: string, id: string) { gets.push(table); return session.context.db.get(table, id); },
        }) });
        return db.transaction(() => check(context));
      } finally { session.close(); }
    };
    command('owner.bind', { scopeId: actor.scopeId, ownerId: 'synthetic-admission-owner' });
    for (const id of ['a', 'b']) command('resource.create', { actor, id, requestId: 'resource-' + id, label: 'PRIVATE_' + id, kind: 'person', ownerId: actor.userId, timeZone: 'UTC' });
    command('type.create', { actor, id: type.id, requestId: 'type', ...typeFields });
    command('location.create', { actor, id: 'office', requestId: 'office', label: 'PRIVATE_OFFICE', region: null });
    const assign = (id: string, locationIds: string[]) => command('resource.locations', { actor, id, requestId: 'assign-' + db.currentSeq,
      expectedRevision: db.get('calendar_resources', id)!.revision, locationIds });
    assign('a', ['office']); assign('b', ['office']);
    const typePolicy = (id: string, mode: string, typeIds: string[]) => command('resource.types', { actor, id, requestId: 'type-policy-' + db.currentSeq,
      expectedRevision: db.get('calendar_resources', id)!.revision, mode, typeIds });
    const weekly = () => command('resource.availability-policy', { actor, id: 'a', requestId: 'weekly-' + db.currentSeq,
      expectedRevision: db.get('calendar_resources', 'a')!.revision, kind: 'weekly-local-v1', fold: 'earlier',
      coverage: { from: '2030-01-07', until: '2030-01-14' }, weekly: [{ day: 1, windows: [{ startMinute: 540, endMinute: 1020 }] }], overrides: [] });
    const state = () => JSON.stringify(Object.fromEntries(Object.keys(calendarRealm.tables).map(name => [name, db.list(name)])));
    const create = (id: string, input: Record<string, unknown> = {}) => command('appointment.create', { actor, id, requestId: 'create-' + id,
      title: 'PRIVATE_APPOINTMENT', resourceIds: candidate.resourceIds, ...timed, appointmentType: type, visit, ...input });
    return { db, raw, command, run, assign, typePolicy, weekly, state, create, close: () => db.dispose() };
  } catch (error) { db.dispose(); throw error; }
}

test('factoring preserves exact current016 metadata and introduces no public registry entry or migration', () => {
  expect(calendarRealm.version).toBe('16'); expect(calendarRealm.migrations).toHaveLength(16);
  expect(calendarRealm.fingerprint).toBe('sha256:2b0e98dabe59b6cf27edf49b3bb37b3f11dc6b1e6d0274c6a590db5a3ba601b5');
  expect(hashSchemaSnapshot(snapshotDeclaredTables(calendarRealm.tables))).toBe('a9de3c82718367f9dfb5db628706f7a2b2fda542d12fc27be8d2d589a8d1f2a4');
  expect(hashMigration(calendarRealm.migrations[15]!)).toBe('0553be4d7a34a76f3e0c9335f056c7abaefab7fac910c127d503060ee061a2d8');
  expect([...Object.keys(calendarRealm.commands), ...Object.keys(calendarRealm.queries)].some(name => name.includes('series') || name.includes('admission'))).toBe(false);
});

test('scope-only cores exactly match existing actor wrappers and return detached retained catalog snapshots without writing', () => {
  const f = fixture();
  try {
    const before = f.state(), seq = f.db.currentSeq;
    f.run(context => {
      expect(assertCalendarTypePolicyForScope(context, actor.scopeId, candidate.resourceIds, type)).toBe(assertCalendarTypePolicy(context, actor, candidate.resourceIds, type));
      expect(assertCalendarVisitPolicyForScope(context, actor.scopeId, candidate.resourceIds, visit)).toBe(assertCalendarVisitPolicy(context, actor, candidate.resourceIds, visit));
      expect(assertCalendarBookingTypeForScope(context, actor.scopeId, candidate.resourceIds, candidate.interval, type)).toEqual(assertCalendarBookingType(context, actor, candidate.resourceIds, candidate.interval, type));
      expect(assertCalendarBookingVisitForScope(context, actor.scopeId, candidate.resourceIds, visit)).toEqual(assertCalendarBookingVisit(context, actor, candidate.resourceIds, visit));
      const admitted = admitCalendarBookingCandidate(context, actor.scopeId, candidate, full);
      expect(admitted.appointmentType).toEqual({ ...type, label: typeFields.label, durationMinutes: 60, bufferBeforeMinutes: 5, bufferAfterMinutes: 10, colorKey: null });
      expect(admitted.visit).toEqual({ mode: 'in-person', location: { id: 'office', revision: 1, label: 'PRIVATE_OFFICE', region: null } });
      expect(admitted.appointmentType).not.toBe(type); expect(admitted.visit).not.toBe(visit);
    });
    expect(f.state()).toBe(before); expect(f.db.currentSeq).toBe(seq);
  } finally { f.close(); }
});

test('scope and exact duration/buffer failures have actor-wrapper parity and never resolve a different scope', () => {
  const f = fixture();
  try {
    f.run(context => {
      for (const interval of [normalizeCalendarTimedInterval({ ...timed, endAt: '2030-01-07T10:59:00.000Z' }), normalizeCalendarTimedInterval({ ...timed, bufferBeforeMinutes: 4 })]) {
        const scoped = outcome(() => assertCalendarBookingTypeForScope(context, actor.scopeId, candidate.resourceIds, interval, type));
        expect(scoped).toEqual({ error: 'CALENDAR_TYPE_CONFLICT' });
        expect(outcome(() => assertCalendarBookingType(context, actor, candidate.resourceIds, interval, type))).toEqual(scoped);
      }
      const other = { ...actor, scopeId: 'tenant:other' };
      expect(outcome(() => assertCalendarBookingTypeForScope(context, other.scopeId, [], candidate.interval, type))).toEqual(outcome(() => assertCalendarBookingType(context, other, [], candidate.interval, type)));
      expect(outcome(() => assertCalendarBookingVisitForScope(context, other.scopeId, [], visit))).toEqual(outcome(() => assertCalendarBookingVisit(context, other, [], visit)));
      expect(outcome(() => assertCalendarBookingVisitForScope(context, other.scopeId, [], visit))).toEqual({ error: 'CALENDAR_VISIT_CONFLICT' });
    });
  } finally { f.close(); }
});

test('both complete resource intersections precede either selected catalog lookup', () => {
  const f = fixture();
  try {
    f.assign('b', []);
    const gets: string[] = [];
    expect(outcome(() => f.run(context => admitCalendarBookingCandidate(context, actor.scopeId,
      { ...candidate, appointmentType: { id: 'PRIVATE_UNAVAILABLE_TYPE', revision: 1 } }, full), gets))).toEqual({ error: 'CALENDAR_VISIT_CONFLICT' });
    expect(gets).not.toContain('calendar_types'); expect(gets).not.toContain('calendar_locations');
    f.assign('b', ['office']); f.typePolicy('b', 'required', ['type']); gets.length = 0;
    expect(outcome(() => f.run(context => admitCalendarBookingCandidate(context, actor.scopeId,
      { ...candidate, appointmentType: undefined, visit: { mode: 'in-person', location: { id: 'PRIVATE_UNAVAILABLE_LOCATION', revision: 1 } } }, full), gets))).toEqual({ error: 'CALENDAR_TYPE_CONFLICT' });
    expect(gets).not.toContain('calendar_types'); expect(gets).not.toContain('calendar_locations');
  } finally { f.close(); }
});

test('stale and inactive selected generations keep exact actor-wrapper rejection parity', () => {
  const f = fixture();
  try {
    f.command('type.replace', { actor, id: 'type', requestId: 'retire-type', expectedRevision: 1, ...typeFields, active: false });
    f.command('location.replace', { actor, id: 'office', requestId: 'retire-location', expectedRevision: 1, label: 'PRIVATE_OFFICE', region: null, active: false });
    const before = f.state();
    f.run(context => {
      for (const revision of [1, 2]) {
        const reference = { id: 'type', revision }, selection: CalendarVisitInput = { mode: 'in-person', location: { id: 'office', revision } };
        const scopedType = outcome(() => assertCalendarBookingTypeForScope(context, actor.scopeId, candidate.resourceIds, candidate.interval, reference));
        expect(scopedType).toEqual({ error: 'CALENDAR_TYPE_STALE' });
        expect(outcome(() => assertCalendarBookingType(context, actor, candidate.resourceIds, candidate.interval, reference))).toEqual(scopedType);
        const scopedVisit = outcome(() => assertCalendarBookingVisitForScope(context, actor.scopeId, candidate.resourceIds, selection));
        expect(scopedVisit).toEqual({ error: 'CALENDAR_VISIT_STALE' });
        expect(outcome(() => assertCalendarBookingVisit(context, actor, candidate.resourceIds, selection))).toEqual(scopedVisit);
      }
    });
    expect(f.state()).toBe(before);
  } finally { f.close(); }
});

test('working-hours coverage and full buffered boundaries exactly match direct native policy admission', () => {
  const f = fixture();
  try {
    f.weekly();
    for (const [fields, expected] of [
      [{ startAt: '2030-01-07T09:05:00.000Z', endAt: '2030-01-07T10:05:00.000Z' }, undefined],
      [{ startAt: '2030-01-07T09:04:00.000Z', endAt: '2030-01-07T10:04:00.000Z' }, 'CALENDAR_AVAILABILITY_CONFLICT'],
      [{ startAt: '2030-01-07T16:00:00.000Z', endAt: '2030-01-07T17:00:00.000Z' }, 'CALENDAR_AVAILABILITY_CONFLICT'],
      [{ startAt: '2030-01-08T10:00:00.000Z', endAt: '2030-01-08T11:00:00.000Z' }, 'CALENDAR_AVAILABILITY_CONFLICT'],
      [{ startAt: '2030-01-14T10:00:00.000Z', endAt: '2030-01-14T11:00:00.000Z' }, 'CALENDAR_AVAILABILITY_COVERAGE_REQUIRED'],
    ] as const) {
      const next = { ...candidate, interval: normalizeCalendarTimedInterval({ ...timed, ...fields }) };
      const direct = outcome(() => f.run(context => assertCalendarAvailability(context, actor.scopeId, next.resourceIds, next.interval)));
      const shared = outcome(() => f.run(context => admitCalendarBookingCandidate(context, actor.scopeId, next, full)));
      if (expected) { expect(direct).toEqual({ error: expected }); expect(shared).toEqual({ error: expected }); }
      else { expect(direct).toEqual({ value: undefined }); expect(shared).toHaveProperty('value'); }
    }
  } finally { f.close(); }
});

test('explicit edit masks preserve grandfathered policy history; scope-only admission never grants human command rights', () => {
  const f = fixture();
  try {
    const original = f.create('appointment');
    f.command('type.replace', { actor, id: 'type', requestId: 'retire-type', expectedRevision: 1, ...typeFields, active: false });
    f.command('location.replace', { actor, id: 'office', requestId: 'retire-location', expectedRevision: 1, label: 'PRIVATE_OFFICE', region: null, active: false });
    f.command('resource.availability-policy', { actor, id: 'a', requestId: 'close-hours', expectedRevision: f.db.get('calendar_resources', 'a')!.revision,
      kind: 'explicit-utc-v1', mode: 'windows', windows: [] });
    expect(f.run(context => admitCalendarBookingCandidate(context, actor.scopeId, candidate,
      { type: false, visit: false, availabilityResourceIds: [], occupancy: false }))).toEqual({ appointmentType: undefined, visit: undefined });
    expect(f.command('appointment.update', { actor, id: 'appointment', requestId: 'title-only', expectedRevision: 1, title: 'PRIVATE_NEW_TITLE' })).toMatchObject({ revision: 2, changed: true });
    expect(f.command('appointment.reschedule', { actor, id: 'appointment', requestId: 'zone-only', expectedRevision: 2, ...timed, timeZone: 'Europe/London' })).toMatchObject({ revision: 3, changed: true });
    // Replay remains before changed catalogs/availability/CAS; no new generation or historical digest is manufactured.
    expect(f.create('appointment')).toEqual(original);
    const before = f.state(), seq = f.db.currentSeq;
    expect(outcome(() => f.create('unauthorized', { actor: outsider }))).toEqual({ error: 'CALENDAR_NOT_FOUND' });
    expect(outcome(() => f.command('appointment.update', { actor: outsider, id: 'appointment', requestId: 'forged', expectedRevision: 3, title: 'PRIVATE_FORGED' }))).toEqual({ error: 'CALENDAR_NOT_FOUND' });
    expect(f.state()).toBe(before); expect(f.db.currentSeq).toBe(seq);
  } finally { f.close(); }
});

test('canonical create and hold confirmation share the same occupancy fence and only the exact captured hold exclusion', () => {
  const clock = spyOn(Date, 'now').mockReturnValue(Date.parse('2030-01-07T08:00:00.000Z'));
  try {
    const f = fixture();
    try {
      f.command('hold.acquire', { actor, id: 'held', requestId: 'held', resourceIds: candidate.resourceIds, ...timed, appointmentType: type, visit });
      const before = f.state();
      expect(outcome(() => f.run(context => admitCalendarBookingCandidate(context, actor.scopeId, candidate, full)))).toEqual({ error: 'CALENDAR_BOOKING_CONFLICT' });
      expect(outcome(() => f.run(context => admitCalendarBookingCandidate(context, actor.scopeId, candidate,
        { ...full, occupancy: { except: { kind: 'hold', id: 'not-the-held-key' }, now: Date.now() } })))).toEqual({ error: 'CALENDAR_BOOKING_CONFLICT' });
      expect(f.state()).toBe(before);
      expect(f.command('hold.confirm', { actor, id: 'held', requestId: 'confirm', expectedRevision: 1, appointmentId: 'accepted', title: 'PRIVATE_HELD_TITLE' })).toMatchObject({ operation: 'appointment.created', revision: 1 });
      expect(f.db.get('calendar_holds', 'held')!.status).toBe('confirmed');
      expect(outcome(() => f.create('overlap'))).toEqual({ error: 'CALENDAR_BOOKING_CONFLICT' });
      expect(f.raw.query('PRAGMA foreign_key_check').all()).toEqual([]);
    } finally { f.close(); }
  } finally { clock.mockRestore(); }
});
