/** Populated genuine 013 -> 014 in strict native SQLite MEMORY. No physical fixture or migration backup. */
import { expect, test } from 'bun:test';
import { Migrator } from '../migrations/migrator';
import { hashMigration, hashSchemaSnapshot, snapshotDeclaredTables } from '../migrations/schema-snapshot';
import { calendarRealm } from './realm';
import { CALENDAR_INTEGRATION_QUEUE_TABLES } from './realm-integration-queue-migration';
import { CALENDAR_INTEGRATION_INSPECTION_ADDITIONS, CALENDAR_INTEGRATION_INSPECTION_TABLES } from './realm-integration-inspection-migration';
import { calendarInspectionFixture, calendarInspectionHistoricalRealm } from './test-support/integration-inspection-fixture';

// Pinned original bb45e01 source closures and complete 013 declarations, not replacement functions/maps.
const ORIGINAL_013_CHECKSUMS = [
  '7a486bf60585cb5e00f86077021d2d142dab9290774828c077abbf03d3aba795',
  '772ccecce42312e46519265f681aa023312592e4ca6bcfdfda605499dc3edd6f',
  'de17b910d8dce95f6292dcc625c5cf3703527d7d3ba834477942a11603ad3e5f',
  'e04bb02ac0e2960a36dd5d4cc1147e72451c1818d24634a787cabb5ebbbd1646',
  'e77be92766070b2da02fb306de1f8694c5714b7ef173c995c198f336ca7c2a10',
  'a38cc0a9ee67b8dcba14583ed27df66fbd8c6b78010110daefac4042af53eca0',
  'e36da6d58e7345c042829228d96a50c7799c1f2b9a4c5135294718e5ff4c0681',
  '1dd8c3a24f0710f6e2e2f19304d9e0e318dd42bbb3230fa1107ee9cbe7f2eb94',
  'f9cfda1d3e4cd012282865a8637639e8a30b700cf72d3769177d56d206b3fe17',
  '5a53a35f77b17cc698bbc21f2744be8f14cc2fd6da29e1df44ff225a1dc9cbb3',
  '973644331b5d77442e142596ed1fda02d987c9abe7b72a83050471ef07de4707',
  '8b71d49213fce98e2d289eca7a67e5895bd6747ce12bda9760d3d7d293995e42',
  '0fa8a49cbbbf0881608d6b1aafbb1900a218ac73a4b7ee95ac7367ef0c8ef448',
] as const;
const ORIGINAL_013_TABLES = 'e18f7613d8eeee600bae966a25e3597ed6ba5c75686d49520d697c66357f9d6a';

function fixture() {
  const f = calendarInspectionFixture({ historical: true });
  try {
    f.install(); const pending = f.appointment('pending'); f.admit(pending);
    const settled = f.appointment('settled', 180_000); f.setNow(f.now + 180_000); f.admit(settled); f.settle(settled);
    const later = f.appointment('later', 360_000); f.setNow(f.now + 360_000); f.admit(later);
    f.install('observe', 'B', 1, false);
    f.integration('control.prepare', { ruleId: 'observe', epoch: 2, action: 'activate', expectedRegistration: f.registration() });
    const rows = () => Object.fromEntries(Object.keys(CALENDAR_INTEGRATION_QUEUE_TABLES).map(name => [name, f.raw.query('SELECT * FROM ' + name + ' ORDER BY id').all()]));
    const definitions = () => f.raw.query("SELECT type,name,sql FROM sqlite_master WHERE type IN ('table','index','trigger') AND name NOT LIKE 'sqlite_%' ORDER BY type,name").all();
    return { ...f, pending, settled, later, retainedRows: rows, definitions };
  } catch (error) { f.close(); throw error; }
}

test('014 preserves all thirteen recorded closures/checksums and frozen complete 013 declarations', () => {
  const versions = Array.from({ length: 13 }, (_, i) => String(i + 1).padStart(3, '0'));
  expect(calendarRealm.version).toBe('14'); expect(calendarRealm.migrations.map(row => row.version)).toEqual([...versions, '014']);
  expect(calendarRealm.migrations.slice(0, 13).map(hashMigration)).toEqual([...ORIGINAL_013_CHECKSUMS]);
  expect(calendarRealm.migrationChecksums.slice(0, 13)).toEqual(ORIGINAL_013_CHECKSUMS.map((checksum, i) => ({ version: versions[i], checksum })));
  expect(hashSchemaSnapshot(snapshotDeclaredTables(CALENDAR_INTEGRATION_QUEUE_TABLES))).toBe(ORIGINAL_013_TABLES);
  expect(calendarInspectionHistoricalRealm.fingerprint).not.toBe(calendarRealm.fingerprint);
  expect(calendarRealm.tables).toEqual(CALENDAR_INTEGRATION_INSPECTION_TABLES);
  for (const [name, schema] of Object.entries(CALENDAR_INTEGRATION_QUEUE_TABLES)) expect(calendarRealm.tables[name]).toEqual(schema);
  expect(Object.isFrozen(CALENDAR_INTEGRATION_INSPECTION_ADDITIONS)).toBe(true); expect(Object.isFrozen(CALENDAR_INTEGRATION_INSPECTION_TABLES)).toBe(true);
  for (const schema of Object.values(CALENDAR_INTEGRATION_INSPECTION_ADDITIONS)) expect(Object.isFrozen(schema)).toBe(true);
});

