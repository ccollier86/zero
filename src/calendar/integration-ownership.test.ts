/** Real 010 -> 011 ownership upgrade and tracked native commands; all SQLite state is MEMORY only. */
import { expect, test } from 'bun:test';
import { runDatabaseRealmCommand } from '../databases/database-realm';
import type { DatabaseSerializableValue } from '../databases/database-operations';
import { jobSourceId } from '../jobs/source-model';
import { Migrator } from '../migrations/migrator';
import { hashMigration, hashSchemaSnapshot, snapshotDeclaredTables } from '../migrations/schema-snapshot';
import { createReactiveDB } from '../sync/reactive-db';
import { readCalendarRejection, type CalendarErrorCode } from './error';
import type { CalendarIntegrationPolicySpec } from './integration-model';
import { CALENDAR_INTEGRATION_ADDITIONS, CALENDAR_INTEGRATION_TABLES } from './realm-integrations-migration';
import { CALENDAR_INTEGRATION_OWNERSHIP_ADDITIONS, CALENDAR_INTEGRATION_OWNERSHIP_TABLES } from './realm-integration-ownership-migration';
import { CALENDAR_INTEGRATION_INSPECTION_TABLES } from './realm-integration-inspection-migration';
import { calendarRealm } from './realm';
import { calendarHash, calendarJson } from './validation';

const ORIGINAL_010_CHECKSUM = '5a53a35f77b17cc698bbc21f2744be8f14cc2fd6da29e1df44ff225a1dc9cbb3';
const ORIGINAL_010_TABLES = '88c082bb2699190b38c842978ff66b770bf16ec32f452149fdae852d8cb5e5c7';

