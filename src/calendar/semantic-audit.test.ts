/** Source-atomic evidence over synthetic in-memory SQLite only. No actor, runtime mount, filesystem or provider output. */
import { expect, test } from 'bun:test';
import { runDatabaseRealmCommand } from '../databases/database-realm';
import type { DatabaseSerializableValue } from '../databases/database-operations';
import { LoggingActorSource, normalizeLoggingActorSourceBinding } from '../logging/logging-actor-source';
import { loggingContext } from '../logging/test-support/logging-fixture';
import { createReactiveDB } from '../sync/reactive-db';
import { calendarRealm } from './realm';

const actor = { scopeId: 'tenant:tenant-a', userId: 'fixture-user', principal: 'fixture-session', manageAll: true, createOwn: true };
const interval = { startAt: '2026-12-01T10:00:00.000Z', endAt: '2026-12-01T11:00:00.000Z', timeZone: 'UTC', bufferBeforeMinutes: 0, bufferAfterMinutes: 0 };
function fixture(logging: 'enabled' | 'disabled' | 'workflow-disabled' = 'enabled', maxEvents = 10000) {
  const db = createReactiveDB({ mode: 'memory' });
  let source: LoggingActorSource | null = null;
  try {
    db.getRawDatabase().run('PRAGMA temp_store=MEMORY');
    for (const [table, schema] of Object.entries(calendarRealm.tables)) db.defineTable(table, schema);
    for (const migration of calendarRealm.migrations) migration.up(db.getRawDatabase());
    source = logging === 'disabled' ? null : new LoggingActorSource(db, normalizeLoggingActorSourceBinding({ records: false,
      workflow: logging !== 'workflow-disabled', policyVersion: 'calendar-semantic-policy', scope: { kind: 'tenant', tenantId: 'tenant-a' }, sourceQueue: { maxEvents } }));
    const command = (name: string, input: unknown) => {
      const run = () => runDatabaseRealmCommand(calendarRealm, db, 'calendar.' + name, input as DatabaseSerializableValue);
      return source ? source.run(loggingContext('tenant-a'), run) : run();
    };
    command('owner.bind', { ownerId: 'synthetic-owner', scopeId: actor.scopeId });
    const resource = (id = 'person') => command('resource.create', { actor, requestId: 'resource-' + id, id,
      label: 'NEVER_LOG_CALENDAR_LABEL', kind: 'person', ownerId: actor.userId, timeZone: 'UTC' });
    const appointment = (id = 'appointment') => command('appointment.create', { actor, requestId: 'create-' + id, id,
      title: 'NEVER_LOG_CALENDAR_TITLE', resourceIds: ['person'], ...interval });
    return { db, source, command, resource, appointment, close() { source?.close(); db.dispose(); } };
  } catch (error) { source?.close(); db.dispose(); throw error; }
}

test('calendar canonical transitions append once while receipt replay, owner binding and no-ops add no evidence', () => {
  const f = fixture();
  try {
    f.resource(); f.resource();
    const grant = { actor, requestId: 'grant-reader', id: 'person', userId: 'NEVER_LOG_CALENDAR_GRANTEE', expectedRevision: 1, grants: ['busy'] };
    f.command('resource.grant', grant); f.command('resource.grant', grant);
    f.command('resource.grant', { ...grant, requestId: 'grant-noop', expectedRevision: 2 });
    f.appointment(); f.appointment();
    const move = { actor, requestId: 'move', id: 'appointment', expectedRevision: 1,
      ...interval, startAt: '2026-12-01T11:00:00.000Z', endAt: '2026-12-01T12:00:00.000Z' };
    f.command('appointment.reschedule', move); f.command('appointment.reschedule', move);
    f.command('appointment.reschedule', { ...move, requestId: 'move-noop', expectedRevision: 2 });
    const cancel = { actor, requestId: 'cancel', id: 'appointment', expectedRevision: 2, confirmed: true };
    f.command('appointment.cancel', cancel); f.command('appointment.cancel', cancel);
    f.command('appointment.cancel', { ...cancel, requestId: 'cancel-noop', expectedRevision: 3 });
    const events = f.source!.control({}).rows.map(row => row.event);
    expect(events.map(event => event.action)).toEqual(['calendar.resource.created', 'calendar.resource.grant-changed',
      'calendar.appointment.created', 'calendar.appointment.rescheduled', 'calendar.appointment.cancelled']);
    expect(events.every(event => event.family === 'workflow' && event.evidence === 'server-confirmed' && event.outcome === 'succeeded'
      && event.scope.kind === 'tenant' && event.scope.tenantId === 'tenant-a' && event.actor.id === actor.userId)).toBe(true);
    expect(events.some(event => event.action.startsWith('record.'))).toBe(false);
    expect(new Set(events.map(event => event.id)).size).toBe(events.length);
    const serialized = JSON.stringify(events);
    expect(serialized).not.toContain('NEVER_LOG_CALENDAR');
    expect(serialized).not.toContain(interval.startAt); expect(serialized).not.toContain(interval.endAt);
    expect(events.every(event => Object.keys(event.metadata).every(key => ['sequence', 'revision', 'resourceCount', 'status'].includes(key)))).toBe(true);
  } finally { f.close(); }
});

