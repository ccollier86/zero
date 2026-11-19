/** Real native in-memory transactions only. Every owned database/read copy/logging owner closes in finally. */
import { Database } from 'bun:sqlite';
import { expect, test } from 'bun:test';
import type { DatabaseSerializableValue } from '../databases/database-operations';
import { createDatabaseReadQuerySession, withDatabaseReadQuerySession } from '../databases/database-read-query-capability';
import { runDatabaseRealmCommand, runDatabaseRealmQuery } from '../databases/database-realm';
import { LoggingActorSource, normalizeLoggingActorSourceBinding } from '../logging/logging-actor-source';
import { loggingContext } from '../logging/test-support/logging-fixture';
import { createReactiveDB } from '../sync/reactive-db';
import { normalizeCalendarAppointmentUpdate } from './appointment-update';
import { CALENDAR_APPOINTMENT_RESOURCE_CURRENT as CURRENT, CALENDAR_APPOINTMENT_UPDATE_HISTORY as HISTORY } from './appointment-resource-bindings';
import type { CalendarActor, CalendarCommandReceipt } from './contracts';
import { CalendarError, readCalendarRejection, type CalendarErrorCode } from './error';
import { calendarRealm } from './realm';
import { reservationId } from './realm-model';
import { calendarInspectionFixture } from './test-support/integration-inspection-fixture';

const manager: CalendarActor = { scopeId: 'tenant:synthetic-update', userId: 'fixture-user', principal: 'session.manager', manageAll: true, createOwn: true };
const owner: CalendarActor = { ...manager, userId: 'old-owner', principal: 'session.old-owner', manageAll: false };
const nextOwner: CalendarActor = { ...owner, userId: 'new-owner', principal: 'session.new-owner' };
const interval = { startAt: '2030-01-01T10:00:00.000Z', endAt: '2030-01-01T11:00:00.000Z', timeZone: 'UTC', bufferBeforeMinutes: 0, bufferAfterMinutes: 0 };
const range = { startAt: '2030-01-01T00:00:00.000Z', endAt: '2030-01-02T00:00:00.000Z' };
function fixture(logging = false, maxEvents = 1000) {
  const db = createReactiveDB({ mode: 'memory' }); let source: LoggingActorSource | null = null;
  try {
    const raw = db.getRawDatabase(); raw.run('PRAGMA temp_store=MEMORY');
    for (const [table, schema] of Object.entries(calendarRealm.tables)) db.defineTable(table, schema);
    for (const migration of calendarRealm.migrations) migration.up(raw);
    if (logging) source = new LoggingActorSource(db, normalizeLoggingActorSourceBinding({ records: false, workflow: true,
      policyVersion: 'synthetic-update', scope: { kind: 'tenant', tenantId: 'synthetic-update' }, sourceQueue: { maxEvents } }));
    const command = (name: string, input: unknown): unknown => {
      const run = () => runDatabaseRealmCommand(calendarRealm, db, 'calendar.' + name, input as DatabaseSerializableValue);
      return source ? source.run(loggingContext('synthetic-update'), run) : run();
    };
    const receipt = (name: string, input: unknown): CalendarCommandReceipt => (command(name, input) as unknown as { value: CalendarCommandReceipt }).value;
    const query = (name: string, input: unknown): any => {
      const copy = Database.deserialize(raw.serialize(), { readonly: true, strict: true });
      try { copy.run('PRAGMA temp_store=MEMORY'); return withDatabaseReadQuerySession(createDatabaseReadQuerySession(copy), context => runDatabaseRealmQuery(calendarRealm, context, 'calendar.' + name, input as DatabaseSerializableValue)); }
      finally { copy.close(); }
    };
    receipt('owner.bind', { scopeId: manager.scopeId, ownerId: 'synthetic-update-owner' });
    const resource = (id: string, ownerId: string | null = owner.userId) => receipt('resource.create', { actor: manager, requestId: 'resource-' + id, id,
      label: 'PRIVATE_RESOURCE_' + id, kind: ownerId ? 'person' : 'room', ownerId, timeZone: 'UTC' });
    const appointment = (id = 'appointment', patch: Record<string, unknown> = {}) => receipt('appointment.create', { actor: manager,
      requestId: 'create-' + id, id, title: 'PRIVATE_ORIGINAL_TITLE', resourceIds: ['old'], ...interval, ...patch });
    const update = (patch: Record<string, unknown>, options: Record<string, unknown> = {}) => receipt('appointment.update', { actor: manager, requestId: 'update-' + db.currentSeq,
      id: 'appointment', expectedRevision: db.get('calendar_appointments', 'appointment')!.revision, ...patch, ...options });
    const grant = (id: string, userId: string, grants: string[]) => receipt('resource.grant', { actor: manager, requestId: 'grant-' + db.currentSeq,
      id, expectedRevision: db.get('calendar_resources', id)!.revision, userId, grants });
    const state = () => JSON.stringify(Object.fromEntries(Object.keys(calendarRealm.tables).map(table => [table, db.list(table)])));
    const drain = () => { if (source) { const page = source.control({}); source.control({ acknowledge: page.rows.map(row => row.id) }); } };
    return { db, raw, source, receipt, query, resource, appointment, update, grant, state, drain, close() { source?.close(); db.dispose(); } };
  } catch (error) { source?.close(); db.dispose(); throw error; }
}
function rejected(run: () => unknown, code: CalendarErrorCode): void {
  try { run(); throw new Error('expected rejection'); }
  catch (error) { expect(error instanceof CalendarError ? error.code : readCalendarRejection(error)?.code).toBe(code); }
}

