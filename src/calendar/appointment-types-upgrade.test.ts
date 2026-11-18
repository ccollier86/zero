/** Populated 004 -> 005 through the real memory migrator; no backups, files or actors. */
import { Database } from 'bun:sqlite';
import { expect, test } from 'bun:test';
import type { DatabaseSerializableValue } from '../databases/database-operations';
import { createDatabaseReadQuerySession, withDatabaseReadQuerySession } from '../databases/database-read-query-capability';
import { runDatabaseRealmCommand, runDatabaseRealmQuery } from '../databases/database-realm';
import { Migrator } from '../migrations/migrator';
import { hashMigration, hashSchemaSnapshot, snapshotDeclaredTables } from '../migrations/schema-snapshot';
import { createReactiveDB } from '../sync/reactive-db';
import type { CalendarActor, CalendarCommandReceipt } from './contracts';
import { blockReservationId } from './blocks-model';
import { holdReservationId } from './holds-model';
import { calendarLocationCurrentId } from './locations-model';
import { reservationId } from './realm-model';
import { calendarRealm } from './realm';
import { CALENDAR_LOCATION_TABLES, CALENDAR_TYPE_TABLES } from './realm-schema';
import { normalizeCalendarTimedInterval } from './time';
import { calendarHash, calendarJson } from './validation';