test('calendar A-to-B-to-A grant transitions have unique committed source identities', () => {
  const f = fixture();
  try {
    f.resource();
    for (const [index, grants] of [['busy'], [], ['busy']].entries()) {
      f.command('resource.grant', { actor, requestId: 'grant-' + index, id: 'person', userId: 'synthetic-reader', expectedRevision: index + 1, grants });
    }
    const events = f.source!.control({}).rows.map(row => row.event);
    expect(events).toHaveLength(4); expect(new Set(events.map(event => event.id)).size).toBe(4);
    expect(events.slice(1).map(event => event.metadata.revision)).toEqual([2, 3, 4]);
  } finally { f.close(); }
});

test('location catalog and resource assignment facts are source-atomic, private and absent on replay or no-op', () => {
  const f = fixture();
  try {
    f.resource();
    const location = { actor, requestId: 'location', id: 'location', label: 'NEVER_LOG_CALENDAR_LOCATION', region: 'NEVER_LOG_CALENDAR_REGION' };
    f.command('location.create', location); f.command('location.create', location);
    const assignment = { actor, id: 'person', requestId: 'assignment', expectedRevision: 1, locationIds: ['location'] };
    f.command('resource.locations', assignment); f.command('resource.locations', assignment);
    f.command('resource.locations', { ...assignment, requestId: 'assignment-noop', expectedRevision: 2 });
    const update = { actor, id: 'location', requestId: 'location-update', expectedRevision: 1,
      label: 'NEVER_LOG_CALENDAR_RENAMED', region: null, active: false };
    f.command('location.replace', update); f.command('location.replace', update);
    f.command('location.replace', { ...update, requestId: 'location-noop', expectedRevision: 2 });
    const events = f.source!.control({}).rows.map(row => row.event);
    expect(events.map(event => event.action)).toEqual(['calendar.resource.created', 'calendar.location.created',
      'calendar.resource.locations-changed', 'calendar.location.updated']);
    expect(events[1]!.target).toEqual({ type: 'calendar.location', id: 'location' });
    expect(events[2]!.target).toEqual({ type: 'calendar.resource', id: 'person' });
    expect(events[2]!.metadata.locationCount).toBe(1); expect(events[3]!.metadata.active).toBe(false);
    expect(events.every(event => event.actor.id === actor.userId && event.evidence === 'server-confirmed' && event.outcome === 'succeeded')).toBe(true);
    expect(JSON.stringify(events)).not.toContain('NEVER_LOG_CALENDAR');
    expect(new Set(events.map(event => event.id)).size).toBe(4);
  } finally { f.close(); }
});