test('rich patch admission detaches/sorts/freezes, preserves omission, and rejects implicit defaults/partial intervals', () => {
  const input = { title: 'Private', resourceIds: ['b', 'a'], participants: [{ kind: 'guardian-user', userId: 'b' }, { kind: 'guardian-user', userId: 'a' }], appointmentType: null, visit: null, ...interval };
  const result = normalizeCalendarAppointmentUpdate(input);
  expect(result.resourceIds).toEqual(['a', 'b']); expect(result.participants).toEqual([{ kind: 'guardian-user', userId: 'a' }, { kind: 'guardian-user', userId: 'b' }]);
  input.resourceIds.push('c'); expect(result.resourceIds).toEqual(['a', 'b']); expect(Object.isFrozen(result)).toBe(true); expect(Object.isFrozen(result.participants?.[0])).toBe(true);
  expect(normalizeCalendarAppointmentUpdate({ title: 'Private' })).toEqual({ title: 'Private' });
  for (const bad of [{}, { resourceIds: [] }, { resourceIds: ['a', 'a'] }, { resourceIds: Array.from({ length: 17 }, (_, i) => 'r' + i) },
    { startAt: interval.startAt }, { ...interval, bufferBeforeMinutes: undefined }, { title: null }, { title: '' }, { participants: null },
    { visit: { mode: 'video', location: null } }, { appointmentType: { id: 't', revision: 0 } }, { principal: 'forged', title: 'x' }, { title: undefined }]) {
    expect(() => normalizeCalendarAppointmentUpdate(bad)).toThrow(CalendarError);
  }
  let called = false; const getter = { get title() { called = true; return 'secret'; } };
  expect(() => normalizeCalendarAppointmentUpdate(getter)).toThrow(CalendarError); expect(called).toBe(false);
});

