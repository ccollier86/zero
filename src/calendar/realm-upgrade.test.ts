/** Populated 001 -> current proof using the real migrator and native in-memory SQL only. */
import { Database } from 'bun:sqlite';
import { expect, test } from 'bun:test';
import type { DatabaseSerializableValue } from '../databases/database-operations';
import { createDatabaseReadQuerySession, withDatabaseReadQuerySession } from '../databases/database-read-query-capability';
import { runDatabaseRealmCommand, runDatabaseRealmQuery } from '../databases/database-realm';
import { Migrator } from '../migrations/migrator';
import { hashMigration, hashSchemaSnapshot, snapshotDeclaredTables } from '../migrations/schema-snapshot';
import { createReactiveDB } from '../sync/reactive-db';
import type { CalendarActor, CalendarCommandReceipt } from './contracts';
import { readCalendarRejection } from './error';
import { calendarRealm } from './realm';
import { grantId, reservationId } from './realm-model';
import { CALENDAR_SCHEDULING_TABLES, CALENDAR_TABLES } from './realm-schema';
import { normalizeCalendarTimedInterval } from './time';
import { calendarHash, calendarJson } from './validation';

const actor: CalendarActor = { scopeId: 'tenant:synthetic-upgrade', userId: 'synthetic-owner', principal: 'synthetic-session', manageAll: false, createOwn: true };
const appointmentInput = { actor, requestId: 'legacy-appointment', id: 'legacy-appointment', resourceIds: ['person'], title: 'PRIVATE_LEGACY_TITLE',
  startAt: '2030-01-01T10:00:00.000Z', endAt: '2030-01-01T11:00:00.000Z', timeZone: 'UTC', bufferBeforeMinutes: 5, bufferAfterMinutes: 10 };
const blockInput = { actor, requestId: 'new-block', id: 'new-block', resourceIds: ['person'], title: 'PRIVATE_BLOCK_TITLE',
  startAt: '2030-01-01T12:00:00.000Z', endAt: '2030-01-01T13:00:00.000Z', timeZone: 'UTC' };
const originalMigration = calendarRealm.migrations[0]!;

// These identities are pinned to the original pre-scheduling 001 generation.
const ORIGINAL_001_CHECKSUM = '7a486bf60585cb5e00f86077021d2d142dab9290774828c077abbf03d3aba795';
const ORIGINAL_TABLES_CHECKSUM = '7ee1126feee7d9d62183a9de968fab0d27254ee32081ad4ad8e1b723346cfd24';

