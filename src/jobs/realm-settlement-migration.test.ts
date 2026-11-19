/** Genuine populated 003 -> 004 through native Migrator, MEMORY only. */
import { Database, type SQLQueryBindings } from 'bun:sqlite';
import { expect, test } from 'bun:test';
import { Migrator } from '../migrations/migrator';
import { jobsRealm } from './realm';
import { JOB_CAPACITY_CURRENT_TABLES } from './realm-capacity-schema';
import { JOB_SETTLEMENT_MIGRATION } from './realm-settlement-migration';
import { JOB_SETTLEMENT_TABLES } from './realm-settlement-schema';
import { readJobSettlementSnapshot } from './settlement-model';
import { jobOccurrenceId } from './model';
import { memoryCapacityFixture, capacityDue } from './test-support/memory-capacity-fixture';

const q = (value: string) => '"' + value.replaceAll('"', '""') + '"';
const order = ['_jobs_owner', '_jobs_sources', '_jobs_source_policies', 'job_schedules', '_jobs_admissions', '_jobs_cursors',
  '_jobs_occurrences', '_jobs_intents', '_jobs_source_intents', '_jobs_usage', '_jobs_schedule_work', '_jobs_work_usage'];
function rows(database: Database) {
  return Object.fromEntries(Object.entries(JOB_CAPACITY_CURRENT_TABLES).map(([table, columns]) => [table,
    database.query('SELECT ' + Object.keys(columns).map(q).join(',') + ' FROM ' + q(table) + ' ORDER BY id').all()]));
}
function objects(database: Database) { return database.query("SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE type IN ('index','trigger') ORDER BY name").all(); }
function migrate(database: Database) {
  const migrator = new Migrator({ database, dbPath: ':memory:', migrations: [...jobsRealm.migrations.slice(0, 3), JOB_SETTLEMENT_MIGRATION],
    createBackups: false, applyPragmas: false, log() {} });
  try { return migrator.run(); } finally { migrator.dispose(); }
}
function historical(seed: (fixture: ReturnType<typeof memoryCapacityFixture>) => void, run: (database: Database, sourceId: string) => void) {
  const current = memoryCapacityFixture(), database = new Database(':memory:');
  try {
    seed(current); database.run('PRAGMA temp_store=MEMORY'); database.run('PRAGMA foreign_keys=ON');
    const setup = new Migrator({ database, dbPath: ':memory:', migrations: jobsRealm.migrations.slice(0, 3),
      createBackups: false, applyPragmas: false, log() {} });
    try { setup.run(); } finally { setup.dispose(); }
    for (const table of order) {
      const columns = Object.keys(JOB_CAPACITY_CURRENT_TABLES[table]!);
      const statement = database.prepare('INSERT INTO ' + q(table) + '(' + columns.map(q).join(',') + ') VALUES(' + columns.map(() => '?').join(',') + ')');
      const update = table === '_jobs_work_usage' ? database.prepare('UPDATE _jobs_work_usage SET count=? WHERE id=?') : null;
      try {
        for (const row of current.raw.query<Record<string, SQLQueryBindings>, []>('SELECT ' + columns.map(q).join(',') + ' FROM ' + q(table)).all()) {
          // 003 initialized these two zero buckets before the populated copy.
          if (update && (row.id === 'schedules' || row.id === 'occurrences')) update.run(row.count!, row.id!);
          else statement.run(...columns.map(column => row[column]!));
        }
      } finally { statement.finalize(); update?.finalize(); }
    }
    run(database, current.sourceId);
  } finally { database.close(true); current.close(); }
}

test('004 backfills every generation without changing any 003 evidence, counters, SQL object or accepted identity', () => {
  historical(f => {
    f.create('closed'); f.finish('closed');
    f.create('unknown'); f.materialize('unknown'); f.claim('unknown'); f.replace('unknown');
    f.create('dispatched'); f.materialize('dispatched'); f.claim('dispatched'); f.dispatch('dispatched');
    f.create('blocked'); f.materialize('blocked'); f.claim('blocked');
    f.command('jobs.block', { scopeId: 'application', id: jobOccurrenceId('blocked', 1, capacityDue),
      nonce: 'synthetic-claim', leaseGeneration: 1, code: 'JOBS_NOT_DISPATCHED', now: capacityDue });
    f.cancel('blocked'); f.create('future');
  }, (database, sourceId) => {
    const before = rows(database), originalObjects = objects(database);
    const oldLedger = database.query("SELECT * FROM _zero_migrations WHERE version IN ('001','002','003') ORDER BY id").all();
    expect(migrate(database)).toEqual(['004']); expect(rows(database)).toEqual(before);
    expect(database.query("SELECT * FROM _zero_migrations WHERE version IN ('001','002','003') ORDER BY id").all()).toEqual(oldLedger);
    for (const object of originalObjects) expect(objects(database)).toContainEqual(object);
    expect(database.query('SELECT id,units FROM _jobs_source_settlement ORDER BY id').all()).toEqual([{ id: sourceId, units: 1 }]);
    expect(database.query('SELECT id,units FROM _jobs_schedule_settlement ORDER BY id').all()).toEqual([
      { id: 'blocked', units: 0 }, { id: 'closed', units: 0 }, { id: 'dispatched', units: 1 }, { id: 'future', units: 1 }, { id: 'unknown', units: 1 },
    ]);
    expect(readJobSettlementSnapshot(database)).toEqual({ transportUnits: 9, actorControlUnits: 0, sourceControlUnits: 4 });
    expect(database.query('PRAGMA foreign_key_check').all()).toEqual([]);
    expect(database.query('SELECT name FROM sqlite_temp_schema').all()).toEqual([]);
    expect(migrate(database)).toEqual([]); expect(rows(database)).toEqual(before);
  });
});