function fixture() {
  const db = createReactiveDB({ mode: 'memory' });
  try {
    const raw = db.getRawDatabase(); raw.run('PRAGMA temp_store=MEMORY'); raw.run('PRAGMA foreign_keys=ON');
    for (const [name, schema] of Object.entries(CALENDAR_INTEGRATION_TABLES)) db.defineTable(name, schema);
    const historical = new Migrator({ database: raw, dbPath: ':memory:', migrations: calendarRealm.migrations.slice(0, 10), createBackups: false, log() {} });
    try { expect(historical.run()).toHaveLength(10); } finally { historical.dispose(); }
    const owner = { scopeId: 'application', expectedOwnerId: 'synthetic-ownership-owner' };
    db.createStrict('_calendar_owner', { id: 'application', scope_id: owner.scopeId, owner_id: owner.expectedOwnerId });
    const policy = (ruleId = 'rule-a', domain = 'calendar.rule-a', version = 'A'): CalendarIntegrationPolicySpec => ({ ruleId, ruleVersion: '1', adapter: 'observation-v1', dueOffsetMs: 0, maxLatenessMs: 60_000,
      source: { identity: { domain, databaseId: 'calendar:' + calendarHash(owner.scopeId), ownerId: owner.expectedOwnerId, scopeId: owner.scopeId, rootHash: '1'.repeat(64) },
        realmFingerprint: calendarRealm.fingerprint, policyVersion: version, semanticsVersion: 'observation-v1', definition: { name: 'calendar.observe', version: '1', fingerprint: '2'.repeat(64) },
        workflow: { name: 'calendar.observe', version: 1, definitionId: 'definition', versionId: 'version', fingerprint: '3'.repeat(64) } } });
    const registration = (spec: CalendarIntegrationPolicySpec, epoch: number) => ({ id: jobSourceId(spec.source.identity), generation: epoch, revision: epoch, state: 'active', policyHash: calendarHash(spec.source) });
    /** Native strict historical rows, not current commands masquerading as 010 behavior. */
    const seed = (spec: CalendarIntegrationPolicySpec, epoch = 1, retire = false) => {
      const id = calendarHash([owner.scopeId, spec.ruleId, epoch]);
      db.createStrict('_calendar_integration_policy_history', { id, scope_id: owner.scopeId, rule_id: spec.ruleId, epoch, request_id: 'historical-' + spec.ruleId + '-' + epoch,
        digest: calendarHash(spec), policy_json: calendarJson(spec), source_id: jobSourceId(spec.source.identity), source_policy_hash: calendarHash(spec.source), created_ms: 1 });
      const pointer = { id: spec.ruleId, scope_id: owner.scopeId, rule_id: spec.ruleId, policy_id: id, epoch, state: 'activating', registration_json: null };
      if (epoch === 1) db.createStrict('_calendar_integration_policy_current', pointer); else db.update('_calendar_integration_policy_current', spec.ruleId, pointer);
      const json = calendarJson(registration(spec, epoch));
      db.createStrict('_calendar_integration_policy_registrations', { id, scope_id: owner.scopeId, policy_id: id, registration_json: json });
      db.update('_calendar_integration_policy_current', spec.ruleId, { state: 'active', registration_json: json });
      if (retire) db.update('_calendar_integration_policy_current', spec.ruleId, { state: 'retired' });
      return id;
    };
    const rows = () => Object.fromEntries(Object.keys(CALENDAR_INTEGRATION_TABLES).map(name => [name, raw.query('SELECT * FROM ' + name + ' ORDER BY id').all()]));
    const bindings = () => raw.query('SELECT * FROM _calendar_integration_rule_sources ORDER BY id').all();
    const definitions = () => raw.query("SELECT type,name,sql FROM sqlite_master WHERE type IN ('table','index','trigger') AND name NOT LIKE 'sqlite_%' ORDER BY type,name").all();
    const define = () => { for (const [name, schema] of Object.entries(CALENDAR_INTEGRATION_OWNERSHIP_ADDITIONS)) db.defineTable(name, schema); };
    const upgrade = () => {
      // Qualify the historical 010 -> 011 boundary itself. The additive 012
      // journal has its own backfill/rollback suite and deliberately extends a guard.
      define(); const migrator = new Migrator({ database: raw, dbPath: ':memory:', migrations: calendarRealm.migrations.slice(0, 11), createBackups: false, log() {} });
      try { const applied = migrator.run(); expect(migrator.status().every(row => row.checksumMatches)).toBe(true); return applied; } finally { migrator.dispose(); }
    };
    const command = (name: string, body: Record<string, unknown>): any => (runDatabaseRealmCommand(calendarRealm, db, 'calendar.integration.' + name,
      { ...owner, ...body } as DatabaseSerializableValue) as any).value;
    const install = (spec: CalendarIntegrationPolicySpec, expectedEpoch = 0, requestId = 'install-' + spec.ruleId + '-' + expectedEpoch) => command('policy.install', { policy: spec, expectedEpoch, requestId, now: 1 });
    return { db, raw, owner, policy, registration, seed, rows, bindings, definitions, define, upgrade, command, install, close: () => db.dispose() };
  } catch (error) { db.dispose(); throw error; }
}
function rejected(run: () => unknown, code: CalendarErrorCode) {
  try { run(); throw new Error('Expected rejection'); } catch (error) { expect(readCalendarRejection(error)?.code).toBe(code); }
}

test('011 preserves committed 010 migration/declaration identity and adds a separate frozen ownership generation', () => {
  expect(hashMigration(calendarRealm.migrations[9]!)).toBe(ORIGINAL_010_CHECKSUM);
  expect(calendarRealm.migrationChecksums[9]).toEqual({ version: '010', checksum: ORIGINAL_010_CHECKSUM });
  expect(hashSchemaSnapshot(snapshotDeclaredTables(CALENDAR_INTEGRATION_TABLES))).toBe(ORIGINAL_010_TABLES);
  expect(calendarRealm.version).toBe('14'); expect(calendarRealm.migrations[10]?.version).toBe('011');
  expect(calendarRealm.tables).toEqual(CALENDAR_INTEGRATION_INSPECTION_TABLES);
  for (const [name, schema] of Object.entries(CALENDAR_INTEGRATION_OWNERSHIP_TABLES)) expect(calendarRealm.tables[name]).toEqual(schema);
  for (const [name, schema] of Object.entries(CALENDAR_INTEGRATION_TABLES)) expect(calendarRealm.tables[name]).toEqual(schema);
  expect(Object.isFrozen(CALENDAR_INTEGRATION_ADDITIONS)).toBe(true); expect(Object.isFrozen(CALENDAR_INTEGRATION_OWNERSHIP_ADDITIONS)).toBe(true);
});

