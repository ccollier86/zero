/** Native memory transactions only; every database, read copy, logger and clock closes in finally. */
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
import { calendarRealm } from './realm';
import { CALENDAR_LIMITS } from './realm-model';
import { normalizeCalendarTimedInterval } from './time';
import { calendarHash } from './validation';

const owner: CalendarActor = { scopeId: 'tenant:synthetic', userId: 'owner', principal: 'session.owner', manageAll: false, createOwn: true };
const manager: CalendarActor = { ...owner, userId: 'manager', principal: 'session.manager', manageAll: true };
const reader: CalendarActor = { ...owner, userId: 'reader', principal: 'session.reader', createOwn: false };
const now = Date.parse('2030-01-01T09:00:00.000Z');
const timed = { startAt: '2030-01-01T10:00:00.000Z', endAt: '2030-01-01T11:00:00.000Z', timeZone: 'UTC' };
const later = { startAt: '2030-01-01T12:00:00.000Z', endAt: '2030-01-01T13:00:00.000Z', timeZone: 'UTC' };
const range = { startAt: '2030-01-01T00:00:00.000Z', endAt: '2030-01-02T00:00:00.000Z' };
const typeRef = { id: 'consult', revision: 1 };
const typeFields = { label: 'PRIVATE_TYPE_LABEL', durationMinutes: 60, bufferBeforeMinutes: 5, bufferAfterMinutes: 10, colorKey: 'violet', active: true };
const typeSnapshot = { ...typeRef, label: typeFields.label, durationMinutes: 60, bufferBeforeMinutes: 5, bufferAfterMinutes: 10, colorKey: 'violet' };

function fixture(logging = false, maxEvents = 10_000) {
  const clock = spyOn(Date, 'now').mockReturnValue(now), db = createReactiveDB({ mode: 'memory' });
  let source: LoggingActorSource | null = null;
  try {
    db.getRawDatabase().run('PRAGMA temp_store=MEMORY');
    for (const [name, schema] of Object.entries(calendarRealm.tables)) db.defineTable(name, schema);
    for (const migration of calendarRealm.migrations) migration.up(db.getRawDatabase());
    if (logging) source = new LoggingActorSource(db, normalizeLoggingActorSourceBinding({ records: false, workflow: true,
      policyVersion: 'calendar-types-synthetic', scope: { kind: 'tenant', tenantId: 'synthetic' }, sourceQueue: { maxEvents } }));
    const command = (name: string, input: unknown): any => {
      // Simulate facade omission, not an unsupported explicit undefined IPC value.
      const payload = Object.fromEntries(Object.entries(input as Record<string, unknown>).filter(([, value]) => value !== undefined));
      const run = () => runDatabaseRealmCommand(calendarRealm, db, 'calendar.' + name, payload as DatabaseSerializableValue);
      return source ? source.run(loggingContext('synthetic'), run) : run();
    };
    const query = (name: string, input: unknown): any => {
      const copy = Database.deserialize(db.getRawDatabase().serialize(), { readonly: true, strict: true });
      try {
        copy.run('PRAGMA temp_store=MEMORY');
        return withDatabaseReadQuerySession(createDatabaseReadQuerySession(copy), context => runDatabaseRealmQuery(calendarRealm, context, 'calendar.' + name, input as DatabaseSerializableValue));
      } finally { copy.close(); }
    };
    command('owner.bind', { ownerId: 'synthetic-owner', scopeId: owner.scopeId });
    const resource = (id = 'person', ownerId: string | null = owner.userId) => command('resource.create', { actor: manager, requestId: 'resource-' + id,
      id, label: 'PRIVATE_RESOURCE_LABEL', kind: ownerId === null ? 'room' : 'person', ownerId, timeZone: 'UTC' });
    const type = (id = 'consult', fields: Record<string, unknown> = {}) => command('type.create', { actor: manager, requestId: 'type-' + id, id, ...typeFields, ...fields });
    const replaceType = (fields: Record<string, unknown> = {}, id = 'consult') => command('type.replace', { actor: manager, requestId: 'replace-' + db.currentSeq,
      id, expectedRevision: db.get('calendar_types', id)!.revision, ...typeFields, ...fields });
    const policy = (mode: string, typeIds: string[], id = 'person') => command('resource.types', { actor: manager, requestId: 'policy-' + db.currentSeq,
      id, expectedRevision: db.get('calendar_resources', id)!.revision, mode, typeIds });
    const grant = (grants: string[], id = 'person') => command('resource.grant', { actor: manager, requestId: 'grant-' + db.currentSeq,
      id, expectedRevision: db.get('calendar_resources', id)!.revision, userId: reader.userId, grants });
    const appointment = (id = 'visit', fields: Record<string, unknown> = {}) => command('appointment.create', { actor: owner, requestId: 'create-' + id,
      id, resourceIds: ['person'], title: 'PRIVATE_BOOKING_TITLE', ...timed, appointmentType: typeRef, ...fields });
    const hold = (id = 'lease', fields: Record<string, unknown> = {}) => command('hold.acquire', { actor: owner, requestId: 'hold-' + id,
      id, resourceIds: ['person'], ...timed, appointmentType: typeRef, ...fields });
    const confirm = (id = 'lease', fields: Record<string, unknown> = {}) => command('hold.confirm', { actor: owner, requestId: 'confirm-' + id,
      id, expectedRevision: 1, appointmentId: 'appointment-' + id, title: 'PRIVATE_BOOKING_TITLE', ...fields });
    const reschedule = (fields: Record<string, unknown> = {}) => command('appointment.reschedule', { actor: owner, requestId: 'move-' + db.currentSeq,
      id: 'visit', expectedRevision: db.get('calendar_appointments', 'visit')!.revision, ...timed,
      bufferBeforeMinutes: 5, bufferAfterMinutes: 10, ...fields });
    return { db, source, command, query, resource, type, replaceType, policy, grant, appointment, hold, confirm, reschedule,
      drain() { const page = source!.control({}); source!.control({ acknowledge: page.rows.map(row => row.id) }); },
      close() { try { source?.close(); } finally { try { db.dispose(); } finally { clock.mockRestore(); } } } };
  } catch (error) { try { source?.close(); } finally { try { db.dispose(); } finally { clock.mockRestore(); } } throw error; }
}
function rejects(run: () => unknown, code: CalendarErrorCode) {
  try { run(); throw new Error('Expected rejection'); }
  catch (error) { expect((error instanceof CalendarError ? error : readCalendarRejection(error))?.code).toBe(code); }
}

