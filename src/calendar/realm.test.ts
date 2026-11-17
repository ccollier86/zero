/** Synthetic in-memory native ReactiveDB + real realm transaction/query sessions; no disk fixtures or actors. */
import { Database } from 'bun:sqlite';
import { expect, test } from 'bun:test';
import { DatabaseError, deserializeDatabaseError, serializeDatabaseError } from '../databases/database-error';
import type { DatabaseSerializableValue } from '../databases/database-operations';
import { createDatabaseReadQuerySession, withDatabaseReadQuerySession } from '../databases/database-read-query-capability';
import { runDatabaseRealmCommand, runDatabaseRealmQuery } from '../databases/database-realm';
import { createReactiveDB } from '../sync/reactive-db';
import type { CalendarActor } from './contracts';
import { CalendarError, readCalendarRejection, type CalendarErrorCode } from './error';
import { calendarRealm } from './realm';
import { CALENDAR_LIMITS } from './realm-model';

const actor: CalendarActor = { scopeId: 'tenant:synthetic', userId: 'owner', principal: 'session.owner', manageAll: false, createOwn: true };
const manager: CalendarActor = { ...actor, userId: 'manager', principal: 'session.manager', manageAll: true };
const reader: CalendarActor = { ...actor, userId: 'reader', principal: 'session.reader', createOwn: false };
const startAt = '2026-11-16T10:00:00.000Z', endAt = '2026-11-16T11:00:00.000Z';
const range = { startAt: '2026-11-16T00:00:00.000Z', endAt: '2026-11-17T00:00:00.000Z' };
function fixture() {
  const db = createReactiveDB({ mode: 'memory' });
  try {
    db.getRawDatabase().run('PRAGMA temp_store=MEMORY');
    for (const [name, schema] of Object.entries(calendarRealm.tables)) db.defineTable(name, schema);
    for (const migration of calendarRealm.migrations) migration.up(db.getRawDatabase());
    const command = (name: string, input: unknown): any => runDatabaseRealmCommand(calendarRealm, db, 'calendar.' + name, input as DatabaseSerializableValue);
    const query = (name: string, input: unknown): any => {
      const copy = Database.deserialize(db.getRawDatabase().serialize(), { readonly: true, strict: true });
      try {
        copy.run('PRAGMA temp_store=MEMORY');
        return withDatabaseReadQuerySession(createDatabaseReadQuerySession(copy), context => runDatabaseRealmQuery(calendarRealm, context, 'calendar.' + name, input as DatabaseSerializableValue));
      } finally { copy.close(); }
    };
    command('owner.bind', { ownerId: 'synthetic-owner', scopeId: actor.scopeId });
    const resource = (id = 'person', ownerId: string | null = actor.userId) => command('resource.create', { actor: manager, requestId: 'resource-' + id, id, label: 'Synthetic ' + id, kind: ownerId ? 'person' : 'room', ownerId, timeZone: 'UTC' });
    const appointment = (id = 'private', overrides: Record<string, unknown> = {}) => command('appointment.create', { actor, requestId: 'create-' + id, id, resourceIds: ['person'], title: 'PRIVATE_TITLE_NEVER_IN_BUSY_OR_RECEIPT', startAt, endAt, timeZone: 'UTC', ...overrides });
    const grant = (id: string, grants: string[], user = reader) => command('resource.grant', { actor: manager, requestId: 'grant-' + id + '-' + db.currentSeq, id, userId: user.userId, grants, expectedRevision: db.get('calendar_resources', id)!.revision });
    const count = (table: string) => (db.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n;
    return { db, command, query, resource, appointment, grant, count, close: () => db.dispose() };
  } catch (error) { db.dispose(); throw error; }
}
function rejects(run: () => unknown, code: CalendarErrorCode): void {
  try { run(); throw new Error('Expected rejection'); }
  catch (error) { const rejection = error instanceof CalendarError ? error : readCalendarRejection(error); expect(rejection?.code).toBe(code); }
}

test('empty native realm is real empty state; owner binding is fixed and mismatched scopes fail closed', () => {
  const f = fixture();
  try {
    expect(f.query('resources', { actor }).items).toEqual([]);
    expect(f.query('busy', { actor, resourceIds: [], ...range })).toEqual({ items: [], truncated: false });
    expect(f.count('calendar_resources')).toBe(0); expect(f.count('calendar_appointments')).toBe(0);
    expect(f.command('owner.bind', { ownerId: 'synthetic-owner', scopeId: actor.scopeId }).value.bound).toBe(true);
    rejects(() => f.command('owner.bind', { ownerId: 'another', scopeId: actor.scopeId }), 'CALENDAR_STATE_INVALID');
    rejects(() => f.query('resources', { actor: { ...actor, scopeId: 'tenant:other' } }), 'CALENDAR_STATE_INVALID');
    rejects(() => f.command('resource.create', { actor: { ...manager, scopeId: 'application' }, requestId: 'bad', id: 'bad', label: 'bad', kind: 'room', ownerId: null, timeZone: 'UTC' }), 'CALENDAR_STATE_INVALID');
  } finally { f.close(); }
});

test('native query rejections survive the exact actor serialization contract without private data or a rollback claim', () => {
  const f = fixture();
  try {
    f.resource(); f.appointment();
    for (const [run, code] of [
      [() => f.query('appointment', { actor, id: 'missing' }), 'CALENDAR_NOT_FOUND'],
      [() => f.query('appointment', { actor: reader, id: 'private' }), 'CALENDAR_NOT_FOUND'],
      [() => f.query('resources', { actor, limit: 0 }), 'CALENDAR_INPUT_INVALID'],
      [() => f.query('resources', { actor: { ...actor, scopeId: 'tenant:other' } }), 'CALENDAR_STATE_INVALID'],
    ] as const) {
      let failure: unknown; try { run(); } catch (error) { failure = error; }
      expect(failure).toBeInstanceOf(DatabaseError);
      const envelope = serializeDatabaseError(failure), restored = deserializeDatabaseError(envelope);
      expect(readCalendarRejection(restored)).toMatchObject({ code, outcome: 'not-started' });
      expect(envelope.details).toEqual({ domainCode: expect.any(Number), calendarRead: true });
      expect(JSON.stringify(envelope)).not.toContain('PRIVATE_TITLE');
      expect(JSON.stringify(envelope)).not.toContain('tenant:other');
    }
    const fabricated = new DatabaseError('DATABASE_CONFLICT', 'Synthetic invalid discriminator.', {
      outcome: 'unknown', retryable: false, details: { domainCode: 3, calendarRead: true },
    });
    expect(readCalendarRejection(fabricated)).toBeNull();
    expect(readCalendarRejection(new DatabaseError('DATABASE_CONFLICT', 'Synthetic invalid outcome.', {
      outcome: 'not-committed', details: { domainCode: 3, calendarRead: true },
    }))).toBeNull();
  } finally { f.close(); }
});
test('capacity-one multi-resource collisions roll back receipt/usage and never partially reserve another resource', () => {
  const f = fixture();
  try {
    f.resource(); f.resource('room', null); f.appointment();
    const seq = f.db.currentSeq, receipts = f.count('_calendar_receipts'), usage = f.db.get('_calendar_usage', 'receipts')!.count;
    rejects(() => f.appointment('competing', { actor: manager, resourceIds: ['room', 'person'] }), 'CALENDAR_BOOKING_CONFLICT');
    expect(f.db.currentSeq).toBe(seq); expect(f.count('_calendar_receipts')).toBe(receipts); expect(f.db.get('_calendar_usage', 'receipts')!.count).toBe(usage);
    expect(f.db.get('calendar_appointments', 'competing')).toBeNull(); expect(f.count('_calendar_reservations')).toBe(1);
    f.appointment('room-only', { actor: manager, resourceIds: ['room'] });
    expect(f.count('calendar_appointments')).toBe(2);
  } finally { f.close(); }
});
test('a late native insert failure rolls back the whole appointment, first reservation, receipt and usage', () => {
  const f = fixture();
  try {
    f.resource(); f.resource('room', null);
    f.db.getRawDatabase().run("CREATE TRIGGER synthetic_failure BEFORE INSERT ON _calendar_reservations WHEN NEW.resource_id='room' BEGIN SELECT RAISE(ABORT,'synthetic failure'); END");
    const seq = f.db.currentSeq, intents = f.count('_calendar_effect_intents'), usage = f.db.get('_calendar_usage', 'receipts')!.count;
    expect(() => f.appointment('rollback', { actor: manager, resourceIds: ['person', 'room'] })).toThrow();
    expect(f.db.currentSeq).toBe(seq); expect(f.count('calendar_appointments')).toBe(0); expect(f.count('_calendar_reservations')).toBe(0);
    expect(f.count('_calendar_effect_intents')).toBe(intents); expect(f.db.get('_calendar_usage', 'appointments')).toBeNull(); expect(f.db.get('_calendar_usage', 'receipts')!.count).toBe(usage);
  } finally { f.close(); }
});
test('half-open adjacency works; both resources and before/after buffers participate in conflict decisions', () => {
  const f = fixture();
  try {
    f.resource(); f.resource('room', null);
    f.appointment('first', { actor: manager, resourceIds: ['person', 'room'], bufferAfterMinutes: 15 });
    rejects(() => f.appointment('buffer-collision', { startAt: endAt, endAt: '2026-11-16T12:00:00.000Z' }), 'CALENDAR_BOOKING_CONFLICT');
    rejects(() => f.appointment('before-collision', { actor: manager, resourceIds: ['room'], startAt: '2026-11-16T11:29:59.999Z', endAt: '2026-11-16T12:00:00.000Z', bufferBeforeMinutes: 15 }), 'CALENDAR_BOOKING_CONFLICT');
    f.appointment('adjacent', { startAt: '2026-11-16T11:30:00.000Z', endAt: '2026-11-16T12:00:00.000Z', bufferBeforeMinutes: 15 });
    f.appointment('plain-adjacent', { startAt: '2026-11-16T12:00:00.000Z', endAt: '2026-11-16T13:00:00.000Z' });
    expect(f.count('calendar_appointments')).toBe(3);
  } finally { f.close(); }
});
test('owner and per-user grants are independent; book does not imply detail or manage', () => {
  const f = fixture();
  try {
    f.resource(); f.resource('room', null);
    rejects(() => f.appointment('denied', { actor: reader }), 'CALENDAR_NOT_FOUND');
    f.grant('person', ['book']); f.appointment('delegated', { actor: reader });
    rejects(() => f.query('appointment', { actor: reader, id: 'delegated' }), 'CALENDAR_NOT_FOUND');
    rejects(() => f.query('appointment', { actor: reader, id: 'missing' }), 'CALENDAR_NOT_FOUND');
    rejects(() => f.command('appointment.cancel', { actor: reader, requestId: 'denied-cancel', id: 'delegated', expectedRevision: 1, confirmed: true }), 'CALENDAR_NOT_FOUND');
    rejects(() => f.command('appointment.cancel', { actor: reader, requestId: 'denied-cancel', id: 'missing', expectedRevision: 1, confirmed: true }), 'CALENDAR_NOT_FOUND');
    rejects(() => f.appointment('denied-room', { actor: reader, resourceIds: ['person', 'room'], startAt: '2026-11-16T12:00:00.000Z', endAt: '2026-11-16T13:00:00.000Z' }), 'CALENDAR_NOT_FOUND');
    rejects(() => f.command('resource.create', { actor, requestId: 'room-own', id: 'room-own', label: 'Room', kind: 'room', ownerId: actor.userId, timeZone: 'UTC' }), 'CALENDAR_FORBIDDEN');
    f.command('resource.create', { actor, requestId: 'person-own', id: 'person-own', label: 'Own', kind: 'person', ownerId: actor.userId, timeZone: 'UTC' });
  } finally { f.close(); }
});
test('busy is a genuinely redacted projection, explicit empty stays empty and queries create no changes', () => {
  const f = fixture();
  try {
    f.resource(); f.appointment(); f.grant('person', ['busy']); const seq = f.db.currentSeq;
    const busy = f.query('busy', { actor: reader, resourceIds: ['person'], ...range });
    expect(busy.items).toEqual([{ resourceId: 'person', startAt, endAt }]);
    expect(JSON.stringify(busy)).not.toContain('PRIVATE'); expect(JSON.stringify(busy)).not.toContain('createdBy');
    expect(Object.keys(busy.items[0]).sort()).toEqual(['endAt', 'resourceId', 'startAt']);
    expect(f.query('busy', { actor: reader, resourceIds: [], ...range }).items).toEqual([]);
    rejects(() => f.query('appointments', { actor: reader, resourceIds: ['person'], ...range }), 'CALENDAR_NOT_FOUND');
    expect(f.db.currentSeq).toBe(seq);
  } finally { f.close(); }
});
test('detail range excludes unauthorized ownerless co-resources before count/truncation', () => {
  const f = fixture();
  try {
    f.resource(); f.resource('room', null); f.appointment('secret-room', { actor: manager, resourceIds: ['person', 'room'] }); f.grant('person', ['details']);
    expect(f.query('appointments', { actor: reader, resourceIds: ['person'], ...range, limit: 1 })).toEqual({ items: [], truncated: false });
    rejects(() => f.query('appointment', { actor: reader, id: 'secret-room' }), 'CALENDAR_NOT_FOUND');
    f.grant('room', ['details']);
    expect(f.query('appointments', { actor: reader, resourceIds: ['person'], ...range }).items[0].resourceIds).toEqual(['person', 'room']);
  } finally { f.close(); }
});
test('receipt identities bind scope/principal and command hash; replay returns safe original outcome only', () => {
  const f = fixture();
  try {
    f.resource(); const first = f.appointment(), seq = f.db.currentSeq;
    expect(f.appointment()).toEqual(first); expect(f.db.currentSeq).toBe(seq);
    expect(Object.keys(first.value).sort()).toEqual(['changed', 'id', 'operation', 'requestId', 'revision']);
    expect(JSON.stringify(f.query('receipt', { actor, requestId: 'create-private' }))).not.toContain('PRIVATE_TITLE');
    rejects(() => f.appointment('private', { title: 'Different' }), 'CALENDAR_INTENT_CONFLICT');
    expect(f.query('receipt', { actor: { ...actor, principal: 'another-session' }, requestId: 'create-private' })).toBeNull();
    f.grant('person', ['book']); const delegate = f.appointment('delegate', { actor: reader, startAt: '2026-11-16T12:00:00.000Z', endAt: '2026-11-16T13:00:00.000Z' });
    expect(delegate.value.changed).toBe(true); f.grant('person', []);
    rejects(() => f.appointment('delegate', { actor: reader, startAt: '2026-11-16T12:00:00.000Z', endAt: '2026-11-16T13:00:00.000Z' }), 'CALENDAR_NOT_FOUND');
    rejects(() => f.query('receipt', { actor: reader, requestId: 'create-delegate' }), 'CALENDAR_NOT_FOUND');
  } finally { f.close(); }
});
test('reschedule revision, collision rollback, replay and no-op evidence are canonical', () => {
  const f = fixture();
  try {
    f.resource(); f.appointment(); f.appointment('later', { startAt: '2026-11-16T12:00:00.000Z', endAt: '2026-11-16T13:00:00.000Z' });
    const command = { actor, requestId: 'move', id: 'private', expectedRevision: 1, startAt: endAt, endAt: '2026-11-16T12:00:00.000Z', timeZone: 'UTC', bufferBeforeMinutes: 0, bufferAfterMinutes: 0 };
    rejects(() => f.command('appointment.reschedule', { ...command, expectedRevision: 2 }), 'CALENDAR_REVISION_CONFLICT');
    rejects(() => f.command('appointment.reschedule', { ...command, startAt: '2026-11-16T12:00:00.000Z', endAt: '2026-11-16T13:00:00.000Z' }), 'CALENDAR_BOOKING_CONFLICT');
    const moved = f.command('appointment.reschedule', command); expect(moved.value.revision).toBe(2);
    const seq = f.db.currentSeq; expect(f.command('appointment.reschedule', command)).toEqual(moved); expect(f.db.currentSeq).toBe(seq);
    const intents = f.count('_calendar_effect_intents');
    expect(f.command('appointment.reschedule', { ...command, requestId: 'move-noop', expectedRevision: 2 }).value).toMatchObject({ changed: false, revision: 2 });
    expect(f.count('_calendar_effect_intents')).toBe(intents); expect(f.db.get('calendar_appointments', 'private')!.revision).toBe(2);
  } finally { f.close(); }
});
test('declined cancellation writes nothing; accepted cancel releases all resources; another cancel is no-op', () => {
  const f = fixture();
  try {
    f.resource(); f.resource('room', null); f.appointment('both', { actor: manager, resourceIds: ['person', 'room'] });
    const cancel = { actor: manager, requestId: 'cancel-both', id: 'both', expectedRevision: 1, confirmed: true }, seq = f.db.currentSeq;
    rejects(() => f.command('appointment.cancel', { ...cancel, confirmed: false }), 'CALENDAR_INPUT_INVALID'); expect(f.db.currentSeq).toBe(seq);
    const accepted = f.command('appointment.cancel', cancel); expect(accepted.value.revision).toBe(2); expect(f.command('appointment.cancel', cancel)).toEqual(accepted);
    const intents = f.count('_calendar_effect_intents');
    expect(f.command('appointment.cancel', { ...cancel, requestId: 'already-cancelled', expectedRevision: 2 }).value.changed).toBe(false); expect(f.count('_calendar_effect_intents')).toBe(intents);
    f.appointment('replacement', { actor: manager, resourceIds: ['person', 'room'] });
    expect(f.query('busy', { actor: manager, resourceIds: ['person', 'room'], ...range }).items).toHaveLength(2);
  } finally { f.close(); }
});
test('query range/selection/page caps, safe truncation, no unknown-field widening and retained capacity reject', () => {
  const f = fixture();
  try {
    f.resource(); f.resource('room', null); f.appointment(); f.appointment('later', { startAt: '2026-11-16T12:00:00.000Z', endAt: '2026-11-16T13:00:00.000Z' });
    const input = { actor, resourceIds: ['person'], ...range };
    expect(f.query('busy', { ...input, limit: 1 })).toMatchObject({ truncated: true });
    expect(f.query('resources', { actor: manager, limit: 1 })).toMatchObject({ truncated: true, nextAfter: 'person' });
    for (const override of [{ limit: 101 }, { resourceIds: Array.from({ length: 17 }, (_, i) => 'id-' + i) }, { resourceIds: ['person', 'person'] }, { endAt: '2027-01-01T00:00:00.000Z' }, { all: true }]) rejects(() => f.query('busy', { ...input, ...override }), 'CALENDAR_INPUT_INVALID');
    rejects(() => f.appointment('empty', { resourceIds: [] }), 'CALENDAR_INPUT_INVALID');
    f.db.update('_calendar_usage', 'receipts', { count: CALENDAR_LIMITS.receipts }); const seq = f.db.currentSeq;
    rejects(() => f.appointment('capacity', { startAt: '2026-11-16T14:00:00.000Z', endAt: '2026-11-16T15:00:00.000Z' }), 'CALENDAR_CAPACITY'); expect(f.db.currentSeq).toBe(seq);
  } finally { f.close(); }
});
test('native retained receipt/intent evidence resists UPDATE, DELETE and INSERT OR REPLACE', () => {
  const f = fixture();
  try {
    f.resource(); f.appointment();
    for (const table of ['_calendar_owner', '_calendar_receipts', '_calendar_effect_intents']) {
      expect(() => f.db.getRawDatabase().run(`DELETE FROM ${table}`)).toThrow();
      expect(() => f.db.getRawDatabase().run(`UPDATE ${table} SET id=id`)).toThrow();
      expect(() => f.db.getRawDatabase().run(`INSERT OR REPLACE INTO ${table} SELECT * FROM ${table} LIMIT 1`)).toThrow();
    }
    const refs = f.db.query('_calendar_effect_intents'); expect(JSON.stringify(refs)).not.toContain('PRIVATE_TITLE');
  } finally { f.close(); }
});
