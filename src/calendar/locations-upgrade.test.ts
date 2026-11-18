/** Populated 003 -> 004, real native migrator; no files, backups, actors or generated fixtures. */
import { Database } from 'bun:sqlite';
import { expect, test } from 'bun:test';
import type { DatabaseSerializableValue } from '../databases/database-operations';
import { createDatabaseReadQuerySession, withDatabaseReadQuerySession } from '../databases/database-read-query-capability';
import { runDatabaseRealmCommand, runDatabaseRealmQuery } from '../databases/database-realm';
import { Migrator } from '../migrations/migrator';
import { hashMigration, hashSchemaSnapshot, snapshotDeclaredTables } from '../migrations/schema-snapshot';
import { createReactiveDB } from '../sync/reactive-db';
import type { CalendarActor, CalendarCommandReceipt } from './contracts';
import { holdReservationId } from './holds-model';
import { calendarRealm } from './realm';
import { CALENDAR_HOLD_TABLES, CALENDAR_LOCATION_TABLES } from './realm-schema';
import { normalizeCalendarTimedInterval } from './time';
import { calendarHash, calendarJson } from './validation';

const HISTORICAL_CHECKSUMS = [
  '7a486bf60585cb5e00f86077021d2d142dab9290774828c077abbf03d3aba795',
  '772ccecce42312e46519265f681aa023312592e4ca6bcfdfda605499dc3edd6f',
  'de17b910d8dce95f6292dcc625c5cf3703527d7d3ba834477942a11603ad3e5f',
];
const ORIGINAL_003_TABLES = '32492f6b45ef4eac7617fff2f73a3610f7ddde9651d3c414f11c7b6852366340';
const actor: CalendarActor = { scopeId: 'tenant:synthetic-location-upgrade', userId: 'owner', principal: 'upgrade-session', manageAll: true, createOwn: true };
const timed = { startAt: '2030-01-01T10:00:00.000Z', endAt: '2030-01-01T11:00:00.000Z', timeZone: 'UTC' };
function fixture() {
  const db = createReactiveDB({ mode: 'memory' });
  try {
    const raw = db.getRawDatabase(); raw.run('PRAGMA temp_store=MEMORY');
    for (const [name, schema] of Object.entries(CALENDAR_HOLD_TABLES)) db.defineTable(name, schema);
    const old = new Migrator({ database: raw, dbPath: ':memory:', migrations: calendarRealm.migrations.slice(0, 3), createBackups: false, log() {} });
    try { expect(old.run()).toEqual(['001', '002', '003']); } finally { old.dispose(); }
    db.createStrict('_calendar_owner', { id: 'application', scope_id: actor.scopeId, owner_id: 'synthetic-owner' });
    db.createStrict('calendar_resources', { id: 'person', scope_id: actor.scopeId, label: 'PRIVATE_ORIGINAL_RESOURCE', kind: 'person', owner_id: actor.userId, time_zone: 'UTC', revision: 1, active: 1 });
    const interval = normalizeCalendarTimedInterval({ ...timed, bufferBeforeMinutes: 0, bufferAfterMinutes: 0 });
    const createdMs = Date.parse('2030-01-01T09:00:00.000Z'), expiresMs = createdMs + 300_000;
    db.createStrict('calendar_holds', { id: 'legacy-hold', scope_id: actor.scopeId, principal: actor.principal, created_by: actor.userId, created_ms: createdMs, revision: 1,
      start_at: interval.startAt, end_at: interval.endAt, start_ms: interval.startMs, end_ms: interval.endMs, time_zone: interval.timeZone,
      buffer_before: 0, buffer_after: 0, occupied_start_ms: interval.occupiedStartMs, occupied_end_ms: interval.occupiedEndMs, status: 'held', expires_ms: expiresMs, appointment_id: null });
    db.createStrict('_calendar_hold_reservations', { id: holdReservationId(actor.scopeId, 'legacy-hold', 'person'), scope_id: actor.scopeId, hold_id: 'legacy-hold', resource_id: 'person', resource_revision: 1,
      occupied_start_ms: interval.occupiedStartMs, occupied_end_ms: interval.occupiedEndMs, expires_ms: expiresMs, active: 1 });
    const saved = new Map<string, CalendarCommandReceipt>();
    const save = (kind: 'resource' | 'hold', requestId: string, targetId: string, operation: CalendarCommandReceipt['operation'], intent: unknown) => {
      const id = calendarHash([actor.scopeId, actor.principal, requestId]), result: CalendarCommandReceipt = { requestId, operation, id: targetId, revision: 1, changed: true };
      const prefix = kind === 'hold' ? '_calendar_hold' : '_calendar';
      db.createStrict(prefix + '_receipts', { id, scope_id: actor.scopeId, principal: actor.principal, request_id: requestId, digest: calendarHash(intent), result_json: calendarJson(result), target_kind: kind, target_id: targetId, required_right: kind === 'hold' ? 'book' : 'manage' });
      db.createStrict(prefix + '_effect_intents', { id, scope_id: actor.scopeId, receipt_id: id, operation, target_kind: kind, target_id: targetId, revision: 1 });
      saved.set(requestId, result);
    };
    save('resource', 'resource', 'person', 'resource.created', ['resource.create', 'person', 'PRIVATE_ORIGINAL_RESOURCE', 'person', actor.userId, 'UTC']);
    save('hold', 'hold', 'legacy-hold', 'hold.acquired', ['hold.acquire', 'legacy-hold', ['person'], interval, 300]);
    for (const [id, count] of [['resources', 1], ['holds', 1], ['receipts', 2]] as const) db.createStrict('_calendar_usage', { id, count });
    const command = (name: string, input: unknown): any => (runDatabaseRealmCommand(calendarRealm, db, 'calendar.' + name, input as DatabaseSerializableValue) as any).value;
    const query = (name: string, input: unknown): any => {
      const copy = Database.deserialize(raw.serialize(), { readonly: true, strict: true });
      try {
        copy.run('PRAGMA temp_store=MEMORY');
        return withDatabaseReadQuerySession(createDatabaseReadQuerySession(copy), context => runDatabaseRealmQuery(calendarRealm, context, 'calendar.' + name, input as DatabaseSerializableValue));
      } finally { copy.close(); }
    };
    const legacy = () => Object.fromEntries(Object.keys(CALENDAR_HOLD_TABLES).map(table => [table, raw.query(`SELECT * FROM ${table} ORDER BY id`).all()]));
    const upgrade = () => {
      for (const [table, schema] of Object.entries(calendarRealm.tables)) if (!(table in CALENDAR_HOLD_TABLES)) db.defineTable(table, schema);
      const current = new Migrator({ database: raw, dbPath: ':memory:', migrations: calendarRealm.migrations, createBackups: false, log() {} });
      try { const applied = current.run(); expect(current.status().every(entry => entry.checksumMatches)).toBe(true); return applied; } finally { current.dispose(); }
    };
    return { db, raw, command, query, legacy, upgrade, saved, close: () => db.dispose() };
  } catch (error) { db.dispose(); throw error; }
}