test('all rich fields commit in ONE parent generation with one receipt/effect/audit and exact private before/after history', () => {
  const f = fixture(true);
  try {
    f.resource('old'); f.resource('new', nextOwner.userId); f.resource('room', null);
    f.receipt('location.create', { actor: manager, requestId: 'office', id: 'office', label: 'PRIVATE_OFFICE' });
    for (const id of ['new', 'room']) f.receipt('resource.locations', { actor: manager, requestId: 'loc-' + id, id, expectedRevision: 1, locationIds: ['office'] });
    f.receipt('type.create', { actor: manager, requestId: 'type', id: 'type', label: 'PRIVATE_TYPE', durationMinutes: 37, bufferBeforeMinutes: 2, bufferAfterMinutes: 3 });
    f.appointment('appointment', { participants: [{ kind: 'guardian-user', userId: 'old-participant' }] }); f.drain();
    const beforeReceipts = f.db.list('_calendar_receipts').length, beforeEffects = f.db.list('_calendar_effect_intents').length;
    const patch = { title: 'PRIVATE_CHANGED_TITLE', resourceIds: ['room', 'new'], startAt: '2030-01-01T12:07:00.000Z', endAt: '2030-01-01T12:44:00.000Z',
      timeZone: 'America/New_York', bufferBeforeMinutes: 2, bufferAfterMinutes: 3, appointmentType: { id: 'type', revision: 1 },
      visit: { mode: 'in-person', location: { id: 'office', revision: 1 } }, participants: [{ kind: 'guardian-user', userId: 'new-participant' }] };
    const result = f.update(patch, { requestId: 'rich' });
    expect(result).toEqual({ requestId: 'rich', operation: 'appointment.updated', id: 'appointment', revision: 2, changed: true });
    const detail = f.query('appointment', { actor: manager, id: 'appointment' });
    expect(detail).toMatchObject({ revision: 2, title: patch.title, resourceIds: ['new', 'room'], startAt: patch.startAt, endAt: patch.endAt,
      timeZone: patch.timeZone, appointmentType: { id: 'type', revision: 1 }, visit: { mode: 'in-person', location: { id: 'office', revision: 1 } } });
    expect(f.query('appointmentParticipants', { actor: manager, id: 'appointment' }).references).toEqual(patch.participants);
    const histories = f.db.list(HISTORY); expect(histories).toHaveLength(1);
    expect(JSON.parse(String(histories[0]!.before_json))).toMatchObject({ title: 'PRIVATE_ORIGINAL_TITLE', resourceIds: ['old'], ...interval,
      appointmentType: null, visit: null, participants: [{ kind: 'guardian-user', userId: 'old-participant' }] });
    expect(JSON.parse(String(histories[0]!.after_json))).toMatchObject({ ...patch, resourceIds: ['new', 'room'] });
    expect(f.db.get('_calendar_reservations', reservationId(manager.scopeId, 'appointment', 'old'))).toMatchObject({ active: 0, occupied_start_ms: Date.parse(interval.startAt) });
    expect(f.db.list(CURRENT).map(row => row.resource_id).sort()).toEqual(['new', 'room']);
    expect(f.db.list('_calendar_receipts')).toHaveLength(beforeReceipts + 1); expect(f.db.list('_calendar_effect_intents')).toHaveLength(beforeEffects + 1);
    const events = f.source!.control({}).rows.map(row => row.event);
    expect(events).toHaveLength(1); expect(events[0]!.action).toBe('calendar.appointment.updated');
    expect(JSON.stringify(events)).not.toContain('PRIVATE_'); expect(JSON.stringify(events)).not.toContain('new-participant');
    expect(events[0]!.metadata).toMatchObject({ revision: 2, resourceCount: 2, resourcesChanged: true, titleChanged: true, occupancyChanged: true, participantsChanged: true });
  } finally { f.close(); }
});

test('current membership—not retained resource history—owns detail/range/receipt authority and legacy reschedule/cancel', () => {
  const f = fixture();
  try {
    f.resource('old'); f.resource('new', nextOwner.userId); f.appointment('appointment', { actor: owner });
    f.update({ resourceIds: ['new'] });
    expect(f.query('appointment', { actor: nextOwner, id: 'appointment' }).resourceIds).toEqual(['new']);
    expect(f.query('appointmentTransitions', { actor: nextOwner, id: 'appointment' })).toMatchObject({ id: 'appointment', revision: 2, status: 'confirmed' });
    rejected(() => f.query('appointment', { actor: owner, id: 'appointment' }), 'CALENDAR_NOT_FOUND');
    rejected(() => f.query('appointmentTransitions', { actor: owner, id: 'appointment' }), 'CALENDAR_NOT_FOUND');
    rejected(() => f.query('receipt', { actor: owner, requestId: 'create-appointment' }), 'CALENDAR_NOT_FOUND');
    expect(f.query('appointments', { actor: manager, resourceIds: ['old'], ...range }).items).toEqual([]);
    expect(f.query('busy', { actor: owner, resourceIds: ['old'], ...range }).items).toEqual([]);
    expect(f.query('appointments', { actor: nextOwner, resourceIds: ['new'], ...range }).items[0].resourceIds).toEqual(['new']);
    f.receipt('appointment.reschedule', { actor: manager, requestId: 'legacy-move', id: 'appointment', expectedRevision: 2, ...interval,
      startAt: '2030-01-01T12:00:00.000Z', endAt: '2030-01-01T13:00:00.000Z' });
    expect(f.db.get('_calendar_reservations', reservationId(manager.scopeId, 'appointment', 'old'))).toMatchObject({ active: 0, occupied_start_ms: Date.parse(interval.startAt) });
    f.receipt('appointment.cancel', { actor: manager, requestId: 'legacy-cancel', id: 'appointment', expectedRevision: 3, confirmed: true });
    expect(f.db.list('_calendar_reservations').every(row => row.active === 0)).toBe(true);
    expect(f.query('appointment', { actor: nextOwner, id: 'appointment' }).resourceIds).toEqual(['new']);
  } finally { f.close(); }
});