const ORIGINAL_004_CHECKSUMS = [
  '7a486bf60585cb5e00f86077021d2d142dab9290774828c077abbf03d3aba795',
  '772ccecce42312e46519265f681aa023312592e4ca6bcfdfda605499dc3edd6f',
  'de17b910d8dce95f6292dcc625c5cf3703527d7d3ba834477942a11603ad3e5f',
  'e04bb02ac0e2960a36dd5d4cc1147e72451c1818d24634a787cabb5ebbbd1646',
];
const ORIGINAL_004_TABLES = 'e877949803b7216ec750ced20fb89c507d3cc7da91dbc0d4666a1b12450cf409';
const actor: CalendarActor = { scopeId: 'tenant:synthetic-types-upgrade', userId: 'owner', principal: 'upgrade-session', manageAll: true, createOwn: true };
const timed = { startAt: '2030-01-01T10:00:00.000Z', endAt: '2030-01-01T11:00:00.000Z', timeZone: 'UTC' };
function fixture() {
  const db = createReactiveDB({ mode: 'memory' });
  try {
    const raw = db.getRawDatabase(); raw.run('PRAGMA temp_store=MEMORY');
    for (const [name, schema] of Object.entries(CALENDAR_LOCATION_TABLES)) db.defineTable(name, schema);
    const old = new Migrator({ database: raw, dbPath: ':memory:', migrations: calendarRealm.migrations.slice(0, 4), createBackups: false, log() {} });
    try { expect(old.run()).toEqual(['001', '002', '003', '004']); } finally { old.dispose(); }
    db.createStrict('_calendar_owner', { id: 'application', scope_id: actor.scopeId, owner_id: 'synthetic-owner' });
    db.createStrict('calendar_resources', { id: 'person', scope_id: actor.scopeId, label: 'PRIVATE_ORIGINAL_RESOURCE', kind: 'person', owner_id: actor.userId, time_zone: 'UTC', revision: 1, active: 1 });
    const interval = normalizeCalendarTimedInterval({ ...timed, bufferBeforeMinutes: 0, bufferAfterMinutes: 0 });
    const intervalFields = (value: typeof interval) => ({ start_at: value.startAt, end_at: value.endAt, start_ms: value.startMs, end_ms: value.endMs, time_zone: value.timeZone,
      buffer_before: value.bufferBeforeMinutes, buffer_after: value.bufferAfterMinutes, occupied_start_ms: value.occupiedStartMs, occupied_end_ms: value.occupiedEndMs });
    db.createStrict('calendar_appointments', { id: 'legacy-appointment', scope_id: actor.scopeId, title: 'PRIVATE_ORIGINAL_TITLE', ...intervalFields(interval), status: 'confirmed', revision: 1, created_by: actor.userId });
    db.createStrict('_calendar_reservations', { id: reservationId(actor.scopeId, 'legacy-appointment', 'person'), scope_id: actor.scopeId,
      appointment_id: 'legacy-appointment', resource_id: 'person', occupied_start_ms: interval.occupiedStartMs, occupied_end_ms: interval.occupiedEndMs, active: 1 });
    const held = normalizeCalendarTimedInterval({ ...timed, startAt: '2030-01-01T12:00:00.000Z', endAt: '2030-01-01T13:00:00.000Z' });
    const createdMs = Date.parse('2030-01-01T09:00:00.000Z'), expiresMs = createdMs + 300_000;
    db.createStrict('calendar_holds', { id: 'legacy-hold', scope_id: actor.scopeId, principal: actor.principal, created_by: actor.userId, created_ms: createdMs,
      revision: 1, ...intervalFields(held), status: 'held', expires_ms: expiresMs, appointment_id: null });
    db.createStrict('_calendar_hold_reservations', { id: holdReservationId(actor.scopeId, 'legacy-hold', 'person'), scope_id: actor.scopeId, hold_id: 'legacy-hold', resource_id: 'person',
      resource_revision: 1, occupied_start_ms: held.occupiedStartMs, occupied_end_ms: held.occupiedEndMs, expires_ms: expiresMs, active: 1 });
    const blocked = normalizeCalendarTimedInterval({ ...timed, startAt: '2030-01-01T14:00:00.000Z', endAt: '2030-01-01T15:00:00.000Z' });
    db.createStrict('calendar_blocks', { id: 'legacy-block', scope_id: actor.scopeId, title: 'PRIVATE_ORIGINAL_BLOCK', start_at: blocked.startAt, end_at: blocked.endAt, start_ms: blocked.startMs,
      end_ms: blocked.endMs, time_zone: blocked.timeZone, status: 'active', revision: 1, created_by: actor.userId });
    db.createStrict('_calendar_block_reservations', { id: blockReservationId(actor.scopeId, 'legacy-block', 'person'), scope_id: actor.scopeId, block_id: 'legacy-block',
      resource_id: 'person', occupied_start_ms: blocked.startMs, occupied_end_ms: blocked.endMs, active: 1 });
    db.createStrict('_calendar_location_history', { id: calendarHash([actor.scopeId, 'location', 1]), scope_id: actor.scopeId, location_id: 'location', location_revision: 1,
      label: 'PRIVATE_ORIGINAL_LOCATION', region: 'US-IN', active: 1 });
    db.createStrict('calendar_locations', { id: 'location', scope_id: actor.scopeId, revision: 1 });
    db.update('calendar_resources', 'person', { revision: 2 });
    db.createStrict('_calendar_resource_location_history', { id: calendarHash([actor.scopeId, 'person', 2]), scope_id: actor.scopeId, resource_id: 'person', resource_revision: 2, location_ids_json: '["location"]' });
    db.createStrict('_calendar_resource_location_members', { id: calendarHash([actor.scopeId, 'person', 2, 'location']), scope_id: actor.scopeId, resource_id: 'person', resource_revision: 2, location_id: 'location' });
    db.createStrict('_calendar_resource_locations', { id: 'person', scope_id: actor.scopeId, resource_id: 'person', resource_revision: 2 });
    db.createStrict('_calendar_resource_location_current', { id: calendarLocationCurrentId(actor.scopeId, 'person', 'location'), scope_id: actor.scopeId, resource_id: 'person', resource_revision: 2, location_id: 'location' });
    db.update('calendar_resources', 'person', { revision: 3 });
    db.createStrict('_calendar_availability_history', { id: calendarHash([actor.scopeId, 'person', 3]), scope_id: actor.scopeId, resource_id: 'person', policy_revision: 3, mode: 'unrestricted', windows_json: '[]' });
    db.createStrict('_calendar_availability', { id: 'person', scope_id: actor.scopeId, resource_id: 'person', policy_revision: 3 });
    const saved = new Map<string, CalendarCommandReceipt>();
    const save = (kind: 'resource' | 'appointment' | 'block' | 'hold' | 'location', targetId: string, operation: CalendarCommandReceipt['operation'], intent: unknown, revision = 1) => {
      const requestId = kind, id = calendarHash([actor.scopeId, actor.principal, requestId]), result = { requestId, operation, id: targetId, revision, changed: true };
      const prefix = ['block', 'hold', 'location'].includes(kind) ? '_calendar_' + kind : '_calendar';
      db.createStrict(prefix + '_receipts', { id, scope_id: actor.scopeId, principal: actor.principal, request_id: requestId, digest: calendarHash(intent), result_json: calendarJson(result),
        target_kind: kind, target_id: targetId, required_right: kind === 'hold' || kind === 'appointment' ? 'book' : 'manage' });
      db.createStrict(prefix + '_effect_intents', { id, scope_id: actor.scopeId, receipt_id: id, operation, target_kind: kind, target_id: targetId, revision });
      saved.set(requestId, result);
    };
    save('resource', 'person', 'resource.created', ['resource.create', 'person', 'PRIVATE_ORIGINAL_RESOURCE', 'person', actor.userId, 'UTC']);
    save('appointment', 'legacy-appointment', 'appointment.created', ['appointment.create', 'legacy-appointment', ['person'], 'PRIVATE_ORIGINAL_TITLE', interval]);
    save('hold', 'legacy-hold', 'hold.acquired', ['hold.acquire', 'legacy-hold', ['person'], held, 300]);
    save('block', 'legacy-block', 'block.created', ['block.create', 'legacy-block', ['person'], 'PRIVATE_ORIGINAL_BLOCK', blocked]);
    save('location', 'location', 'location.created', ['location.create', 'location', 'PRIVATE_ORIGINAL_LOCATION', 'US-IN', true]);
    for (const [id, count] of [['resources', 1], ['appointments', 1], ['blocks', 1], ['holds', 1], ['locations', 1], ['locationHistory', 1], ['resourceLocationHistory', 1], ['receipts', 5]] as const) db.createStrict('_calendar_usage', { id, count });
    const command = (name: string, input: unknown): any => (runDatabaseRealmCommand(calendarRealm, db, 'calendar.' + name, input as DatabaseSerializableValue) as any).value;
    const query = (name: string, input: unknown): any => {
      const copy = Database.deserialize(raw.serialize(), { readonly: true, strict: true });
      try {
        copy.run('PRAGMA temp_store=MEMORY');
        return withDatabaseReadQuerySession(createDatabaseReadQuerySession(copy), context => runDatabaseRealmQuery(calendarRealm, context, 'calendar.' + name, input as DatabaseSerializableValue));
      } finally { copy.close(); }
    };
    const legacy = () => Object.fromEntries(Object.keys(CALENDAR_LOCATION_TABLES).map(table => [table, raw.query(`SELECT * FROM ${table} ORDER BY id`).all()]));
    const upgrade = () => {
      for (const [name, schema] of Object.entries(calendarRealm.tables)) if (!(name in CALENDAR_LOCATION_TABLES)) db.defineTable(name, schema);
      const current = new Migrator({ database: raw, dbPath: ':memory:', migrations: calendarRealm.migrations, createBackups: false, log() {} });
      try { const applied = current.run(); expect(current.status().every(entry => entry.checksumMatches)).toBe(true); return applied; } finally { current.dispose(); }
    };
    return { db, raw, saved, command, query, legacy, upgrade, close: () => db.dispose() };
  } catch (error) { db.dispose(); throw error; }
}

