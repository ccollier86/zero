/** Actual populated 009 storage -> additive 010. Native memory only, no compatibility scaffold. */
import { expect, test } from 'bun:test';
import { Migrator } from '../migrations/migrator';
import { hashMigration, hashSchemaSnapshot, snapshotDeclaredTables } from '../migrations/schema-snapshot';
import { createReactiveDB } from '../sync/reactive-db';
import { calendarRealm } from './realm';
import { CALENDAR_AVAILABILITY_POLICY_TABLES } from './realm-working-hours-migration';
import { CALENDAR_INTEGRATION_ADDITIONS, CALENDAR_INTEGRATION_TABLES } from './realm-integrations-migration';
import { calendarHash, calendarJson } from './validation';

// Recorded from actual ff2a05a before the 010 source edit, not grandfathered
// from replacement functions or recomputed from a mutable current declaration.
const ORIGINAL_009_CHECKSUMS = [
  '7a486bf60585cb5e00f86077021d2d142dab9290774828c077abbf03d3aba795',
  '772ccecce42312e46519265f681aa023312592e4ca6bcfdfda605499dc3edd6f',
  'de17b910d8dce95f6292dcc625c5cf3703527d7d3ba834477942a11603ad3e5f',
  'e04bb02ac0e2960a36dd5d4cc1147e72451c1818d24634a787cabb5ebbbd1646',
  'e77be92766070b2da02fb306de1f8694c5714b7ef173c995c198f336ca7c2a10',
  'a38cc0a9ee67b8dcba14583ed27df66fbd8c6b78010110daefac4042af53eca0',
  'e36da6d58e7345c042829228d96a50c7799c1f2b9a4c5135294718e5ff4c0681',
  '1dd8c3a24f0710f6e2e2f19304d9e0e318dd42bbb3230fa1107ee9cbe7f2eb94',
  'f9cfda1d3e4cd012282865a8637639e8a30b700cf72d3769177d56d206b3fe17',
] as const;
const ORIGINAL_009_TABLES = '0816dfae8579d82d6145c8eb45bfc115faded96d16480f36aabc8b3c1c9a81f2';
const versions = Array.from({ length: 9 }, (_, i) => String(i + 1).padStart(3, '0'));

function fixture() {
  const db = createReactiveDB({ mode: 'memory' });
  try {
    const raw = db.getRawDatabase(); raw.run('PRAGMA temp_store=MEMORY'); raw.run('PRAGMA foreign_keys=ON');
    for (const [name, schema] of Object.entries(CALENDAR_AVAILABILITY_POLICY_TABLES)) db.defineTable(name, schema);
    const historical = new Migrator({ database: raw, dbPath: ':memory:', migrations: calendarRealm.migrations.slice(0, 9), createBackups: false, log() {} });
    try { expect(historical.run()).toEqual(versions); } finally { historical.dispose(); }
    const scope = 'tenant:synthetic-integration-upgrade', principal = 'synthetic-session', owner = 'synthetic-owner';
    // Use native strict writes to the REAL historical declaration/guards. Current
    // handlers deliberately require 010 and cannot stand in for historical code.
    db.createStrict('_calendar_owner', { id: 'application', scope_id: scope, owner_id: owner });
    db.createStrict('calendar_resources', { id: 'resource', scope_id: scope, label: 'PRIVATE_RESOURCE', kind: 'person', owner_id: 'synthetic-user', time_zone: 'UTC', revision: 1, active: 1 });
    const start = Date.parse('2030-01-01T10:00:00.000Z'), end = start + 3_600_000;
    db.createStrict('calendar_appointments', { id: 'appointment', scope_id: scope, title: 'PRIVATE_TITLE', start_at: new Date(start).toISOString(), end_at: new Date(end).toISOString(),
      start_ms: start, end_ms: end, time_zone: 'UTC', buffer_before: 0, buffer_after: 0, occupied_start_ms: start, occupied_end_ms: end, status: 'confirmed', revision: 1, created_by: 'synthetic-user' });
    db.createStrict('_calendar_reservations', { id: calendarHash([scope, 'appointment', 'resource']), scope_id: scope, appointment_id: 'appointment', resource_id: 'resource', occupied_start_ms: start, occupied_end_ms: end, active: 1 });
    const effect = (key: string, target: 'resource' | 'appointment', id: string, revision: number, operation: string) => {
      const receipt = calendarHash([scope, principal, key]);
      db.createStrict('_calendar_receipts', { id: receipt, scope_id: scope, principal, request_id: key, digest: calendarHash(['synthetic-historical', key]),
        result_json: calendarJson({ requestId: key, operation, id, revision, changed: true }), target_kind: target, target_id: id, required_right: target === 'resource' ? 'manage' : 'book' });
      db.createStrict('_calendar_effect_intents', { id: receipt, scope_id: scope, receipt_id: receipt, operation, target_kind: target, target_id: id, revision });
    };
    effect('appointment-created', 'appointment', 'appointment', 1, 'appointment.created');
    db.update('calendar_resources', 'resource', { revision: 2 });
    const history = calendarHash([scope, 'resource', 2]);
    db.createStrict('_calendar_availability_policy_history', { id: history, scope_id: scope, resource_id: 'resource', resource_revision: 2, kind: 'explicit-utc-v1',
      source_json: calendarJson({ kind: 'explicit-utc-v1', mode: 'unrestricted', windows: [] }), mode: 'unrestricted', window_count: 0,
      coverage_start_ms: null, coverage_end_ms: null, engine_json: null, skipped_json: '[]' });
    db.createStrict('_calendar_availability_policy_current', { id: 'resource', scope_id: scope, resource_id: 'resource', resource_revision: 2, source_kind: 'policy', history_id: history });
    effect('availability-policy', 'resource', 'resource', 2, 'resource.availability-policy-changed');
    for (const [id, count] of [['resources', 1], ['appointments', 1], ['receipts', 2], ['availabilityPolicyHistory', 1]] as const) db.createStrict('_calendar_usage', { id, count });
    const rows = () => Object.fromEntries(Object.keys(CALENDAR_AVAILABILITY_POLICY_TABLES).map(name => [name, raw.query(`SELECT * FROM ${name} ORDER BY id`).all()]));
    const definitions = () => raw.query("SELECT type,name,sql FROM sqlite_master WHERE type IN ('table','index','trigger') AND name NOT LIKE 'sqlite_%' ORDER BY type,name").all();
    const defineAdditions = () => { for (const [name, schema] of Object.entries(CALENDAR_INTEGRATION_ADDITIONS)) db.defineTable(name, schema); };
    const upgrade = () => {
      defineAdditions();
      const migrator = new Migrator({ database: raw, dbPath: ':memory:', migrations: calendarRealm.migrations, createBackups: false, log() {} });
      try { const applied = migrator.run(); expect(migrator.status().every(row => row.checksumMatches)).toBe(true); return applied; }
      finally { migrator.dispose(); }
    };
    return { db, raw, rows, definitions, defineAdditions, upgrade, close: () => db.dispose() };
  } catch (error) { db.dispose(); throw error; }
}

