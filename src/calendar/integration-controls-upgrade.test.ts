/** Genuine 011 schema/ledger -> additive 012, entirely native SQLite MEMORY. */
import { expect, test } from 'bun:test';
import { defineDatabaseRealm } from '../databases/database-realm';
import { Migrator } from '../migrations/migrator';
import { hashMigration, hashSchemaSnapshot, snapshotDeclaredTables } from '../migrations/schema-snapshot';
import { createReactiveDB } from '../sync/reactive-db';
import { jobSourceId } from '../jobs/source-model';
import { calendarRealm } from './realm';
import { CALENDAR_INTEGRATION_OWNERSHIP_TABLES } from './realm-integration-ownership-migration';
import { CALENDAR_INTEGRATION_CONTROL_ADDITIONS, CALENDAR_INTEGRATION_CONTROL_TABLES } from './realm-integration-controls-migration';
import { CALENDAR_INTEGRATION_INSPECTION_TABLES } from './realm-integration-inspection-migration';
import { calendarHash, calendarJson } from './validation';

const ORIGINAL_011_CHECKSUM = '973644331b5d77442e142596ed1fda02d987c9abe7b72a83050471ef07de4707';
const ORIGINAL_011_TABLES = 'df10f32ada83b3f8bcf387f25beaf7fb1acb99801ec0af16b8c2f4ffe07c22fe';
const historicalRealm = defineDatabaseRealm({ name: calendarRealm.name, version: '11', tables: CALENDAR_INTEGRATION_OWNERSHIP_TABLES,
  migrations: calendarRealm.migrations.slice(0, 11), commands: Object.fromEntries(Object.entries(calendarRealm.commands).filter(([name]) => !name.startsWith('calendar.integration.control'))),
  queries: Object.fromEntries(Object.entries(calendarRealm.queries).filter(([name]) => !name.startsWith('calendar.integration.control'))) });

function fixture() {
  const db = createReactiveDB({ mode: 'memory' });
  try {
    const raw = db.getRawDatabase(); raw.run('PRAGMA temp_store=MEMORY'); raw.run('PRAGMA foreign_keys=ON');
    for (const [name, schema] of Object.entries(CALENDAR_INTEGRATION_OWNERSHIP_TABLES)) db.defineTable(name, schema);
    const historical = new Migrator({ database: raw, dbPath: ':memory:', migrations: calendarRealm.migrations.slice(0, 11), createBackups: false, log() {} });
    try { expect(historical.run()).toHaveLength(11); } finally { historical.dispose(); }
    const scope = 'application', ownerId = 'synthetic-journal-upgrade-owner';
    db.createStrict('_calendar_owner', { id: 'application', scope_id: scope, owner_id: ownerId });
    const seed = (ruleId: string, registered = true, retired = false) => {
      const source = { identity: { domain: 'calendar.' + ruleId, databaseId: 'calendar:' + calendarHash(scope), ownerId, scopeId: scope, rootHash: '1'.repeat(64) },
        realmFingerprint: historicalRealm.fingerprint, policyVersion: 'historical-A', semanticsVersion: 'observation-v1', definition: { name: 'calendar.observe', version: '1', fingerprint: '2'.repeat(64) },
        workflow: { name: 'calendar.observe', version: 1, definitionId: 'definition', versionId: 'version', fingerprint: '3'.repeat(64) } };
      const policy = { ruleId, ruleVersion: '1', adapter: 'observation-v1', source, dueOffsetMs: 0, maxLatenessMs: 60_000 }, sourceId = jobSourceId(source.identity), id = calendarHash([scope, ruleId, 1]);
      db.createStrict('_calendar_integration_rule_sources', { id: ruleId, scope_id: scope, rule_id: ruleId, source_id: sourceId });
      db.createStrict('_calendar_integration_policy_history', { id, scope_id: scope, rule_id: ruleId, epoch: 1, request_id: 'historical-' + ruleId, digest: calendarHash(policy),
        policy_json: calendarJson(policy), source_id: sourceId, source_policy_hash: calendarHash(source), created_ms: 1 });
      db.createStrict('_calendar_integration_policy_current', { id: ruleId, scope_id: scope, rule_id: ruleId, policy_id: id, epoch: 1, state: 'activating', registration_json: null });
      if (registered) {
        const registration = calendarJson({ id: sourceId, generation: 1, revision: 1, state: 'active', policyHash: calendarHash(source) });
        db.createStrict('_calendar_integration_policy_registrations', { id, scope_id: scope, policy_id: id, registration_json: registration });
        db.update('_calendar_integration_policy_current', ruleId, { state: 'active', registration_json: registration });
      }
      if (retired) db.update('_calendar_integration_policy_current', ruleId, { state: 'retired' });
      return { id, sourceId, ruleId };
    };
    const rows = () => Object.fromEntries(Object.keys(CALENDAR_INTEGRATION_OWNERSHIP_TABLES).map(name => [name, raw.query('SELECT * FROM ' + name + ' ORDER BY id').all()]));
    const definitions = () => raw.query("SELECT type,name,sql FROM sqlite_master WHERE type IN ('table','index','trigger') AND name NOT LIKE 'sqlite_%' ORDER BY type,name").all();
    const define = () => { for (const [name, schema] of Object.entries(CALENDAR_INTEGRATION_CONTROL_ADDITIONS)) db.defineTable(name, schema); };
    const upgrade = () => {
      define(); const migrator = new Migrator({ database: raw, dbPath: ':memory:', migrations: calendarRealm.migrations.slice(0, 12), createBackups: false, log() {} });
      try { const applied = migrator.run(); expect(migrator.status().every(row => row.checksumMatches)).toBe(true); return applied; } finally { migrator.dispose(); }
    };
    return { db, raw, scope, seed, rows, definitions, define, upgrade, close: () => db.dispose() };
  } catch (error) { db.dispose(); throw error; }
}

