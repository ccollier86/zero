/** Canonical real memory transactions only. Every read copy, source logger and database closes in finally; no disk fixtures or actors. */
import { Database } from 'bun:sqlite';
import { expect, spyOn, test } from 'bun:test';
import type { DatabaseSerializableValue } from '../databases/database-operations';
import { createDatabaseReadQuerySession, withDatabaseReadQuerySession } from '../databases/database-read-query-capability';
import { runDatabaseRealmCommand, runDatabaseRealmQuery } from '../databases/database-realm';
import { LoggingActorSource, normalizeLoggingActorSourceBinding } from '../logging/logging-actor-source';
import { loggingContext } from '../logging/test-support/logging-fixture';
import { createReactiveDB } from '../sync/reactive-db';
import type { CalendarActor } from './contracts';
import { CalendarError, readCalendarRejection, type CalendarErrorCode } from './error';
import { CALENDAR_HOLD_LIMITS } from './holds-model';
import { calendarRealm } from './realm';
import { CALENDAR_LIMITS } from './realm-model';
import { calendarOverlapSearchStart } from './time';

const actor: CalendarActor = { scopeId: 'tenant:synthetic', userId: 'owner', principal: 'session.owner', manageAll: false, createOwn: true };
const manager: CalendarActor = { ...actor, userId: 'manager', principal: 'session.manager', manageAll: true };
const delegate: CalendarActor = { ...actor, userId: 'delegate', principal: 'session.delegate', createOwn: false };
const initialNow = Date.parse('2030-01-01T09:00:00.000Z');
const timed = { startAt: '2030-01-01T10:00:00.000Z', endAt: '2030-01-01T11:00:00.000Z', timeZone: 'UTC' };
const later = { startAt: '2030-01-01T12:00:00.000Z', endAt: '2030-01-01T13:00:00.000Z', timeZone: 'UTC' };
const range = { startAt: '2030-01-01T00:00:00.000Z', endAt: '2030-01-02T00:00:00.000Z' };