test('consistent retained 010 epochs backfill one permanent binding per rule without changing history, old guards, ledger or source sequence', () => {
  const f = fixture(); try {
    f.seed(f.policy(), 1, true); f.seed(f.policy('rule-a', 'calendar.rule-a', 'B'), 2); f.seed(f.policy('rule-b', 'calendar.rule-b'), 1, true);
    const before = f.rows(), definitions = f.definitions(), ledger = f.raw.query('SELECT * FROM _migrations ORDER BY version').all(), sequence = f.db.currentSeq;
    expect(f.upgrade()).toEqual(['011']); expect(f.rows()).toEqual(before); expect(f.db.currentSeq).toBe(sequence);
    expect(f.raw.query("SELECT * FROM _migrations WHERE version<='010' ORDER BY version").all()).toEqual(ledger);
    for (const definition of definitions as { type: string; name: string; sql: string }[]) expect(f.raw.query('SELECT type,name,sql FROM sqlite_master WHERE type=? AND name=?').get(definition.type, definition.name)).toEqual(definition);
    expect(f.bindings()).toEqual(['rule-a', 'rule-b'].map(ruleId => ({ id: ruleId, scope_id: f.owner.scopeId, rule_id: ruleId, source_id: jobSourceId(f.policy(ruleId, 'calendar.' + ruleId).source.identity) })));
    expect(f.upgrade()).toEqual([]); expect(f.raw.query('PRAGMA foreign_key_check').all()).toEqual([]);
  } finally { f.close(); }
});

test('011 refuses shared-source and same-rule source-rotation history, including retired epochs, without picking winners or mutating old evidence', () => {
  for (const conflict of ['shared', 'rotated'] as const) {
    const f = fixture(); try {
      f.seed(f.policy(), 1, true);
      if (conflict === 'shared') f.seed(f.policy('rule-b', 'calendar.rule-a'), 1, true);
      else f.seed(f.policy('rule-a', 'calendar.rotated'), 2, true);
      const before = f.rows(), definitions = f.definitions(), ledger = f.raw.query('SELECT * FROM _migrations ORDER BY version').all(), sequence = f.db.currentSeq;
      expect(() => f.upgrade()).toThrow('conflicts with retained rule history');
      expect(f.rows()).toEqual(before); expect(f.db.currentSeq).toBe(sequence); expect(f.bindings()).toEqual([]);
      expect(f.raw.query('SELECT * FROM _migrations ORDER BY version').all()).toEqual(ledger);
      for (const definition of definitions as { type: string; name: string; sql: string }[]) expect(f.raw.query('SELECT type,name,sql FROM sqlite_master WHERE type=? AND name=?').get(definition.type, definition.name)).toEqual(definition);
      expect(f.raw.query("SELECT name FROM sqlite_master WHERE name='calendar_integration_policy_source_binding'").get()).toBeNull();
    } finally { f.close(); }
  }
});