test('legacy untyped create/acquire keep exact digest and omit the new DTO property', () => {
  const f = fixture();
  try {
    f.resource(); f.appointment('plain', { appointmentType: undefined }); f.hold('plain', { appointmentType: undefined, ...later });
    const appointment = f.query('appointment', { actor: owner, id: 'plain' }), hold = f.query('hold', { actor: owner, id: 'plain' });
    expect(Object.hasOwn(appointment, 'appointmentType')).toBe(false); expect(Object.hasOwn(hold, 'appointmentType')).toBe(false);
    expect(f.db.list('_calendar_appointment_type_bindings')).toHaveLength(0); expect(f.db.list('_calendar_hold_type_bindings')).toHaveLength(0);
    expect(f.db.list('_calendar_receipts').find(row => row.request_id === 'create-plain')!.digest)
      .toBe(calendarHash(['appointment.create', 'plain', ['person'], 'PRIVATE_BOOKING_TITLE', normalizeCalendarTimedInterval(timed)]));
    expect(f.db.list('_calendar_hold_receipts')[0]!.digest)
      .toBe(calendarHash(['hold.acquire', 'plain', ['person'], normalizeCalendarTimedInterval(later), 300]));
  } finally { f.close(); }
});

test('legacy untyped reschedule retains its exact digest and replays even after a later typed generation', () => {
  const f = fixture();
  try {
    f.resource(); f.type(); f.appointment('visit', { appointmentType: undefined });
    const move = { requestId: 'legacy-move', expectedRevision: 1, ...later, bufferBeforeMinutes: 0, bufferAfterMinutes: 0 };
    const accepted = f.reschedule(move);
    expect(f.db.list('_calendar_receipts').find(row => row.request_id === 'legacy-move')!.digest)
      .toBe(calendarHash(['appointment.reschedule', 'visit', 1, normalizeCalendarTimedInterval({ ...later, bufferBeforeMinutes: 0, bufferAfterMinutes: 0 })]));
    f.reschedule({ ...later, appointmentType: typeRef });
    const seq = f.db.currentSeq; expect(f.reschedule(move)).toEqual(accepted); expect(f.db.currentSeq).toBe(seq);
    expect(f.query('appointment', { actor: owner, id: 'visit' }).appointmentType).toEqual(typeSnapshot);
  } finally { f.close(); }
});

