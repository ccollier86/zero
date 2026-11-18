/** Native memory-only policy storage/booking proofs. No actor, file, build or disposable disk state. */
import { Database } from 'bun:sqlite';
import { expect, test } from 'bun:test';
import type { DatabaseSerializableValue } from '../databases/database-operations';
import { createDatabaseReadQuerySession, withDatabaseReadQuerySession } from '../databases/database-read-query-capability';
import { runDatabaseRealmCommand, runDatabaseRealmQuery } from '../databases/database-realm';
import { LoggingActorSource, normalizeLoggingActorSourceBinding } from '../logging/logging-actor-source';
import { loggingContext } from '../logging/test-support/logging-fixture';
import { createReactiveDB } from '../sync/reactive-db';
import type { CalendarActor } from './contracts';
import { readCalendarRejection, type CalendarErrorCode } from './error';
import { calendarRealm } from './realm';
import { CALENDAR_LIMITS } from './realm-model';
import { CALENDAR_AVAILABILITY_POLICY_ADDITIONS, CALENDAR_AVAILABILITY_POLICY_TABLES } from './realm-working-hours-migration';

const actor: CalendarActor = { scopeId: 'tenant:synthetic-working-hours', userId: 'owner', principal: 'owner-session', manageAll: true, createOwn: true };
const reader: CalendarActor = { ...actor, userId: 'reader', principal: 'reader-session', manageAll: false, createOwn: false };
const weekly = { kind: 'weekly-local-v1', coverage: { from: '2026-11-16', until: '2026-11-23' }, fold: 'earlier',
  weekly: [{ day: 1, windows: [{ startMinute: 540, endMinute: 1020 }] }], overrides: [] };
