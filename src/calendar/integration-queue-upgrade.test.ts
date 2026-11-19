/** Genuine populated 012 -> additive 013 with strict native SQLite MEMORY and no backup/output files. */
import { expect, test } from 'bun:test';
import { runDatabaseRealmCommand } from '../databases/database-realm';
import type { DatabaseSerializableValue } from '../databases/database-operations';
import { Migrator } from '../migrations/migrator';
import { hashMigration, hashSchemaSnapshot, snapshotDeclaredTables } from '../migrations/schema-snapshot';
import { createReactiveDB } from '../sync/reactive-db';
import { CALENDAR_INTEGRATION_CONTROL_TABLES } from './realm-integration-controls-migration';
import { CALENDAR_INTEGRATION_QUEUE_ADDITIONS, CALENDAR_INTEGRATION_QUEUE_TABLES } from './realm-integration-queue-migration';
import { CALENDAR_INTEGRATION_INSPECTION_TABLES } from './realm-integration-inspection-migration';
import { calendarRealm } from './realm';
import { calendarHash } from './validation';

// Recorded from the committed 012 source before adding 013, not recomputed from a replacement.
const ORIGINAL_012_CHECKSUM = '8b71d49213fce98e2d289eca7a67e5895bd6747ce12bda9760d3d7d293995e42';
const ORIGINAL_012_TABLES = '3fe17c27bd4b6f2eda34e8f1f8bb43058d8779766248ab316111917c1d44f581';

function fixture() {
  const db = createReactiveDB({ mode: 'memory' });
  try {
    const raw = db.getRawDatabase(); raw.run('PRAGMA temp_store=MEMORY'); raw.run('PRAGMA foreign_keys=ON');
    for (const [name, schema] of Object.entries(CALENDAR_INTEGRATION_CONTROL_TABLES)) db.defineTable(name, schema);
    const historical = new Migrator({ database: raw, dbPath: ':memory:', migrations: calendarRealm.migrations.slice(0, 12), createBackups: false, log() {} });
    try { expect(historical.run()).toHaveLength(12); } finally { historical.dispose(); }
    const owner = { scopeId: 'application', expectedOwnerId: 'synthetic-queue-upgrade-owner' };
    runDatabaseRealmCommand(calendarRealm, db, 'calendar.owner.bind', { scopeId: owner.scopeId, ownerId: owner.expectedOwnerId });
    const policy = { ruleId: 'observe', ruleVersion: '1', adapter: 'observation-v1', dueOffsetMs: 0, maxLatenessMs: 60_000,
      source: { identity: { domain: 'calendar.observe', databaseId: 'calendar:' + calendarHash(owner.scopeId), ownerId: owner.expectedOwnerId, scopeId: owner.scopeId, rootHash: '1'.repeat(64) },
        realmFingerprint: 'sha256:' + '4'.repeat(64), policyVersion: 'historical-012', semanticsVersion: 'observation-v1', definition: { name: 'calendar.observe', version: '1', fingerprint: '2'.repeat(64) },
        workflow: { name: 'calendar.observe', version: 1, definitionId: 'definition', versionId: 'version', fingerprint: '3'.repeat(64) } } };
    const command = (name: string, body: Record<string, unknown>): any => (runDatabaseRealmCommand(calendarRealm, db, 'calendar.integration.' + name,
      { ...owner, requestId: 'synthetic-' + name, ...body } as DatabaseSerializableValue) as any).value;
    command('policy.install', { policy, expectedEpoch: 0, now: 10 });
    const control = command('control.prepare', { ruleId: 'observe', epoch: 1, action: 'activate', expectedRegistration: null });
    command('control.fail', { id: control.id, code: 'JOBS_OUTCOME_UNKNOWN', now: Date.now(), retryAt: Date.now() + 10_000 });
    const rows = () => Object.fromEntries(Object.keys(CALENDAR_INTEGRATION_CONTROL_TABLES).map(name => [name, raw.query('SELECT * FROM ' + name + ' ORDER BY id').all()]));
    const definitions = () => raw.query("SELECT type,name,sql FROM sqlite_master WHERE type IN ('table','index','trigger') AND name NOT LIKE 'sqlite_%' ORDER BY type,name").all();
    const define = () => { for (const [name, schema] of Object.entries(CALENDAR_INTEGRATION_QUEUE_ADDITIONS)) db.defineTable(name, schema); };
    const upgrade = () => {
      define(); const migrator = new Migrator({ database: raw, dbPath: ':memory:', migrations: calendarRealm.migrations.slice(0, 13), createBackups: false, log() {} });
      try { const applied = migrator.run(); expect(migrator.status().every(row => row.checksumMatches)).toBe(true); return applied; } finally { migrator.dispose(); }
    };
    return { db, raw, owner, rows, definitions, define, upgrade, close: () => db.dispose() };
  } catch (error) { db.dispose(); throw error; }
}

