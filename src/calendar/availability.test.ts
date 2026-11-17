/** Real native memory transactions; no actor, file, external provider or retained fixture. */
import { Database } from 'bun:sqlite';
import { expect, test } from 'bun:test';
import type { DatabaseSerializableValue } from '../databases/database-operations';
import { createDatabaseReadQuerySession, withDatabaseReadQuerySession } from '../databases/database-read-query-capability';
import { runDatabaseRealmCommand, runDatabaseRealmQuery } from '../databases/database-realm';
import { LoggingActorSource, normalizeLoggingActorSourceBinding } from '../logging/logging-actor-source';
import { loggingContext } from '../logging/test-support/logging-fixture';
import { createReactiveDB } from '../sync/reactive-db';
import { normalizeCalendarAvailability } from './availability-model';
import type { CalendarActor } from './contracts';
import { CalendarError, readCalendarRejection, type CalendarErrorCode } from './error';
import { calendarRealm } from './realm';
import { CALENDAR_LIMITS } from './realm-model';

const actor: CalendarActor = { scopeId: 'tenant:synthetic', userId: 'fixture-user', principal: 'fixture-session', manageAll: true, createOwn: true };
const reader: CalendarActor = { ...actor, userId: 'reader', principal: 'reader-session', manageAll: false, createOwn: false };
const startAt = '2026-11-16T10:00:00.000Z', endAt = '2026-11-16T11:00:00.000Z';
const timed = { startAt, endAt, timeZone: 'UTC' };
const open = { mode: 'windows', windows: [{ startAt: '2026-11-16T09:00:00.000Z', endAt: '2026-11-16T12:00:00.000Z' }] };
function fixture(logging = false, maxEvents = 10_000) {
  const db = createReactiveDB({ mode: 'memory' }); let source: LoggingActorSource | null = null;
  try {
    db.getRawDatabase().run('PRAGMA temp_store=MEMORY');
    for (const [table, schema] of Object.entries(calendarRealm.tables)) db.defineTable(table, schema);
    for (const migration of calendarRealm.migrations) migration.up(db.getRawDatabase());
    if (logging) source = new LoggingActorSource(db, normalizeLoggingActorSourceBinding({ records: false, workflow: true,
      policyVersion: 'calendar-availability-synthetic', scope: { kind: 'tenant', tenantId: 'synthetic' }, sourceQueue: { maxEvents } }));
    const command = (name: string, input: unknown): any => {
      const run = () => runDatabaseRealmCommand(calendarRealm, db, 'calendar.' + name, input as DatabaseSerializableValue);
      return source ? source.run(loggingContext('synthetic'), run) : run();
    };
    const query = (name: string, input: unknown): any => {
      const copy = Database.deserialize(db.getRawDatabase().serialize(), { readonly: true, strict: true });
      try { copy.run('PRAGMA temp_store=MEMORY'); return withDatabaseReadQuerySession(createDatabaseReadQuerySession(copy), context =>
        runDatabaseRealmQuery(calendarRealm, context, 'calendar.' + name, input as DatabaseSerializableValue)); }
      finally { copy.close(); }
    };
    command('owner.bind', { ownerId: 'synthetic-owner', scopeId: actor.scopeId });
    const resource = (id = 'person') => command('resource.create', { actor, requestId: 'resource-' + id, id, label: 'PRIVATE_RESOURCE', kind: 'room', ownerId: null, timeZone: 'UTC' });
    const replace = (policy: unknown = open, overrides: Record<string, unknown> = {}) => command('resource.availability', { actor, requestId: 'policy-' + db.currentSeq,
      id: 'person', expectedRevision: db.get('calendar_resources', 'person')!.revision, ...policy as object, ...overrides });
    const appointment = (id = 'appointment', overrides: Record<string, unknown> = {}) => command('appointment.create', { actor, requestId: 'create-' + id, id,
      resourceIds: ['person'], title: 'PRIVATE_APPOINTMENT', ...timed, ...overrides });
    const count = (table: string) => (db.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n;
    return { db, source, command, query, resource, replace, appointment, count, close() { source?.close(); db.dispose(); } };
  } catch (error) { source?.close(); db.dispose(); throw error; }
}
function rejects(run: () => unknown, code: CalendarErrorCode): void {
  try { run(); throw new Error('Expected rejection'); }
  catch (error) { expect((error instanceof CalendarError ? error : readCalendarRejection(error))?.code).toBe(code); }
}

test('availability is unrestricted only by absence; explicit closed windows reject new reservations without hiding history', () => {
  const f = fixture(); try {
    f.resource();
    expect(f.query('availability', { actor, id: 'person' })).toEqual({ resourceId: 'person', resourceRevision: 1, timeZone: 'UTC', mode: 'unrestricted', windows: [] });
    f.appointment(); const prior = f.query('appointment', { actor, id: 'appointment' });
    expect(f.replace({ mode: 'windows', windows: [] }).value).toMatchObject({ changed: true, revision: 2 });
    expect(f.query('appointment', { actor, id: 'appointment' })).toEqual(prior);
    rejects(() => f.appointment('closed', { startAt: endAt, endAt: '2026-11-16T12:00:00.000Z' }), 'CALENDAR_AVAILABILITY_CONFLICT');
    expect(f.count('calendar_appointments')).toBe(1);
    f.command('block.create', { actor, requestId: 'closed-block', id: 'block', title: 'PRIVATE', resourceIds: ['person'],
      startAt: endAt, endAt: '2026-11-16T12:00:00.000Z', timeZone: 'UTC' });
    expect(f.count('calendar_blocks')).toBe(1); // blocks are not appointments needing opening hours
    f.replace({ mode: 'unrestricted', windows: [] });
    f.appointment('reopened', { startAt: '2026-11-16T12:00:00.000Z', endAt: '2026-11-16T13:00:00.000Z' });
    expect(f.count('_calendar_availability_history')).toBe(2);
  } finally { f.close(); }
});

test('normalization merges overlap/touching windows and roundtrips long horizons and date extremes', () => {
  const policy = normalizeCalendarAvailability({ mode: 'windows', windows: [
    { startAt: endAt, endAt: '2027-11-16T10:00:00.000Z' }, { startAt, endAt },
    { startAt: '2026-11-16T10:30:00.000Z', endAt: '2026-11-16T12:00:00.000Z' },
  ] });
  expect(policy).toEqual({ mode: 'windows', windows: [{ startAt, endAt: '2027-11-16T10:00:00.000Z' }] });
  expect(normalizeCalendarAvailability(policy)).toEqual(policy);
  expect(normalizeCalendarAvailability({ mode: 'windows', windows: [{ startAt: new Date(-8_640_000_000_000_000).toISOString(), endAt: new Date(8_640_000_000_000_000).toISOString() }] }).windows).toHaveLength(1);
  const f = fixture(); try { f.resource(); f.replace(policy); expect(f.query('availability', { actor, id: 'person' }).windows).toEqual(policy.windows); }
  finally { f.close(); }
});

test('all-resource availability contains the entire buffered interval and cannot bridge gaps', () => {
  const f = fixture(); try {
    f.resource(); f.resource('room');
    f.replace({ mode: 'windows', windows: [{ startAt, endAt }] });
    f.replace(open, { id: 'room', expectedRevision: 1 });
    rejects(() => f.appointment('before', { bufferBeforeMinutes: 1 }), 'CALENDAR_AVAILABILITY_CONFLICT');
    rejects(() => f.appointment('after', { bufferAfterMinutes: 1 }), 'CALENDAR_AVAILABILITY_CONFLICT');
    f.replace({ mode: 'windows', windows: [
      { startAt: '2026-11-16T09:00:00.000Z', endAt: '2026-11-16T10:30:00.000Z' },
      { startAt: '2026-11-16T10:45:00.000Z', endAt: '2026-11-16T12:00:00.000Z' },
    ] });
    rejects(() => f.appointment('gap'), 'CALENDAR_AVAILABILITY_CONFLICT');
    f.replace(open);
    f.replace({ mode: 'windows', windows: [] }, { id: 'room', expectedRevision: 2 });
    rejects(() => f.appointment('multi', { resourceIds: ['person', 'room'] }), 'CALENDAR_AVAILABILITY_CONFLICT');
    expect(f.count('_calendar_reservations')).toBe(0); expect(f.count('calendar_appointments')).toBe(0);
    f.appointment('fits', { bufferBeforeMinutes: 60, bufferAfterMinutes: 60 });
    expect(f.count('calendar_appointments')).toBe(1);
  } finally { f.close(); }
});

test('policy changes fence new occupancy but preserve replay, exact no-op and zone-only corrections of existing appointments', () => {
  const f = fixture(); try {
    f.resource(); const receipt = f.appointment().value;
    f.replace({ mode: 'windows', windows: [] });
    expect(f.appointment().value).toEqual(receipt);
    const move = { actor, requestId: 'no-op', id: 'appointment', expectedRevision: 1, ...timed, bufferBeforeMinutes: 0, bufferAfterMinutes: 0 };
    expect(f.command('appointment.reschedule', move).value.changed).toBe(false);
    expect(f.command('appointment.reschedule', { ...move, requestId: 'zone-only', timeZone: 'America/New_York' }).value).toMatchObject({ revision: 2, changed: true });
    rejects(() => f.command('appointment.reschedule', { ...move, requestId: 'buffer-change', expectedRevision: 2, bufferBeforeMinutes: 1 }), 'CALENDAR_AVAILABILITY_CONFLICT');
    rejects(() => f.command('appointment.reschedule', { ...move, requestId: 'time-change', expectedRevision: 2, endAt: '2026-11-16T11:00:00.001Z' }), 'CALENDAR_AVAILABILITY_CONFLICT');
    expect(f.query('appointment', { actor, id: 'appointment' }).revision).toBe(2);
    expect(f.command('appointment.cancel', { actor, requestId: 'cancel', id: 'appointment', expectedRevision: 2, confirmed: true }).value.changed).toBe(true);
  } finally { f.close(); }
});

test('availability reads need book/detail/manage; writes and replay need current manage, never busy only', () => {
  const f = fixture(); try {
    f.resource(); const receipt = f.replace().value;
    const grant = (grants: string[]) => f.command('resource.grant', { actor, requestId: 'grant-' + f.db.currentSeq, id: 'person',
      userId: reader.userId, grants, expectedRevision: f.db.get('calendar_resources', 'person')!.revision });
    for (const rights of [[], ['busy']]) { grant(rights); rejects(() => f.query('availability', { actor: reader, id: 'person' }), 'CALENDAR_NOT_FOUND'); }
    for (const rights of [['book'], ['details']]) {
      grant(rights); expect(f.query('availability', { actor: reader, id: 'person' }).resourceId).toBe('person');
      rejects(() => f.replace(open, { actor: reader }), 'CALENDAR_NOT_FOUND');
    }
    grant(['manage']);
    const own = f.replace({ mode: 'windows', windows: [] }, { actor: reader, requestId: 'delegated' }).value;
    expect(own.changed).toBe(true);
    grant([]); rejects(() => f.query('receipt', { actor: reader, requestId: 'delegated' }), 'CALENDAR_NOT_FOUND');
    expect(f.query('receipt', { actor, requestId: receipt.requestId })).toEqual(receipt);
    rejects(() => f.query('availability', { actor: { ...actor, scopeId: 'tenant:foreign' }, id: 'person' }), 'CALENDAR_STATE_INVALID');
  } finally { f.close(); }
});

test('resource revision fences grants and policies; canonical replay, no-ops and history remain distinct', () => {
  const f = fixture(); try {
    f.resource();
    expect(f.replace({ mode: 'unrestricted', windows: [] }, { requestId: 'initial-noop' }).value).toMatchObject({ changed: false, revision: 1 });
    expect(f.count('_calendar_availability_history')).toBe(0);
    const first = f.replace(open, { requestId: 'policy', expectedRevision: 1 }).value, seq = f.db.currentSeq;
    expect(f.replace({ ...open, windows: [...open.windows, ...open.windows] }, { requestId: 'policy', expectedRevision: 1 }).value).toEqual(first);
    expect(f.db.currentSeq).toBe(seq);
    f.command('resource.grant', { actor, requestId: 'grant', id: 'person', userId: reader.userId, grants: ['book'], expectedRevision: 2 });
    expect(f.query('availability', { actor, id: 'person' }).resourceRevision).toBe(3);
    rejects(() => f.replace({ mode: 'windows', windows: [] }, { expectedRevision: 2 }), 'CALENDAR_REVISION_CONFLICT');
    expect(f.replace(open).value).toMatchObject({ revision: 3, changed: false });
    f.replace({ mode: 'windows', windows: [] });
    expect(f.db.get('_calendar_availability', 'person')!.policy_revision).toBe(4);
    expect(f.count('_calendar_availability_history')).toBe(2);
  } finally { f.close(); }
});

test('availability rejects malformed, excessive, executable or unknown inputs without consuming request identities', () => {
  const f = fixture(); try {
    f.resource(); const seq = f.db.currentSeq;
    for (const policy of [ { mode: 'unrestricted', windows: open.windows }, { mode: 'windows', windows: [{ startAt, endAt: startAt }] },
      { mode: 'weekly', windows: [] }, { mode: 'windows', windows: Array(101).fill(open.windows[0]) },
      { mode: 'windows', windows: [{ startAt: '2026-11-16T10:00:00Z', endAt }] } ]) rejects(() => f.replace(policy), 'CALENDAR_INPUT_INVALID');
    rejects(() => f.replace({ ...open, extra: true }), 'CALENDAR_INPUT_INVALID');
    let touched = false; const window = { get startAt() { touched = true; return startAt; }, endAt };
    // Native serialization rejects executable values even before the domain handler runs.
    expect(() => f.replace({ mode: 'windows', windows: [window] })).toThrow(); expect(touched).toBe(false);
    rejects(() => normalizeCalendarAvailability({ mode: 'windows', windows: [window] }), 'CALENDAR_INPUT_INVALID');
    expect(f.db.currentSeq).toBe(seq); expect(f.count('_calendar_availability_history')).toBe(0);
  } finally { f.close(); }
});

test('a failed history/pointer insert rolls resource revision, policy, usage and evidence back atomically', () => {
  const f = fixture(true); try {
    f.resource(); const seq = f.db.currentSeq, queued = f.source!.control({}).queued, receipts = f.count('_calendar_receipts');
    f.db.getRawDatabase().run("CREATE TRIGGER synthetic_policy_failure BEFORE INSERT ON _calendar_availability BEGIN SELECT RAISE(ABORT,'synthetic failure'); END");
    expect(() => f.replace()).toThrow();
    expect(f.db.currentSeq).toBe(seq); expect(f.db.get('calendar_resources', 'person')!.revision).toBe(1);
    expect(f.count('_calendar_availability_history')).toBe(0); expect(f.count('_calendar_availability')).toBe(0);
    expect(f.count('_calendar_receipts')).toBe(receipts); expect(f.source!.control({}).queued).toBe(queued);
  } finally { f.close(); }
});

test('availability source audit is private, atomic, once per accepted change, and bounded by shared receipt capacity', () => {
  const f = fixture(true); try {
    f.resource(); const first = f.replace(open, { requestId: 'policy', expectedRevision: 1 }).value;
    f.replace(open, { requestId: 'policy', expectedRevision: 1 }); f.replace(open);
    expect(f.query('receipt', { actor, requestId: 'policy' })).toEqual(first);
    const events = f.source!.control({}).rows.map(row => row.event);
    expect(events.map(event => event.action)).toEqual(['calendar.resource.created', 'calendar.resource.availability-changed']);
    expect(events[1]!.target).toEqual({ type: 'calendar.resource', id: 'person' });
    expect(JSON.stringify(events)).not.toContain('PRIVATE'); expect(JSON.stringify(events)).not.toContain(startAt);
    expect(Object.keys(events[1]!.metadata).sort()).toEqual(['revision', 'sequence']);
    f.db.update('_calendar_usage', 'receipts', { count: CALENDAR_LIMITS.receipts });
    rejects(() => f.replace({ mode: 'windows', windows: [] }), 'CALENDAR_CAPACITY');
    expect(f.count('_calendar_availability_history')).toBe(1);
  } finally { f.close(); }
  const pressured = fixture(true, 1); try {
    pressured.resource(); expect(() => pressured.replace()).toThrow();
    expect(pressured.db.get('calendar_resources', 'person')!.revision).toBe(1); expect(pressured.count('_calendar_availability_history')).toBe(0);
  } finally { pressured.close(); }
});

test('corrupt retained availability fails closed rather than silently reverting to unrestricted', () => {
  const f = fixture(); try {
    f.resource(); f.replace();
    f.db.getRawDatabase().run('DROP TRIGGER _calendar_availability_history_update');
    expect(() => f.db.getRawDatabase().run("UPDATE _calendar_availability_history SET mode='corrupt'")).toThrow();
    f.db.getRawDatabase().run("UPDATE _calendar_availability_history SET windows_json='not-json'");
    rejects(() => f.query('availability', { actor, id: 'person' }), 'CALENDAR_STATE_INVALID');
    rejects(() => f.appointment(), 'CALENDAR_STATE_INVALID');
  } finally { f.close(); }
});