test('returning to a formerly reserved resource reuses retained identity while immutable history preserves each prior interval', () => {
  const f = fixture();
  try {
    f.resource('old'); f.resource('new', nextOwner.userId); f.appointment();
    const originalId = reservationId(manager.scopeId, 'appointment', 'old');
    f.update({ resourceIds: ['new'], ...interval, startAt: '2030-01-01T12:00:00.000Z', endAt: '2030-01-01T13:00:00.000Z' });
    f.update({ resourceIds: ['old'], ...interval, startAt: '2030-01-01T14:00:00.000Z', endAt: '2030-01-01T15:00:00.000Z' });
    expect(f.db.list('_calendar_reservations')).toHaveLength(2); expect(f.db.get('_calendar_reservations', originalId)).toMatchObject({ active: 1, occupied_start_ms: Date.parse('2030-01-01T14:00:00.000Z') });
    expect(f.query('appointment', { actor: owner, id: 'appointment' }).resourceIds).toEqual(['old']);
    const history = f.db.list(HISTORY).sort((a, b) => Number(a.appointment_revision) - Number(b.appointment_revision));
    expect(JSON.parse(String(history[0]!.before_json)).startAt).toBe(interval.startAt);
    expect(JSON.parse(String(history[1]!.before_json)).startAt).toBe('2030-01-01T12:00:00.000Z');
    expect(JSON.parse(String(history[0]!.after_json)).resourceIds).toEqual(['new']);
  } finally { f.close(); }
});

test('more than sixteen historical resources never exceeds the sixteen-CURRENT-member boundary', () => {
  const f = fixture();
  try {
    f.resource('old'); f.appointment();
    for (let i = 0; i < 18; i++) { const id = 'r' + i; f.resource(id); f.update({ resourceIds: [id] }); }
    expect(f.db.list('_calendar_reservations')).toHaveLength(19); expect(f.db.list(CURRENT)).toHaveLength(1);
    expect(f.query('appointment', { actor: manager, id: 'appointment' }).resourceIds).toEqual(['r17']);
    expect(f.query('appointmentTransitions', { actor: manager, id: 'appointment' })).toMatchObject({ id: 'appointment', revision: 19, status: 'confirmed' });
    f.update({ resourceIds: ['old'] }); expect(f.query('appointment', { actor: manager, id: 'appointment' }).resourceIds).toEqual(['old']);
  } finally { f.close(); }
});

test('old manage and resulting book rights are independently checked before hidden catalog probes', () => {
  const f = fixture();
  try {
    f.resource('old'); f.resource('new', nextOwner.userId); f.appointment();
    const patch = { resourceIds: ['new'], appointmentType: { id: 'hidden', revision: 1 } };
    rejected(() => f.update(patch, { actor: nextOwner }), 'CALENDAR_NOT_FOUND');
    rejected(() => f.update(patch, { actor: owner }), 'CALENDAR_NOT_FOUND');
    f.grant('new', owner.userId, ['book']);
    rejected(() => f.update(patch, { actor: owner }), 'CALENDAR_TYPE_STALE');
    expect(f.update({ resourceIds: ['new'] }, { actor: owner }).changed).toBe(true);
    rejected(() => f.update({ title: 'cannot-manage-result' }, { actor: owner }), 'CALENDAR_NOT_FOUND');
  } finally { f.close(); }
});