function fixture() {
  const db = createReactiveDB({ mode: 'memory' });
  try {
    const raw = db.getRawDatabase(); raw.run('PRAGMA temp_store=MEMORY');
    for (const [table, schema] of Object.entries(CALENDAR_TABLES)) db.defineTable(table, schema);
    const initial = new Migrator({ database: raw, dbPath: ':memory:', migrations: [originalMigration], createBackups: false, log() {} });
    try { expect(initial.run()).toEqual(['001']); } finally { initial.dispose(); }

    // Exact synthetic original-schema rows, not current handlers that already
    // depend on the additive block receipt table. No external database is opened.
    db.createStrict('_calendar_owner', { id: 'application', scope_id: actor.scopeId, owner_id: 'synthetic-calendar-owner' });
    db.createStrict('calendar_resources', { id: 'person', scope_id: actor.scopeId, label: 'Synthetic provider', kind: 'person', owner_id: actor.userId,
      time_zone: 'UTC', revision: 1, active: 1 });
    const saveReceipt = (requestId: string, intent: unknown, targetKind: 'resource' | 'appointment', requiredRight: 'manage' | 'book', result: CalendarCommandReceipt) => {
      const id = calendarHash([actor.scopeId, actor.principal, requestId]);
      db.createStrict('_calendar_receipts', { id, scope_id: actor.scopeId, principal: actor.principal, request_id: requestId, digest: calendarHash(intent),
        result_json: calendarJson(result), target_kind: targetKind, target_id: result.id, required_right: requiredRight });
      db.createStrict('_calendar_effect_intents', { id, scope_id: actor.scopeId, receipt_id: id, operation: result.operation,
        target_kind: targetKind, target_id: result.id, revision: result.revision });
    };
    saveReceipt('legacy-resource', ['resource.create', 'person', 'Synthetic provider', 'person', actor.userId, 'UTC'], 'resource', 'manage',
      { requestId: 'legacy-resource', operation: 'resource.created', id: 'person', revision: 1, changed: true });
    db.createStrict('_calendar_grants', { id: grantId(actor.scopeId, 'person', 'synthetic-delegate'), scope_id: actor.scopeId, resource_id: 'person',
      user_id: 'synthetic-delegate', busy: 1, details: 1, book: 0, manage: 0 });
    db.update('calendar_resources', 'person', { revision: 2 });
    saveReceipt('legacy-grant', ['resource.grant', 'person', 1, 'synthetic-delegate', ['busy', 'details']], 'resource', 'manage',
      { requestId: 'legacy-grant', operation: 'resource.grant-changed', id: 'person', revision: 2, changed: true });
    const interval = normalizeCalendarTimedInterval({ startAt: appointmentInput.startAt, endAt: appointmentInput.endAt, timeZone: appointmentInput.timeZone,
      bufferBeforeMinutes: appointmentInput.bufferBeforeMinutes, bufferAfterMinutes: appointmentInput.bufferAfterMinutes });
    db.createStrict('calendar_appointments', { id: appointmentInput.id, scope_id: actor.scopeId, title: appointmentInput.title,
      start_at: interval.startAt, end_at: interval.endAt, start_ms: interval.startMs, end_ms: interval.endMs, time_zone: interval.timeZone,
      buffer_before: interval.bufferBeforeMinutes, buffer_after: interval.bufferAfterMinutes, occupied_start_ms: interval.occupiedStartMs,
      occupied_end_ms: interval.occupiedEndMs, status: 'confirmed', revision: 1, created_by: actor.userId });
    db.createStrict('_calendar_reservations', { id: reservationId(actor.scopeId, appointmentInput.id, 'person'), scope_id: actor.scopeId,
      appointment_id: appointmentInput.id, resource_id: 'person', occupied_start_ms: interval.occupiedStartMs, occupied_end_ms: interval.occupiedEndMs, active: 1 });
    const accepted: CalendarCommandReceipt = { requestId: appointmentInput.requestId, operation: 'appointment.created', id: appointmentInput.id, revision: 1, changed: true };
    saveReceipt(appointmentInput.requestId, ['appointment.create', appointmentInput.id, ['person'], appointmentInput.title, interval], 'appointment', 'book', accepted);
    for (const [id, count] of [['resources', 1], ['appointments', 1], ['receipts', 3]] as const) db.createStrict('_calendar_usage', { id, count });

    const command = (name: string, input: unknown): CalendarCommandReceipt => {
      const result = runDatabaseRealmCommand(calendarRealm, db, 'calendar.' + name, input as DatabaseSerializableValue);
      if (result === null || typeof result !== 'object' || Array.isArray(result) || !('ok' in result) || result.ok !== true || !('value' in result)) throw new Error('Expected accepted calendar command');
      return result.value as unknown as CalendarCommandReceipt;
    };
    const query = <T = DatabaseSerializableValue>(name: string, input: unknown): T => {
      const copy = Database.deserialize(raw.serialize(), { readonly: true, strict: true });
      try {
        copy.run('PRAGMA temp_store=MEMORY');
        return withDatabaseReadQuerySession(createDatabaseReadQuerySession(copy), context => runDatabaseRealmQuery(calendarRealm, context, 'calendar.' + name, input as DatabaseSerializableValue)) as unknown as T;
      } finally { copy.close(); }
    };
    const legacyData = () => Object.fromEntries(Object.keys(CALENDAR_TABLES).map(table => [table, raw.query(`SELECT * FROM ${table} ORDER BY id`).all()]));
    const upgrade = () => {
      for (const [table, schema] of Object.entries(calendarRealm.tables)) if (!(table in CALENDAR_TABLES)) db.defineTable(table, schema);
      const current = new Migrator({ database: raw, dbPath: ':memory:', migrations: calendarRealm.migrations, createBackups: false, log() {} });
      try {
        const applied = current.run();
        expect(current.status().every(entry => entry.checksumMatches)).toBe(true);
        return applied;
      } finally { current.dispose(); }
    };
    return { db, raw, command, query, legacyData, upgrade, accepted, close: () => db.dispose() };
  } catch (error) { db.dispose(); throw error; }
}