test('a late 011 failure rolls back derivative backfill and guards, keeping original 010 evidence recoverable', () => {
  const f = fixture(); try {
    f.seed(f.policy()); f.define(); const before = f.rows(), definitions = f.definitions(), ledger = f.raw.query('SELECT * FROM _migrations ORDER BY version').all(), sequence = f.db.currentSeq;
    const migration = calendarRealm.migrations[10]!;
    const failing = new Migrator({ database: f.raw, dbPath: ':memory:', createBackups: false, log() {}, migrations: [
      ...calendarRealm.migrations.slice(0, 10), { ...migration, up(database) { migration.up(database); throw new Error('Synthetic late ownership failure.'); } },
    ] });
    try { expect(() => failing.run()).toThrow('Synthetic late ownership failure.'); } finally { failing.dispose(); }
    expect(f.rows()).toEqual(before); expect(f.bindings()).toEqual([]); expect(f.definitions()).toEqual(definitions); expect(f.db.currentSeq).toBe(sequence);
    expect(f.raw.query('SELECT * FROM _migrations ORDER BY version').all()).toEqual(ledger); expect(f.upgrade()).toEqual(['011']);
  } finally { f.close(); }
});

test('tracked installation binds identities bidirectionally for every retained epoch and preserves original receipt replay', () => {
  const f = fixture(); try {
    f.upgrade(); const a = f.policy(), accepted = f.install(a), snapshot = f.rows(), sequence = f.db.currentSeq;
    rejected(() => f.install(f.policy('rule-b', 'calendar.rule-a')), 'CALENDAR_INTENT_CONFLICT');
    rejected(() => f.install(f.policy('rule-a', 'calendar.rotated'), 1), 'CALENDAR_INTENT_CONFLICT');
    expect(f.rows()).toEqual(snapshot); expect(f.db.currentSeq).toBe(sequence); expect(f.bindings()).toHaveLength(1);
    f.command('policy.retire', { ruleId: a.ruleId, epoch: accepted.epoch });
    rejected(() => f.install(f.policy('rule-b', 'calendar.rule-a')), 'CALENDAR_INTENT_CONFLICT');
    rejected(() => f.install(f.policy('rule-a', 'calendar.rotated'), 1), 'CALENDAR_INTENT_CONFLICT');
    expect(f.install(f.policy('rule-a', 'calendar.rule-a', 'B'), 1).epoch).toBe(2);
    expect(f.install(a)).toMatchObject({ epoch: 1, state: 'retired' });
    expect(f.install(f.policy('rule-b', 'calendar.rule-b')).epoch).toBe(1); expect(f.bindings()).toHaveLength(2);
  } finally { f.close(); }
});

test('new binding allocation rolls back with late policy failure, and SQL guards prevent delete/update/replacement or bypass through historical inserts', () => {
  const f = fixture(); try {
    f.upgrade(); const before = f.rows(), sequence = f.db.currentSeq;
    f.raw.run("CREATE TRIGGER synthetic_late_policy_failure BEFORE INSERT ON _calendar_integration_policy_history BEGIN SELECT RAISE(ABORT,'synthetic'); END");
    expect(() => f.install(f.policy())).toThrow(); expect(f.bindings()).toEqual([]); expect(f.rows()).toEqual(before); expect(f.db.currentSeq).toBe(sequence);
    f.raw.run('DROP TRIGGER synthetic_late_policy_failure'); f.install(f.policy());
    f.raw.run('PRAGMA recursive_triggers=OFF');
    expect(() => f.raw.run('UPDATE _calendar_integration_rule_sources SET source_id=source_id')).toThrow();
    expect(() => f.raw.run('DELETE FROM _calendar_integration_rule_sources')).toThrow();
    expect(() => f.raw.run('INSERT OR REPLACE INTO _calendar_integration_rule_sources SELECT * FROM _calendar_integration_rule_sources')).toThrow();
    expect(() => f.db.createStrict('_calendar_integration_rule_sources', { id: 'other', scope_id: f.owner.scopeId, rule_id: 'other', source_id: jobSourceId(f.policy().source.identity) })).toThrow();
    expect(() => f.seed(f.policy('rule-a', 'calendar.rotated'), 2)).toThrow('rule source ownership');
    expect(() => f.seed(f.policy('rule-b', 'calendar.rule-b'))).toThrow('rule source ownership');
    expect(f.bindings()).toHaveLength(1);
  } finally { f.close(); }
});