test('no-op/replay have no history/audit/effect mutations; intent conflicts and stale generations reject', () => {
  const f = fixture(true);
  try {
    f.resource('old'); f.appointment(); f.drain();
    const noop = f.update({ title: 'PRIVATE_ORIGINAL_TITLE', ...interval }, { requestId: 'noop' });
    expect(noop).toMatchObject({ changed: false, revision: 1 }); expect(f.db.list(HISTORY)).toEqual([]); expect(f.source!.control({}).rows).toEqual([]);
    const accepted = f.update({ title: 'PRIVATE_AFTER' }, { requestId: 'changed' }), state = f.state(), seq = f.db.currentSeq;
    expect(f.update({ title: 'PRIVATE_AFTER' }, { requestId: 'changed', expectedRevision: 1 })).toEqual(accepted);
    expect(f.state()).toBe(state); expect(f.db.currentSeq).toBe(seq); expect(f.source!.control({}).rows).toHaveLength(1);
    rejected(() => f.update({ title: 'DIFFERENT' }, { requestId: 'changed', expectedRevision: 1 }), 'CALENDAR_INTENT_CONFLICT');
    rejected(() => f.update({ title: 'stale' }, { expectedRevision: 1 }), 'CALENDAR_REVISION_CONFLICT');
    expect(f.db.get('calendar_appointments', 'appointment')!.revision).toBe(2);
  } finally { f.close(); }
});

test('collision and late source/history/receipt failures roll back every edited field, binding, reservation and quota', () => {
  for (const target of ['conflict', 'history', 'receipt', 'participant'] as const) {
    const f = fixture();
    try {
      f.resource('old'); f.resource('new'); f.appointment();
      if (target === 'conflict') f.appointment('collision', { resourceIds: ['new'] });
      else f.raw.run(`CREATE TRIGGER synthetic_update_failure BEFORE INSERT ON ${target === 'history' ? HISTORY : target === 'receipt' ? '_calendar_receipts' : '_calendar_appointment_participant_bindings'}
        BEGIN SELECT RAISE(ABORT,'synthetic update failure'); END`);
      const state = f.state(), seq = f.db.currentSeq;
      const run = () => f.update({ title: 'PRIVATE_ROLLBACK', resourceIds: ['new'], participants: [{ kind: 'guardian-user', userId: 'new-participant' }], visit: { mode: 'phone' } });
      if (target === 'conflict') rejected(run, 'CALENDAR_BOOKING_CONFLICT'); else expect(run).toThrow();
      expect(f.state()).toBe(state); expect(f.db.currentSeq).toBe(seq);
    } finally { f.close(); }
  }
});

test('audit pressure and history capacity reject atomically instead of leaving accepted partial edits', () => {
  const f = fixture(true, 1);
  try {
    f.resource('old'); f.drain(); f.resource('new'); f.drain(); f.appointment();
    const state = f.state(); expect(() => f.update({ title: 'PRIVATE_ROLLBACK', resourceIds: ['new'] })).toThrow(expect.objectContaining({ code: 'DATABASE_BACKPRESSURE' }));
    expect(f.state()).toBe(state); f.drain(); f.db.createStrict('_calendar_usage', { id: 'appointmentUpdateHistory', count: 100_000 });
    rejected(() => f.update({ title: 'PRIVATE_CAPACITY' }), 'CALENDAR_CAPACITY');
    expect(f.db.get('calendar_appointments', 'appointment')!.revision).toBe(1); expect(f.db.list(HISTORY)).toEqual([]);
  } finally { f.close(); }
});