test('typed create captures historical defaults and only detail-authorized views expose the safe snapshot', () => {
  const f = fixture();
  try {
    f.resource(); f.type(); f.appointment();
    expect(f.query('appointment', { actor: owner, id: 'visit' })).toMatchObject({ ...timed, bufferBeforeMinutes: 5, bufferAfterMinutes: 10, appointmentType: typeSnapshot });
    expect(f.query('appointments', { actor: owner, resourceIds: ['person'], ...range }).items[0].appointmentType).toEqual(typeSnapshot);
    f.grant(['busy']);
    const busy = f.query('busy', { actor: reader, resourceIds: ['person'], ...range });
    expect(busy.items).toEqual([{ resourceId: 'person', startAt: '2030-01-01T09:55:00.000Z', endAt: '2030-01-01T11:10:00.000Z' }]);
    expect(JSON.stringify(busy)).not.toContain('consult'); rejects(() => f.query('appointment', { actor: reader, id: 'visit' }), 'CALENDAR_NOT_FOUND');
    expect(f.db.list('_calendar_appointment_type_bindings')).toHaveLength(1); expect(f.db.list('_calendar_appointment_type_current')).toHaveLength(1);
  } finally { f.close(); }
});

test('all co-resource book rights precede unknown type admission and type conflicts leave no partial resources or receipts', () => {
  const f = fixture();
  try {
    f.resource(); f.resource('room', null); f.type(); f.grant(['book']);
    rejects(() => f.appointment('hidden', { actor: reader, resourceIds: ['person', 'room'], appointmentType: { id: 'missing', revision: 1 } }), 'CALENDAR_NOT_FOUND');
    rejects(() => f.hold('hidden', { actor: reader, resourceIds: ['person', 'room'], appointmentType: { id: 'missing', revision: 1 } }), 'CALENDAR_NOT_FOUND');
    const seq = f.db.currentSeq;
    for (const [index, fields] of [{ endAt: '2030-01-01T10:59:59.999Z' }, { bufferBeforeMinutes: 0 }, { bufferAfterMinutes: 11 }].entries()) {
      rejects(() => f.appointment('bad-' + index, { actor: manager, resourceIds: ['person', 'room'], ...fields }), 'CALENDAR_TYPE_CONFLICT');
      rejects(() => f.hold('bad-' + index, { actor: manager, resourceIds: ['person', 'room'], ...fields }), 'CALENDAR_TYPE_CONFLICT');
    }
    expect(f.db.currentSeq).toBe(seq); expect(f.db.list('calendar_appointments')).toHaveLength(0); expect(f.db.list('calendar_holds')).toHaveLength(0);
    expect(f.db.list('_calendar_appointment_type_bindings')).toHaveLength(0); expect(f.db.list('_calendar_hold_type_bindings')).toHaveLength(0);
    rejects(() => f.appointment('unknown', { appointmentType: { id: 'missing', revision: 1 } }), 'CALENDAR_TYPE_STALE');
  } finally { f.close(); }
});

test('optional/required resource policy is an all-resource intersection; required empty closes only new booking', () => {
  const f = fixture();
  try {
    f.resource(); f.resource('room', null); f.type(); f.type('other');
    f.policy('optional', ['other']);
    rejects(() => f.appointment(), 'CALENDAR_TYPE_CONFLICT'); rejects(() => f.hold(), 'CALENDAR_TYPE_CONFLICT');
    f.appointment('plain', { appointmentType: undefined });
    f.policy('required', ['consult']); f.policy('optional', ['other'], 'room');
    rejects(() => f.appointment('plain-required', { appointmentType: undefined, ...later }), 'CALENDAR_TYPE_CONFLICT');
    rejects(() => f.hold('intersection', { actor: manager, resourceIds: ['person', 'room'], ...later }), 'CALENDAR_TYPE_CONFLICT');
    f.policy('required', []);
    rejects(() => f.appointment('closed', { ...later }), 'CALENDAR_TYPE_CONFLICT');
    expect(f.query('appointment', { actor: owner, id: 'plain' }).status).toBe('confirmed');
  } finally { f.close(); }
});