test('source audit pressure rolls back location revision history and resource assignment pointers', () => {
  const f = fixture('enabled', 1);
  const drain = () => { const page = f.source!.control({}); f.source!.control({ acknowledge: page.rows.map(row => row.id) }); };
  try {
    f.resource(); drain();
    f.command('location.create', { actor, requestId: 'location', id: 'location', label: 'Private location', region: null });
    expect(() => f.command('resource.locations', { actor, id: 'person', requestId: 'failed-assignment', expectedRevision: 1, locationIds: ['location'] }))
      .toThrow(expect.objectContaining({ code: 'DATABASE_BACKPRESSURE', outcome: 'not-committed' }));
    expect(f.db.get('calendar_resources', 'person')!.revision).toBe(1);
    expect(f.db.get('_calendar_resource_locations', 'person')).toBeNull();
    expect(f.db.list('_calendar_resource_location_history')).toHaveLength(0);
    expect(f.db.list('_calendar_resource_location_members')).toHaveLength(0);
    expect(() => f.command('location.replace', { actor, id: 'location', requestId: 'failed-update', expectedRevision: 1,
      label: 'Changed', region: 'US-IN', active: true }))
      .toThrow(expect.objectContaining({ code: 'DATABASE_BACKPRESSURE', outcome: 'not-committed' }));
    expect(f.db.get('calendar_locations', 'location')!.revision).toBe(1);
    expect(f.db.list('_calendar_location_history')).toHaveLength(1);
    expect(f.db.list('_calendar_location_receipts')).toHaveLength(1);
    expect(f.db.list('_calendar_location_effect_intents')).toHaveLength(1);
    expect(f.db.get('_calendar_usage', 'receipts')!.count).toBe(2);
    expect(f.db.get('_calendar_usage', 'resourceLocationHistory')).toBeNull();
    drain();
    f.command('resource.locations', { actor, id: 'person', requestId: 'failed-assignment', expectedRevision: 1, locationIds: ['location'] });
    expect(f.db.get('_calendar_resource_locations', 'person')!.resource_revision).toBe(2);
  } finally { f.close(); }
});

test('effective assignment policy audit is source-atomic, private and once-only across replay, no-op and explicit downgrade', () => {
  const f = fixture();
  try {
    f.resource();
    f.command('location.create', { actor, requestId: 'location', id: 'location', label: 'NEVER_LOG_CALENDAR_LOCATION' });
    const policy = { actor, id: 'person', requestId: 'effective-policy', expectedRevision: 1,
      kind: 'effective-utc-v1', assignments: [{ locationId: 'location', windows: [
        { startAt: '2027-01-01T00:00:00.000Z', endAt: '2028-01-01T00:00:00.000Z' },
      ] }] };
    f.command('resource.location-policy', policy); f.command('resource.location-policy', policy);
    f.command('resource.location-policy', { ...policy, requestId: 'effective-noop', expectedRevision: 2 });
    f.command('resource.location-policy', { actor, id: 'person', requestId: 'explicit-downgrade', expectedRevision: 2,
      kind: 'static-v1', locationIds: ['location'] });
    const events = f.source!.control({}).rows.map(row => row.event);
    const policies = events.filter(event => event.action === 'calendar.resource.location-policy-changed');
    expect(policies).toHaveLength(2);
    expect(policies.map(event => event.metadata.locationPolicyKind)).toEqual(['effective-utc-v1', 'static-v1']);
    expect(policies.map(event => event.metadata.revision)).toEqual([2, 3]);
    expect(policies.map(event => event.metadata.windowCount)).toEqual([1, 0]);
    expect(policies.every(event => event.actor.id === actor.userId && event.outcome === 'succeeded'
      && event.evidence === 'server-confirmed' && event.scope.kind === 'tenant' && event.scope.tenantId === 'tenant-a')).toBe(true);
    expect(policies.every(event => event.target?.type === 'calendar.resource' && event.target.id === 'person')).toBe(true);
    expect(policies.every(event => Object.keys(event.metadata).every(key =>
      ['sequence', 'revision', 'locationCount', 'windowCount', 'locationPolicyKind'].includes(key)))).toBe(true);
    expect(new Set(policies.map(event => event.id)).size).toBe(2);
    expect(JSON.stringify(policies)).not.toContain('NEVER_LOG_CALENDAR');
    expect(JSON.stringify(policies)).not.toContain('2027-01-01');
    expect(JSON.stringify(policies)).not.toContain('assignments');
    expect(() => f.command('resource.location-policy', { ...policy, requestId: 'rejected-policy', expectedRevision: 3,
      assignments: [{ locationId: 'guessed-location', windows: policy.assignments[0]!.windows }] })).toThrow();
    expect(f.source!.control({}).rows.map(row => row.event)).toEqual(events);
  } finally { f.close(); }
});