test('title/zone/participant and removal-only edits grandfather existing occupancy, but additions and moved occupancy re-admit policy', () => {
  const f = fixture();
  try {
    f.resource('old'); f.resource('new'); f.appointment();
    f.receipt('resource.availability', { actor: manager, requestId: 'closed-old', id: 'old', expectedRevision: 1, mode: 'windows', windows: [] });
    f.update({ title: 'PRIVATE_GRANDFATHERED', ...interval, timeZone: 'America/New_York', participants: [] });
    rejected(() => f.update({ ...interval, startAt: '2030-01-01T12:00:00.000Z', endAt: '2030-01-01T13:00:00.000Z' }), 'CALENDAR_AVAILABILITY_CONFLICT');
    f.update({ resourceIds: ['old', 'new'] });
    f.receipt('resource.availability', { actor: manager, requestId: 'closed-new', id: 'new', expectedRevision: 1, mode: 'windows', windows: [] });
    f.update({ resourceIds: ['old'] });
    rejected(() => f.update({ resourceIds: ['old', 'new'] }), 'CALENDAR_AVAILABILITY_CONFLICT');
  } finally { f.close(); }
});

test('terminal lifecycle fences precede new no-op admission while original accepted update remains replayable', () => {
  const f = fixture();
  try {
    f.resource('old'); f.appointment(); const result = f.update({ title: 'PRIVATE_TERMINAL' }, { requestId: 'before-terminal' });
    f.receipt('lifecycle.replace', { actor: manager, requestId: 'policy', expectedRevision: 1, extended: true, cancellationReason: 'optional', noShowReason: 'optional' });
    const transitions = f.query('appointmentTransitions', { actor: manager, id: 'appointment' });
    f.receipt('appointment.transition', { actor: manager, requestId: 'completed', id: 'appointment', expectedRevision: 2, policyRevision: transitions.policyRevision, status: 'completed' });
    rejected(() => f.update({ title: 'PRIVATE_TERMINAL' }), 'CALENDAR_TRANSITION_INVALID');
    expect(f.update({ title: 'PRIVATE_TERMINAL' }, { requestId: 'before-terminal', expectedRevision: 1 })).toEqual(result);
  } finally { f.close(); }
});

test('confirmed hold captures stay immutable after a later atomic appointment resource/time/participant edit', () => {
  const f = fixture();
  try {
    f.resource('old'); f.resource('new');
    const now = Date.now(); const startAt = new Date(now + 3_600_000).toISOString(), endAt = new Date(now + 7_200_000).toISOString();
    f.receipt('hold.acquire', { actor: manager, requestId: 'hold', id: 'hold', resourceIds: ['old'], startAt, endAt, timeZone: 'UTC', participants: [{ kind: 'guardian-user', userId: 'held-participant' }] });
    f.receipt('hold.confirm', { actor: manager, requestId: 'confirm', id: 'hold', appointmentId: 'appointment', expectedRevision: 1, title: 'PRIVATE_HELD_TITLE' });
    const holdView = f.query('hold', { actor: manager, id: 'hold' }), participantView = f.query('holdParticipants', { actor: manager, id: 'hold' });
    const admission = f.query('holdParticipantAdmission', { actor: manager, id: 'hold' });
    const hold = JSON.stringify(f.db.get('calendar_holds', 'hold')), captured = JSON.stringify(f.db.list('_calendar_hold_reservations')), participants = JSON.stringify(f.db.list('_calendar_hold_participant_bindings'));
    f.update({ title: 'PRIVATE_CHANGED_AFTER_HOLD', resourceIds: ['new'], ...interval, participants: [] });
    expect(JSON.stringify(f.db.get('calendar_holds', 'hold'))).toBe(hold); expect(JSON.stringify(f.db.list('_calendar_hold_reservations'))).toBe(captured);
    expect(JSON.stringify(f.db.list('_calendar_hold_participant_bindings'))).toBe(participants);
    expect(f.query('hold', { actor: manager, id: 'hold' })).toEqual(holdView);
    expect(f.query('holdParticipants', { actor: manager, id: 'hold' })).toEqual(participantView);
    expect(f.query('holdParticipantAdmission', { actor: manager, id: 'hold' })).toEqual(admission);
    expect(f.query('appointment', { actor: manager, id: 'appointment' }).resourceIds).toEqual(['new']);
    expect(f.receipt('hold.confirm', { actor: manager, requestId: 'confirm', id: 'hold', appointmentId: 'appointment', expectedRevision: 1, title: 'PRIVATE_HELD_TITLE' })).toMatchObject({ operation: 'appointment.created', revision: 1 });
  } finally { f.close(); }
});