test('013 preserves the actual 012 closure/checksum and complete frozen historical declarations', () => {
  expect(hashMigration(calendarRealm.migrations[11]!)).toBe(ORIGINAL_012_CHECKSUM);
  expect(calendarRealm.migrationChecksums[11]).toEqual({ version: '012', checksum: ORIGINAL_012_CHECKSUM });
  expect(hashSchemaSnapshot(snapshotDeclaredTables(CALENDAR_INTEGRATION_CONTROL_TABLES))).toBe(ORIGINAL_012_TABLES);
  expect(calendarRealm.version).toBe('14'); expect(calendarRealm.migrations[12]?.version).toBe('013');
  expect(calendarRealm.tables).toEqual(CALENDAR_INTEGRATION_INSPECTION_TABLES);
  for (const [name, schema] of Object.entries(CALENDAR_INTEGRATION_CONTROL_TABLES)) expect(calendarRealm.tables[name]).toEqual(schema);
  expect(Object.isFrozen(CALENDAR_INTEGRATION_QUEUE_ADDITIONS)).toBe(true); expect(Object.isFrozen(CALENDAR_INTEGRATION_QUEUE_TABLES)).toBe(true);
});

test('populated 012 upgrade retains exact evidence/guards/ledger/sequence without fabricated fairness history', () => {
  const f = fixture(); try {
    const rows = f.rows(), definitions = f.definitions(), sequence = f.db.currentSeq, ledger = f.raw.query('SELECT * FROM _migrations ORDER BY version').all();
    expect(f.upgrade()).toEqual(['013']); expect(f.rows()).toEqual(rows); expect(f.db.currentSeq).toBe(sequence);
    expect(f.raw.query("SELECT * FROM _migrations WHERE version<='012' ORDER BY version").all()).toEqual(ledger);
    for (const definition of definitions as { type: string; name: string; sql: string }[]) expect(f.raw.query('SELECT type,name,sql FROM sqlite_master WHERE type=? AND name=?').get(definition.type, definition.name)).toEqual(definition);
    expect(f.raw.query('SELECT * FROM _calendar_integration_queue_cursor').all()).toEqual([]);
    expect(f.upgrade()).toEqual([]); expect(f.raw.query('PRAGMA foreign_key_check').all()).toEqual([]);
  } finally { f.close(); }
});

test('late 013 failure rolls back all new guards and ledger without changing retained 012 evidence', () => {
  const f = fixture(); try {
    f.define(); const rows = f.rows(), definitions = f.definitions(), sequence = f.db.currentSeq, ledger = f.raw.query('SELECT * FROM _migrations ORDER BY version').all();
    const migration = calendarRealm.migrations[12]!;
    const failing = new Migrator({ database: f.raw, dbPath: ':memory:', createBackups: false, log() {}, migrations: [
      ...calendarRealm.migrations.slice(0, 12), { ...migration, up(database) { migration.up(database); throw new Error('Synthetic late queue migration failure.'); } },
    ] });
    try { expect(() => failing.run()).toThrow('Synthetic late queue migration failure.'); } finally { failing.dispose(); }
    expect(f.rows()).toEqual(rows); expect(f.definitions()).toEqual(definitions); expect(f.db.currentSeq).toBe(sequence);
    expect(f.raw.query('SELECT * FROM _migrations ORDER BY version').all()).toEqual(ledger);
    expect(f.raw.query('SELECT * FROM _calendar_integration_queue_cursor').all()).toEqual([]); expect(f.upgrade()).toEqual(['013']);
  } finally { f.close(); }
});

test('cursor is a bounded owner-scope singleton with immutable identity, retention and no-replace enforcement', () => {
  const f = fixture(); try {
    f.upgrade(); f.raw.run('PRAGMA recursive_triggers=OFF');
    expect(() => f.db.createStrict('_calendar_integration_queue_cursor', { id: 'dispatch', scope_id: 'wrong-scope', next_class: 0 })).toThrow();
    expect(() => f.db.createStrict('_calendar_integration_queue_cursor', { id: 'other', scope_id: f.owner.scopeId, next_class: 0 })).toThrow();
    expect(() => f.db.createStrict('_calendar_integration_queue_cursor', { id: 'dispatch', scope_id: f.owner.scopeId, next_class: 3 })).toThrow();
    expect(() => f.db.createStrict('_calendar_integration_queue_cursor', { id: 'dispatch', scope_id: f.owner.scopeId, next_class: 1.5 })).toThrow();
    f.db.createStrict('_calendar_integration_queue_cursor', { id: 'dispatch', scope_id: f.owner.scopeId, next_class: 0 });
    expect(() => f.raw.run('INSERT OR REPLACE INTO _calendar_integration_queue_cursor SELECT * FROM _calendar_integration_queue_cursor')).toThrow();
    expect(() => f.raw.run("UPDATE _calendar_integration_queue_cursor SET scope_id='wrong-scope'")).toThrow();
    expect(() => f.raw.run('DELETE FROM _calendar_integration_queue_cursor')).toThrow();
    f.db.update('_calendar_integration_queue_cursor', 'dispatch', { next_class: 2 }); expect(f.db.get('_calendar_integration_queue_cursor', 'dispatch')?.next_class).toBe(2);
  } finally { f.close(); }
});
