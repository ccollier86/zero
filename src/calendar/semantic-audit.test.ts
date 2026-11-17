/** Source-atomic evidence over synthetic in-memory SQLite only. No actor, runtime mount, filesystem or provider output. */
import { expect, test } from 'bun:test';
import { runDatabaseRealmCommand } from '../databases/database-realm';
import type { DatabaseSerializableValue } from '../databases/database-operations';
import { LoggingActorSource, normalizeLoggingActorSourceBinding } from '../logging/logging-actor-source';
import { loggingContext } from '../logging/test-support/logging-fixture';
import { createReactiveDB } from '../sync/reactive-db';
import { CALENDAR_TABLES } from './realm-schema';
import { calendarRealm } from './realm';

const actor = { scopeId: 'tenant:tenant-a', userId: 'fixture-user', principal: 'fixture-session', manageAll: true, createOwn: true };
const interval = { startAt: '2026-12-01T10:00:00.000Z', endAt: '2026-12-01T11:00:00.000Z', timeZone: 'UTC', bufferBeforeMinutes: 0, bufferAfterMinutes: 0 };
function fixture(logging: 'enabled' | 'disabled' | 'workflow-disabled' = 'enabled', maxEvents = 10000) {
  const db = createReactiveDB({ mode: 'memory' });
  let source: LoggingActorSource | null = null;
  try {
    for (const [table, schema] of Object.entries(CALENDAR_TABLES)) db.defineTable(table, schema);
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