test('010 preserves actual nine migration closures, registered checksums and complete 009 declarations', () => {
  expect(calendarRealm.version).toBe('10');
  expect(calendarRealm.migrations.map(m => m.version)).toEqual([...versions, '010']);
  expect(calendarRealm.migrations.slice(0, 9).map(hashMigration)).toEqual([...ORIGINAL_009_CHECKSUMS]);
  expect(calendarRealm.migrationChecksums.slice(0, 9)).toEqual(ORIGINAL_009_CHECKSUMS.map((checksum, i) => ({ version: versions[i], checksum })));
  expect(hashSchemaSnapshot(snapshotDeclaredTables(CALENDAR_AVAILABILITY_POLICY_TABLES))).toBe(ORIGINAL_009_TABLES);
  for (const [name, schema] of Object.entries(CALENDAR_AVAILABILITY_POLICY_TABLES)) expect(calendarRealm.tables[name]).toEqual(schema);
  expect(calendarRealm.tables).toEqual(CALENDAR_INTEGRATION_TABLES);
  expect(Object.isFrozen(CALENDAR_INTEGRATION_ADDITIONS)).toBe(true);
});

test('real populated 009 upgrade preserves evidence, guards, ledger and sequence with no policy/intent backfill', () => {
  const f = fixture(); try {
    for (const table of Object.keys(CALENDAR_INTEGRATION_ADDITIONS)) expect(f.raw.query("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table)).toBeNull();
    const before = f.rows(), sequence = f.db.currentSeq, ledger = f.raw.query('SELECT * FROM _migrations ORDER BY version').all(), definitions = f.definitions();
    expect(f.upgrade()).toEqual(['010']);
    expect(f.rows()).toEqual(before); expect(f.db.currentSeq).toBe(sequence);
    expect(f.raw.query("SELECT * FROM _migrations WHERE version<='009' ORDER BY version").all()).toEqual(ledger);
    for (const definition of definitions as { type: string; name: string; sql: string }[]) expect(f.raw.query('SELECT type,name,sql FROM sqlite_master WHERE type=? AND name=?').get(definition.type, definition.name)).toEqual(definition);
    for (const table of Object.keys(CALENDAR_INTEGRATION_ADDITIONS)) expect(f.raw.query(`SELECT * FROM ${table}`).all()).toEqual([]);
    expect(() => f.raw.run('UPDATE _calendar_effect_intents SET revision=revision')).toThrow();
    expect(() => f.raw.run('DELETE FROM _calendar_receipts')).toThrow();
    expect(f.upgrade()).toEqual([]); expect(f.raw.query('PRAGMA foreign_key_check').all()).toEqual([]);
  } finally { f.close(); expect(() => f.raw.query('SELECT 1').get()).toThrow(); }
});

test('a late 010 migration failure rolls back its SQL changes and ledger, retaining a recoverable original source', () => {
  const f = fixture(); try {
    f.defineAdditions();
    const rows = f.rows(), definitions = f.definitions(), sequence = f.db.currentSeq, ledger = f.raw.query('SELECT * FROM _migrations ORDER BY version').all();
    const addition = calendarRealm.migrations[9]!;
    const failing = new Migrator({ database: f.raw, dbPath: ':memory:', createBackups: false, log() {}, migrations: [
      ...calendarRealm.migrations.slice(0, 9), { ...addition, up(database) { addition.up(database); throw new Error('Synthetic late 010 migration failure.'); } },
    ] });
    try { expect(() => failing.run()).toThrow('Synthetic late 010 migration failure.'); } finally { failing.dispose(); }
    expect(f.rows()).toEqual(rows); expect(f.definitions()).toEqual(definitions); expect(f.db.currentSeq).toBe(sequence);
    expect(f.raw.query('SELECT * FROM _migrations ORDER BY version').all()).toEqual(ledger);
    expect(f.upgrade()).toEqual(['010']); expect(f.raw.query('PRAGMA foreign_key_check').all()).toEqual([]);
  } finally { f.close(); }
});