const explicit = { kind: 'explicit-utc-v1', mode: 'windows', windows: [{ startAt: '2026-11-16T09:00:00.000Z', endAt: '2026-11-16T17:00:00.000Z' }] };
function fixture(logging = false, maxEvents = 10_000) {
  const db = createReactiveDB({ mode: 'memory' }); let source: LoggingActorSource | null = null;
  try {
    const raw = db.getRawDatabase(); raw.run('PRAGMA temp_store=MEMORY');
    for (const [table, schema] of Object.entries(calendarRealm.tables)) db.defineTable(table, schema);
    for (const migration of calendarRealm.migrations) migration.up(raw);
    if (logging) source = new LoggingActorSource(db, normalizeLoggingActorSourceBinding({ records: false, workflow: true,
      policyVersion: 'synthetic-working-hours', scope: { kind: 'tenant', tenantId: 'synthetic-working-hours' }, sourceQueue: { maxEvents } }));
    const command = (name: string, input: unknown): any => {
      const run = () => runDatabaseRealmCommand(calendarRealm, db, 'calendar.' + name, input as DatabaseSerializableValue);
      return source ? source.run(loggingContext('synthetic-working-hours'), run) : run();
    };
    const query = (name: string, input: unknown): any => {
      const copy = Database.deserialize(raw.serialize(), { readonly: true, strict: true });
      try { copy.run('PRAGMA temp_store=MEMORY'); return withDatabaseReadQuerySession(createDatabaseReadQuerySession(copy), context =>
        runDatabaseRealmQuery(calendarRealm, context, 'calendar.' + name, input as DatabaseSerializableValue)); }
      finally { copy.close(); }
    };
    command('owner.bind', { ownerId: 'synthetic-working-hours-owner', scopeId: actor.scopeId });
    command('resource.create', { actor, requestId: 'resource', id: 'person', label: 'PRIVATE_RESOURCE', kind: 'person', ownerId: actor.userId, timeZone: 'UTC' });
    const replace = (policy: unknown = weekly, overrides: Record<string, unknown> = {}) => command('resource.availability-policy', {
      actor, id: 'person', requestId: 'policy-' + db.currentSeq, expectedRevision: db.get('calendar_resources', 'person')!.revision, ...policy as object, ...overrides });
    const appointment = (id: string, overrides: Record<string, unknown> = {}) => command('appointment.create', { actor, id, requestId: id, title: 'PRIVATE_APPOINTMENT',
      resourceIds: ['person'], startAt: '2026-11-16T10:00:00.000Z', endAt: '2026-11-16T11:00:00.000Z', timeZone: 'UTC', ...overrides });
    const count = (table: string) => (raw.query(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n;
    const close = () => { source?.close(); db.dispose(); };
    return { db, raw, source, command, query, replace, appointment, count, close };
  } catch (error) { source?.close(); db.dispose(); throw error; }
}
function rejected(run: () => unknown, code: CalendarErrorCode) {
  try { run(); throw new Error('Expected rejection'); }
  catch (error) { expect(readCalendarRejection(error)?.code).toBe(code); }
}

test('weekly writes freeze UTC coverage/windows and booking uses full buffered occupancy', () => {
  const f = fixture(); try {
    expect(f.replace().value).toMatchObject({ operation: 'resource.availability-policy-changed', revision: 2, changed: true });
    const view = f.query('availabilityPolicy', { actor, id: 'person' });
    expect(view).toMatchObject({ resourceId: 'person', resourceRevision: 2, timeZone: 'UTC', policy: weekly,
      materialization: { coverage: { startAt: '2026-11-16T00:00:00.000Z', endAt: '2026-11-23T00:00:00.000Z' }, windowCount: 1, skippedDates: [], engine: { name: 'temporal-working-hours-v1' } } });
    expect(view).not.toHaveProperty('windows'); expect(view.materialization).not.toHaveProperty('windows');
    expect(f.raw.query('SELECT start_ms,end_ms FROM _calendar_availability_policy_windows').all()).toEqual([
      { start_ms: Date.parse(explicit.windows[0]!.startAt), end_ms: Date.parse(explicit.windows[0]!.endAt) },
    ]);
    expect(f.appointment('accepted').value.changed).toBe(true);
    rejected(() => f.appointment('closed', { startAt: '2026-11-17T10:00:00.000Z', endAt: '2026-11-17T11:00:00.000Z' }), 'CALENDAR_AVAILABILITY_CONFLICT');
    rejected(() => f.appointment('buffer', { startAt: '2026-11-16T09:00:00.000Z', endAt: '2026-11-16T09:30:00.000Z', bufferBeforeMinutes: 1 }), 'CALENDAR_AVAILABILITY_CONFLICT');
    rejected(() => f.appointment('uncovered', { startAt: '2026-11-23T10:00:00.000Z', endAt: '2026-11-23T11:00:00.000Z' }), 'CALENDAR_AVAILABILITY_COVERAGE_REQUIRED');
    expect(f.count('_calendar_availability_policy_history')).toBe(1); expect(f.count('_calendar_availability_policy_windows')).toBe(1);
    expect(f.raw.query('PRAGMA foreign_key_check').all()).toEqual([]);
  } finally { f.close(); }
});

test('source-normalized replay and no-op preserve frozen evidence across resource revision gaps', () => {
  const f = fixture(); try {
    const receipt = f.replace(weekly, { requestId: 'weekly', expectedRevision: 1 }).value, seq = f.db.currentSeq;
    expect(f.replace({ ...weekly, weekly: [{ day: 1, windows: [{ startMinute: 540, endMinute: 720 }, { startMinute: 720, endMinute: 1020 }] }] }, { requestId: 'weekly', expectedRevision: 1 }).value).toEqual(receipt);
    expect(f.db.currentSeq).toBe(seq);
    f.command('resource.grant', { actor, id: 'person', userId: reader.userId, grants: ['book'], expectedRevision: 2, requestId: 'grant' });
    expect(f.replace().value).toMatchObject({ changed: false, revision: 3 });
    expect(f.count('_calendar_availability_policy_history')).toBe(1); expect(f.count('_calendar_availability_policy_windows')).toBe(1);
    expect(f.query('availabilityPolicy', { actor: reader, id: 'person' }).policy).toEqual(weekly);
    expect(f.query('receipt', { actor, requestId: 'weekly' })).toEqual(receipt);
    rejected(() => f.replace({ ...weekly, weekly: [] }, { expectedRevision: 2 }), 'CALENDAR_REVISION_CONFLICT');
  } finally { f.close(); }
});

test('retained weekly reads, booking, no-op and receipt replay require no current timezone expansion engine', () => {
  const f = fixture();
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'Temporal');
  try {
    const receipt = f.replace(weekly, { requestId: 'weekly', expectedRevision: 1 }).value;
    const frozen = f.raw.query('SELECT * FROM _calendar_availability_policy_windows ORDER BY ordinal').all();
    Object.defineProperty(globalThis, 'Temporal', { value: undefined, configurable: true, writable: true });
    expect(f.query('availabilityPolicy', { actor, id: 'person' }).policy).toEqual(weekly);
    expect(f.appointment('engine-independent').value.changed).toBe(true);
    expect(f.replace(weekly, { requestId: 'weekly', expectedRevision: 1 }).value).toEqual(receipt);
    expect(f.replace().value).toMatchObject({ revision: 2, changed: false });
    rejected(() => f.replace({ ...weekly, weekly: [] }), 'CALENDAR_TIME_RULES_UNAVAILABLE');
    expect(f.raw.query('SELECT * FROM _calendar_availability_policy_windows ORDER BY ordinal').all()).toEqual(frozen);
    expect(f.count('_calendar_availability_policy_history')).toBe(1); expect(f.db.get('calendar_resources', 'person')!.revision).toBe(2);
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'Temporal', descriptor);
    else Reflect.deleteProperty(globalThis, 'Temporal');
    f.close();
  }
});