test('original 001 function identity and declaration remain frozen while current schema is additive', () => {
  expect(hashMigration(originalMigration)).toBe(ORIGINAL_001_CHECKSUM);
  expect(hashSchemaSnapshot(snapshotDeclaredTables(CALENDAR_TABLES))).toBe(ORIGINAL_TABLES_CHECKSUM);
  expect(calendarRealm.migrationChecksums[0]).toEqual({ version: '001', checksum: ORIGINAL_001_CHECKSUM });
  expect(Object.keys(CALENDAR_TABLES)).toEqual(['_calendar_owner', 'calendar_resources', '_calendar_grants', 'calendar_appointments',
    '_calendar_reservations', '_calendar_receipts', '_calendar_effect_intents', '_calendar_usage']);
  for (const [table, schema] of Object.entries(CALENDAR_TABLES)) expect(CALENDAR_SCHEDULING_TABLES[table]).toEqual(schema);
  expect(CALENDAR_TABLES._calendar_receipts!.target_kind).toBe("TEXT NOT NULL CHECK(target_kind IN ('resource','appointment'))");
});

test('real migrator upgrades populated 001 without rewriting legacy rows, triggers or accepted receipts', () => {
  const f = fixture();
  try {
    const data = f.legacyData(), seq = f.db.currentSeq;
    const triggers = f.raw.query<{ name: string; sql: string }, []>("SELECT name,sql FROM sqlite_master WHERE type='trigger' ORDER BY name").all();
    const ledger = f.raw.query("SELECT * FROM _migrations WHERE version='001'").get();
    expect(f.upgrade()).toEqual(['002', '003', '004', '005', '006', '007', '008', '009', '010', '011', '012', '013', '014', '015']);
    expect(f.legacyData()).toEqual(data); expect(f.db.currentSeq).toBe(seq);
    expect(f.raw.query("SELECT * FROM _migrations WHERE version='001'").get()).toEqual(ledger);
    for (const trigger of triggers) expect(f.raw.query('SELECT name,sql FROM sqlite_master WHERE name=? AND type=\'trigger\'').get(trigger.name)).toEqual(trigger);
    expect(f.query('availability', { actor, id: 'person' })).toMatchObject({ mode: 'unrestricted', windows: [], resourceRevision: 2 });
    expect(f.query<CalendarCommandReceipt | null>('receipt', { actor, requestId: appointmentInput.requestId })).toEqual(f.accepted);
    expect(f.command('appointment.create', appointmentInput)).toEqual(f.accepted);
    expect(f.command('resource.create', { actor, requestId: 'legacy-resource', id: 'person', label: 'Synthetic provider', kind: 'person', ownerId: actor.userId, timeZone: 'UTC' }))
      .toEqual({ requestId: 'legacy-resource', operation: 'resource.created', id: 'person', revision: 1, changed: true });
    expect(f.command('resource.grant', { actor, requestId: 'legacy-grant', id: 'person', expectedRevision: 1, userId: 'synthetic-delegate', grants: ['details', 'busy'] }))
      .toEqual({ requestId: 'legacy-grant', operation: 'resource.grant-changed', id: 'person', revision: 2, changed: true });
    expect(f.legacyData()).toEqual(data); expect(f.db.currentSeq).toBe(seq);
    expect(f.upgrade()).toEqual([]); expect(f.db.currentSeq).toBe(seq);
    expect(f.raw.query('PRAGMA foreign_key_check').all()).toEqual([]);
  } finally { f.close(); }
});