test('catalog retirement never relabels existing appointments or rejects an exact create replay, but current rights still apply', () => {
  const f = fixture();
  try {
    f.resource(); f.type(); f.grant(['book']); const accepted = f.appointment('visit', { actor: reader });
    f.replaceType({ label: 'OTHER_PRIVATE_LABEL', durationMinutes: 30, bufferBeforeMinutes: 0, bufferAfterMinutes: 0, colorKey: null, active: false });
    const seq = f.db.currentSeq;
    expect(f.appointment('visit', { actor: reader })).toEqual(accepted); expect(f.db.currentSeq).toBe(seq);
    expect(f.query('appointment', { actor: owner, id: 'visit' }).appointmentType).toEqual(typeSnapshot);
    rejects(() => f.appointment('old-version', { ...later }), 'CALENDAR_TYPE_STALE');
    rejects(() => f.appointment('inactive', { ...later, appointmentType: { id: 'consult', revision: 2 } }), 'CALENDAR_TYPE_STALE');
    f.grant(['details']); rejects(() => f.appointment('visit', { actor: reader }), 'CALENDAR_NOT_FOUND');
  } finally { f.close(); }
});

test('type-only reschedule advances the parent and binding generation, omitted refs preserve, explicit null clears and old replays survive later changes', () => {
  const f = fixture();
  try {
    f.resource(); f.type(); f.type('other', { label: 'OTHER' }); f.appointment();
    const first = { requestId: 'move-once', ...later }; const accepted = f.reschedule(first);
    expect(accepted.value.revision).toBe(2); expect(f.query('appointment', { actor: owner, id: 'visit' }).appointmentType).toEqual(typeSnapshot);
    f.reschedule({ ...later, appointmentType: { id: 'other', revision: 1 } });
    expect(f.query('appointment', { actor: owner, id: 'visit' }).appointmentType.id).toBe('other');
    const seq = f.db.currentSeq;
    expect(f.reschedule({ ...first, expectedRevision: 1 })).toEqual(accepted); expect(f.db.currentSeq).toBe(seq);
    f.reschedule({ ...later, appointmentType: null, bufferBeforeMinutes: 0, bufferAfterMinutes: 0 });
    expect(Object.hasOwn(f.query('appointment', { actor: owner, id: 'visit' }), 'appointmentType')).toBe(false);
    expect(f.db.list('_calendar_appointment_type_bindings').map(row => [row.appointment_revision, row.type_id])).toEqual([[1, 'consult'], [3, 'other'], [4, null]]);
    const pointer = f.db.list('_calendar_appointment_type_current');
    f.command('appointment.cancel', { actor: owner, id: 'visit', requestId: 'cancel', expectedRevision: 4, confirmed: true });
    expect(f.db.list('_calendar_appointment_type_current')).toEqual(pointer); expect(f.db.list('_calendar_appointment_type_bindings')).toHaveLength(3);
  } finally { f.close(); }
});

test('grandfathered retired type accepts zone-only correction and identical old ref no-op, never occupancy/type changes or policy-bypassing clear', () => {
  const f = fixture();
  try {
    f.resource(); f.type(); f.appointment(); f.replaceType({ active: false }); f.policy('required', []);
    expect(f.reschedule({ appointmentType: typeRef }).value.changed).toBe(false);
    expect(f.reschedule({ timeZone: 'America/New_York', appointmentType: typeRef }).value.revision).toBe(2);
    expect(f.query('appointment', { actor: owner, id: 'visit' }).appointmentType).toEqual(typeSnapshot);
    rejects(() => f.reschedule({ ...later }), 'CALENDAR_TYPE_CONFLICT');
    rejects(() => f.reschedule({ appointmentType: null, bufferBeforeMinutes: 0, bufferAfterMinutes: 0 }), 'CALENDAR_TYPE_CONFLICT');
    f.type('replacement'); rejects(() => f.reschedule({ appointmentType: { id: 'replacement', revision: 1 } }), 'CALENDAR_TYPE_CONFLICT');
    expect(f.db.get('calendar_appointments', 'visit')!.revision).toBe(2);
  } finally { f.close(); }
});