test('legacy APIs never hide active weekly source and explicit replacement restores compatible access', () => {
  const f = fixture(); try {
    const legacy = { actor, id: 'person', requestId: 'legacy', expectedRevision: 1, mode: 'windows', windows: explicit.windows };
    const historicalReceipt = f.command('resource.availability', legacy).value;
    f.replace();
    rejected(() => f.query('availability', { actor, id: 'person' }), 'CALENDAR_AVAILABILITY_FORMAT_UNSUPPORTED');
    rejected(() => f.command('resource.availability', { ...legacy, requestId: 'legacy-new', expectedRevision: 3 }), 'CALENDAR_AVAILABILITY_FORMAT_UNSUPPORTED');
    expect(f.command('resource.availability', legacy).value).toEqual(historicalReceipt);
    f.replace(explicit);
    expect(f.query('availability', { actor, id: 'person' })).toMatchObject({ mode: 'windows', windows: explicit.windows });
    expect(f.command('resource.availability', { ...legacy, requestId: 'legacy-noop', expectedRevision: 4 }).value).toMatchObject({ changed: false, revision: 4 });
    f.command('resource.availability', { ...legacy, requestId: 'legacy-switch', expectedRevision: 4, windows: [] });
    expect(f.db.get('_calendar_availability_policy_current', 'person')).toMatchObject({ source_kind: 'legacy', history_id: null, resource_revision: 5 });
    expect(f.query('availabilityPolicy', { actor, id: 'person' })).toMatchObject({ policy: { kind: 'explicit-utc-v1', mode: 'windows', windows: [] }, materialization: null });
    rejected(() => f.appointment('closed'), 'CALENDAR_AVAILABILITY_CONFLICT');
    expect(f.count('_calendar_availability_policy_history')).toBe(2);
  } finally { f.close(); }
});

test('successive legacy policy writes publish selectors atomically across legitimate grant revision gaps', () => {
  const f = fixture(); try {
    f.command('resource.availability', { actor, id: 'person', requestId: 'legacy-closed', expectedRevision: 1, mode: 'windows', windows: [] });
    f.command('resource.grant', { actor, id: 'person', requestId: 'grant-gap', expectedRevision: 2, userId: reader.userId, grants: ['book'] });
    expect(f.query('availability', { actor, id: 'person' })).toMatchObject({ resourceRevision: 3, mode: 'windows', windows: [] });
    expect(f.command('resource.availability', { actor, id: 'person', requestId: 'legacy-open', expectedRevision: 3, mode: 'unrestricted', windows: [] }).value)
      .toMatchObject({ changed: true, revision: 4 });
    expect(f.db.get('_calendar_availability_policy_current', 'person')).toMatchObject({ source_kind: 'legacy', resource_revision: 4, history_id: null });
    expect(f.db.get('_calendar_availability', 'person')!.policy_revision).toBe(4);
    expect(f.query('availabilityPolicy', { actor, id: 'person' })).toMatchObject({ policy: { kind: 'explicit-utc-v1', mode: 'unrestricted', windows: [] }, materialization: null });
    expect(f.appointment('legacy-open-allowed').value.changed).toBe(true);
  } finally { f.close(); }
});