test('audit source pressure rolls back the complete effective policy and permits only the original not-committed command to be retried', () => {
  const f = fixture('enabled', 1);
  const drain = () => { const page = f.source!.control({}); f.source!.control({ acknowledge: page.rows.map(row => row.id) }); };
  try {
    f.resource(); drain();
    f.command('location.create', { actor, requestId: 'location', id: 'location', label: 'NEVER_LOG_CALENDAR_LOCATION' });
    const policy = { actor, id: 'person', requestId: 'pressured-policy', expectedRevision: 1,
      kind: 'effective-utc-v1', assignments: [{ locationId: 'location', windows: [
        { startAt: '2027-01-01T00:00:00.000Z', endAt: '2028-01-01T00:00:00.000Z' },
      ] }] };
    const before = f.db.getRawDatabase().serialize(), sequence = f.db.currentSeq;
    expect(() => f.command('resource.location-policy', policy)).toThrow(expect.objectContaining({ code: 'DATABASE_BACKPRESSURE', outcome: 'not-committed' }));
    expect(f.db.getRawDatabase().serialize()).toEqual(before); expect(f.db.currentSeq).toBe(sequence);
    expect(f.db.list('_calendar_resource_location_policy_history')).toEqual([]);
    expect(f.db.list('_calendar_resource_location_policy_windows')).toEqual([]);
    expect(f.db.get('_calendar_resource_location_policy_current', 'person')).toMatchObject({ source_kind: 'legacy', history_id: null, resource_revision: 1 });
    expect(f.db.list('_calendar_resource_location_history')).toEqual([]);
    drain(); f.command('resource.location-policy', policy);
    expect(f.db.get('calendar_resources', 'person')!.revision).toBe(2);
    expect(f.source!.control({}).rows.map(row => row.event.action)).toEqual(['calendar.resource.location-policy-changed']);
  } finally { f.close(); }
});

test('type catalog, resource policy and typed bookings emit private canonical facts without duplicating replay evidence', () => {
  const f = fixture();
  try {
    f.resource();
    const create = { actor, id: 'type', requestId: 'type', label: 'NEVER_LOG_CALENDAR_TYPE', durationMinutes: 30,
      bufferBeforeMinutes: 2, bufferAfterMinutes: 3, colorKey: 'NEVER_LOG_CALENDAR_COLOR' };
    f.command('type.create', create); f.command('type.create', create);
    f.command('resource.types', { actor, id: 'person', requestId: 'policy', expectedRevision: 1, mode: 'required', typeIds: ['type'] });
    const booking = { actor, id: 'typed', requestId: 'typed', resourceIds: ['person'], title: 'NEVER_LOG_CALENDAR_APPOINTMENT',
      startAt: interval.startAt, endAt: '2026-12-01T10:30:00.000Z', timeZone: 'UTC', appointmentType: { id: 'type', revision: 1 } };
    f.command('appointment.create', booking);
    const replacement = { ...create, requestId: 'type-replacement', expectedRevision: 1, label: 'NEVER_LOG_CALENDAR_RENAMED_TYPE', active: false };
    f.command('type.replace', replacement);
    f.command('appointment.create', booking);
    f.command('type.replace', { ...replacement, requestId: 'type-noop', expectedRevision: 2 });
    const events = f.source!.control({}).rows.map(row => row.event);
    expect(events.map(event => event.action)).toEqual(['calendar.resource.created', 'calendar.type.created',
      'calendar.resource.types-changed', 'calendar.appointment.created', 'calendar.type.updated']);
    expect(events[1]!.target).toEqual({ type: 'calendar.appointment-type', id: 'type' });
    expect(events[2]!.metadata).toMatchObject({ typeCount: 1, mode: 'required', revision: 2 });
    expect(events.every(event => event.actor.id === actor.userId && event.outcome === 'succeeded' && event.evidence === 'server-confirmed')).toBe(true);
    expect(JSON.stringify(events)).not.toContain('NEVER_LOG_CALENDAR');
    expect(JSON.stringify(events)).not.toContain(booking.startAt);
    expect(new Set(events.map(event => event.id)).size).toBe(5);
  } finally { f.close(); }
});