test('012 preserves committed 011 migration/map identity and declares separate frozen journal/marker additions', () => {
  expect(hashMigration(calendarRealm.migrations[10]!)).toBe(ORIGINAL_011_CHECKSUM);
  expect(calendarRealm.migrationChecksums[10]).toEqual({ version: '011', checksum: ORIGINAL_011_CHECKSUM });
  expect(hashSchemaSnapshot(snapshotDeclaredTables(CALENDAR_INTEGRATION_OWNERSHIP_TABLES))).toBe(ORIGINAL_011_TABLES);
  expect(calendarRealm.version).toBe('14'); expect(calendarRealm.migrations[11]?.version).toBe('012');
  expect(calendarRealm.tables).toEqual(CALENDAR_INTEGRATION_INSPECTION_TABLES);
  for (const [name, schema] of Object.entries(CALENDAR_INTEGRATION_OWNERSHIP_TABLES)) expect(calendarRealm.tables[name]).toEqual(schema);
  expect(Object.isFrozen(CALENDAR_INTEGRATION_CONTROL_ADDITIONS)).toBe(true); expect(Object.isFrozen(CALENDAR_INTEGRATION_CONTROL_TABLES)).toBe(true);
});

test('populated 011 upgrade retains all evidence, ledger and source sequence while backfilling only proven registered-source presence', () => {
  const f = fixture(); try {
    const active = f.seed('active'), retired = f.seed('retired', true, true); f.seed('never-registered', false, true);
    const rows = f.rows(), definitions = f.definitions(), sequence = f.db.currentSeq, ledger = f.raw.query('SELECT * FROM _migrations ORDER BY version').all();
    expect(f.upgrade()).toEqual(['012']); expect(f.rows()).toEqual(rows); expect(f.db.currentSeq).toBe(sequence);
    expect(f.raw.query("SELECT * FROM _migrations WHERE version<='011' ORDER BY version").all()).toEqual(ledger);
    for (const definition of definitions as { type: string; name: string; sql: string }[]) {
      if (definition.name === 'calendar_integration_registration_parent') continue; // Explicitly extended, not silently retained unchanged.
      expect(f.raw.query('SELECT type,name,sql FROM sqlite_master WHERE type=? AND name=?').get(definition.type, definition.name)).toEqual(definition);
    }
    expect(f.raw.query('SELECT * FROM _calendar_integration_registered_sources ORDER BY rule_id').all()).toEqual([active, retired].map(row => ({ id: row.sourceId, scope_id: f.scope, rule_id: row.ruleId })));
    for (const table of ['_calendar_integration_controls', '_calendar_integration_control_results', '_calendar_integration_control_attempts']) expect(f.raw.query('SELECT * FROM ' + table).all()).toEqual([]);
    expect(f.upgrade()).toEqual([]); expect(f.raw.query('PRAGMA foreign_key_check').all()).toEqual([]);
  } finally { f.close(); }
});

test('late 012 failure rolls back backfill, result guards and registration-guard extension without losing recoverable 011 history', () => {
  const f = fixture(); try {
    f.seed('active'); f.define(); const rows = f.rows(), definitions = f.definitions(), sequence = f.db.currentSeq, ledger = f.raw.query('SELECT * FROM _migrations ORDER BY version').all();
    const migration = calendarRealm.migrations[11]!;
    const failing = new Migrator({ database: f.raw, dbPath: ':memory:', createBackups: false, log() {}, migrations: [
      ...calendarRealm.migrations.slice(0, 11), { ...migration, up(database) { migration.up(database); throw new Error('Synthetic late control-journal failure.'); } },
    ] });
    try { expect(() => failing.run()).toThrow('Synthetic late control-journal failure.'); } finally { failing.dispose(); }
    expect(f.rows()).toEqual(rows); expect(f.definitions()).toEqual(definitions); expect(f.db.currentSeq).toBe(sequence);
    expect(f.raw.query('SELECT * FROM _migrations ORDER BY version').all()).toEqual(ledger);
    for (const table of Object.keys(CALENDAR_INTEGRATION_CONTROL_ADDITIONS)) expect(f.raw.query('SELECT * FROM ' + table).all()).toEqual([]);
    expect(f.upgrade()).toEqual(['012']);
  } finally { f.close(); }
});

test('unexpected retained registration guard is not overwritten under the guise of a journal upgrade', () => {
  const f = fixture(); try {
    f.seed('active'); f.define();
    f.raw.run('DROP TRIGGER calendar_integration_registration_parent');
    f.raw.run("CREATE TRIGGER calendar_integration_registration_parent BEFORE INSERT ON _calendar_integration_policy_registrations BEGIN SELECT RAISE(ABORT,'synthetic unexpected guard'); END");
    const rows = f.rows(), definitions = f.definitions(), ledger = f.raw.query('SELECT * FROM _migrations ORDER BY version').all();
    expect(() => f.upgrade()).toThrow('unexpected historical registration guard');
    expect(f.rows()).toEqual(rows); expect(f.definitions()).toEqual(definitions); expect(f.raw.query('SELECT * FROM _migrations ORDER BY version').all()).toEqual(ledger);
  } finally { f.close(); }
});