test('retained policy history without its selector fails closed instead of restoring implicit or hidden legacy policy', () => {
  for (const legacyFirst of [false, true]) {
    const f = fixture(); try {
      if (legacyFirst) f.command('resource.availability', { actor, id: 'person', requestId: 'legacy-first', expectedRevision: 1, mode: 'windows', windows: [] });
      const expectedRevision = Number(f.db.get('calendar_resources', 'person')!.revision);
      const receipt = f.replace(weekly, { requestId: 'weekly', expectedRevision }).value;
      f.raw.run('DROP TRIGGER _calendar_availability_policy_current_retain');
      f.raw.run("DELETE FROM _calendar_availability_policy_current WHERE id='person'");
      rejected(() => f.query('availabilityPolicy', { actor, id: 'person' }), 'CALENDAR_STATE_INVALID');
      rejected(() => f.query('availability', { actor, id: 'person' }), 'CALENDAR_STATE_INVALID');
      rejected(() => f.appointment('lost-selector'), 'CALENDAR_STATE_INVALID');
      rejected(() => f.replace({ kind: 'explicit-utc-v1', mode: 'unrestricted', windows: [] }), 'CALENDAR_STATE_INVALID');
      expect(f.replace(weekly, { requestId: 'weekly', expectedRevision }).value).toEqual(receipt);
      const plan = f.raw.query<{ detail: string }, [string, string]>('EXPLAIN QUERY PLAN SELECT id FROM _calendar_availability_policy_history WHERE scope_id=? AND resource_id=? LIMIT 1')
        .all(actor.scopeId, 'person').map(row => row.detail).join('\n');
      expect(plan).toContain('SEARCH'); expect(plan).not.toContain('SCAN'); expect(plan).not.toContain('TEMP B-TREE');
    } finally { f.close(); }
  }
});

test('new schema declarations are frozen without changing imported historical tables', () => {
  expect(Object.isFrozen(CALENDAR_AVAILABILITY_POLICY_ADDITIONS)).toBe(true);
  expect(Object.isFrozen(CALENDAR_AVAILABILITY_POLICY_TABLES)).toBe(true);
  for (const [name, definition] of Object.entries(CALENDAR_AVAILABILITY_POLICY_ADDITIONS)) {
    expect(Object.isFrozen(definition)).toBe(true); expect(CALENDAR_AVAILABILITY_POLICY_TABLES[name]).toBe(definition);
    if (Array.isArray(definition._identity)) expect(Object.isFrozen(definition._identity)).toBe(true);
    expect(() => { definition.synthetic = 'TEXT'; }).toThrow();
  }
});

test('selected legacy state cannot silently fall back after its pointer disappears or drifts', () => {
  for (const damage of ['missing', 'drift'] as const) {
    const f = fixture(); try {
      const input = { actor, id: 'person', requestId: 'legacy', expectedRevision: 1, mode: 'windows', windows: explicit.windows };
      const receipt = f.command('resource.availability', input).value;
      if (damage === 'missing') {
        f.raw.run('DROP TRIGGER _calendar_availability_retain');
        f.raw.run("DELETE FROM _calendar_availability WHERE id='person'");
      } else {
        f.db.update('calendar_resources', 'person', { revision: 3 });
        const prior = f.db.get('_calendar_availability_history', String(f.raw.query<{ id: string }, []>('SELECT id FROM _calendar_availability_history').get()!.id))!;
        f.db.createStrict('_calendar_availability_history', { ...prior, id: 'synthetic-drift', policy_revision: 3 });
        f.db.update('_calendar_availability', 'person', { policy_revision: 3 });
      }
      rejected(() => f.query('availabilityPolicy', { actor, id: 'person' }), 'CALENDAR_STATE_INVALID');
      rejected(() => f.query('availability', { actor, id: 'person' }), 'CALENDAR_STATE_INVALID');
      rejected(() => f.appointment('must-not-fall-back'), 'CALENDAR_STATE_INVALID');
      // Existing accepted command evidence is reconciled before new state admission.
      expect(f.command('resource.availability', input).value).toEqual(receipt);
    } finally { f.close(); }
  }
});