test('all four historical migrations and the complete 004 declaration retain their pinned identities', () => {
  expect(calendarRealm.migrations.map(migration => migration.version)).toEqual(['001', '002', '003', '004', '005', '006', '007', '008', '009']);
  expect(calendarRealm.migrations.slice(0, 4).map(hashMigration)).toEqual(ORIGINAL_004_CHECKSUMS);
  expect(hashSchemaSnapshot(snapshotDeclaredTables(CALENDAR_LOCATION_TABLES))).toBe(ORIGINAL_004_TABLES);
  for (const [name, schema] of Object.entries(CALENDAR_LOCATION_TABLES)) expect(CALENDAR_TYPE_TABLES[name]).toEqual(schema);
  for (const [name, schema] of Object.entries(CALENDAR_TYPE_TABLES)) expect(calendarRealm.tables[name]).toEqual(schema);
});

test('real populated 004 upgrade preserves all old rows, triggers, ledgers, receipts and untyped interpretation without backfill', () => {
  const f = fixture();
  try {
    const before = f.legacy(), seq = f.db.currentSeq, ledger = f.raw.query('SELECT * FROM _migrations ORDER BY version').all();
    const triggers = f.raw.query<{ name: string; sql: string }, []>("SELECT name,sql FROM sqlite_master WHERE type='trigger' ORDER BY name").all();
    expect(f.upgrade()).toEqual(['005', '006', '007', '008', '009']); expect(f.legacy()).toEqual(before); expect(f.db.currentSeq).toBe(seq);
    expect(f.raw.query("SELECT * FROM _migrations WHERE version IN ('001','002','003','004') ORDER BY version").all()).toEqual(ledger);
    for (const trigger of triggers) expect(f.raw.query("SELECT name,sql FROM sqlite_master WHERE type='trigger' AND name=?").get(trigger.name)).toEqual(trigger);
    for (const [requestId, receipt] of f.saved) expect(f.query('receipt', { actor, requestId })).toEqual(receipt);
    expect(f.command('resource.create', { actor, id: 'person', requestId: 'resource', label: 'PRIVATE_ORIGINAL_RESOURCE', kind: 'person', ownerId: actor.userId, timeZone: 'UTC' })).toEqual(f.saved.get('resource'));
    expect(f.command('appointment.create', { actor, id: 'legacy-appointment', requestId: 'appointment', resourceIds: ['person'], title: 'PRIVATE_ORIGINAL_TITLE', ...timed })).toEqual(f.saved.get('appointment'));
    expect(f.command('hold.acquire', { actor, id: 'legacy-hold', requestId: 'hold', resourceIds: ['person'], ...timed, startAt: '2030-01-01T12:00:00.000Z', endAt: '2030-01-01T13:00:00.000Z' })).toEqual(f.saved.get('hold'));
    expect(f.command('location.create', { actor, id: 'location', requestId: 'location', label: 'PRIVATE_ORIGINAL_LOCATION', region: 'US-IN' })).toEqual(f.saved.get('location'));
    expect(f.query('appointment', { actor, id: 'legacy-appointment' })).not.toHaveProperty('appointmentType');
    expect(f.query('hold', { actor, id: 'legacy-hold' })).not.toHaveProperty('appointmentType');
    expect(f.query('resourceLocations', { actor, id: 'person' })).toEqual({ resourceId: 'person', resourceRevision: 3, locationIds: ['location'] });
    expect(f.query('types', { actor })).toEqual({ items: [], truncated: false, nextAfter: null });
    expect(f.query('resourceTypes', { actor, id: 'person' })).toEqual({ resourceId: 'person', resourceRevision: 3, mode: 'unrestricted', typeIds: [] });
    for (const table of Object.keys(CALENDAR_TYPE_TABLES).filter(table => !(table in CALENDAR_LOCATION_TABLES))) expect(f.raw.query(`SELECT * FROM ${table}`).all()).toEqual([]);
    expect(f.legacy()).toEqual(before); expect(f.db.currentSeq).toBe(seq); expect(f.upgrade()).toEqual([]);
    expect(f.raw.query('PRAGMA foreign_key_check').all()).toEqual([]);
  } finally { f.close(); }
});