test('legacy untyped grandfathering permits zone-only changes, but fresh required policy applies to occupancy edits', () => {
  const f = fixture();
  try {
    f.resource(); f.appointment('visit', { appointmentType: undefined }); f.policy('required', []);
    expect(f.reschedule({ timeZone: 'America/New_York', bufferBeforeMinutes: 0, bufferAfterMinutes: 0 }).value.revision).toBe(2);
    rejects(() => f.reschedule({ ...later, bufferBeforeMinutes: 0, bufferAfterMinutes: 0 }), 'CALENDAR_TYPE_CONFLICT');
    expect(f.db.list('_calendar_appointment_type_bindings')).toHaveLength(0);
  } finally { f.close(); }
});

test('out-of-policy catalog IDs, nonexistent revisions and inactive types have one rejection across every typed booking family', () => {
  const f = fixture();
  try {
    f.resource(); f.type(); f.type('hidden'); f.type('inactive', { active: false }); f.policy('required', ['consult']); f.appointment();
    const seq = f.db.currentSeq;
    for (const reference of [{ id: 'hidden', revision: 1 }, { id: 'hidden', revision: 2 }, { id: 'missing', revision: 1 }, { id: 'inactive', revision: 1 }]) {
      rejects(() => f.appointment('probe', { appointmentType: reference, ...later }), 'CALENDAR_TYPE_CONFLICT');
      rejects(() => f.hold('probe', { appointmentType: reference, ...later }), 'CALENDAR_TYPE_CONFLICT');
      rejects(() => f.reschedule({ appointmentType: reference, ...later }), 'CALENDAR_TYPE_CONFLICT');
    }
    // Hidden historical defaults must not turn an otherwise valid wire interval into an overflow oracle.
    const edge = { startAt: '+275760-09-12T23:00:00.000Z', endAt: '+275760-09-13T00:00:00.000Z', timeZone: 'UTC' };
    for (const reference of [{ id: 'hidden', revision: 1 }, { id: 'missing', revision: 1 }]) {
      rejects(() => f.appointment('edge-probe', { appointmentType: reference, ...edge }), 'CALENDAR_TYPE_CONFLICT');
      rejects(() => f.hold('edge-probe', { appointmentType: reference, ...edge }), 'CALENDAR_TYPE_CONFLICT');
    }
    expect(f.db.currentSeq).toBe(seq); expect(f.db.list('calendar_appointments')).toHaveLength(1); expect(f.db.list('calendar_holds')).toHaveLength(0);
  } finally { f.close(); }
});

test('versioned typed wire intents replay after catalog and policy retirement, distinguish omitted buffers and never alter legacy digests', () => {
  const f = fixture();
  try {
    f.resource(); f.type(); const appointment = f.appointment();
    const move = { requestId: 'accepted-typed-move', expectedRevision: 1, startAt: '2030-01-01T14:00:00.000Z', endAt: '2030-01-01T15:00:00.000Z', appointmentType: typeRef };
    const reschedule = f.reschedule(move), hold = f.hold('lease', later);
    f.policy('required', []); f.replaceType({ active: false, bufferBeforeMinutes: 1_440, bufferAfterMinutes: 1_440 });
    const seq = f.db.currentSeq;
    expect(f.appointment()).toEqual(appointment); expect(f.hold('lease', later)).toEqual(hold); expect(f.reschedule(move)).toEqual(reschedule);
    expect(f.query('receipt', { actor: owner, requestId: 'create-visit' })).toEqual(appointment.value);
    rejects(() => f.appointment('visit', { bufferBeforeMinutes: 5 }), 'CALENDAR_INTENT_CONFLICT');
    rejects(() => f.hold('lease', { ...later, bufferBeforeMinutes: 5 }), 'CALENDAR_INTENT_CONFLICT');
    expect(f.db.currentSeq).toBe(seq);
    expect(f.query('appointment', { actor: owner, id: 'visit' }).appointmentType).toEqual(typeSnapshot);
  } finally { f.close(); }
});