test('a selector beyond the current resource revision fails closed for queries and booking', () => {
  const f = fixture(); try {
    const receipt = f.replace(weekly, { requestId: 'weekly', expectedRevision: 1 }).value;
    f.raw.run('DROP TRIGGER calendar_availability_policy_current_parent_update');
    f.raw.run("UPDATE _calendar_availability_policy_current SET resource_revision=3 WHERE id='person'");
    rejected(() => f.query('availabilityPolicy', { actor, id: 'person' }), 'CALENDAR_STATE_INVALID');
    rejected(() => f.appointment('future-selector'), 'CALENDAR_STATE_INVALID');
    expect(f.replace(weekly, { requestId: 'weekly', expectedRevision: 1 }).value).toEqual(receipt);
  } finally { f.close(); }
});

test('immutable history/windows reject replacement, late append, cross-scope windows and backward pointers', () => {
  const f = fixture(); try {
    f.replace(); const pointer = f.db.get('_calendar_availability_policy_current', 'person')!;
    const history = f.db.get('_calendar_availability_policy_history', String(pointer.history_id))!;
    const window = f.raw.query<Record<string, unknown>, []>('SELECT * FROM _calendar_availability_policy_windows').get()!;
    expect(() => f.db.update('_calendar_availability_policy_history', String(history.id), { source_json: '{}' })).toThrow();
    expect(() => f.db.createStrict('_calendar_availability_policy_history', { ...history })).toThrow();
    expect(() => f.db.createStrict('_calendar_availability_policy_windows', { ...window, id: 'late', ordinal: 1 })).toThrow();
    expect(() => f.db.createStrict('_calendar_availability_policy_windows', { ...window, id: 'foreign', ordinal: 1, scope_id: 'tenant:foreign' })).toThrow();
    expect(() => f.db.update('_calendar_availability_policy_current', 'person', { resource_revision: 1 })).toThrow();
    f.replace({ ...weekly, weekly: [] });
    expect(() => f.db.update('_calendar_availability_policy_current', 'person', { resource_revision: pointer.resource_revision, history_id: pointer.history_id })).toThrow();
    const columns = Object.keys(history), sql = 'INSERT OR REPLACE INTO _calendar_availability_policy_history(' + columns.join(',') + ') VALUES(' + columns.map(() => '?').join(',') + ')';
    expect(() => f.raw.query(sql).run(...columns.map(key => history[key]) as any)).toThrow();
  } finally { f.close(); }
});

test('selector publication requires the exact resource generation and a complete ordered disjoint window set', () => {
  const f = fixture(); try {
    f.replace(); const original = f.db.get('_calendar_availability_policy_current', 'person')!;
    const history = f.db.get('_calendar_availability_policy_history', String(original.history_id))!;
    f.db.update('calendar_resources', 'person', { revision: 3 });
    const next = { ...history, id: 'synthetic-next-generation', resource_revision: 3, window_count: 2 };
    f.db.createStrict('_calendar_availability_policy_history', next);
    const row = { scope_id: actor.scopeId, resource_id: 'person', history_id: next.id,
      start_ms: Date.parse('2026-11-16T09:00:00.000Z'), end_ms: Date.parse('2026-11-16T10:00:00.000Z') };
    expect(() => f.db.createStrict('_calendar_availability_policy_windows', { ...row, id: 'out-of-order', ordinal: 1 })).toThrow();
    f.db.createStrict('_calendar_availability_policy_windows', { ...row, id: 'next-zero', ordinal: 0 });
    expect(() => f.db.update('_calendar_availability_policy_current', 'person', { resource_revision: 3, history_id: next.id })).toThrow();
    expect(() => f.db.createStrict('_calendar_availability_policy_windows', { ...row, id: 'adjacent', ordinal: 1, start_ms: row.end_ms, end_ms: row.end_ms + 60_000 })).toThrow();
    f.db.createStrict('_calendar_availability_policy_windows', { ...row, id: 'next-one', ordinal: 1, start_ms: row.end_ms + 60_000, end_ms: row.end_ms + 120_000 });
    f.db.update('_calendar_availability_policy_current', 'person', { resource_revision: 3, history_id: next.id });
    expect(() => f.db.createStrict('_calendar_availability_policy_windows', { ...row, id: 'sealed-extra', ordinal: 2, start_ms: row.end_ms + 180_000, end_ms: row.end_ms + 240_000 })).toThrow();
    expect(() => f.db.createStrict('_calendar_availability_policy_history', { ...history, id: 'stale-parent', resource_revision: 2 })).toThrow();
    expect(f.raw.query('PRAGMA foreign_key_check').all()).toEqual([]);
  } finally { f.close(); }
});