test('upgraded legacy and block evidence reject replacement and cross-store request reuse in both directions', () => {
  const f = fixture();
  try {
    f.upgrade(); f.command('block.create', blockInput);
    f.command('resource.availability', { actor, requestId: 'closed-policy', id: 'person', expectedRevision: 2, mode: 'windows', windows: [] });
    f.raw.run('PRAGMA recursive_triggers=OFF');
    for (const table of ['_calendar_owner', '_calendar_receipts', '_calendar_effect_intents', '_calendar_availability_history', '_calendar_block_receipts', '_calendar_block_effect_intents']) {
      const before = f.raw.query(`SELECT * FROM ${table} ORDER BY id`).all();
      expect(before.length).toBeGreaterThan(0);
      expect(() => f.raw.run(`UPDATE ${table} SET id=id`)).toThrow();
      expect(() => f.raw.run(`DELETE FROM ${table}`)).toThrow();
      expect(() => f.raw.run(`INSERT OR REPLACE INTO ${table} SELECT * FROM ${table} LIMIT 1`)).toThrow();
      expect(f.raw.query(`SELECT * FROM ${table} ORDER BY id`).all()).toEqual(before);
    }
    const columns = 'id,scope_id,principal,request_id,digest,result_json,target_kind,target_id,required_right';
    expect(() => f.raw.run(`INSERT INTO _calendar_block_receipts (${columns})
      SELECT id||'-book-only',scope_id,principal,request_id||'-book-only',digest,result_json,target_kind,target_id,'book'
      FROM _calendar_block_receipts LIMIT 1`)).toThrow();
    for (const [target, source, kind, targetId] of [
      ['_calendar_block_receipts', '_calendar_receipts', 'block', blockInput.id],
      ['_calendar_receipts', '_calendar_block_receipts', 'appointment', appointmentInput.id],
    ] as const) {
      for (const [id, request] of [['id', "request_id||'-different'"], ["id||'-different'", 'request_id']] as const) {
        const before = f.raw.query(`SELECT * FROM ${target} ORDER BY id`).all();
        expect(() => f.raw.query(`INSERT OR REPLACE INTO ${target} (${columns})
          SELECT ${id},scope_id,principal,${request},digest,result_json,?,?,'manage' FROM ${source} LIMIT 1`).run(kind, targetId)).toThrow();
        expect(f.raw.query(`SELECT * FROM ${target} ORDER BY id`).all()).toEqual(before);
      }
    }
    for (const [name, input] of [
      ['block.create', { ...blockInput, requestId: appointmentInput.requestId }],
      ['appointment.create', { ...appointmentInput, requestId: blockInput.requestId }],
    ] as const) {
      let failure: unknown;
      try { f.command(name, input); } catch (error) { failure = error; }
      expect(readCalendarRejection(failure)?.code).toBe('CALENDAR_INTENT_CONFLICT');
    }
    const seq = f.db.currentSeq;
    expect(f.command('block.create', blockInput)).toEqual({ requestId: blockInput.requestId, operation: 'block.created', id: blockInput.id, revision: 1, changed: true });
    expect(f.db.currentSeq).toBe(seq);
  } finally { f.close(); }
});

test('availability pointer references immutable same-resource history and advances over legitimate grant revision gaps', () => {
  const f = fixture();
  try {
    f.upgrade();
    expect(() => f.db.createStrict('_calendar_availability', { id: 'person', scope_id: actor.scopeId, resource_id: 'person', policy_revision: 2 })).toThrow();
    expect(() => f.db.createStrict('_calendar_availability_history', { id: 'future-policy', scope_id: actor.scopeId, resource_id: 'person', policy_revision: 3, mode: 'windows', windows_json: '[]' })).toThrow();
    f.command('resource.availability', { actor, requestId: 'first-policy', id: 'person', expectedRevision: 2, mode: 'windows', windows: [] });
    expect(f.db.get('_calendar_availability', 'person')!.policy_revision).toBe(3);
    const pointer = f.db.get('_calendar_availability', 'person');
    for (const policyRevision of [2, 3, 4]) expect(() => f.db.update('_calendar_availability', 'person', { policy_revision: policyRevision })).toThrow();
    expect(() => f.db.update('_calendar_availability', 'person', { resource_id: 'missing-resource', policy_revision: 4 })).toThrow();
    expect(() => f.raw.run("INSERT OR REPLACE INTO _calendar_availability SELECT * FROM _calendar_availability WHERE id='person'")).toThrow();
    expect(() => f.raw.run("DELETE FROM _calendar_availability WHERE id='person'")).toThrow();
    expect(f.db.get('_calendar_availability', 'person')).toEqual(pointer);
    f.command('resource.grant', { actor, requestId: 'grant-gap', id: 'person', userId: 'synthetic-delegate', grants: ['busy'], expectedRevision: 3 });
    expect(f.query('availability', { actor, id: 'person' })).toMatchObject({ resourceRevision: 4, mode: 'windows', windows: [] });
    f.command('resource.availability', { actor, requestId: 'open-policy', id: 'person', expectedRevision: 4, mode: 'unrestricted', windows: [] });
    expect(f.db.get('_calendar_availability', 'person')!.policy_revision).toBe(5);
    expect(f.raw.query<{ policy_revision: number }, []>('SELECT policy_revision FROM _calendar_availability_history ORDER BY policy_revision').all()).toEqual([{ policy_revision: 3 }, { policy_revision: 5 }]);
    expect(() => f.db.update('_calendar_availability', 'person', { policy_revision: 3 })).toThrow();
    expect(f.db.get('calendar_appointments', appointmentInput.id)!.revision).toBe(1);
    expect(f.db.get('calendar_appointments', appointmentInput.id)!.status).toBe('confirmed');
    expect(f.raw.query('PRAGMA foreign_key_check').all()).toEqual([]);
  } finally { f.close(); }
});