test('all three historical functions and the complete 003 schema retain original pinned identities', () => {
  expect(calendarRealm.migrations.map(migration => migration.version)).toEqual(['001', '002', '003', '004', '005', '006', '007', '008', '009', '010']);
  expect(calendarRealm.migrations.slice(0, 3).map(hashMigration)).toEqual(HISTORICAL_CHECKSUMS);
  expect(hashSchemaSnapshot(snapshotDeclaredTables(CALENDAR_HOLD_TABLES))).toBe(ORIGINAL_003_TABLES);
  for (const [table, schema] of Object.entries(CALENDAR_HOLD_TABLES)) expect(CALENDAR_LOCATION_TABLES[table]).toEqual(schema);
  for (const [table, schema] of Object.entries(CALENDAR_LOCATION_TABLES)) expect(calendarRealm.tables[table]).toEqual(schema);
});

test('real 003 upgrade preserves every row, old trigger and receipt, and leaves the directory genuinely empty', () => {
  const f = fixture();
  try {
    const before = f.legacy(), seq = f.db.currentSeq, ledger = f.raw.query('SELECT * FROM _migrations ORDER BY version').all();
    const triggers = f.raw.query<{ name: string; sql: string }, []>("SELECT name,sql FROM sqlite_master WHERE type='trigger' ORDER BY name").all();
    expect(f.upgrade()).toEqual(['004', '005', '006', '007', '008', '009', '010']); expect(f.legacy()).toEqual(before); expect(f.db.currentSeq).toBe(seq);
    expect(f.raw.query("SELECT * FROM _migrations WHERE version IN ('001','002','003') ORDER BY version").all()).toEqual(ledger);
    for (const trigger of triggers) expect(f.raw.query("SELECT name,sql FROM sqlite_master WHERE type='trigger' AND name=?").get(trigger.name)).toEqual(trigger);
    for (const [requestId, receipt] of f.saved) expect(f.query('receipt', { actor, requestId })).toEqual(receipt);
    expect(f.command('hold.acquire', { actor, id: 'legacy-hold', requestId: 'hold', resourceIds: ['person'], ...timed })).toEqual(f.saved.get('hold'));
    expect(f.command('resource.create', { actor, id: 'person', requestId: 'resource', label: 'PRIVATE_ORIGINAL_RESOURCE', kind: 'person', ownerId: actor.userId, timeZone: 'UTC' })).toEqual(f.saved.get('resource'));
    expect(f.query('locations', { actor })).toEqual({ items: [], truncated: false, nextAfter: null });
    expect(f.query('resourceLocations', { actor, id: 'person' })).toEqual({ resourceId: 'person', resourceRevision: 1, locationIds: [] });
    for (const table of Object.keys(CALENDAR_LOCATION_TABLES).filter(table => !(table in CALENDAR_HOLD_TABLES))) expect(f.raw.query(`SELECT * FROM ${table}`).all()).toEqual([]);
    expect(f.legacy()).toEqual(before); expect(f.db.currentSeq).toBe(seq); expect(f.upgrade()).toEqual([]);
    expect(f.raw.query('PRAGMA foreign_key_check').all()).toEqual([]);
  } finally { f.close(); }
});