test('late audit pressure rolls back a typed booking together with its type history pointer and reservations', () => {
  const f = fixture('enabled', 2);
  try {
    f.resource(); f.command('type.create', { actor, id: 'type', requestId: 'type', label: 'Private type', durationMinutes: 60 });
    expect(() => f.command('appointment.create', { actor, id: 'typed', requestId: 'typed', resourceIds: ['person'], title: 'Private',
      ...interval, appointmentType: { id: 'type', revision: 1 } }))
      .toThrow(expect.objectContaining({ code: 'DATABASE_BACKPRESSURE', outcome: 'not-committed' }));
    expect(f.db.get('calendar_appointments', 'typed')).toBeNull(); expect(f.db.list('_calendar_reservations')).toEqual([]);
    expect(f.db.list('_calendar_appointment_type_bindings')).toEqual([]); expect(f.db.list('_calendar_appointment_type_current')).toEqual([]);
    expect(f.db.get('_calendar_usage', 'appointmentTypeHistory')).toBeNull(); expect(f.db.get('_calendar_usage', 'appointments')).toBeNull();
    expect(f.db.get('_calendar_usage', 'receipts')!.count).toBe(2); expect(f.source!.control({}).queued).toBe(2);
  } finally { f.close(); }
});

test('disabled logging and disabled workflow capture create no semantic calendar evidence', () => {
  for (const mode of ['disabled', 'workflow-disabled'] as const) {
    const f = fixture(mode);
    try {
      f.resource(); f.appointment();
      expect(f.db.get('calendar_appointments', 'appointment')).not.toBeNull();
      if (f.source) expect(f.source.control({}).queued).toBe(0);
      else expect(f.db.prepare("SELECT name FROM sqlite_master WHERE name='_zero_logging_outbox'").get()).toBeNull();
    } finally { f.close(); }
  }
});

test('audit queue pressure and explicit rollback atomically undo calendar data, reservations, receipts, intents and usage', () => {
  const f = fixture('enabled', 1);
  try {
    expect(() => f.db.transaction(() => { f.resource('rolled-back'); throw new Error('synthetic rollback'); })).toThrow('synthetic rollback');
    expect(f.db.get('calendar_resources', 'rolled-back')).toBeNull(); expect(f.source!.control({}).queued).toBe(0);
    f.resource();
    expect(() => f.appointment()).toThrow(expect.objectContaining({ code: 'DATABASE_BACKPRESSURE', outcome: 'not-committed' }));
    expect(f.db.get('calendar_appointments', 'appointment')).toBeNull(); expect(f.db.list('_calendar_reservations')).toHaveLength(0);
    expect(f.db.list('_calendar_receipts')).toHaveLength(1); expect(f.db.list('_calendar_effect_intents')).toHaveLength(1);
    expect(f.db.get('_calendar_usage', 'receipts')!.count).toBe(1); expect(f.db.get('_calendar_usage', 'appointments')).toBeNull();
    const page = f.source!.control({}); expect(page.queued).toBe(1);
    f.source!.control({ acknowledge: page.rows.map(row => row.id) });
    f.appointment();
    expect(f.db.list('_calendar_receipts')).toHaveLength(2); expect(f.db.list('_calendar_effect_intents')).toHaveLength(2);
    expect(f.source!.control({}).rows[0]!.event.action).toBe('calendar.appointment.created');
  } finally { f.close(); }
});