test('typed holds keep their immutable snapshot, confirm through the canonical typed writer and replay after later catalog edits', () => {
  const f = fixture();
  try {
    f.resource(); f.type(); f.hold();
    expect(f.query('hold', { actor: owner, id: 'lease' }).appointmentType).toEqual(typeSnapshot);
    expect(f.query('holds', { actor: owner, resourceIds: ['person'], ...range }).items[0].appointmentType).toEqual(typeSnapshot);
    const accepted = f.confirm();
    expect(f.query('appointment', { actor: owner, id: 'appointment-lease' }).appointmentType).toEqual(typeSnapshot);
    f.replaceType({ label: 'REPLACED', active: false });
    const seq = f.db.currentSeq; expect(f.confirm()).toEqual(accepted); expect(f.db.currentSeq).toBe(seq);
    expect(f.query('hold', { actor: owner, id: 'lease' }).appointmentType).toEqual(typeSnapshot);
    expect(f.db.list('_calendar_appointment_type_bindings')).toHaveLength(1);
  } finally { f.close(); }
});

test('typed hold acquisition replays after retirement but fresh confirmation rejects stale type without consuming the hold', () => {
  const f = fixture();
  try {
    f.resource(); f.type(); const accepted = f.hold(); f.replaceType({ label: 'REPLACED' });
    const seq = f.db.currentSeq; expect(f.hold()).toEqual(accepted); expect(f.db.currentSeq).toBe(seq);
    rejects(() => f.confirm(), 'CALENDAR_TYPE_STALE'); expect(f.db.currentSeq).toBe(seq);
    expect(f.db.get('calendar_holds', 'lease')!.status).toBe('held'); expect(f.db.list('calendar_appointments')).toHaveLength(0);
    expect(f.db.list('_calendar_hold_reservations')[0]!.active).toBe(1); expect(f.db.list('_calendar_appointment_type_bindings')).toHaveLength(0);
  } finally { f.close(); }
});

test('a changed resource type policy invalidates hold confirmation through the existing captured resource revision fence', () => {
  const f = fixture();
  try {
    f.resource(); f.type(); f.hold(); f.policy('required', ['consult']);
    const seq = f.db.currentSeq; rejects(() => f.confirm(), 'CALENDAR_HOLD_STALE'); expect(f.db.currentSeq).toBe(seq);
    expect(f.db.get('calendar_holds', 'lease')!.status).toBe('held'); expect(f.db.list('calendar_appointments')).toHaveLength(0);
  } finally { f.close(); }
});

test('late reservation failure rolls back type bindings, parent, reservations, receipts, effect intents and budgets', () => {
  const f = fixture();
  try {
    f.resource(); f.resource('room', null); f.type();
    f.db.getRawDatabase().run("CREATE TRIGGER synthetic_failure BEFORE INSERT ON _calendar_reservations WHEN NEW.resource_id='room' BEGIN SELECT RAISE(ABORT,'synthetic failure'); END");
    const seq = f.db.currentSeq, receipts = f.db.list('_calendar_receipts'), effects = f.db.list('_calendar_effect_intents');
    expect(() => f.appointment('failed', { actor: manager, resourceIds: ['person', 'room'] })).toThrow();
    expect(f.db.currentSeq).toBe(seq); expect(f.db.list('calendar_appointments')).toHaveLength(0); expect(f.db.list('_calendar_reservations')).toHaveLength(0);
    expect(f.db.list('_calendar_appointment_type_bindings')).toHaveLength(0); expect(f.db.list('_calendar_appointment_type_current')).toHaveLength(0);
    expect(f.db.list('_calendar_receipts')).toEqual(receipts); expect(f.db.list('_calendar_effect_intents')).toEqual(effects);
    expect(f.db.get('_calendar_usage', 'appointments')).toBeNull(); expect(f.db.get('_calendar_usage', 'appointmentTypeHistory')).toBeNull();
  } finally { f.close(); }
});

test('retained type binding capacity rejects create, type changes and hold confirmation without partial parent mutations', () => {
  const f = fixture();
  try {
    f.resource(); f.type(); f.type('other'); f.appointment();
    f.db.update('_calendar_usage', 'appointmentTypeHistory', { count: CALENDAR_LIMITS.appointmentTypeHistory });
    const before = f.query('appointment', { actor: owner, id: 'visit' }), seq = f.db.currentSeq;
    rejects(() => f.appointment('full', later), 'CALENDAR_CAPACITY');
    rejects(() => f.reschedule({ appointmentType: { id: 'other', revision: 1 } }), 'CALENDAR_CAPACITY');
    expect(f.db.currentSeq).toBe(seq); expect(f.query('appointment', { actor: owner, id: 'visit' })).toEqual(before);
    f.hold('lease', later); const held = f.db.currentSeq;
    rejects(() => f.confirm(), 'CALENDAR_CAPACITY'); expect(f.db.currentSeq).toBe(held);
    expect(f.db.get('calendar_holds', 'lease')!.status).toBe('held'); expect(f.db.list('calendar_appointments')).toHaveLength(1);
    expect(f.db.list('_calendar_appointment_type_bindings')).toHaveLength(1); expect(f.db.list('_calendar_appointment_type_current')).toHaveLength(1);
  } finally { f.close(); }
});

