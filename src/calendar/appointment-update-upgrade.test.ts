/** Genuine populated 015 -> 016 using native Migrator BEFORE any new ReactiveDB table definition. MEMORY only. */
import { Database } from 'bun:sqlite';
import { expect, test } from 'bun:test';
import { defineDatabaseRealm, runDatabaseRealmCommand, runDatabaseRealmQuery } from '../databases/database-realm';
import type { DatabaseSerializableValue } from '../databases/database-operations';
import { createDatabaseReadQuerySession, withDatabaseReadQuerySession } from '../databases/database-read-query-capability';
import { Migrator } from '../migrations/migrator';
import { hashMigration, hashSchemaSnapshot, snapshotDeclaredTables } from '../migrations/schema-snapshot';
import { createReactiveDB } from '../sync/reactive-db';
import { calendarRealm } from './realm';
import { CALENDAR_INTEGRATION_OPERATOR_TABLES } from './realm-integration-operator-migration';
import { CALENDAR_APPOINTMENT_UPDATE_ADDITIONS } from './realm-appointment-update-migration';
import { CALENDAR_APPOINTMENT_RESOURCE_CURRENT as CURRENT, CALENDAR_APPOINTMENT_RESOURCE_STATE as STATE, CALENDAR_APPOINTMENT_UPDATE_HISTORY as HISTORY } from './appointment-resource-bindings';
import { readCalendarRejection } from './error';

const historical = defineDatabaseRealm({ name: calendarRealm.name, version: '15', tables: CALENDAR_INTEGRATION_OPERATOR_TABLES,
  migrations: calendarRealm.migrations.slice(0, 15), commands: Object.fromEntries(Object.entries(calendarRealm.commands).filter(([name]) => name !== 'calendar.appointment.update')),
  queries: calendarRealm.queries });
const actor = { scopeId: 'tenant:synthetic-update-upgrade', userId: 'synthetic-user', principal: 'synthetic-session', manageAll: true, createOwn: true };
const interval = { startAt: '2030-01-01T10:00:00.000Z', endAt: '2030-01-01T11:00:00.000Z', timeZone: 'UTC', bufferBeforeMinutes: 0, bufferAfterMinutes: 0 };
function fixture() {
  const db = createReactiveDB({ mode: 'memory' }), raw = db.getRawDatabase();
  try {
    raw.run('PRAGMA temp_store=MEMORY'); raw.run('PRAGMA foreign_keys=ON');
    for (const [name, schema] of Object.entries(historical.tables)) db.defineTable(name, schema);
    const migrate = (migrations = calendarRealm.migrations) => {
      const migrator = new Migrator({ database: raw, dbPath: ':memory:', migrations, createBackups: false, log() {} });
      try { return migrator.run(); } finally { migrator.dispose(); }
    };
    expect(migrate(historical.migrations)).toHaveLength(15);
    let current = false;
    const command = (name: string, body: Record<string, unknown> = {}): any => (runDatabaseRealmCommand(current ? calendarRealm : historical, db,
      'calendar.' + name, (name === 'owner.bind' ? body : { actor, ...body }) as DatabaseSerializableValue) as any).value;
    const query = (name: string, body: Record<string, unknown> = {}): any => {
      const copy = Database.deserialize(raw.serialize(), { readonly: true, strict: true });
      try { copy.run('PRAGMA temp_store=MEMORY'); return withDatabaseReadQuerySession(createDatabaseReadQuerySession(copy), context => runDatabaseRealmQuery(calendarRealm, context, 'calendar.' + name, { actor, ...body } as DatabaseSerializableValue)); }
      finally { copy.close(); }
    };
    command('owner.bind', { scopeId: actor.scopeId, ownerId: 'synthetic-update-upgrade-owner' });
    for (const id of ['old', 'new']) command('resource.create', { requestId: 'resource-' + id, id, label: 'PRIVATE_' + id, kind: 'person', ownerId: actor.userId, timeZone: 'UTC' });
    const booking = { requestId: 'original-create', id: 'appointment', title: 'PRIVATE_LEGACY_TITLE', resourceIds: ['old'], ...interval };
    const accepted = command('appointment.create', booking);
    command('appointment.create', { ...booking, id: 'cancelled', requestId: 'cancelled-create', startAt: '2030-01-01T12:00:00.000Z', endAt: '2030-01-01T13:00:00.000Z' });
    command('appointment.cancel', { id: 'cancelled', requestId: 'cancelled', expectedRevision: 1, confirmed: true });
    const retained = () => JSON.stringify(Object.fromEntries(Object.keys(historical.tables).map(name => [name, raw.query('SELECT * FROM ' + name + ' ORDER BY id').all()])));
    const definitions = () => raw.query("SELECT type,name,sql FROM sqlite_schema WHERE type IN ('table','index','trigger') AND name NOT LIKE 'sqlite_%' ORDER BY type,name").all();
    const upgrade = () => { const result = migrate(); for (const [name, schema] of Object.entries(CALENDAR_APPOINTMENT_UPDATE_ADDITIONS)) db.defineTable(name, schema); current = true; return result; };
    return { db, raw, migrate, command, query, retained, definitions, upgrade, booking, accepted, close: () => db.dispose() };
  } catch (error) { db.dispose(); throw error; }
}