test('policy/window budget and pointer failures roll back resource, receipts, usage, windows and audit', () => {
  const f = fixture(true); try {
    f.db.createStrict('_calendar_usage', { id: 'availabilityPolicyWindows', count: CALENDAR_LIMITS.availabilityPolicyWindows });
    const seq = f.db.currentSeq, events = f.source!.control({}).queued;
    rejected(() => f.replace(), 'CALENDAR_CAPACITY');
    expect(f.db.currentSeq).toBe(seq); expect(f.count('_calendar_availability_policy_history')).toBe(0); expect(f.count('_calendar_availability_policy_windows')).toBe(0);
    expect(f.db.get('calendar_resources', 'person')!.revision).toBe(1); expect(f.source!.control({}).queued).toBe(events);
    f.db.update('_calendar_usage', 'availabilityPolicyWindows', { count: 0 });
    f.raw.run("CREATE TRIGGER synthetic_availability_pointer_failure BEFORE INSERT ON _calendar_availability_policy_current BEGIN SELECT RAISE(ABORT,'synthetic failure'); END");
    expect(() => f.replace()).toThrow();
    expect(f.count('_calendar_availability_policy_history')).toBe(0); expect(f.count('_calendar_availability_policy_windows')).toBe(0);
    expect(f.db.get('calendar_resources', 'person')!.revision).toBe(1); expect(f.source!.control({}).queued).toBe(events);
  } finally { f.close(); }
});

test('semantic policy audit is private and once-only; query plan seeks the frozen current window', () => {
  const f = fixture(true); try {
    f.replace(weekly, { requestId: 'weekly', expectedRevision: 1 }); f.replace(weekly, { requestId: 'weekly', expectedRevision: 1 }); f.replace();
    const events = f.source!.control({}).rows.map(row => row.event);
    expect(events.map(event => event.action)).toEqual(['calendar.resource.created', 'calendar.resource.availability-policy-changed']);
    expect(JSON.stringify(events)).not.toContain('PRIVATE'); expect(JSON.stringify(events)).not.toContain('2026-11-16'); expect(JSON.stringify(events)).not.toContain('startMinute');
    const details = f.raw.query<{ detail: string }, [string, string, number]>('EXPLAIN QUERY PLAN SELECT start_ms,end_ms FROM _calendar_availability_policy_windows WHERE scope_id=? AND history_id=? AND start_ms<=? ORDER BY start_ms DESC LIMIT 1')
      .all(actor.scopeId, String(f.db.get('_calendar_availability_policy_current', 'person')!.history_id), Date.parse('2026-11-16T10:00:00.000Z')).map(row => row.detail).join('\n');
    expect(details).toContain('calendar_availability_policy_window_contains'); expect(details).not.toContain('SCAN'); expect(details).not.toContain('TEMP B-TREE');
    expect(f.query('availabilityPolicy', { actor, id: 'person' }).materialization.windowCount).toBe(1);
    rejected(() => f.query('availabilityPolicy', { actor: reader, id: 'person' }), 'CALENDAR_NOT_FOUND');
    rejected(() => f.query('availabilityPolicy', { actor: { ...actor, scopeId: 'tenant:foreign' }, id: 'person' }), 'CALENDAR_STATE_INVALID');
  } finally { f.close(); }
});