test('late source audit pressure rolls back typed hold confirmation and type-only reschedule as one source transaction', () => {
  const f = fixture(true, 1);
  try {
    f.resource(); f.drain(); f.type(); f.drain(); f.hold(); f.drain();
    // Confirmation appends appointment.created then hold.confirmed; the second fact fails after binding writes.
    const seq = f.db.currentSeq;
    expect(() => f.confirm()).toThrow(expect.objectContaining({ code: 'DATABASE_BACKPRESSURE', outcome: 'not-committed' }));
    expect(f.db.currentSeq).toBe(seq); expect(f.db.list('calendar_appointments')).toHaveLength(0);
    expect(f.db.list('_calendar_appointment_type_bindings')).toHaveLength(0); expect(f.db.list('_calendar_appointment_type_current')).toHaveLength(0);
    expect(f.db.get('calendar_holds', 'lease')!.status).toBe('held'); expect(f.source!.control({}).rows).toHaveLength(0);
    f.command('hold.release', { actor: owner, id: 'lease', requestId: 'release', expectedRevision: 1, confirmed: true }); f.drain();
    f.appointment(); f.drain(); f.type('other'); // Fill the queue so the type-only parent mutation fails at evidence admission.
    const original = f.query('appointment', { actor: owner, id: 'visit' }), before = f.db.currentSeq;
    expect(() => f.reschedule({ appointmentType: { id: 'other', revision: 1 } })).toThrow(expect.objectContaining({ code: 'DATABASE_BACKPRESSURE' }));
    expect(f.db.currentSeq).toBe(before); expect(f.query('appointment', { actor: owner, id: 'visit' })).toEqual(original);
    expect(f.db.list('_calendar_appointment_type_bindings')).toHaveLength(1);
  } finally { f.close(); }
});

test('raw SQL cannot mutate, replace, cross-scope or append bindings to a sealed accepted parent generation', () => {
  const f = fixture();
  try {
    f.resource(); f.type(); f.appointment(); f.hold('future', later); f.appointment('plain', { appointmentType: undefined, startAt: '2030-01-01T14:00:00.000Z', endAt: '2030-01-01T15:00:00.000Z' });
    const raw = f.db.getRawDatabase(), binding = f.db.list('_calendar_appointment_type_bindings')[0]!, hold = f.db.list('_calendar_hold_type_bindings')[0]!;
    expect(() => raw.run('UPDATE _calendar_appointment_type_bindings SET type_revision=2 WHERE id=?', [String(binding.id)])).toThrow();
    expect(() => raw.run('DELETE FROM _calendar_appointment_type_bindings WHERE id=?', [String(binding.id)])).toThrow();
    expect(() => raw.run('INSERT OR REPLACE INTO _calendar_hold_type_bindings(id,scope_id,hold_id,type_id,type_revision) VALUES(?,?,?,?,?)', [String(hold.id), owner.scopeId, 'future', 'consult', 1])).toThrow();
    expect(() => raw.run('INSERT INTO _calendar_appointment_type_bindings(id,scope_id,appointment_id,appointment_revision,type_id,type_revision) VALUES(?,?,?,?,?,?)', ['late', owner.scopeId, 'plain', 1, 'consult', 1])).toThrow();
    expect(() => raw.run('INSERT INTO _calendar_appointment_type_bindings(id,scope_id,appointment_id,appointment_revision,type_id,type_revision) VALUES(?,?,?,?,?,?)', ['partial-null', owner.scopeId, 'plain', 1, 'consult', null])).toThrow();
    expect(() => raw.run('INSERT INTO _calendar_hold_type_bindings(id,scope_id,hold_id,type_id,type_revision) VALUES(?,?,?,?,?)', ['wrong-scope', 'tenant:other', 'future', 'consult', 1])).toThrow();
    expect(() => raw.run('UPDATE _calendar_appointment_type_current SET binding_id=?', ['missing'])).toThrow();
    expect(f.query('appointment', { actor: owner, id: 'visit' }).appointmentType).toEqual(typeSnapshot);
  } finally { f.close(); }
});

