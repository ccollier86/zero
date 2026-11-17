/** Memory-only lifecycle qualification. No files, actors, builds or persistent fixtures. */
import { Database } from 'bun:sqlite';
import { expect, test } from 'bun:test';
import type { DatabaseSerializableValue } from '../databases/database-operations';
import { createDatabaseReadQuerySession, withDatabaseReadQuerySession } from '../databases/database-read-query-capability';
import { runDatabaseRealmCommand, runDatabaseRealmQuery } from '../databases/database-realm';
import { LoggingActorSource, normalizeLoggingActorSourceBinding } from '../logging/logging-actor-source';
import { loggingContext } from '../logging/test-support/logging-fixture';
import { createReactiveDB } from '../sync/reactive-db';
import type { CalendarActor, CalendarAppointmentStatus } from './contracts';
import { CalendarError, readCalendarRejection, type CalendarErrorCode } from './error';
import { calendarAppointmentTransitionProjection, CALENDAR_LIFECYCLE_STATUSES } from './lifecycle-model';
import { calendarRealm } from './realm';
import { CALENDAR_LIMITS } from './realm-model';
import { calendarHash } from './validation';

const owner: CalendarActor = { scopeId: 'tenant:synthetic', userId: 'owner', principal: 'owner-session', manageAll: false, createOwn: true };
const manager: CalendarActor = { ...owner, userId: 'manager', principal: 'manager-session', manageAll: true };
const reader: CalendarActor = { ...owner, userId: 'reader', principal: 'reader-session', createOwn: false };
const interval = { startAt: '2030-01-01T10:00:00.000Z', endAt: '2030-01-01T11:00:00.000Z', timeZone: 'UTC', bufferBeforeMinutes: 0, bufferAfterMinutes: 0 };
const range = { startAt: '2030-01-01T00:00:00.000Z', endAt: '2030-01-02T00:00:00.000Z' };
const defaults = { extended: false, cancellationReason: 'optional', noShowReason: 'optional' };
function fixture(logging = false, maxEvents = 10_000) {
  const db = createReactiveDB({ mode: 'memory' }); let source: LoggingActorSource | null = null;
  try {
    const raw = db.getRawDatabase(); raw.run('PRAGMA temp_store=MEMORY');
    for (const [name, schema] of Object.entries(calendarRealm.tables)) db.defineTable(name, schema);
    for (const migration of calendarRealm.migrations) migration.up(raw);
    if (logging) source = new LoggingActorSource(db, normalizeLoggingActorSourceBinding({ records: false, workflow: true, policyVersion: 'synthetic-lifecycle', scope: { kind: 'tenant', tenantId: 'synthetic' }, sourceQueue: { maxEvents } }));
    const command = (name: string, input: unknown): any => {
      const run = () => (runDatabaseRealmCommand(calendarRealm, db, 'calendar.' + name, input as DatabaseSerializableValue) as any).value;
      return source ? source.run(loggingContext('synthetic'), run) : run();
    };
    const query = (name: string, input: unknown): any => {
      const copy = Database.deserialize(raw.serialize(), { readonly: true, strict: true });
      try { copy.run('PRAGMA temp_store=MEMORY'); return withDatabaseReadQuerySession(createDatabaseReadQuerySession(copy), context => runDatabaseRealmQuery(calendarRealm, context, 'calendar.' + name, input as DatabaseSerializableValue)); }
      finally { copy.close(); }
    };
    command('owner.bind', { ownerId: 'synthetic-owner', scopeId: owner.scopeId });
    const resource = (id = 'person', ownerId: string | null = owner.userId) => command('resource.create', { actor: manager, requestId: 'resource-' + id, id, label: 'PRIVATE_RESOURCE', kind: ownerId ? 'person' : 'room', ownerId, timeZone: 'UTC' });
    const appointment = (id = 'visit', overrides: Record<string, unknown> = {}) => command('appointment.create', { actor: manager, requestId: 'create-' + id, id, resourceIds: ['person'], title: 'PRIVATE_TITLE', ...interval, ...overrides });
    const policy = (overrides: Record<string, unknown> = {}) => command('lifecycle.replace', { actor: manager, requestId: 'policy-' + db.currentSeq, expectedRevision: query('lifecycle', { actor: manager }).revision, ...defaults, ...overrides });
    const transition = (status: CalendarAppointmentStatus, overrides: Record<string, unknown> = {}) => command('appointment.transition', { actor: owner, requestId: 'transition-' + db.currentSeq, id: 'visit', expectedRevision: db.get('calendar_appointments', 'visit')!.revision, policyRevision: query('lifecycle', { actor: manager }).revision, status, ...overrides });
    const cancel = (overrides: Record<string, unknown> = {}) => command('appointment.cancel', { actor: owner, requestId: 'cancel-' + db.currentSeq, id: 'visit', expectedRevision: db.get('calendar_appointments', 'visit')!.revision, confirmed: true, ...overrides });
    const grant = (id: string, grants: string[]) => command('resource.grant', { actor: manager, requestId: 'grant-' + db.currentSeq, id, expectedRevision: db.get('calendar_resources', id)!.revision, userId: reader.userId, grants });
    const snapshot = () => Object.fromEntries(Object.keys(calendarRealm.tables).map(table => [table, raw.query(`SELECT * FROM ${table} ORDER BY id`).all()]));
    const drain = () => { const page = source!.control({}); source!.control({ acknowledge: page.rows.map(row => row.id) }); };
    return { db, raw, source, command, query, resource, appointment, policy, transition, cancel, grant, snapshot, drain, close() { try { source?.close(); } finally { db.dispose(); } } };
  } catch (error) { try { source?.close(); } finally { db.dispose(); } throw error; }
}
function rejects(run: () => unknown, code: CalendarErrorCode): void {
  try { run(); throw new Error('Expected rejection'); }
  catch (error) { expect((error instanceof CalendarError ? error : readCalendarRejection(error))?.code).toBe(code); }
}