test('SQL guards retain immutable edit history/current identity and reject late resource/seal changes', () => {
  const f = fixture();
  try {
    f.resource('old'); f.resource('new'); f.appointment(); f.update({ resourceIds: ['new'] });
    const before = f.state(), history = f.db.list(HISTORY)[0]!;
    f.raw.run('PRAGMA recursive_triggers=OFF');
    for (const run of [
      () => f.raw.run(`UPDATE ${HISTORY} SET before_json=before_json`), () => f.raw.run(`DELETE FROM ${HISTORY}`),
      () => f.raw.run(`INSERT OR REPLACE INTO ${HISTORY} SELECT * FROM ${HISTORY}`),
      () => f.raw.run(`DELETE FROM ${CURRENT}`), () => f.raw.run(`UPDATE ${CURRENT} SET resource_id='old'`),
      () => f.db.update('_calendar_reservations', reservationId(manager.scopeId, 'appointment', 'old'), { active: 1 }),
      () => f.db.createStrict(HISTORY, { ...history, id: 'late-history', appointment_revision: 3, prior_revision: 2 }),
      () => f.db.createStrict(CURRENT, { id: 'late-current', scope_id: manager.scopeId, appointment_id: 'appointment', resource_id: 'old', binding_revision: 2 }),
    ]) expect(run).toThrow();
    expect(f.state()).toBe(before); expect(f.raw.query('PRAGMA foreign_key_check').all()).toEqual([]);
  } finally { f.close(); }
});

test('changed updates participate in the existing versioned ANY-appointment integration rules exactly once', () => {
  const f = calendarInspectionFixture();
  try {
    f.install(); const original = f.appointment();
    const result = f.command('appointment.update', { actor: f.actor, requestId: 'updated', id: 'appointment', expectedRevision: 1, title: 'PRIVATE_UPDATED_TITLE' });
    expect(result).toMatchObject({ operation: 'appointment.updated', revision: 2, changed: true });
    expect(f.rows('intents')).toHaveLength(2);
    expect(f.rows('dispatch').find(row => row.id === original)!.eligibility).toBe('superseded');
    expect(f.rows('dispatch').filter(row => row.eligibility === 'current')).toHaveLength(1);
    f.command('appointment.update', { actor: f.actor, requestId: 'updated', id: 'appointment', expectedRevision: 1, title: 'PRIVATE_UPDATED_TITLE' });
    f.command('appointment.update', { actor: f.actor, requestId: 'updated-noop', id: 'appointment', expectedRevision: 2, title: 'PRIVATE_UPDATED_TITLE' });
    expect(f.rows('intents')).toHaveLength(2);
  } finally { f.close(); }
});

test('late receipt failure rolls back an already changed type, visit, participants, times and resources together', () => {
  const f = fixture();
  try {
    f.resource('old'); f.resource('new'); f.appointment();
    f.receipt('type.create', { actor: manager, id: 'typed', requestId: 'typed', label: 'PRIVATE_TYPE', durationMinutes: 37, bufferBeforeMinutes: 2, bufferAfterMinutes: 3 });
    f.raw.run("CREATE TRIGGER synthetic_all_fields_failure BEFORE INSERT ON _calendar_receipts WHEN NEW.request_id='all-fields-rollback' BEGIN SELECT RAISE(ABORT,'synthetic late receipt failure'); END");
    const before = f.state(), sequence = f.db.currentSeq;
    expect(() => f.update({ title: 'PRIVATE_ROLLBACK_TITLE', resourceIds: ['new'], appointmentType: { id: 'typed', revision: 1 }, visit: { mode: 'phone' },
      participants: [{ kind: 'guardian-user', userId: 'PRIVATE_ROLLBACK_PARTICIPANT' }], startAt: '2030-01-01T12:07:00.000Z', endAt: '2030-01-01T12:44:00.000Z',
      timeZone: 'America/New_York', bufferBeforeMinutes: 2, bufferAfterMinutes: 3 }, { requestId: 'all-fields-rollback' })).toThrow();
    expect(f.state()).toBe(before); expect(f.db.currentSeq).toBe(sequence);
  } finally { f.close(); }
});