test('populated 013 migration backfills only admitted-but-unsettled presence once and preserves every historical row/guard/ledger/sequence', () => {
  const f = fixture(); try {
    const rows = f.retainedRows(), definitions = f.definitions(), sequence = f.db.currentSeq, ledger = f.raw.query('SELECT * FROM _migrations ORDER BY version').all();
    expect(f.upgrade()).toEqual(['014']); expect(f.retainedRows()).toEqual(rows); expect(f.db.currentSeq).toBe(sequence);
    expect(f.raw.query("SELECT * FROM _migrations WHERE version<='013' ORDER BY version").all()).toEqual(ledger);
    for (const definition of definitions as { type: string; name: string; sql: string }[]) expect(f.raw.query('SELECT type,name,sql FROM sqlite_master WHERE type=? AND name=?').get(definition.type, definition.name)).toEqual(definition);
    expect(f.rows('pending_effects')).toEqual([f.pending, f.later].sort().map(id => ({ id, scope_id: f.owner.scopeId })));
    expect(f.inspect().effects.admittedButUnsettled).toBe(true); expect(f.inspect().retained.intents.used).toBe(3);
    expect(f.inspect().rules[0]).toMatchObject({ epoch: 2, state: 'activating', pendingControl: { action: 'activate', epoch: 2 } });
    expect(f.upgrade()).toEqual([]); f.settle(f.pending); expect(f.inspect().effects.admittedButUnsettled).toBe(true);
    f.settle(f.later); expect(f.inspect().effects.admittedButUnsettled).toBe(false);
    expect(f.rows('effect_admissions')).toHaveLength(3); expect(f.rows('effect_outcomes')).toHaveLength(3); expect(f.raw.query('PRAGMA foreign_key_check').all()).toEqual([]);
  } finally { f.close(); }
});

test('late 014 refusal rolls back the historical backfill and all new guards/indexes/ledger before a clean retry', () => {
  const f = fixture(); try {
    f.define(); const rows = f.retainedRows(), definitions = f.definitions(), sequence = f.db.currentSeq, ledger = f.raw.query('SELECT * FROM _migrations ORDER BY version').all();
    const migration = calendarRealm.migrations[13]!;
    const failing = new Migrator({ database: f.raw, dbPath: ':memory:', createBackups: false, log() {}, migrations: [
      ...calendarRealm.migrations.slice(0, 13), { ...migration, up(database) { migration.up(database); throw new Error('Synthetic late inspection migration refusal.'); } },
    ] });
    try { expect(() => failing.run()).toThrow('Synthetic late inspection migration refusal.'); } finally { failing.dispose(); }
    expect(f.retainedRows()).toEqual(rows); expect(f.definitions()).toEqual(definitions); expect(f.db.currentSeq).toBe(sequence);
    expect(f.raw.query('SELECT * FROM _migrations ORDER BY version').all()).toEqual(ledger); expect(f.rows('pending_effects')).toEqual([]);
    expect(f.upgrade()).toEqual(['014']); expect(f.rows('pending_effects')).toHaveLength(2);
  } finally { f.close(); }
});

test('014 refuses an unexpected pre-existing derived identity instead of silently accepting or replacing it', () => {
  const f = fixture(); try {
    f.define(); f.db.createStrict('_calendar_integration_pending_effects', { id: f.pending, scope_id: f.owner.scopeId });
    const rows = f.retainedRows(), definitions = f.definitions(), ledger = f.raw.query('SELECT * FROM _migrations ORDER BY version').all();
    expect(() => f.upgrade()).toThrow(); expect(f.retainedRows()).toEqual(rows); expect(f.definitions()).toEqual(definitions);
    expect(f.raw.query('SELECT * FROM _migrations ORDER BY version').all()).toEqual(ledger);
    expect(f.rows('pending_effects')).toEqual([{ id: f.pending, scope_id: f.owner.scopeId }]);
  } finally { f.close(); }
});