test('005 enforces exact typed hold transfer in both directions and rolls back a wrong canonical appointment', () => {
  for (const [holdType, appointmentType] of [['consult', null], ['consult', 'other'], [null, 'consult']] as const) {
    const f = fixture();
    try {
      f.resource(); f.type(); f.type('other');
      f.hold('lease', { appointmentType: holdType ? { id: holdType, revision: 1 } : undefined, bufferBeforeMinutes: 5, bufferAfterMinutes: 10 });
      const raw = f.db.getRawDatabase();
      const wrongTransfer = raw.transaction(() => {
        raw.run(`INSERT INTO calendar_appointments(id,scope_id,title,start_at,end_at,start_ms,end_ms,time_zone,buffer_before,buffer_after,occupied_start_ms,occupied_end_ms,status,revision,created_by)
          SELECT 'wrong',scope_id,'Synthetic',start_at,end_at,start_ms,end_ms,time_zone,buffer_before,buffer_after,occupied_start_ms,occupied_end_ms,'confirmed',1,created_by FROM calendar_holds WHERE id='lease'`);
        raw.run(`INSERT INTO _calendar_reservations(id,scope_id,appointment_id,resource_id,occupied_start_ms,occupied_end_ms,active)
          SELECT 'wrong-reservation',scope_id,'wrong',resource_id,occupied_start_ms,occupied_end_ms,1 FROM _calendar_hold_reservations WHERE hold_id='lease'`);
        if (appointmentType) {
          raw.run('INSERT INTO _calendar_appointment_type_bindings(id,scope_id,appointment_id,appointment_revision,type_id,type_revision) VALUES(?,?,?,?,?,?)', ['wrong-binding', owner.scopeId, 'wrong', 1, appointmentType, 1]);
          raw.run('INSERT INTO _calendar_appointment_type_current(id,scope_id,appointment_id,binding_id) VALUES(?,?,?,?)', ['wrong-pointer', owner.scopeId, 'wrong', 'wrong-binding']);
        }
        raw.run("UPDATE calendar_holds SET status='confirmed',revision=2,appointment_id='wrong' WHERE id='lease'");
      });
      expect(() => wrongTransfer()).toThrow(/Private hold type transfer is inconsistent/);
      expect(f.db.get('calendar_appointments', 'wrong')).toBeNull(); expect(f.db.list('_calendar_reservations')).toHaveLength(0);
      expect(f.db.list('_calendar_appointment_type_bindings')).toHaveLength(0); expect(f.db.list('_calendar_appointment_type_current')).toHaveLength(0);
      expect(f.db.get('calendar_holds', 'lease')!.status).toBe('held');
    } finally { f.close(); }
  }
});

test('typed parent audit uses ordinary revision-only evidence, with no type label, duration, color or replay/no-op success facts', () => {
  const f = fixture(true);
  try {
    f.resource(); f.type(); f.type('other'); f.drain();
    const accepted = f.appointment(); expect(f.appointment()).toEqual(accepted);
    expect(f.reschedule({ appointmentType: typeRef }).value.changed).toBe(false);
    f.reschedule({ appointmentType: { id: 'other', revision: 1 } });
    const events = f.source!.control({}).rows.map(row => row.event);
    expect(events.map(event => event.action)).toEqual(['calendar.appointment.created', 'calendar.appointment.rescheduled']);
    expect(events.map(event => event.metadata.revision)).toEqual([1, 2]);
    expect(events.every(event => Object.keys(event.metadata).every(key => ['sequence', 'revision', 'resourceCount', 'status'].includes(key)))).toBe(true);
    expect(JSON.stringify(events)).not.toContain(typeFields.label); expect(JSON.stringify(events)).not.toContain('durationMinutes');
    expect(JSON.stringify(events)).not.toContain('violet'); expect(JSON.stringify(events)).not.toContain(timed.startAt);
  } finally { f.close(); }
});
