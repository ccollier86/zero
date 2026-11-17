/** Real native tracked transactions and bounded read sessions, wholly synthetic in-memory SQLite; no files, actors or builds. */
import { Database } from 'bun:sqlite';
import { expect, test } from 'bun:test';
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

const actor: CalendarActor = { scopeId: 'tenant:synthetic', userId: 'owner', principal: 'session.owner', manageAll: false, createOwn: true };
const manager: CalendarActor = { ...actor, userId: 'manager', principal: 'session.manager', manageAll: true };
const delegate: CalendarActor = { ...actor, userId: 'delegate', principal: 'session.delegate', createOwn: false };
const startAt = '2026-11-16T10:00:00.000Z', endAt = '2026-11-16T11:00:00.000Z';
const timed = { startAt, endAt, timeZone: 'UTC' };
const range = { startAt: '2026-11-16T00:00:00.000Z', endAt: '2026-11-17T00:00:00.000Z' };

function fixture(logging = false, maxEvents = 10_000) {
  const db = createReactiveDB({ mode: 'memory' });
  let source: LoggingActorSource | null = null;
  try {
    db.getRawDatabase().run('PRAGMA temp_store=MEMORY');
    for (const [name, schema] of Object.entries(calendarRealm.tables)) db.defineTable(name, schema);
    for (const migration of calendarRealm.migrations) migration.up(db.getRawDatabase());
    if (logging) source = new LoggingActorSource(db, normalizeLoggingActorSourceBinding({ records: false, workflow: true,
      policyVersion: 'calendar-block-synthetic', scope: { kind: 'tenant', tenantId: 'synthetic' }, sourceQueue: { maxEvents } }));
    const command = (name: string, input: unknown): any => {
      const run = () => runDatabaseRealmCommand(calendarRealm, db, 'calendar.' + name, input as DatabaseSerializableValue);
      return source ? source.run(loggingContext('synthetic'), run) : run();
    };
    const query = (name: string, input: unknown): any => {
      const copy = Database.deserialize(db.getRawDatabase().serialize(), { readonly: true, strict: true });
      try {
        copy.run('PRAGMA temp_store=MEMORY');
        return withDatabaseReadQuerySession(createDatabaseReadQuerySession(copy), context => runDatabaseRealmQuery(calendarRealm, context, 'calendar.' + name, input as DatabaseSerializableValue));
      } finally { copy.close(); }
    };
    command('owner.bind', { ownerId: 'synthetic-owner', scopeId: actor.scopeId });
    const resource = (id = 'person', ownerId: string | null = actor.userId) => command('resource.create', { actor: manager, requestId: 'resource-' + id,
      id, label: 'PRIVATE_RESOURCE_LABEL', kind: ownerId === null ? 'room' : 'person', ownerId, timeZone: 'UTC' });
    const block = (id = 'private-block', overrides: Record<string, unknown> = {}) => command('block.create', { actor, requestId: 'create-' + id,
      id, resourceIds: ['person'], title: 'PRIVATE_BLOCK_TITLE', ...timed, ...overrides });
    const appointment = (id = 'private-appointment', overrides: Record<string, unknown> = {}) => command('appointment.create', { actor: manager, requestId: 'appointment-' + id,
      id, resourceIds: ['person'], title: 'PRIVATE_APPOINTMENT_TITLE', ...timed, ...overrides });
    const grant = (id: string, grants: string[], user = delegate) => command('resource.grant', { actor: manager, requestId: 'grant-' + id + '-' + db.currentSeq,
      id, userId: user.userId, grants, expectedRevision: db.get('calendar_resources', id)!.revision });
    const count = (table: string) => (db.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n;
    return { db, source, command, query, resource, block, appointment, grant, count, close() { source?.close(); db.dispose(); } };
  } catch (error) { source?.close(); db.dispose(); throw error; }
}
function rejects(run: () => unknown, code: CalendarErrorCode): void {
  try { run(); throw new Error('Expected rejection'); }
  catch (error) { expect((error instanceof CalendarError ? error : readCalendarRejection(error))?.code).toBe(code); }
}

test('one-off blocks are canonical private records and busy exposes only resource/time occupancy', () => {
  const f = fixture();
  try {
    expect(f.query('blocks', { actor, resourceIds: [], ...range })).toEqual({ items: [], truncated: false });
    f.resource(); f.block(); f.grant('person', ['busy']); const seq = f.db.currentSeq;
    expect(f.query('block', { actor, id: 'private-block' })).toEqual({ id: 'private-block', revision: 1, resourceIds: ['person'], title: 'PRIVATE_BLOCK_TITLE',
      ...timed, status: 'active', createdBy: actor.userId });
    expect(f.query('blocks', { actor, resourceIds: ['person'], ...range })).toEqual({ items: [f.query('block', { actor, id: 'private-block' })], truncated: false });
    const busy = f.query('busy', { actor: delegate, resourceIds: ['person'], ...range });
    expect(busy).toEqual({ items: [{ resourceId: 'person', startAt, endAt }], truncated: false });
    expect(Object.keys(busy.items[0]).sort()).toEqual(['endAt', 'resourceId', 'startAt']);
    expect(JSON.stringify(busy)).not.toContain('private-block'); expect(JSON.stringify(busy)).not.toContain('PRIVATE');
    rejects(() => f.query('block', { actor: delegate, id: 'private-block' }), 'CALENDAR_NOT_FOUND');
    rejects(() => f.query('block', { actor: delegate, id: 'missing' }), 'CALENDAR_NOT_FOUND');
    rejects(() => f.query('blocks', { actor: delegate, resourceIds: ['person'], ...range }), 'CALENDAR_NOT_FOUND');
    expect(f.db.currentSeq).toBe(seq);
  } finally { f.close(); }
});

test('block writes require current manage on every selected resource, not book or details', () => {
  const f = fixture();
  try {
    f.resource(); f.resource('room', null);
    for (const grants of [[], ['busy'], ['details'], ['book']]) {
      f.grant('person', grants);
      rejects(() => f.block('denied', { actor: delegate }), 'CALENDAR_NOT_FOUND');
    }
    f.grant('person', ['manage']);
    rejects(() => f.block('denied-co-resource', { actor: delegate, resourceIds: ['person', 'room'] }), 'CALENDAR_NOT_FOUND');
    f.grant('room', ['manage']);
    f.block('delegated', { actor: delegate, resourceIds: ['room', 'person'] });
    expect(f.query('block', { actor: delegate, id: 'delegated' }).resourceIds).toEqual(['person', 'room']);
    f.grant('room', ['details']);
    rejects(() => f.command('block.reschedule', { actor: delegate, requestId: 'denied-move', id: 'delegated', expectedRevision: 1, ...timed }), 'CALENDAR_NOT_FOUND');
    rejects(() => f.command('block.cancel', { actor: delegate, requestId: 'denied-cancel', id: 'delegated', expectedRevision: 1, confirmed: true }), 'CALENDAR_NOT_FOUND');
    expect(f.db.get('calendar_blocks', 'delegated')!.status).toBe('active');
  } finally { f.close(); }
});

test('block details authorize unselected co-resources before membership and truncation', () => {
  const f = fixture();
  try {
    f.resource(); f.resource('room', null);
    f.block('hidden', { actor: manager, resourceIds: ['person', 'room'] });
    f.block('visible', { startAt: '2026-11-16T12:00:00.000Z', endAt: '2026-11-16T13:00:00.000Z' });
    f.grant('person', ['details']);
    expect(f.query('blocks', { actor: delegate, resourceIds: ['person'], ...range, limit: 1 })).toMatchObject({ items: [{ id: 'visible' }], truncated: false });
    rejects(() => f.query('block', { actor: delegate, id: 'hidden' }), 'CALENDAR_NOT_FOUND');
    f.grant('room', ['details']);
    expect(f.query('blocks', { actor: delegate, resourceIds: ['person'], ...range, limit: 1 })).toMatchObject({ items: [{ id: 'hidden' }], truncated: true });
    expect(f.query('blocks', { actor: delegate, resourceIds: [], ...range })).toEqual({ items: [], truncated: false });
    rejects(() => f.query('block', { actor: { ...manager, scopeId: 'tenant:other' }, id: 'hidden' }), 'CALENDAR_STATE_INVALID');
  } finally { f.close(); }
});

test('blocks and appointments share one all-resource conflict domain with buffered half-open occupancy', () => {
  const f = fixture();
  try {
    f.resource(); f.resource('room', null); f.appointment('existing', { bufferAfterMinutes: 15 });
    const seq = f.db.currentSeq, receipts = f.count('_calendar_block_receipts');
    rejects(() => f.block('conflict', { actor: manager, resourceIds: ['room', 'person'] }), 'CALENDAR_BOOKING_CONFLICT');
    rejects(() => f.block('buffer-conflict', { startAt: endAt, endAt: '2026-11-16T12:00:00.000Z' }), 'CALENDAR_BOOKING_CONFLICT');
    expect(f.db.currentSeq).toBe(seq); expect(f.count('_calendar_block_receipts')).toBe(receipts); expect(f.count('_calendar_block_reservations')).toBe(0);
    expect(f.db.get('calendar_appointments', 'existing')!.status).toBe('confirmed');
    f.block('adjacent', { startAt: '2026-11-16T11:15:00.000Z', endAt: '2026-11-16T12:00:00.000Z' });
    rejects(() => f.appointment('blocked', { startAt: '2026-11-16T11:30:00.000Z', endAt: '2026-11-16T12:00:00.000Z' }), 'CALENDAR_BOOKING_CONFLICT');
    f.appointment('after-block', { startAt: '2026-11-16T12:00:00.000Z', endAt: '2026-11-16T13:00:00.000Z' });
    rejects(() => f.block('block-block', { startAt: '2026-11-16T11:30:00.000Z', endAt: '2026-11-16T11:45:00.000Z' }), 'CALENDAR_BOOKING_CONFLICT');
    f.block('room-only', { actor: manager, resourceIds: ['room'] });
  } finally { f.close(); }
});

test('block reschedule rejects appointment and block collisions, excludes only its own target kind, and retains revisions', () => {
  const f = fixture();
  try {
    f.resource(); f.block('same-id');
    f.appointment('same-id', { startAt: '2026-11-16T12:00:00.000Z', endAt: '2026-11-16T13:00:00.000Z' });
    f.block('later', { startAt: '2026-11-16T14:00:00.000Z', endAt: '2026-11-16T15:00:00.000Z' });
    const move = { actor, requestId: 'move', id: 'same-id', expectedRevision: 1, ...timed, startAt: endAt, endAt: '2026-11-16T12:00:00.000Z' };
    const seq = f.db.currentSeq;
    rejects(() => f.command('block.reschedule', { ...move, expectedRevision: 2 }), 'CALENDAR_REVISION_CONFLICT');
    rejects(() => f.command('block.reschedule', { ...move, startAt: '2026-11-16T12:00:00.000Z', endAt: '2026-11-16T13:00:00.000Z' }), 'CALENDAR_BOOKING_CONFLICT');
    rejects(() => f.command('block.reschedule', { ...move, startAt: '2026-11-16T14:00:00.000Z', endAt: '2026-11-16T15:00:00.000Z' }), 'CALENDAR_BOOKING_CONFLICT');
    expect(f.db.currentSeq).toBe(seq);
    const moved = f.command('block.reschedule', move), movedSeq = f.db.currentSeq, intents = f.count('_calendar_block_effect_intents');
    expect(moved.value).toMatchObject({ operation: 'block.rescheduled', revision: 2, changed: true });
    expect(f.command('block.reschedule', move)).toEqual(moved); expect(f.db.currentSeq).toBe(movedSeq);
    expect(f.command('block.reschedule', { ...move, requestId: 'move-noop', expectedRevision: 2 }).value).toMatchObject({ revision: 2, changed: false });
    expect(f.count('_calendar_block_effect_intents')).toBe(intents);
    rejects(() => f.command('appointment.reschedule', { actor: manager, requestId: 'appointment-move', id: 'same-id', expectedRevision: 1,
      ...timed, startAt: endAt, endAt: '2026-11-16T12:00:00.000Z', bufferBeforeMinutes: 0, bufferAfterMinutes: 0 }), 'CALENDAR_BOOKING_CONFLICT');
  } finally { f.close(); }
});

test('confirmed block cancellation releases every reservation without deleting history or cancelling appointments', () => {
  const f = fixture();
  try {
    f.resource(); f.resource('room', null); f.block('both', { actor: manager, resourceIds: ['person', 'room'] });
    const cancel = { actor: manager, requestId: 'cancel', id: 'both', expectedRevision: 1, confirmed: true }, seq = f.db.currentSeq;
    rejects(() => f.command('block.cancel', { ...cancel, confirmed: false }), 'CALENDAR_INPUT_INVALID'); expect(f.db.currentSeq).toBe(seq);
    const accepted = f.command('block.cancel', cancel), acceptedSeq = f.db.currentSeq;
    expect(accepted.value).toMatchObject({ operation: 'block.cancelled', revision: 2, changed: true });
    expect(f.command('block.cancel', cancel)).toEqual(accepted); expect(f.db.currentSeq).toBe(acceptedSeq);
    const intents = f.count('_calendar_block_effect_intents');
    expect(f.command('block.cancel', { ...cancel, requestId: 'cancel-noop', expectedRevision: 2 }).value).toMatchObject({ revision: 2, changed: false });
    expect(f.count('_calendar_block_effect_intents')).toBe(intents);
    expect(f.db.query('_calendar_block_reservations').map(row => row.active)).toEqual([0, 0]);
    expect(f.query('block', { actor: manager, id: 'both' }).status).toBe('cancelled');
    expect(f.query('blocks', { actor: manager, resourceIds: ['person', 'room'], ...range })).toEqual({ items: [], truncated: false });
    expect(f.query('busy', { actor: manager, resourceIds: ['person', 'room'], ...range })).toEqual({ items: [], truncated: false });
    rejects(() => f.command('block.reschedule', { actor: manager, requestId: 'revive', id: 'both', expectedRevision: 2, ...timed }), 'CALENDAR_REVISION_CONFLICT');
    f.appointment('replacement', { resourceIds: ['person', 'room'] });
    expect(f.db.get('calendar_appointments', 'replacement')!.status).toBe('confirmed'); expect(f.count('calendar_blocks')).toBe(1);
  } finally { f.close(); }
});

test('block receipts are immutable scope/principal/intent-bound outcomes and replay rechecks current co-resource manage', () => {
  const f = fixture();
  try {
    f.resource(); f.resource('room', null); f.grant('person', ['manage']); f.grant('room', ['manage']);
    const args = { actor: delegate, resourceIds: ['person', 'room'] }, accepted = f.block('delegated', args), seq = f.db.currentSeq;
    expect(f.block('delegated', { ...args, resourceIds: ['room', 'person'] })).toEqual(accepted); expect(f.db.currentSeq).toBe(seq);
    expect(f.query('receipt', { actor: delegate, requestId: 'create-delegated' })).toEqual(accepted.value);
    expect(Object.keys(accepted.value).sort()).toEqual(['changed', 'id', 'operation', 'requestId', 'revision']);
    expect(JSON.stringify(accepted.value)).not.toContain('PRIVATE'); expect(JSON.stringify(accepted.value)).not.toContain(startAt);
    expect(f.query('receipt', { actor: { ...delegate, principal: 'session.other' }, requestId: 'create-delegated' })).toBeNull();
    rejects(() => f.block('delegated', { ...args, title: 'Changed intent' }), 'CALENDAR_INTENT_CONFLICT');
    f.grant('room', ['details']);
    rejects(() => f.block('delegated', args), 'CALENDAR_NOT_FOUND');
    rejects(() => f.query('receipt', { actor: delegate, requestId: 'create-delegated' }), 'CALENDAR_NOT_FOUND');
    expect(f.query('block', { actor: delegate, id: 'delegated' }).title).toBe('PRIVATE_BLOCK_TITLE');
    rejects(() => f.block('other-scope', { actor: { ...manager, scopeId: 'tenant:other' } }), 'CALENDAR_STATE_INVALID');
    for (const table of ['_calendar_block_receipts', '_calendar_block_effect_intents']) {
      expect(() => f.db.getRawDatabase().run(`DELETE FROM ${table}`)).toThrow();
      expect(() => f.db.getRawDatabase().run(`UPDATE ${table} SET id=id`)).toThrow();
      expect(() => f.db.getRawDatabase().run(`INSERT OR REPLACE INTO ${table} SELECT * FROM ${table} LIMIT 1`)).toThrow();
    }
  } finally { f.close(); }
});

test('a late block-reservation failure rolls back the source, every reservation, usage, receipt, intent and audit', () => {
  const f = fixture(true);
  try {
    f.resource(); f.resource('room', null);
    f.db.getRawDatabase().run("CREATE TRIGGER synthetic_block_failure BEFORE INSERT ON _calendar_block_reservations WHEN NEW.resource_id='room' BEGIN SELECT RAISE(ABORT,'synthetic failure'); END");
    const seq = f.db.currentSeq, events = f.source!.control({}).rows.length, receipts = f.count('_calendar_block_receipts'), intents = f.count('_calendar_block_effect_intents'), usage = f.db.get('_calendar_usage', 'receipts')!.count;
    expect(() => f.block('rollback', { actor: manager, resourceIds: ['person', 'room'] })).toThrow();
    expect(f.db.currentSeq).toBe(seq); expect(f.count('calendar_blocks')).toBe(0); expect(f.count('_calendar_block_reservations')).toBe(0);
    expect(f.count('_calendar_block_receipts')).toBe(receipts); expect(f.count('_calendar_block_effect_intents')).toBe(intents);
    expect(f.db.get('_calendar_usage', 'blocks')).toBeNull(); expect(f.db.get('_calendar_usage', 'receipts')!.count).toBe(usage);
    expect(f.source!.control({}).rows).toHaveLength(events);
  } finally { f.close(); }
});

test('block source audit records accepted transitions once with only opaque target and bounded facts', () => {
  const f = fixture(true);
  try {
    f.resource(); f.block(); f.block();
    const move = { actor, requestId: 'move', id: 'private-block', expectedRevision: 1, ...timed, startAt: endAt, endAt: '2026-11-16T12:00:00.000Z' };
    f.command('block.reschedule', move); f.command('block.reschedule', move);
    f.command('block.reschedule', { ...move, requestId: 'move-noop', expectedRevision: 2 });
    const cancel = { actor, requestId: 'cancel', id: 'private-block', expectedRevision: 2, confirmed: true };
    f.command('block.cancel', cancel); f.command('block.cancel', cancel);
    f.command('block.cancel', { ...cancel, requestId: 'cancel-noop', expectedRevision: 3 });
    const events = f.source!.control({}).rows.map(row => row.event).filter(event => event.action.startsWith('calendar.block.'));
    expect(events.map(event => event.action)).toEqual(['calendar.block.created', 'calendar.block.rescheduled', 'calendar.block.cancelled']);
    expect(events.map(event => event.metadata.revision)).toEqual([1, 2, 3]); expect(new Set(events.map(event => event.id)).size).toBe(3);
    expect(events.every(event => event.family === 'workflow' && event.target?.type === 'calendar.block' && event.outcome === 'succeeded')).toBe(true);
    expect(events.every(event => Object.keys(event.metadata).every(key => ['sequence', 'revision', 'resourceCount', 'status'].includes(key)))).toBe(true);
    const serialized = JSON.stringify(events); expect(serialized).not.toContain('PRIVATE'); expect(serialized).not.toContain(startAt); expect(serialized).not.toContain(endAt);
  } finally { f.close(); }
});

test('source audit pressure rejects a block atomically while disabled logging needs no queue', () => {
  const f = fixture(true, 1);
  let disabled: ReturnType<typeof fixture> | null = null;
  try {
    disabled = fixture();
    f.resource(); const seq = f.db.currentSeq, receipts = f.count('_calendar_block_receipts');
    expect(() => f.block()).toThrow(); expect(f.db.currentSeq).toBe(seq); expect(f.count('calendar_blocks')).toBe(0);
    expect(f.count('_calendar_block_reservations')).toBe(0); expect(f.count('_calendar_block_receipts')).toBe(receipts); expect(f.db.get('_calendar_usage', 'blocks')).toBeNull();
    disabled.resource(); expect(disabled.block().value.changed).toBe(true); expect(disabled.source).toBeNull();
  } finally { disabled?.close(); f.close(); }
});

test('block admission rejects buffers, mutable resource sets, local/offset times, excess duration, range/selection/page widening and capacity', () => {
  const f = fixture();
  try {
    f.resource();
    for (const override of [{ bufferBeforeMinutes: 0 }, { bufferAfterMinutes: 0 }, { resourceIds: [] }, { resourceIds: ['person', 'person'] },
      { resourceIds: Array.from({ length: 17 }, (_, i) => 'r-' + i) }, { startAt: '2026-11-16T10:00' }, { startAt: '2026-11-16T10:00:00.000+00:00' },
      { endAt: startAt }, { endAt: '2026-12-18T10:00:00.001Z' }, { timeZone: '+00:00' }, { actor: { ...actor, caller: 'client' } }]) {
      rejects(() => f.block('invalid', override), 'CALENDAR_INPUT_INVALID');
    }
    f.block();
    rejects(() => f.command('block.reschedule', { actor, requestId: 'mutable-resources', id: 'private-block', expectedRevision: 1, ...timed, resourceIds: ['person'] }), 'CALENDAR_INPUT_INVALID');
    for (const override of [{ limit: 101 }, { resourceIds: ['person', 'person'] }, { endAt: '2027-01-01T00:00:00.000Z' }, { all: true }]) {
      rejects(() => f.query('blocks', { actor, resourceIds: ['person'], ...range, ...override }), 'CALENDAR_INPUT_INVALID');
    }
    f.db.update('_calendar_usage', 'blocks', { count: CALENDAR_LIMITS.blocks }); const seq = f.db.currentSeq;
    rejects(() => f.block('capacity', { startAt: endAt, endAt: '2026-11-16T12:00:00.000Z' }), 'CALENDAR_CAPACITY'); expect(f.db.currentSeq).toBe(seq);
  } finally { f.close(); }
});

test('maximum-duration blocks crossing the indexed lower bound remain visible and conflicting at the last millisecond', () => {
  const f = fixture();
  try {
    f.resource();
    f.block('long', { startAt: '2026-10-17T11:00:00.000Z', endAt: '2026-11-17T11:00:00.000Z' });
    expect(f.query('blocks', { actor, resourceIds: ['person'], startAt: '2026-11-17T10:59:59.999Z', endAt: '2026-11-17T11:00:00.000Z' }).items.map((row: { id: string }) => row.id)).toEqual(['long']);
    rejects(() => f.appointment('last-ms', { startAt: '2026-11-17T10:59:59.999Z', endAt: '2026-11-17T11:00:00.000Z' }), 'CALENDAR_BOOKING_CONFLICT');
    f.appointment('adjacent', { startAt: '2026-11-17T11:00:00.000Z', endAt: '2026-11-17T12:00:00.000Z' });
  } finally { f.close(); }
});

test('one request namespace rejects appointment-to-block and block-to-appointment reuse without consuming new evidence', () => {
  const f = fixture();
  try {
    f.resource(); f.block('first-block', { actor: manager, requestId: 'shared-block-first' });
    let seq = f.db.currentSeq, receipts = f.db.get('_calendar_usage', 'receipts')!.count;
    rejects(() => f.appointment('denied-appointment', { requestId: 'shared-block-first', startAt: '2026-11-16T12:00:00.000Z', endAt: '2026-11-16T13:00:00.000Z' }), 'CALENDAR_INTENT_CONFLICT');
    expect(f.db.currentSeq).toBe(seq); expect(f.db.get('_calendar_usage', 'receipts')!.count).toBe(receipts);
    expect(f.db.get('calendar_appointments', 'denied-appointment')).toBeNull();
    expect(f.query('receipt', { actor: manager, requestId: 'shared-block-first' }).operation).toBe('block.created');
    f.appointment('first-appointment', { requestId: 'shared-appointment-first', startAt: '2026-11-16T12:00:00.000Z', endAt: '2026-11-16T13:00:00.000Z' });
    seq = f.db.currentSeq; receipts = f.db.get('_calendar_usage', 'receipts')!.count;
    rejects(() => f.block('denied-block', { actor: manager, requestId: 'shared-appointment-first', startAt: '2026-11-16T14:00:00.000Z', endAt: '2026-11-16T15:00:00.000Z' }), 'CALENDAR_INTENT_CONFLICT');
    expect(f.db.currentSeq).toBe(seq); expect(f.db.get('_calendar_usage', 'receipts')!.count).toBe(receipts);
    expect(f.db.get('calendar_blocks', 'denied-block')).toBeNull();
    expect(f.query('receipt', { actor: manager, requestId: 'shared-appointment-first' }).operation).toBe('appointment.created');
  } finally { f.close(); }
});

test('mixed busy projections apply a single global time/resource order and limit without exposing target identity', () => {
  const f = fixture();
  try {
    f.resource(); f.resource('room', null);
    // Deliberately insert out of order and interleave both reservation stores.
    f.appointment('late', { startAt: '2026-11-16T12:00:00.000Z', endAt: '2026-11-16T13:00:00.000Z' });
    f.block('early', { actor: manager, resourceIds: ['room'], startAt: '2026-11-16T09:00:00.000Z', endAt: startAt });
    f.block('tie-block', { actor: manager, resourceIds: ['room'] }); f.appointment('tie-appointment');
    f.grant('person', ['busy']); f.grant('room', ['busy']); const seq = f.db.currentSeq;
    const expected = [
      { resourceId: 'room', startAt: '2026-11-16T09:00:00.000Z', endAt: startAt },
      { resourceId: 'person', startAt, endAt }, { resourceId: 'room', startAt, endAt },
      { resourceId: 'person', startAt: '2026-11-16T12:00:00.000Z', endAt: '2026-11-16T13:00:00.000Z' },
    ];
    for (const limit of [1, 2, 3, 4, 5]) {
      const busy = f.query('busy', { actor: delegate, resourceIds: ['room', 'person'], ...range, limit });
      expect(busy).toEqual({ items: expected.slice(0, limit), truncated: limit < expected.length });
      expect(busy.items.every((row: Record<string, unknown>) => Object.keys(row).sort().join(',') === 'endAt,resourceId,startAt')).toBe(true);
      expect(JSON.stringify(busy)).not.toContain('PRIVATE'); expect(JSON.stringify(busy)).not.toContain('tie-');
    }
    expect(f.db.currentSeq).toBe(seq);
  } finally { f.close(); }
});

test('late reservation update failures roll back both block reschedule and cancellation without partial release or false audit', () => {
  const f = fixture(true);
  try {
    f.resource(); f.resource('room', null); f.block('both', { actor: manager, resourceIds: ['person', 'room'] });
    f.db.getRawDatabase().run("CREATE TRIGGER synthetic_block_update_failure BEFORE UPDATE ON _calendar_block_reservations WHEN NEW.resource_id='room' BEGIN SELECT RAISE(ABORT,'synthetic failure'); END");
    const prior = f.query('block', { actor: manager, id: 'both' }), reservations = f.db.query('_calendar_block_reservations');
    const seq = f.db.currentSeq, events = f.source!.control({}).rows.length, receipts = f.count('_calendar_block_receipts'), usage = f.db.get('_calendar_usage', 'receipts')!.count;
    expect(() => f.command('block.reschedule', { actor: manager, requestId: 'failed-move', id: 'both', expectedRevision: 1,
      ...timed, startAt: endAt, endAt: '2026-11-16T12:00:00.000Z' })).toThrow();
    expect(() => f.command('block.cancel', { actor: manager, requestId: 'failed-cancel', id: 'both', expectedRevision: 1, confirmed: true })).toThrow();
    expect(f.query('block', { actor: manager, id: 'both' })).toEqual(prior); expect(f.db.query('_calendar_block_reservations')).toEqual(reservations);
    expect(f.db.currentSeq).toBe(seq); expect(f.count('_calendar_block_receipts')).toBe(receipts); expect(f.db.get('_calendar_usage', 'receipts')!.count).toBe(usage);
    expect(f.source!.control({}).rows).toHaveLength(events);
  } finally { f.close(); }
});

test('inactive resources reject new blocks and changed intervals while still allowing cancellation to release retained occupancy', () => {
  const f = fixture();
  try {
    f.resource(); f.block(); f.db.update('calendar_resources', 'person', { active: 0, revision: 2 });
    const seq = f.db.currentSeq;
    rejects(() => f.block('inactive', { startAt: endAt, endAt: '2026-11-16T12:00:00.000Z' }), 'CALENDAR_FORBIDDEN');
    rejects(() => f.command('block.reschedule', { actor, requestId: 'inactive-move', id: 'private-block', expectedRevision: 1,
      ...timed, startAt: endAt, endAt: '2026-11-16T12:00:00.000Z' }), 'CALENDAR_FORBIDDEN');
    expect(f.db.currentSeq).toBe(seq);
    expect(f.command('block.cancel', { actor, requestId: 'release-inactive', id: 'private-block', expectedRevision: 1, confirmed: true }).value.changed).toBe(true);
    expect(f.query('busy', { actor, resourceIds: ['person'], ...range })).toEqual({ items: [], truncated: false });
  } finally { f.close(); }
});