test('corrupt 003 all-generation work or aggregate counters refuse 004 atomically without repairing source state', () => {
  for (const corrupt of ["UPDATE _jobs_schedule_work SET open_occurrences=open_occurrences+1 WHERE id='unknown'",
    "UPDATE _jobs_work_usage SET count=count+1 WHERE id='occurrences'", "DELETE FROM _jobs_cursors WHERE id='unknown'",
    "UPDATE _jobs_usage SET count=count+1 WHERE id='schedules'",
    "UPDATE _jobs_usage SET count=count+1 WHERE id='intents'",
    "INSERT INTO _jobs_usage(id,count) VALUES('actorRecoveryIntents',1)"]) {
    historical(f => { f.create('unknown'); f.materialize('unknown'); f.claim('unknown'); }, database => {
      database.run(corrupt); const before = rows(database), originalObjects = objects(database);
      expect(() => migrate(database)).toThrow(); expect(rows(database)).toEqual(before); expect(objects(database)).toEqual(originalObjects);
      expect(database.query("SELECT name FROM sqlite_schema WHERE name IN ('_jobs_settlement_usage','_jobs_settlement_state')").all()).toEqual([]);
    });
  }
});

test('a retained actor claim receives both pause and cancel control units independently of source control', () => {
  historical(f => {
    const actor = { scopeId: 'application', userId: 'synthetic-user', principal: 'synthetic-session', manageAll: false };
    const { source: _source, ...base } = f.admission('actor-unknown');
    f.command('jobs.schedule.create', { actor, requestId: 'create-actor', now: capacityDue - 1000,
      admission: { ...base, actorId: actor.userId, principal: actor.principal, runAs: 'actor' },
      seal: { authorityJson: 'SYNTHETIC_ACTOR', authorityMac: '6'.repeat(64) } });
    f.materialize('actor-unknown'); f.claim('actor-unknown');
  }, database => {
    const before = rows(database); expect(migrate(database)).toEqual(['004']); expect(rows(database)).toEqual(before);
    expect(readJobSettlementSnapshot(database)).toEqual({ transportUnits: 5, actorControlUnits: 2, sourceControlUnits: 1 });
  });
});

test('late 004 DDL failure rolls back new memberships and obligations while preserving retained rows and foreign-key enforcement', () => {
  historical(f => { f.create('future'); }, database => {
    database.run('CREATE TRIGGER jobs_settlement_state_immutable BEFORE UPDATE ON _jobs_usage BEGIN SELECT 1; END');
    const before = rows(database), originalObjects = objects(database);
    expect(() => migrate(database)).toThrow(); expect(rows(database)).toEqual(before); expect(objects(database)).toEqual(originalObjects);
    for (const table of Object.keys(JOB_SETTLEMENT_TABLES)) expect(database.query('SELECT name FROM sqlite_schema WHERE name=?').get(table)).toBeNull();
    expect(database.query('PRAGMA foreign_keys').get()).toEqual({ foreign_keys: 1 });
    database.run('DROP TRIGGER jobs_settlement_state_immutable'); expect(migrate(database)).toEqual(['004']);
  });
});

test('004 admits exact empty predeclared tables but rejects incompatible pre-existing shape without replacing it', () => {
  for (const malformed of [false, true]) historical(() => {}, database => {
    if (malformed) database.run('CREATE TABLE _jobs_settlement_usage(id TEXT PRIMARY KEY,count TEXT)');
    else for (const [table, columns] of Object.entries(JOB_SETTLEMENT_TABLES)) database.run('CREATE TABLE ' + q(table)
      + '(' + Object.entries(columns).map(([column, definition]) => q(column) + ' ' + definition).join(',') + ')');
    const before = database.query("SELECT sql FROM sqlite_schema WHERE name='_jobs_settlement_usage'").get();
    if (malformed) { expect(() => migrate(database)).toThrow(); expect(database.query("SELECT sql FROM sqlite_schema WHERE name='_jobs_settlement_usage'").get()).toEqual(before); }
    else { expect(migrate(database)).toEqual(['004']); expect(readJobSettlementSnapshot(database)).toEqual({ transportUnits: 1, actorControlUnits: 0, sourceControlUnits: 1 }); }
  });
});

test('004 requires the managed transaction and FK enforcement; it does not provision through a reader', () => {
  historical(() => {}, database => {
    expect(() => JOB_SETTLEMENT_MIGRATION.up(database)).toThrow('managed transaction');
    database.run('PRAGMA foreign_keys=OFF'); expect(() => migrate(database)).toThrow('foreign-key enforcement');
    expect(database.query("SELECT name FROM sqlite_schema WHERE name='_jobs_settlement_usage'").get()).toBeNull();
  });
});