test('lifecycle has one fixed matrix: active states cross or finish, terminal states have no outgoing edges', () => {
  for (const status of CALENDAR_LIFECYCLE_STATUSES) for (const extended of [false, true]) {
    const projected = calendarAppointmentTransitionProjection({ id: 'visit', revision: 7 }, status, { revision: 3, extended, cancellationReason: 'required', noShowReason: 'required' });
    const expected = status === 'tentative' || status === 'confirmed'
      ? CALENDAR_LIFECYCLE_STATUSES.filter(target => target !== status && (extended || target === 'cancelled' || status === 'tentative' && target === 'confirmed')) : [];
    expect(projected).toEqual({ id: 'visit', revision: 7, policyRevision: 3, status, allowed: expected.map(status => ({ status, requiresReason: status === 'cancelled' || status === 'no-show' })) });
  }
});
test('virtual default is manager-only; default policy no-op is quiet, versioned replacement and replay are canonical', () => {
  const f = fixture(true);
  try {
    expect(f.query('lifecycle', { actor: manager })).toEqual({ revision: 1, ...defaults });
    rejects(() => f.query('lifecycle', { actor: owner }), 'CALENDAR_FORBIDDEN');
    rejects(() => f.policy({ actor: owner }), 'CALENDAR_FORBIDDEN');
    expect(f.policy({ requestId: 'noop' })).toMatchObject({ id: 'policy', revision: 1, changed: false });
    expect(f.db.list('_calendar_lifecycle_policy_history')).toHaveLength(0); expect(f.source!.control({}).rows).toHaveLength(0);
    const accepted = f.policy({ requestId: 'extended', extended: true }), seq = f.db.currentSeq;
    expect(accepted).toMatchObject({ id: 'policy', revision: 2, changed: true });
    expect(f.policy({ requestId: 'extended', expectedRevision: 1, extended: true })).toEqual(accepted); expect(f.db.currentSeq).toBe(seq);
    expect(f.policy({ extended: true })).toMatchObject({ revision: 2, changed: false });
    rejects(() => f.policy({ expectedRevision: 1 }), 'CALENDAR_REVISION_CONFLICT');
    rejects(() => f.policy({ extended: 'yes' }), 'CALENDAR_INPUT_INVALID');
    rejects(() => f.query('receipt', { actor: { ...manager, manageAll: false }, requestId: 'extended' }), 'CALENDAR_FORBIDDEN');
    expect(f.query('receipt', { actor: manager, requestId: 'extended' })).toEqual(accepted);
    expect(f.db.list('_calendar_lifecycle_receipts')).toHaveLength(3); expect(f.db.list('_calendar_lifecycle_effect_intents')).toHaveLength(1);
    expect(f.source!.control({}).rows.map(row => row.event.action)).toEqual(['calendar.lifecycle.policy-changed']);
  } finally { f.close(); }
});
test('untouched and default-cancelled legacy appointments keep exact wire shape and old digest; later policy never invalidates accepted replay', () => {
  const f = fixture();
  try {
    f.resource(); f.appointment(); expect(Object.hasOwn(f.query('appointment', { actor: owner, id: 'visit' }), 'lifecycle')).toBe(false);
    const accepted = f.cancel({ requestId: 'legacy-cancel' });
    expect(f.db.list('_calendar_receipts').find(row => row.request_id === 'legacy-cancel')!.digest).toBe(calendarHash(['appointment.cancel', 'visit', 1]));
    expect(Object.hasOwn(f.query('appointment', { actor: owner, id: 'visit' }), 'lifecycle')).toBe(false);
    f.policy({ cancellationReason: 'required' }); const seq = f.db.currentSeq;
    expect(f.cancel({ requestId: 'legacy-cancel', expectedRevision: 1 })).toEqual(accepted); expect(f.db.currentSeq).toBe(seq);
    expect(f.cancel()).toMatchObject({ changed: false, revision: 2 });
    rejects(() => f.cancel({ requestId: 'legacy-cancel', expectedRevision: 1, reason: 'Different intent' }), 'CALENDAR_INTENT_CONFLICT');
  } finally { f.close(); }
});
test('all co-resources require management before transitions or policy projections; lesser rights reveal no lifecycle', () => {
  const f = fixture();
  try {
    f.resource(); f.resource('room', null); f.appointment('visit', { resourceIds: ['person', 'room'] }); f.policy({ extended: true });
    for (const grants of [['busy'], ['book'], ['details'], ['manage']]) {
      f.grant('person', grants);
      rejects(() => f.query('appointmentTransitions', { actor: reader, id: 'visit' }), 'CALENDAR_NOT_FOUND');
      rejects(() => f.transition('completed', { actor: reader }), 'CALENDAR_NOT_FOUND');
    }
    f.grant('room', ['manage']);
    expect(f.query('appointmentTransitions', { actor: reader, id: 'visit' })).toMatchObject({ status: 'confirmed', policyRevision: 2 });
    expect(f.transition('completed', { actor: reader, requestId: 'reader-finish' })).toMatchObject({ revision: 2, changed: true });
    f.grant('room', []);
    rejects(() => f.query('receipt', { actor: reader, requestId: 'reader-finish' }), 'CALENDAR_NOT_FOUND');
    rejects(() => f.query('appointmentTransitions', { actor: reader, id: 'missing' }), 'CALENDAR_NOT_FOUND');
  } finally { f.close(); }
});
test('tentative stays occupied, disabling extended permits confirmation but blocks new advanced state, and old replay precedes fresh policy checks', () => {
  const f = fixture();
  try {
    f.resource(); f.appointment();
    rejects(() => f.transition('tentative'), 'CALENDAR_TRANSITION_INVALID');
    f.policy({ extended: true }); const tentative = f.transition('tentative', { requestId: 'tentative' });
    expect(f.query('appointment', { actor: owner, id: 'visit' })).toMatchObject({ status: 'confirmed', lifecycle: { status: 'tentative', revision: 2, policyRevision: 2, reason: null } });
    expect(f.query('busy', { actor: owner, resourceIds: ['person'], ...range }).items).toHaveLength(1);
    rejects(() => f.appointment('collision'), 'CALENDAR_BOOKING_CONFLICT');
    f.policy(); const seq = f.db.currentSeq;
    expect(f.transition('tentative', { requestId: 'tentative', expectedRevision: 1, policyRevision: 2 })).toEqual(tentative); expect(f.db.currentSeq).toBe(seq);
    rejects(() => f.transition('completed', { policyRevision: 2 }), 'CALENDAR_POLICY_STALE');
    rejects(() => f.transition('completed'), 'CALENDAR_TRANSITION_INVALID');
    expect(f.query('appointmentTransitions', { actor: owner, id: 'visit' }).allowed.map((target: any) => target.status)).toEqual(['confirmed', 'cancelled']);
    f.transition('confirmed'); expect(f.query('appointment', { actor: owner, id: 'visit' }).lifecycle.status).toBe('confirmed');
  } finally { f.close(); }
});
test('completed and no-show retain occupancy, are terminal, and cannot be bypassed through legacy cancel or reschedule', () => {
  for (const status of ['completed', 'no-show'] as const) {
    const f = fixture();
    try {
      f.resource(); f.appointment(); f.policy({ extended: true });
      const accepted = f.transition(status, { requestId: 'finish' }); const seq = f.db.currentSeq;
      expect(f.transition(status, { requestId: 'finish', expectedRevision: 1 })).toEqual(accepted); expect(f.db.currentSeq).toBe(seq);
      expect(f.query('appointmentTransitions', { actor: owner, id: 'visit' }).allowed).toEqual([]);
      expect(f.query('appointments', { actor: owner, resourceIds: ['person'], ...range }).items[0].lifecycle.status).toBe(status);
      expect(f.db.list('_calendar_reservations')[0]!.active).toBe(1);
      rejects(() => f.transition('cancelled'), 'CALENDAR_TRANSITION_INVALID'); rejects(() => f.cancel(), 'CALENDAR_TRANSITION_INVALID');
      rejects(() => f.command('appointment.reschedule', { actor: owner, requestId: 'move', id: 'visit', expectedRevision: 2, ...interval }), 'CALENDAR_REVISION_CONFLICT');
      rejects(() => f.appointment('collision'), 'CALENDAR_BOOKING_CONFLICT');
      expect(() => f.raw.run("UPDATE calendar_appointments SET revision=revision+1,status='cancelled' WHERE id='visit'")).toThrow('lifecycle is terminal');
    } finally { f.close(); }
  }
});
test('required reasons are enforced by both cancellation entry points; normalized reasons stay private and only cancellation releases occupancy', () => {
  const f = fixture(true);
  try {
    f.resource(); f.resource('room', null); f.appointment('visit', { resourceIds: ['person', 'room'] }); f.policy({ extended: true, cancellationReason: 'required', noShowReason: 'required' }); f.drain();
    rejects(() => f.cancel({ actor: manager }), 'CALENDAR_REASON_REQUIRED'); rejects(() => f.transition('cancelled', { actor: manager }), 'CALENDAR_REASON_REQUIRED');
    rejects(() => f.transition('no-show', { actor: manager }), 'CALENDAR_REASON_REQUIRED');
    for (const reason of ['', '   ', 'x'.repeat(1025), ' '.repeat(1024) + 'x', 'x\nprivate', '\nprivate', null]) rejects(() => f.cancel({ actor: manager, reason }), 'CALENDAR_INPUT_INVALID');
    rejects(() => f.transition('tentative', { actor: manager, reason: 'PRIVATE_REASON' }), 'CALENDAR_INPUT_INVALID');
    const accepted = f.transition('cancelled', { actor: manager, requestId: 'reasoned', reason: '  PRIVATE_REASON  ' });
    expect(accepted.operation).toBe('appointment.transitioned'); expect(JSON.stringify(accepted)).not.toContain('PRIVATE_REASON');
    expect(f.query('appointment', { actor: manager, id: 'visit' }).lifecycle).toEqual({ status: 'cancelled', revision: 2, policyRevision: 2, reason: 'PRIVATE_REASON' });
    expect(f.db.list('_calendar_reservations').every(row => row.active === 0)).toBe(true);
    expect(f.query('busy', { actor: manager, resourceIds: ['person', 'room'], ...range }).items).toEqual([]);
    const events = f.source!.control({}).rows.map(row => row.event);
    expect(events).toHaveLength(1); expect(events[0]!.action).toBe('calendar.appointment.transitioned');
    expect(events[0]!.metadata).toMatchObject({ revision: 2, status: 'cancelled', policyRevision: 2, reasonPresent: true });
    expect(JSON.stringify(events)).not.toContain('PRIVATE_REASON'); expect(JSON.stringify(f.db.list('_calendar_effect_intents'))).not.toContain('PRIVATE_REASON');
    f.appointment('replacement', { resourceIds: ['person', 'room'] });
  } finally { f.close(); }
});
test('reasoned legacy cancel has its own v1 digest and updates lifecycle sidecars without leaking private text', () => {
  const f = fixture();
  try {
    f.resource(); f.appointment(); const accepted = f.cancel({ requestId: 'reason', reason: ' PRIVATE_REASON ' });
    expect(accepted.operation).toBe('appointment.cancelled');
    expect(f.db.list('_calendar_receipts').find(row => row.request_id === 'reason')!.digest).toBe(calendarHash(['appointment.cancel.reason.v1', 'visit', 1, 'PRIVATE_REASON']));
    expect(f.query('appointment', { actor: owner, id: 'visit' }).lifecycle).toMatchObject({ status: 'cancelled', reason: 'PRIVATE_REASON', policyRevision: 1 });
    const seq = f.db.currentSeq; expect(f.cancel({ requestId: 'reason', expectedRevision: 1, reason: 'PRIVATE_REASON' })).toEqual(accepted); expect(f.db.currentSeq).toBe(seq);
  } finally { f.close(); }
});
test('reschedule preserves the older lifecycle fact, and exact accepted reschedule replays after a terminal transition', () => {
  const f = fixture();
  try {
    f.resource(); f.appointment(); f.policy({ extended: true }); f.transition('tentative');
    const move = { actor: owner, requestId: 'move', id: 'visit', expectedRevision: 2, ...interval, startAt: '2030-01-01T12:00:00.000Z', endAt: '2030-01-01T13:00:00.000Z' };
    const moved = f.command('appointment.reschedule', move);
    expect(f.query('appointment', { actor: owner, id: 'visit' })).toMatchObject({ revision: 3, lifecycle: { revision: 2, status: 'tentative' } });
    f.transition('completed'); const seq = f.db.currentSeq; expect(f.command('appointment.reschedule', move)).toEqual(moved); expect(f.db.currentSeq).toBe(seq);
  } finally { f.close(); }
});
test('policy and lifecycle history budgets, late pointer failure and audit pressure roll back every source fact', () => {
  for (const key of ['policyHistory', 'appointmentLifecycleHistory', 'receipts'] as const) {
    const f = fixture();
    try {
      f.resource(); f.appointment(); if (key !== 'policyHistory') f.policy({ extended: true });
      if (f.db.get('_calendar_usage', key)) f.db.update('_calendar_usage', key, { count: CALENDAR_LIMITS[key] });
      else f.db.createStrict('_calendar_usage', { id: key, count: CALENDAR_LIMITS[key] });
      const before = f.snapshot(), seq = f.db.currentSeq;
      rejects(() => key === 'policyHistory' ? f.policy({ extended: true }) : f.transition('completed'), 'CALENDAR_CAPACITY');
      expect(f.snapshot()).toEqual(before); expect(f.db.currentSeq).toBe(seq);
    } finally { f.close(); }
  }
  const f = fixture(true, 1);
  try {
    f.resource(); f.drain(); f.appointment(); f.drain(); f.policy({ extended: true }); f.drain();
    f.raw.run("CREATE TRIGGER synthetic_lifecycle_late BEFORE INSERT ON _calendar_appointment_lifecycle_current BEGIN SELECT RAISE(ABORT,'synthetic late failure'); END");
    const before = f.snapshot(), seq = f.db.currentSeq;
    expect(() => f.transition('cancelled', { reason: 'PRIVATE' })).toThrow('synthetic late failure'); expect(f.snapshot()).toEqual(before); expect(f.db.currentSeq).toBe(seq);
    f.raw.run('DROP TRIGGER synthetic_lifecycle_late');
    f.policy({ extended: true, cancellationReason: 'required' });
    const pressureBefore = f.snapshot(), pressureSeq = f.db.currentSeq;
    expect(() => f.transition('completed')).toThrow(); expect(f.snapshot()).toEqual(pressureBefore); expect(f.db.currentSeq).toBe(pressureSeq);
    expect(() => f.policy()).toThrow(); expect(f.snapshot()).toEqual(pressureBefore); expect(f.db.currentSeq).toBe(pressureSeq);
  } finally { f.close(); }
});
test('SQL rejects lifecycle evidence mutation/replacement, wrong parents/scopes, rewinds and metadata added after any accepted appointment generation', () => {
  const f = fixture();
  try {
    f.resource(); f.appointment(); f.policy({ extended: true });
    const append = (overrides: Record<string, unknown> = {}) => f.db.createStrict('_calendar_appointment_lifecycle_history', { id: 'late', scope_id: owner.scopeId, appointment_id: 'visit', appointment_revision: 1, policy_revision: 2, status: 'tentative', reason: null, ...overrides });
    expect(() => append({ appointment_revision: 2 })).toThrow();
    f.transition('tentative');
    for (const table of ['_calendar_lifecycle_policy_history', '_calendar_appointment_lifecycle_history', '_calendar_lifecycle_receipts', '_calendar_lifecycle_effect_intents']) {
      expect(() => f.raw.run(`UPDATE ${table} SET id=id`)).toThrow(); expect(() => f.raw.run(`DELETE FROM ${table}`)).toThrow();
      const row = f.db.list(table)[0]!; expect(() => f.db.createStrict(table, row)).toThrow();
    }
    for (const table of ['_calendar_lifecycle_policy', '_calendar_appointment_lifecycle_current']) expect(() => f.raw.run(`DELETE FROM ${table}`)).toThrow();
    expect(() => append({ scope_id: 'tenant:other', appointment_revision: 2 })).toThrow();
    expect(() => append({ appointment_id: 'missing', appointment_revision: 2 })).toThrow();
    expect(() => append({ appointment_revision: 2 })).toThrow('generation is sealed');
    expect(() => f.db.update('_calendar_lifecycle_policy', 'policy', { policy_revision: 1 })).toThrow();
    expect(() => f.db.update('_calendar_appointment_lifecycle_current', 'visit', { appointment_id: 'missing' })).toThrow();
    f.appointment('untouched', { startAt: '2030-01-01T12:00:00.000Z', endAt: '2030-01-01T13:00:00.000Z' });
    f.command('appointment.reschedule', { actor: owner, requestId: 'move', id: 'untouched', expectedRevision: 1, ...interval, startAt: '2030-01-01T14:00:00.000Z', endAt: '2030-01-01T15:00:00.000Z' });
    expect(() => append({ appointment_id: 'untouched', appointment_revision: 2 })).toThrow('generation is sealed');
  } finally { f.close(); }
});