test('the complete genuine015 map, migration source and operation registry retain their pinned identities', () => {
  expect(hashMigration(calendarRealm.migrations[14]!)).toBe('24ba28d0d72cc5b90ad5436c5483188bbcf9ee637fdf08ea7fe3990d5ab528b4');
  expect(hashSchemaSnapshot(snapshotDeclaredTables(CALENDAR_INTEGRATION_OPERATOR_TABLES))).toBe('67d756b28b2671d19eeb37afda6f65c75540d83bf55ebf6514db99e5c06a8df0');
  expect(historical.fingerprint).toBe('sha256:c49625860fd495b46bfa2e614e40b7283eb8312b41114eef5e7b4cb1cd98f603');
  expect(calendarRealm.version).toBe('16'); expect(calendarRealm.migrations[15]!.version).toBe('016');
});

test('native015 upgrade creates/validates016 tables itself and backfills only exact derived sets, including cancelled records', () => {
  const f = fixture();
  try {
    const before = f.retained(), definitions = f.definitions(), sequence = f.db.currentSeq;
    expect(f.raw.query("SELECT name FROM sqlite_schema WHERE name=?").get(CURRENT)).toBeNull();
    expect(f.upgrade()).toEqual(['016']); expect(f.retained()).toBe(before); expect(f.db.currentSeq).toBe(sequence);
    for (const definition of definitions as { type: string; name: string; sql: string }[]) expect(f.raw.query('SELECT type,name,sql FROM sqlite_schema WHERE type=? AND name=?').get(definition.type, definition.name)).toEqual(definition);
    expect(f.db.list(HISTORY)).toEqual([]); expect(f.db.list(CURRENT)).toHaveLength(2); expect(f.db.get(STATE, 'application')!.version).toBe(16);
    expect(f.query('appointment', { id: 'cancelled' }).resourceIds).toEqual(['old']);
    expect(f.command('appointment.create', f.booking)).toEqual(f.accepted);
    f.command('appointment.update', { id: 'appointment', requestId: 'rich', expectedRevision: 1, title: 'PRIVATE_NEW', resourceIds: ['new'] });
    expect(f.query('appointment', { id: 'appointment' }).resourceIds).toEqual(['new']);
    expect(f.command('appointment.create', f.booking)).toEqual(f.accepted);
    expect(f.upgrade()).toEqual([]); expect(f.raw.query('PRAGMA foreign_key_check').all()).toEqual([]);
  } finally { f.close(); }
});

test('late016 failure rolls back new tables, rows, guards, indexes and compatibility ledger while preserving a retryable015 source', () => {
  const f = fixture();
  try {
    const before = f.retained(), definitions = f.definitions(), ledger = f.raw.query('SELECT * FROM _migrations ORDER BY version').all(), sequence = f.db.currentSeq;
    const migration = calendarRealm.migrations[15]!;
    const failing = [...calendarRealm.migrations.slice(0, 15), { ...migration, up(database: Parameters<typeof migration.up>[0]) { migration.up(database); throw new Error('synthetic late016 failure'); } }];
    expect(() => f.migrate(failing)).toThrow('synthetic late016 failure');
    expect(f.retained()).toBe(before); expect(f.definitions()).toEqual(definitions); expect(f.db.currentSeq).toBe(sequence);
    expect(f.raw.query('SELECT * FROM _migrations ORDER BY version').all()).toEqual(ledger);
    expect(f.raw.query("SELECT name FROM sqlite_schema WHERE name IN (?,?,?)").all(CURRENT, HISTORY, STATE)).toEqual([]);
    expect(f.upgrade()).toEqual(['016']);
  } finally { f.close(); }
});

test('pre-existing malformed016 table shape is rejected without repairing it or rewriting any retained015 data', () => {
  const f = fixture();
  try {
    f.raw.run(`CREATE TABLE ${CURRENT}(id TEXT PRIMARY KEY)`);
    const before = f.retained(), definitions = f.definitions();
    expect(() => f.migrate()).toThrow(); expect(f.retained()).toBe(before); expect(f.definitions()).toEqual(definitions);
    expect(f.raw.query("SELECT name FROM sqlite_schema WHERE name IN (?,?)").all(HISTORY, STATE)).toEqual([]);
  } finally { f.close(); }
});

test('warm reads cannot fall back to retained historical resources after ALL016 projection/state tables disappear', () => {
  const f = fixture();
  try {
    f.upgrade(); f.command('appointment.update', { id: 'appointment', requestId: 'rich', expectedRevision: 1, resourceIds: ['new'] });
    for (const table of [CURRENT, HISTORY, STATE]) f.raw.run('DROP TABLE ' + table);
    const before = f.raw.serialize();
    for (const name of ['appointment', 'appointmentTransitions']) {
      try { f.query(name, { id: 'appointment' }); throw new Error('missing016 projection accepted'); }
      catch (error) { expect(readCalendarRejection(error)?.code).toBe('CALENDAR_STATE_INVALID'); }
    }
    expect(f.raw.serialize()).toEqual(before);
    expect(f.raw.query("SELECT name FROM sqlite_schema WHERE name IN (?,?,?)").all(CURRENT, HISTORY, STATE)).toEqual([]);
  } finally { f.close(); }
});
