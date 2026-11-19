/** Genuine populated 014 -> additive015 in native SQLite MEMORY; no backup or output paths. */
import { expect, test } from 'bun:test';
import { Migrator } from '../migrations/migrator';
import { hashMigration, hashSchemaSnapshot, snapshotDeclaredTables } from '../migrations/schema-snapshot';
import { calendarRealm016 as calendarRealm } from './test-support/calendar-realm-016';
import { CALENDAR_APPOINTMENT_UPDATE_TABLES } from './realm-appointment-update-migration';
import { CALENDAR_INTEGRATION_INSPECTION_TABLES } from './realm-integration-inspection-migration';
import { CALENDAR_INTEGRATION_OPERATOR_ADDITIONS, CALENDAR_INTEGRATION_OPERATOR_TABLES } from './realm-integration-operator-migration';
import { calendarOperatorHistoricalRealm } from './test-support/integration-inspection-fixture';
import { calendarOperatorRequestFixture } from './test-support/integration-operator-request-fixture';

const ORIGINAL_014_CHECKSUM = 'bf3c1f6718bf15a8a0d1686d0ad3ef920d0477730faae5943d182861dcd5b945';
const ORIGINAL_014_TABLES = 'a2f91077414b0a49d44a69e5c8e8f96fbccaf03e224542c5290bdc447f7dcb83';
const ORIGINAL_014_REALM = 'sha256:642282673e4e569527bd1d85a6946bd289baf5a4af366d95bb82394b6739e650';
function fixture() {
  const f = calendarOperatorRequestFixture({ historical: '014' });
  try {
    f.install(); const intent = f.appointment(); f.admit(intent);
    const rows = () => Object.fromEntries(Object.keys(CALENDAR_INTEGRATION_INSPECTION_TABLES).map(name => [name, f.raw.query('SELECT * FROM ' + name + ' ORDER BY id').all()]));
    const definitions = () => f.raw.query("SELECT type,name,sql FROM sqlite_master WHERE type IN ('table','index','trigger') AND name NOT LIKE 'sqlite_%' ORDER BY type,name").all();
    const define = () => { for (const [name, schema] of Object.entries(CALENDAR_INTEGRATION_OPERATOR_ADDITIONS)) f.db.defineTable(name, schema); };
    const upgrade = () => {
      define(); const migrator = new Migrator({ database: f.raw, dbPath: ':memory:', migrations: calendarRealm.migrations, createBackups: false, log() {} });
      try { const applied = migrator.run(); expect(migrator.status().every(row => row.checksumMatches)).toBe(true); return applied; } finally { migrator.dispose(); }
    };
    return { ...f, retainedRows: rows, definitions, define, upgrade };
  } catch (error) { f.close(); throw error; }
}

test('015 preserves the actual014 closure/checksum, complete frozen map and original command/query registry fingerprint', () => {
  expect(calendarRealm.version).toBe('16'); expect(calendarRealm.migrations[14]?.version).toBe('015');
  expect(hashMigration(calendarRealm.migrations[13]!)).toBe(ORIGINAL_014_CHECKSUM);
  expect(calendarRealm.migrationChecksums[13]).toEqual({ version: '014', checksum: ORIGINAL_014_CHECKSUM });
  expect(hashSchemaSnapshot(snapshotDeclaredTables(CALENDAR_INTEGRATION_INSPECTION_TABLES))).toBe(ORIGINAL_014_TABLES);
  expect(calendarOperatorHistoricalRealm.fingerprint).toBe(ORIGINAL_014_REALM); expect(Object.keys(calendarOperatorHistoricalRealm.commands)).toHaveLength(35); expect(Object.keys(calendarOperatorHistoricalRealm.queries)).toHaveLength(34);
  expect(calendarRealm.tables).toEqual(CALENDAR_APPOINTMENT_UPDATE_TABLES);
  for (const [name, schema] of Object.entries(CALENDAR_INTEGRATION_INSPECTION_TABLES)) expect(calendarRealm.tables[name]).toEqual(schema);
  expect(Object.isFrozen(CALENDAR_INTEGRATION_OPERATOR_ADDITIONS)).toBe(true); expect(Object.isFrozen(CALENDAR_INTEGRATION_OPERATOR_TABLES)).toBe(true);
  for (const schema of Object.values(CALENDAR_INTEGRATION_OPERATOR_ADDITIONS)) expect(Object.isFrozen(schema)).toBe(true);
});

test('populated014 upgrade preserves all source/admission/pending/control evidence, guards, ledger and sequence without human receipt backfill', () => {
  const f = fixture(); try {
    const before = f.retainedRows(), definitions = f.definitions(), ledger = f.raw.query('SELECT * FROM _migrations ORDER BY version').all(), sequence = f.db.currentSeq;
    expect(f.upgrade()).toEqual(['015', '016']); expect(f.retainedRows()).toEqual(before); expect(f.db.currentSeq).toBe(sequence);
    expect(f.raw.query("SELECT * FROM _migrations WHERE version<='014' ORDER BY version").all()).toEqual(ledger);
    for (const definition of definitions as { type: string; name: string; sql: string }[]) expect(f.raw.query('SELECT type,name,sql FROM sqlite_master WHERE type=? AND name=?').get(definition.type, definition.name)).toEqual(definition);
    expect(f.rows('operator_requests')).toEqual([]); expect(f.db.get('_calendar_usage', 'integrationOperatorRetirements')).toBeNull();
    expect(f.upgrade()).toEqual([]); expect(f.raw.query('PRAGMA foreign_key_check').all()).toEqual([]);
    expect(f.retire().localState).toBe('retired'); expect(f.rows('pending_effects')).toHaveLength(1);
  } finally { f.close(); }
});

test('late015 failure rolls back every new cross-store guard/index and ledger while preserving a retryable014 source', () => {
  const f = fixture(); try {
    f.define(); const before = f.retainedRows(), definitions = f.definitions(), ledger = f.raw.query('SELECT * FROM _migrations ORDER BY version').all(), sequence = f.db.currentSeq;
    const migration = calendarRealm.migrations[14]!;
    const failing = new Migrator({ database: f.raw, dbPath: ':memory:', createBackups: false, log() {}, migrations: [
      ...calendarRealm.migrations.slice(0, 14), { ...migration, up(database) { migration.up(database); throw new Error('synthetic late operator migration failure'); } },
    ] });
    try { expect(() => failing.run()).toThrow('synthetic late operator migration failure'); } finally { failing.dispose(); }
    expect(f.retainedRows()).toEqual(before); expect(f.definitions()).toEqual(definitions); expect(f.db.currentSeq).toBe(sequence);
    expect(f.raw.query('SELECT * FROM _migrations ORDER BY version').all()).toEqual(ledger); expect(f.rows('operator_requests')).toEqual([]); expect(f.upgrade()).toEqual(['015', '016']);
  } finally { f.close(); }
});