test('005 admits new typed reservations without rewriting legacy appointments, metadata or receipt evidence', () => {
  const f = fixture();
  try {
    f.upgrade();
    const appointment = f.db.get('calendar_appointments', 'legacy-appointment'), location = f.db.get('calendar_locations', 'location');
    const oldReceipts = f.raw.query('SELECT * FROM _calendar_receipts ORDER BY id').all();
    f.command('type.create', { actor, id: 'type', requestId: 'type', label: 'PRIVATE_NEW_TYPE', durationMinutes: 60, bufferBeforeMinutes: 5, bufferAfterMinutes: 10 });
    f.command('resource.types', { actor, id: 'person', requestId: 'policy', expectedRevision: 3, mode: 'required', typeIds: ['type'] });
    f.command('appointment.create', { actor, id: 'typed', requestId: 'typed', title: 'PRIVATE_NEW_APPOINTMENT', resourceIds: ['person'], ...timed,
      startAt: '2030-01-01T16:00:00.000Z', endAt: '2030-01-01T17:00:00.000Z', appointmentType: { id: 'type', revision: 1 } });
    expect(f.query('appointment', { actor, id: 'typed' }).appointmentType).toMatchObject({ id: 'type', revision: 1, label: 'PRIVATE_NEW_TYPE' });
    expect(f.db.get('calendar_appointments', 'legacy-appointment')).toEqual(appointment); expect(f.db.get('calendar_locations', 'location')).toEqual(location);
    expect(f.query('appointment', { actor, id: 'legacy-appointment' })).not.toHaveProperty('appointmentType');
    expect(f.raw.query('SELECT * FROM _calendar_receipts WHERE request_id IN (\'resource\',\'appointment\') ORDER BY id').all()).toEqual(oldReceipts);
    expect(f.db.list('_calendar_appointment_type_bindings')).toHaveLength(1);
    expect(f.raw.query('PRAGMA foreign_key_check').all()).toEqual([]);
  } finally { f.close(); }
});