function fixture(logging = false, maxEvents = 10_000) {
  let now = initialNow;
  const clock = spyOn(Date, 'now').mockImplementation(() => now), db = createReactiveDB({ mode: 'memory' });
  let source: LoggingActorSource | null = null;
  try {
    db.getRawDatabase().run('PRAGMA temp_store=MEMORY');
    for (const [name, schema] of Object.entries(calendarRealm.tables)) db.defineTable(name, schema);
    for (const migration of calendarRealm.migrations) migration.up(db.getRawDatabase());
    if (logging) source = new LoggingActorSource(db, normalizeLoggingActorSourceBinding({ records: false, workflow: true,
      policyVersion: 'calendar-hold-synthetic', scope: { kind: 'tenant', tenantId: 'synthetic' }, sourceQueue: { maxEvents } }));
    const command = (name: string, input: unknown): any => {
      const run = () => runDatabaseRealmCommand(calendarRealm, db, 'calendar.' + name, input as DatabaseSerializableValue);
      return source ? source.run(loggingContext('synthetic'), run) : run();
    };
    const preparedQueries: string[] = [];
    const query = (name: string, input: unknown, recordPrepared = false): any => {
      const copy = Database.deserialize(db.getRawDatabase().serialize(), { readonly: true, strict: true });
      const original = copy.prepare.bind(copy);
      const observer = recordPrepared ? spyOn(copy, 'prepare').mockImplementation((sql, parameters) => {
        preparedQueries.push(sql); return original(sql, parameters);
      }) : null;
      try {
        copy.run('PRAGMA temp_store=MEMORY');
        return withDatabaseReadQuerySession(createDatabaseReadQuerySession(copy), context => runDatabaseRealmQuery(calendarRealm, context, 'calendar.' + name, input as DatabaseSerializableValue));
      } finally { observer?.mockRestore(); copy.close(); }
    };
    command('owner.bind', { ownerId: 'synthetic-owner', scopeId: actor.scopeId });
    const resource = (id = 'person', ownerId: string | null = actor.userId) => command('resource.create', { actor: manager, requestId: 'resource-' + id,
      id, label: 'PRIVATE_RESOURCE_LABEL', kind: ownerId === null ? 'room' : 'person', ownerId, timeZone: 'UTC' });
    const hold = (id = 'private-hold', overrides: Record<string, unknown> = {}) => command('hold.acquire', { actor, requestId: 'acquire-' + id,
      id, resourceIds: ['person'], ...timed, ...overrides });
    const release = (id = 'private-hold', overrides: Record<string, unknown> = {}) => command('hold.release', { actor, requestId: 'release-' + id,
      id, expectedRevision: 1, confirmed: true, ...overrides });
    const confirm = (id = 'private-hold', overrides: Record<string, unknown> = {}) => command('hold.confirm', { actor, requestId: 'confirm-' + id,
      id, appointmentId: 'appointment-' + id, expectedRevision: 1, title: 'PRIVATE_APPOINTMENT_TITLE', ...overrides });
    const appointment = (id = 'private-appointment', overrides: Record<string, unknown> = {}) => command('appointment.create', { actor: manager, requestId: 'appointment-' + id,
      id, resourceIds: ['person'], title: 'PRIVATE_APPOINTMENT_TITLE', ...timed, ...overrides });
    const block = (id = 'private-block', overrides: Record<string, unknown> = {}) => command('block.create', { actor: manager, requestId: 'block-' + id,
      id, resourceIds: ['person'], title: 'PRIVATE_BLOCK_TITLE', ...timed, ...overrides });
    const grant = (id: string, grants: string[], user = delegate) => command('resource.grant', { actor: manager, requestId: 'grant-' + id + '-' + db.currentSeq,
      id, userId: user.userId, grants, expectedRevision: db.get('calendar_resources', id)!.revision });
    const policy = (id: string, windows: { startAt: string; endAt: string }[]) => command('resource.availability', { actor: manager, requestId: 'policy-' + db.currentSeq,
      id, expectedRevision: db.get('calendar_resources', id)!.revision, mode: 'windows', windows });
    const count = (table: string) => (db.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n;
    return { db, source, command, query, preparedQueries, resource, hold, release, confirm, appointment, block, grant, policy, count,
      now: () => now, setNow(value: number) { now = value; }, close() { try { source?.close(); } finally { try { db.dispose(); } finally { clock.mockRestore(); } } } };
  } catch (error) { try { source?.close(); } finally { try { db.dispose(); } finally { clock.mockRestore(); } } throw error; }
}
function rejects(run: () => unknown, code: CalendarErrorCode): void {
  try { run(); throw new Error('Expected rejection'); }
  catch (error) { expect((error instanceof CalendarError ? error : readCalendarRejection(error))?.code).toBe(code); }
}

test('holds are private canonical records; busy exposes buffered occupancy but no hold identity or discriminator', () => {
  const f = fixture();
  try {
    expect(f.query('holds', { actor, resourceIds: [], ...range })).toEqual({ items: [], truncated: false });
    f.resource(); f.hold('private-hold', { bufferBeforeMinutes: 5, bufferAfterMinutes: 10 }); f.grant('person', ['busy']);
    const seq = f.db.currentSeq;
    const view = { id: 'private-hold', revision: 1, resourceIds: ['person'], ...timed, bufferBeforeMinutes: 5, bufferAfterMinutes: 10,
      status: 'held', expiresAt: '2030-01-01T09:05:00.000Z', createdBy: actor.userId, appointmentId: null };
    expect(f.query('hold', { actor, id: 'private-hold' })).toEqual(view);
    expect(f.query('holds', { actor, resourceIds: ['person'], ...range })).toEqual({ items: [view], truncated: false });
    const busy = f.query('busy', { actor: delegate, resourceIds: ['person'], ...range });
    expect(busy).toEqual({ items: [{ resourceId: 'person', startAt: '2030-01-01T09:55:00.000Z', endAt: '2030-01-01T11:10:00.000Z' }], truncated: false });
    expect(Object.keys(busy.items[0]).sort()).toEqual(['endAt', 'resourceId', 'startAt']); expect(JSON.stringify(busy)).not.toContain('private-hold');
    for (const id of ['private-hold', 'missing']) rejects(() => f.query('hold', { actor: delegate, id }), 'CALENDAR_NOT_FOUND');
    rejects(() => f.query('holds', { actor: delegate, resourceIds: ['person'], ...range }), 'CALENDAR_NOT_FOUND');
    expect(f.db.currentSeq).toBe(seq); expect(f.db.get('calendar_holds', 'private-hold')!.principal).toBe(actor.principal);
    expect(f.db.get('calendar_holds', 'private-hold')!.title).toBeUndefined();
  } finally { f.close(); }
});

test('acquisition needs current book and active resources on all selected calendars, not busy or details', () => {
  const f = fixture();
  try {
    f.resource(); f.resource('room', null);
    for (const grants of [[], ['busy'], ['details']]) { f.grant('person', grants); rejects(() => f.hold('denied', { actor: delegate }), 'CALENDAR_NOT_FOUND'); }
    f.grant('person', ['book']);
    rejects(() => f.hold('denied-co-resource', { actor: delegate, resourceIds: ['person', 'room'] }), 'CALENDAR_NOT_FOUND');
    f.grant('room', ['book']); f.hold('delegated', { actor: delegate, resourceIds: ['room', 'person'] });
    expect(f.query('hold', { actor: delegate, id: 'delegated' }).resourceIds).toEqual(['person', 'room']);
    f.db.update('calendar_resources', 'room', { active: 0, revision: Number(f.db.get('calendar_resources', 'room')!.revision) + 1 });
    rejects(() => f.hold('inactive', { actor: delegate, resourceIds: ['person', 'room'], ...later }), 'CALENDAR_FORBIDDEN');
  } finally { f.close(); }
});

test('hold queries filter subject and every co-resource before membership, limits and truncation', () => {
  const f = fixture();
  try {
    f.resource(); f.resource('room', null); f.grant('person', ['book']);
    f.hold('hidden-first', { actor: manager, resourceIds: ['person', 'room'] }); f.hold('visible', { actor: delegate, ...later });
    const input = { actor: delegate, resourceIds: ['person'], ...range, limit: 1 };
    expect(f.query('holds', input)).toMatchObject({ items: [{ id: 'visible' }], truncated: false });
    rejects(() => f.query('hold', { actor: { ...delegate, principal: 'replacement-session' }, id: 'visible' }), 'CALENDAR_NOT_FOUND');
    rejects(() => f.query('hold', { actor: { ...delegate, userId: 'replacement-user' }, id: 'visible' }), 'CALENDAR_NOT_FOUND');
    f.grant('person', ['details']); expect(f.query('holds', input)).toEqual({ items: [], truncated: false });
    rejects(() => f.query('hold', { actor: delegate, id: 'visible' }), 'CALENDAR_NOT_FOUND');
    f.grant('person', ['manage']); f.grant('room', ['details']);
    expect(f.query('holds', input)).toMatchObject({ items: [{ id: 'visible' }], truncated: false });
    f.grant('room', ['manage']); expect(f.query('holds', input)).toMatchObject({ items: [{ id: 'hidden-first' }], truncated: true });
    expect(f.query('hold', { actor: manager, id: 'hidden-first' }).status).toBe('held');
    rejects(() => f.query('hold', { actor: { ...manager, scopeId: 'tenant:other' }, id: 'visible' }), 'CALENDAR_STATE_INVALID');
  } finally { f.close(); }
});

test('TTL uses trusted now, defaults to 300 seconds, clamps at future start and expires exactly without a write', () => {
  const f = fixture();
  try {
    f.resource(); f.hold('short', { startAt: '2030-01-01T09:00:01.000Z', endAt: '2030-01-01T09:00:02.000Z', ttlSeconds: 900 });
    expect(f.query('hold', { actor, id: 'short' }).expiresAt).toBe('2030-01-01T09:00:01.000Z');
    f.setNow(initialNow + 999); expect(f.query('hold', { actor, id: 'short' }).status).toBe('held');
    const seq = f.db.currentSeq; f.setNow(initialNow + 1_000);
    expect(f.query('hold', { actor, id: 'short' }).status).toBe('expired');
    expect(f.query('holds', { actor, resourceIds: ['person'], ...range })).toEqual({ items: [], truncated: false });
    expect(f.query('busy', { actor, resourceIds: ['person'], ...range })).toEqual({ items: [], truncated: false });
    expect(f.db.get('calendar_holds', 'short')!.status).toBe('held'); expect(f.db.currentSeq).toBe(seq);
    rejects(() => f.confirm('short'), 'CALENDAR_HOLD_EXPIRED'); expect(f.db.currentSeq).toBe(seq);
    f.appointment('expired-is-free', { startAt: '2030-01-01T09:00:01.000Z', endAt: '2030-01-01T09:00:02.000Z' });
  } finally { f.close(); }
});

test('acquire replay is clock-independent and global idempotency keys conflict across command families', () => {
  const f = fixture();
  try {
    f.resource(); const accepted = f.hold(), seq = f.db.currentSeq;
    expect(f.hold()).toEqual(accepted); expect(f.db.currentSeq).toBe(seq);
    f.setNow(Date.parse(timed.startAt) + 1);
    expect(f.hold()).toEqual(accepted); expect(f.db.currentSeq).toBe(seq);
    expect(f.query('receipt', { actor, requestId: 'acquire-private-hold' })).toEqual(accepted.value);
    expect(f.query('receipt', { actor: { ...actor, principal: 'other-session' }, requestId: 'acquire-private-hold' })).toBeNull();
    rejects(() => f.hold('private-hold', { ttlSeconds: 301 }), 'CALENDAR_INTENT_CONFLICT');
    rejects(() => f.appointment('other', { actor, requestId: 'acquire-private-hold' }), 'CALENDAR_INTENT_CONFLICT');
    rejects(() => f.block('other', { actor, requestId: 'acquire-private-hold' }), 'CALENDAR_INTENT_CONFLICT');
    rejects(() => f.hold('different-hold', { actor: manager, requestId: 'resource-person' }), 'CALENDAR_INTENT_CONFLICT');
    expect(Object.keys(accepted.value).sort()).toEqual(['changed', 'id', 'operation', 'requestId', 'revision']);
    expect(JSON.stringify(accepted.value)).not.toContain(timed.startAt);
  } finally { f.close(); }
});

test('current book revocation conceals private reads, release and acquire receipts, even under exact replay', () => {
  const f = fixture();
  try {
    f.resource(); f.resource('room', null); f.grant('person', ['book']); f.grant('room', ['book']);
    const input = { actor: delegate, resourceIds: ['person', 'room'] }; f.hold('delegated', input); f.grant('room', ['details']);
    const seq = f.db.currentSeq;
    rejects(() => f.hold('delegated', input), 'CALENDAR_NOT_FOUND');
    rejects(() => f.query('receipt', { actor: delegate, requestId: 'acquire-delegated' }), 'CALENDAR_NOT_FOUND');
    rejects(() => f.query('hold', { actor: delegate, id: 'delegated' }), 'CALENDAR_NOT_FOUND');
    rejects(() => f.release('delegated', { actor: delegate }), 'CALENDAR_NOT_FOUND');
    rejects(() => f.confirm('delegated', { actor: delegate }), 'CALENDAR_NOT_FOUND');
    expect(f.db.currentSeq).toBe(seq); expect(f.query('hold', { actor: manager, id: 'delegated' }).status).toBe('held');
  } finally { f.close(); }
});

test('holds, buffered appointments and one-off blocks share all-resource capacity with exact half-open adjacency', () => {
  const f = fixture();
  try {
    f.resource(); f.resource('room', null); f.hold('held', { actor: manager, resourceIds: ['room', 'person'], bufferAfterMinutes: 15 });
    const seq = f.db.currentSeq;
    rejects(() => f.hold('competing', { resourceIds: ['person'] }), 'CALENDAR_BOOKING_CONFLICT');
    rejects(() => f.appointment('competing', { resourceIds: ['person', 'room'] }), 'CALENDAR_BOOKING_CONFLICT');
    rejects(() => f.block('competing', { resourceIds: ['person', 'room'] }), 'CALENDAR_BOOKING_CONFLICT');
    rejects(() => f.appointment('buffer-edge', { startAt: timed.endAt, endAt: later.startAt }), 'CALENDAR_BOOKING_CONFLICT');
    expect(f.db.currentSeq).toBe(seq); expect(f.count('calendar_holds')).toBe(1); expect(f.count('_calendar_hold_reservations')).toBe(2);
    f.block('adjacent', { startAt: '2030-01-01T11:15:00.000Z', endAt: later.startAt });
    rejects(() => f.hold('blocked', { startAt: '2030-01-01T11:59:59.999Z', endAt: later.endAt }), 'CALENDAR_BOOKING_CONFLICT');
    f.appointment('later', later); rejects(() => f.hold('appointment-conflict', later), 'CALENDAR_BOOKING_CONFLICT');
    f.release('held', { actor: manager }); f.hold('replacement', { actor: manager, resourceIds: ['person', 'room'] });
  } finally { f.close(); }
});

test('competing queued memory writer attempts produce exactly one winner with no partial co-resource hold', async () => {
  const f = fixture();
  try {
    f.resource(); f.resource('room', null);
    // These are real serialized native transactions, not a physical actor or parallel-file contention claim.
    const outcomes = await Promise.allSettled([
      Promise.resolve().then(() => f.hold('first', { actor: manager, resourceIds: ['person', 'room'] })),
      Promise.resolve().then(() => f.appointment('second', { resourceIds: ['room', 'person'] })),
      Promise.resolve().then(() => f.block('third', { resourceIds: ['person', 'room'] })),
    ]);
    expect(outcomes.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    for (const result of outcomes) if (result.status === 'rejected') expect(readCalendarRejection(result.reason)?.code).toBe('CALENDAR_BOOKING_CONFLICT');
    expect(f.count('calendar_holds')).toBe(1); expect(f.count('_calendar_hold_reservations')).toBe(2);
    expect(f.count('calendar_appointments')).toBe(0); expect(f.count('calendar_blocks')).toBe(0);
    expect(f.count('_calendar_reservations')).toBe(0); expect(f.count('_calendar_block_reservations')).toBe(0);
  } finally { f.close(); }
});

test('acquire validates availability including buffers and rolls all resources back on an unavailable co-resource', () => {
  const f = fixture();
  try {
    f.resource(); f.resource('room', null); f.policy('room', [{ startAt: timed.startAt, endAt: timed.endAt }]);
    const seq = f.db.currentSeq;
    rejects(() => f.hold('outside-buffer', { actor: manager, resourceIds: ['person', 'room'], bufferBeforeMinutes: 1 }), 'CALENDAR_AVAILABILITY_CONFLICT');
    expect(f.db.currentSeq).toBe(seq); expect(f.count('calendar_holds')).toBe(0); expect(f.count('_calendar_hold_reservations')).toBe(0);
    f.hold('fits', { actor: manager, resourceIds: ['person', 'room'] });
  } finally { f.close(); }
});

test('release needs explicit confirmation and revision, releases every resource, retains truth and never cancels a confirmed appointment', () => {
  const f = fixture();
  try {
    f.resource(); f.resource('room', null); f.hold('both', { actor: manager, resourceIds: ['person', 'room'] });
    rejects(() => f.release('both', { actor: manager, confirmed: false }), 'CALENDAR_INPUT_INVALID');
    rejects(() => f.release('both', { actor: manager, expectedRevision: 2 }), 'CALENDAR_REVISION_CONFLICT');
    const accepted = f.release('both', { actor: manager }); expect(accepted.value).toMatchObject({ operation: 'hold.released', revision: 2, changed: true });
    const seq = f.db.currentSeq; expect(f.release('both', { actor: manager })).toEqual(accepted); expect(f.db.currentSeq).toBe(seq);
    expect(f.release('both', { actor: manager, requestId: 'release-noop', expectedRevision: 2 }).value.changed).toBe(false);
    expect(f.query('hold', { actor: manager, id: 'both' }).status).toBe('released');
    expect(f.db.list('_calendar_hold_reservations').filter(row => row.active === 1)).toHaveLength(0);
    f.hold('next'); f.confirm('next');
    rejects(() => f.release('next', { expectedRevision: 2 }), 'CALENDAR_HOLD_STALE');
    expect(f.db.get('calendar_appointments', 'appointment-next')!.status).toBe('confirmed');
  } finally { f.close(); }
});

test('an expired hold can explicitly become released without manufacturing an expiry transition or revived occupancy', () => {
  const f = fixture(true);
  try {
    f.resource(); f.hold('expired', { ttlSeconds: 1 }); f.setNow(initialNow + 1_000); f.release('expired');
    expect(f.query('hold', { actor, id: 'expired' }).status).toBe('released');
    expect(f.query('busy', { actor, resourceIds: ['person'], ...range })).toEqual({ items: [], truncated: false });
    expect(f.source!.control({}).rows.map(row => row.event.action).filter(action => action.startsWith('calendar.hold.'))).toEqual(['calendar.hold.acquired', 'calendar.hold.released']);
  } finally { f.close(); }
});

test('confirmation consumes a fresh owned hold into one canonical appointment with frozen resources and buffers', () => {
  const f = fixture();
  try {
    f.resource(); f.resource('room', null); f.grant('person', ['book']); f.grant('room', ['book']);
    f.hold('owned', { actor: delegate, resourceIds: ['room', 'person'], bufferBeforeMinutes: 5, bufferAfterMinutes: 10 });
    rejects(() => f.confirm('owned', { actor: manager }), 'CALENDAR_NOT_FOUND');
    rejects(() => f.confirm('owned', { actor: { ...delegate, principal: 'other-session' } }), 'CALENDAR_NOT_FOUND');
    const accepted = f.confirm('owned', { actor: delegate });
    expect(accepted.value).toEqual({ requestId: 'confirm-owned', operation: 'appointment.created', id: 'appointment-owned', revision: 1, changed: true });
    expect(f.query('hold', { actor: delegate, id: 'owned' })).toMatchObject({ revision: 2, status: 'confirmed', appointmentId: 'appointment-owned', resourceIds: ['person', 'room'] });
    expect(f.db.get('calendar_appointments', 'appointment-owned')).toMatchObject({ title: 'PRIVATE_APPOINTMENT_TITLE', created_by: delegate.userId,
      status: 'confirmed', buffer_before: 5, buffer_after: 10 });
    expect(f.count('_calendar_reservations')).toBe(2);
    expect(f.db.list('_calendar_hold_reservations').filter(row => row.active === 1)).toHaveLength(0);
    const seq = f.db.currentSeq; f.setNow(initialNow + 900_000); expect(f.confirm('owned', { actor: delegate })).toEqual(accepted); expect(f.db.currentSeq).toBe(seq);
    expect(f.query('receipt', { actor: delegate, requestId: 'confirm-owned' })).toEqual(accepted.value);
    rejects(() => f.confirm('owned', { actor: delegate, requestId: 'confirm-again', expectedRevision: 2 }), 'CALENDAR_HOLD_STALE');
    expect(f.count('calendar_appointments')).toBe(1);
  } finally { f.close(); }
});

test('confirm is fenced by captured resource revision even if changed permissions or availability still allow booking', () => {
  const f = fixture();
  try {
    f.resource(); f.hold(); f.grant('person', ['busy']); const seq = f.db.currentSeq;
    rejects(() => f.confirm(), 'CALENDAR_HOLD_STALE'); expect(f.db.currentSeq).toBe(seq);
    expect(f.db.get('calendar_holds', 'private-hold')!.status).toBe('held'); expect(f.count('calendar_appointments')).toBe(0);
    f.release(); f.hold('policy'); f.policy('person', [{ startAt: timed.startAt, endAt: timed.endAt }]);
    rejects(() => f.confirm('policy'), 'CALENDAR_HOLD_STALE'); expect(f.count('_calendar_reservations')).toBe(0);
    f.release('policy'); f.hold('active'); f.db.update('calendar_resources', 'person', { revision: Number(f.db.get('calendar_resources', 'person')!.revision) + 1, active: 0 });
    rejects(() => f.confirm('active'), 'CALENDAR_HOLD_STALE');
  } finally { f.close(); }
});

test('managers retain ordinary reschedule and cancellation receipt rights for an appointment confirmed by another subject', () => {
  const f = fixture();
  try {
    f.resource(); f.grant('person', ['book']); f.hold('delegated', { actor: delegate }); f.confirm('delegated', { actor: delegate });
    const move = { actor: manager, requestId: 'manager-move', id: 'appointment-delegated', expectedRevision: 1,
      ...later, bufferBeforeMinutes: 0, bufferAfterMinutes: 0 };
    const moved = f.command('appointment.reschedule', move); expect(f.command('appointment.reschedule', move)).toEqual(moved);
    expect(f.query('receipt', { actor: manager, requestId: 'manager-move' })).toEqual(moved.value);
    const cancel = { actor: manager, requestId: 'manager-cancel', id: 'appointment-delegated', expectedRevision: 2, confirmed: true };
    const cancelled = f.command('appointment.cancel', cancel); expect(f.command('appointment.cancel', cancel)).toEqual(cancelled);
    expect(f.query('receipt', { actor: manager, requestId: 'manager-cancel' })).toEqual(cancelled.value);
    expect(f.query('hold', { actor: manager, id: 'delegated' })).toMatchObject({ status: 'confirmed', appointmentId: 'appointment-delegated' });
    expect(f.db.get('calendar_appointments', 'appointment-delegated')!.status).toBe('cancelled');
  } finally { f.close(); }
});

test('confirm receipts and exact replay keep original user binding and current all-resource book rights', () => {
  const f = fixture();
  try {
    f.resource(); f.grant('person', ['book']); f.hold('delegated', { actor: delegate }); f.confirm('delegated', { actor: delegate });
    const replacement = { ...delegate, userId: 'different-user', manageAll: true };
    rejects(() => f.confirm('delegated', { actor: replacement }), 'CALENDAR_NOT_FOUND');
    rejects(() => f.query('receipt', { actor: replacement, requestId: 'confirm-delegated' }), 'CALENDAR_NOT_FOUND');
    f.grant('person', ['details']); const seq = f.db.currentSeq;
    rejects(() => f.confirm('delegated', { actor: delegate }), 'CALENDAR_NOT_FOUND');
    rejects(() => f.query('receipt', { actor: delegate, requestId: 'confirm-delegated' }), 'CALENDAR_NOT_FOUND');
    expect(f.db.currentSeq).toBe(seq); expect(f.db.get('calendar_appointments', 'appointment-delegated')!.status).toBe('confirmed');
  } finally { f.close(); }
});

test('confirmation rejects an existing appointment identity or exhausted appointment budget without consuming the hold', () => {
  const f = fixture();
  try {
    f.resource(); f.appointment('occupied-target', later); f.hold(); const seq = f.db.currentSeq;
    rejects(() => f.confirm('private-hold', { appointmentId: 'occupied-target' }), 'CALENDAR_INTENT_CONFLICT');
    expect(f.db.currentSeq).toBe(seq); expect(f.db.get('calendar_holds', 'private-hold')).toMatchObject({ status: 'held', revision: 1, appointment_id: null });
    f.db.update('_calendar_usage', 'appointments', { count: CALENDAR_LIMITS.appointments });
    const fullSeq = f.db.currentSeq; rejects(() => f.confirm(), 'CALENDAR_CAPACITY'); expect(f.db.currentSeq).toBe(fullSeq);
    expect(f.count('calendar_appointments')).toBe(1); expect(f.count('_calendar_reservations')).toBe(1);
    expect(f.db.list('_calendar_hold_reservations').filter(row => row.active === 1)).toHaveLength(1);
    expect(f.db.get('calendar_holds', 'private-hold')).toMatchObject({ status: 'held', revision: 1, appointment_id: null });
  } finally { f.close(); }
});

test('a late acquire reservation failure rolls back holds, partial reservations, usage, receipt, effect intent and source audit', () => {
  const f = fixture(true);
  try {
    f.resource(); f.resource('room', null);
    f.db.getRawDatabase().run("CREATE TRIGGER synthetic_hold_failure BEFORE INSERT ON _calendar_hold_reservations WHEN NEW.resource_id='room' BEGIN SELECT RAISE(ABORT,'synthetic failure'); END");
    const seq = f.db.currentSeq, audit = f.source!.control({}).queued, receipts = f.db.get('_calendar_usage', 'receipts')!.count;
    expect(() => f.hold('rollback', { actor: manager, resourceIds: ['person', 'room'] })).toThrow();
    expect(f.db.currentSeq).toBe(seq); expect(f.count('calendar_holds')).toBe(0); expect(f.count('_calendar_hold_reservations')).toBe(0);
    expect(f.count('_calendar_hold_receipts')).toBe(0); expect(f.count('_calendar_hold_effect_intents')).toBe(0);
    expect(f.db.get('_calendar_usage', 'holds')).toBeNull(); expect(f.db.get('_calendar_usage', 'receipts')!.count).toBe(receipts);
    expect(f.source!.control({}).queued).toBe(audit);
  } finally { f.close(); }
});

test('late appointment reservation and hold-consumption failures preserve the entire held source and audit atomically', () => {
  const f = fixture(true);
  try {
    f.resource(); f.resource('room', actor.userId); f.hold('both', { resourceIds: ['person', 'room'] });
    const seq = f.db.currentSeq, audit = f.source!.control({}).queued, receipts = f.db.get('_calendar_usage', 'receipts')!.count;
    f.db.getRawDatabase().run("CREATE TRIGGER synthetic_confirm_failure BEFORE INSERT ON _calendar_reservations WHEN NEW.resource_id='room' BEGIN SELECT RAISE(ABORT,'synthetic failure'); END");
    expect(() => f.confirm('both')).toThrow();
    expect(f.db.currentSeq).toBe(seq); expect(f.count('calendar_appointments')).toBe(0); expect(f.count('_calendar_reservations')).toBe(0);
    expect(f.db.get('calendar_holds', 'both')).toMatchObject({ status: 'held', revision: 1, appointment_id: null });
    expect(f.db.list('_calendar_hold_reservations').filter(row => row.active === 1)).toHaveLength(2);
    expect(f.db.get('_calendar_usage', 'appointments')).toBeNull(); expect(f.db.get('_calendar_usage', 'receipts')!.count).toBe(receipts); expect(f.source!.control({}).queued).toBe(audit);
    f.db.getRawDatabase().run('DROP TRIGGER synthetic_confirm_failure');
    f.db.getRawDatabase().run("CREATE TRIGGER synthetic_consume_failure BEFORE UPDATE ON _calendar_hold_reservations WHEN NEW.resource_id='room' BEGIN SELECT RAISE(ABORT,'synthetic consume failure'); END");
    expect(() => f.confirm('both')).toThrow();
    expect(f.db.currentSeq).toBe(seq); expect(f.count('calendar_appointments')).toBe(0); expect(f.count('_calendar_reservations')).toBe(0);
    expect(f.db.get('calendar_holds', 'both')).toMatchObject({ status: 'held', revision: 1 }); expect(f.source!.control({}).queued).toBe(audit);
    f.db.getRawDatabase().run('DROP TRIGGER synthetic_consume_failure'); f.confirm('both'); expect(f.count('_calendar_reservations')).toBe(2);
  } finally { f.close(); }
});

test('source audit records acquire, explicit release, confirmation and appointment creation once with only bounded opaque facts', () => {
  const f = fixture(true);
  try {
    f.resource(); f.hold('released'); f.hold('released'); f.release('released'); f.release('released');
    f.release('released', { requestId: 'new-noop', expectedRevision: 2 }); f.hold('confirmed'); f.confirm('confirmed'); f.confirm('confirmed');
    const events = f.source!.control({}).rows.map(row => row.event).filter(event => event.action.startsWith('calendar.hold.') || event.action === 'calendar.appointment.created');
    expect(events.map(event => event.action)).toEqual(['calendar.hold.acquired', 'calendar.hold.released', 'calendar.hold.acquired', 'calendar.appointment.created', 'calendar.hold.confirmed']);
    expect(new Set(events.map(event => event.id)).size).toBe(events.length);
    expect(events.filter(event => event.action.startsWith('calendar.hold.')).every(event => event.target?.type === 'calendar.hold')).toBe(true);
    expect(events.every(event => event.family === 'workflow' && event.outcome === 'succeeded')).toBe(true);
    expect(events.every(event => Object.keys(event.metadata).every(key => ['sequence', 'revision', 'resourceCount', 'status'].includes(key)))).toBe(true);
    const serialized = JSON.stringify(events); expect(serialized).not.toContain('PRIVATE'); expect(serialized).not.toContain(timed.startAt); expect(serialized).not.toContain(actor.principal);
  } finally { f.close(); }
});

test('audit queue pressure rolls back hold acquisition and confirmation rather than leaving a partially accepted source', () => {
  const f = fixture(true, 2);
  try {
    f.resource(); f.hold(); const seq = f.db.currentSeq;
    expect(() => f.confirm()).toThrow(); expect(f.db.currentSeq).toBe(seq);
    expect(f.db.get('calendar_holds', 'private-hold')!.status).toBe('held'); expect(f.count('calendar_appointments')).toBe(0); expect(f.count('_calendar_reservations')).toBe(0);
    expect(() => f.hold('audit-pressure', later)).toThrow(); expect(f.count('calendar_holds')).toBe(1);
    const queued = f.source!.control({}); f.source!.control({ acknowledge: queued.rows.map(row => row.id) });
    f.confirm(); expect(f.db.get('calendar_holds', 'private-hold')!.status).toBe('confirmed');
  } finally { f.close(); }
});

test('late confirmation audit pressure rolls back an already inserted appointment and its evidence as well as hold consumption', () => {
  const f = fixture(true, 3);
  try {
    f.resource(); f.hold(); const seq = f.db.currentSeq, receipts = f.db.get('_calendar_usage', 'receipts')!.count;
    // The appointment.created event fits as the third event; hold.confirmed is the late failing fourth event.
    expect(f.source!.control({}).queued).toBe(2); expect(() => f.confirm()).toThrow();
    expect(f.db.currentSeq).toBe(seq); expect(f.count('calendar_appointments')).toBe(0); expect(f.count('_calendar_reservations')).toBe(0);
    expect(f.db.get('calendar_holds', 'private-hold')).toMatchObject({ status: 'held', revision: 1, appointment_id: null });
    expect(f.db.list('_calendar_hold_reservations').filter(row => row.active === 1)).toHaveLength(1);
    expect(f.source!.control({}).queued).toBe(2); expect(f.db.get('_calendar_usage', 'receipts')!.count).toBe(receipts);
    expect(f.query('receipt', { actor, requestId: 'confirm-private-hold' })).toBeNull();
    const queued = f.source!.control({}); f.source!.control({ acknowledge: queued.rows.map(row => row.id) });
    f.confirm(); expect(f.count('calendar_appointments')).toBe(1); expect(f.source!.control({}).queued).toBe(2);
  } finally { f.close(); }
});

test('principal live quota excludes expired and released history while retained holds have an independent lifetime budget', () => {
  const f = fixture();
  try {
    f.resource();
    const at = (i: number) => ({ startAt: new Date(Date.parse(timed.startAt) + i * 60_000).toISOString(), endAt: new Date(Date.parse(timed.startAt) + (i + 1) * 60_000).toISOString() });
    for (let i = 0; i < CALENDAR_HOLD_LIMITS.principal; i++) f.hold('quota-' + i, { ...at(i), ttlSeconds: 1 });
    const seq = f.db.currentSeq; rejects(() => f.hold('seventeenth', at(16)), 'CALENDAR_CAPACITY'); expect(f.db.currentSeq).toBe(seq);
    f.release('quota-0'); f.hold('after-release', { ...at(16), ttlSeconds: 1 });
    f.setNow(initialNow + 1_000); f.hold('after-expiry', at(17)); expect(f.count('calendar_holds')).toBe(18);
    f.db.update('_calendar_usage', 'holds', { count: CALENDAR_LIMITS.holds });
    rejects(() => f.hold('retained-limit', at(18)), 'CALENDAR_CAPACITY'); expect(f.count('calendar_holds')).toBe(18);
    expect(f.db.get('_calendar_usage', 'holds')!.count).toBe(CALENDAR_LIMITS.holds);
  } finally { f.close(); }
});

test('scope live quota is enforced independently across principals and expired history does not block a new principal', () => {
  const f = fixture();
  try {
    f.resource();
    // Every row is generated by the canonical command in this owned memory fixture; no synthetic provenance is inferred from a path or name.
    for (let i = 0; i < CALENDAR_HOLD_LIMITS.scope; i++) {
      const startMs = Date.parse(timed.startAt) + i * 1_000;
      f.hold('scope-' + i, { actor: { ...actor, principal: 'scope-principal-' + i }, ttlSeconds: 1,
        startAt: new Date(startMs).toISOString(), endAt: new Date(startMs + 1_000).toISOString() });
    }
    const at = { startAt: later.startAt, endAt: later.endAt };
    const seq = f.db.currentSeq; rejects(() => f.hold('scope-full', at), 'CALENDAR_CAPACITY'); expect(f.db.currentSeq).toBe(seq);
    f.setNow(initialNow + 1_000); f.hold('scope-free', at); expect(f.count('calendar_holds')).toBe(CALENDAR_HOLD_LIMITS.scope + 1);
    for (const [sql, values, index] of [
      ["SELECT id FROM calendar_holds WHERE scope_id=? AND status='held' AND expires_ms>? ORDER BY expires_ms,id LIMIT ?", [actor.scopeId, f.now(), CALENDAR_HOLD_LIMITS.scope], 'calendar_hold_live_scope'],
      ["SELECT id FROM calendar_holds WHERE scope_id=? AND principal=? AND status='held' AND expires_ms>? ORDER BY expires_ms,id LIMIT ?", [actor.scopeId, actor.principal, f.now(), CALENDAR_HOLD_LIMITS.principal], 'calendar_hold_live_principal'],
    ] as const) {
      const plan = f.db.getRawDatabase().query<{ detail: string }, any[]>('EXPLAIN QUERY PLAN ' + sql).all(...values).map(row => row.detail).join(' ');
      expect(plan).toContain(index); expect(plan).toContain('expires_ms>?'); expect(plan).not.toContain('TEMP B-TREE');
    }
    expect(f.query('holds', { actor: manager, resourceIds: ['person'], ...range }, true)).toMatchObject({ items: [{ id: 'scope-free' }], truncated: false });
    const actualRangeSql = f.preparedQueries.find(sql => sql.startsWith('SELECT h.* FROM calendar_holds h'))!;
    expect(actualRangeSql).toBeDefined();
    const rangePlan = f.db.getRawDatabase().query<{ detail: string }, any[]>('EXPLAIN QUERY PLAN ' + actualRangeSql)
      .all(actor.scopeId, f.now(), calendarOverlapSearchStart(Date.parse(range.startAt)), Date.parse(range.endAt), Date.parse(range.startAt),
        'person', manager.principal, manager.userId, 101).map(row => row.detail).join(' ');
    expect(rangePlan).toMatch(/calendar_hold_(range|live_scope)/); expect(rangePlan).toContain('expires_ms>?');
    const reservationPlan = f.db.getRawDatabase().query<{ detail: string }, any[]>(`EXPLAIN QUERY PLAN SELECT id FROM _calendar_hold_reservations
      WHERE scope_id=? AND resource_id=? AND active=1 AND expires_ms>? AND occupied_start_ms>=? AND occupied_start_ms<? AND occupied_end_ms>?
      ORDER BY expires_ms,id LIMIT 1`).all(actor.scopeId, 'person', f.now(), calendarOverlapSearchStart(Date.parse(timed.startAt)), Date.parse(timed.endAt), Date.parse(timed.startAt))
      .map(row => row.detail).join(' ');
    expect(reservationPlan).toContain('calendar_hold_reservation_overlap'); expect(reservationPlan).toContain('expires_ms>?');
  } finally { f.close(); }
});

test('strict hold admission rejects injected subject/clock/title, invalid TTL, nonfuture starts and widened interval/query controls', () => {
  const f = fixture();
  try {
    f.resource();
    for (const overrides of [{ now: initialNow }, { principal: actor.principal }, { createdBy: actor.userId }, { title: 'not-on-hold' }, { expiresAt: timed.endAt },
      { ttlSeconds: 0 }, { ttlSeconds: 901 }, { ttlSeconds: 1.5 }, { ttlSeconds: null }, { resourceIds: [] }, { resourceIds: ['person', 'person'] },
      { resourceIds: Array.from({ length: 17 }, (_, i) => 'resource-' + i) }, { startAt: initialNow }, { startAt: initialNow - 1 },
      { startAt: '2030-01-01T10:00' }, { startAt: '2030-01-01T10:00:00.000+00:00' }, { endAt: timed.startAt }, { endAt: '2030-02-01T10:00:00.001Z' },
      { bufferBeforeMinutes: 1_441 }, { timeZone: '+00:00' }, { actor: { ...actor, now: initialNow } }]) {
      rejects(() => f.hold('invalid', overrides), 'CALENDAR_INPUT_INVALID');
    }
    for (const overrides of [{ limit: 101 }, { resourceIds: ['person', 'person'] }, { endAt: '2030-03-01T00:00:00.000Z' }, { status: 'expired' }]) {
      rejects(() => f.query('holds', { actor, resourceIds: ['person'], ...range, ...overrides }), 'CALENDAR_INPUT_INVALID');
    }
    f.hold();
    rejects(() => f.confirm('private-hold', { resourceIds: ['person'] }), 'CALENDAR_INPUT_INVALID');
    rejects(() => f.confirm('private-hold', { startAt: later.startAt }), 'CALENDAR_INPUT_INVALID');
    rejects(() => f.confirm('private-hold', { expectedRevision: 2 }), 'CALENDAR_REVISION_CONFLICT');
    expect(f.count('calendar_holds')).toBe(1); expect(f.count('calendar_appointments')).toBe(0);
  } finally { f.close(); }
});
