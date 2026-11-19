/** Populated native MEMORY migration tests. All copies are SQLite :memory:
 * owners, closed in finally. No databases, backups or generated files exist.
 */
import { Database, type SQLQueryBindings } from 'bun:sqlite';
import { expect, test } from 'bun:test';
import { jobsRealm } from './realm';
import { JOB_CAPACITY_MIGRATION } from './realm-capacity-migration';
import { JOB_CAPACITY_TABLES } from './realm-capacity-schema';
import { CURRENT_JOB_TABLES } from './realm-source-schema';
import { hashMigration } from '../migrations/schema-snapshot';
import { JOB_SOURCE_MIGRATION } from './realm-source-migration';
import { Migrator } from '../migrations/migrator';
import { jobWorkSourceKey } from './realm-capacity';
import { jobOccurrenceId } from './model';
import { memoryCapacityFixture, capacityDue } from './test-support/memory-capacity-fixture';

const q = (value: string) => '"' + value.replaceAll('"', '""') + '"';
const order = ['_jobs_owner', '_jobs_sources', '_jobs_source_policies', 'job_schedules', '_jobs_admissions', '_jobs_cursors', '_jobs_occurrences', '_jobs_intents', '_jobs_source_intents', '_jobs_usage'];
function snapshot(database: Database) {
  return Object.fromEntries(Object.entries(CURRENT_JOB_TABLES).map(([table, columns]) => [table,
    database.query('SELECT ' + Object.keys(columns).map(q).join(',') + ' FROM ' + q(table) + ' ORDER BY id').all()]));
}
function objects(database: Database) {
  return database.query("SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE type IN ('index','trigger') ORDER BY name").all();
}
function historical(seed: (fixture: ReturnType<typeof memoryCapacityFixture>) => void,
  run: (database: Database, sourceId: string) => void) {
  const current = memoryCapacityFixture(), database = new Database(':memory:');
  try {
    seed(current); database.run('PRAGMA temp_store=MEMORY'); database.run('PRAGMA foreign_keys=ON');
    const preparer = new Migrator({ database, dbPath: ':memory:', migrations: jobsRealm.migrations.slice(0, 2),
      createBackups: false, applyPragmas: false, log() {} });
    try { preparer.run(); } finally { preparer.dispose(); }
    for (const table of order) {
      const columns = Object.keys(CURRENT_JOB_TABLES[table]!);
      const insert = database.prepare('INSERT INTO ' + q(table) + ' (' + columns.map(q).join(',') + ') VALUES (' + columns.map(() => '?').join(',') + ')');
      try {
        for (const row of current.raw.query<Record<string, SQLQueryBindings>, []>('SELECT ' + columns.map(q).join(',') + ' FROM ' + q(table)).all()) {
          insert.run(...columns.map(column => row[column]!));
        }
      } finally { insert.finalize(); }
    }
    run(database, current.sourceId);
  } finally { database.close(true); current.close(); }
}
function migrate(database: Database) {
  const migrator = new Migrator({ database, dbPath: ':memory:', migrations: jobsRealm.migrations.slice(0, 3),
    createBackups: false, applyPragmas: false, log() {} });
  try { migrator.run(); return migrator.status(); } finally { migrator.dispose(); }
}

test('003 is additive and 001/002 declaration maps and checksums remain historical', () => {
  expect(hashMigration(jobsRealm.migrations[0]!)).toBe('e685208b804564ef8099324f5218dbd6cc783d8d0541e4689cba348fb42a4749');
  expect(hashMigration(jobsRealm.migrations[1]!)).toBe(hashMigration(JOB_SOURCE_MIGRATION));
  expect(jobsRealm.migrations.slice(0, 3).map(migration => migration.version)).toEqual(['001', '002', '003']);
  expect(CURRENT_JOB_TABLES._jobs_schedule_work).toBeUndefined();
  expect(Object.isFrozen(CURRENT_JOB_TABLES)).toBe(true); expect(Object.isFrozen(JOB_CAPACITY_TABLES)).toBe(true);
});

test('populated 002 backfill preserves every history field/seal/receipt/counter/index and counts all generations', () => {
  historical(f => {
    f.create('closed'); f.finish('closed');
    f.create('unknown-old-generation'); f.materialize('unknown-old-generation'); f.claim('unknown-old-generation'); f.replace('unknown-old-generation'); f.cancel('unknown-old-generation', 2);
    f.create('blocked'); f.materialize('blocked'); f.claim('blocked');
    f.command('jobs.block', { scopeId: 'application', id: jobOccurrenceId('blocked', 1, capacityDue), nonce: 'synthetic-claim', leaseGeneration: 1, code: 'JOBS_NOT_DISPATCHED', now: capacityDue });
    f.cancel('blocked'); f.create('future');
  }, (database, sourceId) => {
    database.run('CREATE INDEX synthetic_retained_capacity_index ON _jobs_usage(count)');
    database.run("CREATE TRIGGER synthetic_retained_capacity_guard BEFORE UPDATE OF count ON _jobs_usage WHEN NEW.count<OLD.count BEGIN SELECT RAISE(ABORT,'historical counter cannot shrink'); END");
    const before = snapshot(database), originalObjects = objects(database), status = migrate(database);
    expect(status.map(row => ({ version: row.version, applied: row.applied, checksumMatches: row.checksumMatches }))).toEqual([
      { version: '001', applied: true, checksumMatches: true }, { version: '002', applied: true, checksumMatches: true },
      { version: '003', applied: true, checksumMatches: true },
    ]);
    expect(snapshot(database)).toEqual(before);
    for (const original of originalObjects) expect(objects(database)).toContainEqual(original);
    expect(database.query('SELECT id,open_occurrences,occupied FROM _jobs_schedule_work ORDER BY id').all()).toEqual([
      { id: 'blocked', open_occurrences: 1, occupied: 1 }, { id: 'closed', open_occurrences: 0, occupied: 0 },
      { id: 'future', open_occurrences: 0, occupied: 1 }, { id: 'unknown-old-generation', open_occurrences: 1, occupied: 1 },
    ]);
    expect(database.query('SELECT count FROM _jobs_work_usage WHERE id=?').get(jobWorkSourceKey(sourceId))).toEqual({ count: 3 });
    expect(database.query('SELECT count FROM _jobs_work_usage WHERE id=?').get('schedules')).toEqual({ count: 3 });
    expect(database.query('SELECT count FROM _jobs_work_usage WHERE id=?').get('occurrences')).toEqual({ count: 2 });
    expect(database.query('PRAGMA foreign_key_check').all()).toEqual([]);
    expect(database.query('SELECT name FROM sqlite_temp_schema').all()).toEqual([]);
  });
});

test('inconsistent historical counters or missing cursor reject migration without creating a partial ledger', () => {
  for (const corrupt of ["UPDATE _jobs_usage SET count=count+1 WHERE id='schedules'", "DELETE FROM _jobs_cursors WHERE id='retained'"]) {
    historical(f => { f.create('retained'); }, database => {
      database.run(corrupt); const before = snapshot(database), originalObjects = objects(database);
      expect(() => migrate(database)).toThrow(); expect(snapshot(database)).toEqual(before); expect(objects(database)).toEqual(originalObjects);
      expect(database.query("SELECT name FROM sqlite_schema WHERE name IN ('_jobs_schedule_work','_jobs_work_usage')").all()).toEqual([]);
      expect(database.query('SELECT name FROM sqlite_temp_schema').all()).toEqual([]);
    });
  }
});

test('late 003 DDL collision rolls back both populated work tables while preserving historical application objects', () => {
  historical(f => { f.create('retained'); f.finish('retained'); }, database => {
    database.run('CREATE TRIGGER jobs_work_closed BEFORE UPDATE ON _jobs_usage BEGIN SELECT 1; END');
    const before = snapshot(database), originalObjects = objects(database);
    expect(() => migrate(database)).toThrow(); expect(snapshot(database)).toEqual(before); expect(objects(database)).toEqual(originalObjects);
    expect(database.query("SELECT name FROM sqlite_schema WHERE name IN ('_jobs_schedule_work','_jobs_work_usage')").all()).toEqual([]);
    expect(database.query('PRAGMA foreign_keys').get()).toEqual({ foreign_keys: 1 });
  });
});

test('003 requires a managed transaction and foreign-key enforcement', () => {
  historical(() => {}, database => {
    expect(() => JOB_CAPACITY_MIGRATION.up(database)).toThrow('managed transaction');
    database.run('PRAGMA foreign_keys=OFF'); expect(() => migrate(database)).toThrow('foreign-key enforcement');
    expect(database.query("SELECT name FROM sqlite_schema WHERE name='_jobs_schedule_work'").get()).toBeNull();
  });
});

test('working identity and closure SQL guards cannot erase unresolved claims or replace membership', () => {
  const f = memoryCapacityFixture(); try {
    f.create('unknown'); f.materialize('unknown'); f.claim('unknown');
    expect(() => f.raw.run("UPDATE _jobs_schedule_work SET occupied=0,open_occurrences=0 WHERE id='unknown'")).toThrow('working closure');
    expect(() => f.raw.run("DELETE FROM _jobs_schedule_work WHERE id='unknown'")).toThrow();
    expect(() => f.raw.run("INSERT OR REPLACE INTO _jobs_schedule_work SELECT * FROM _jobs_schedule_work WHERE id='unknown'")).toThrow();
    expect(() => f.raw.run("UPDATE _jobs_schedule_work SET source_id=NULL WHERE id='unknown'")).toThrow();
    expect(() => f.raw.run("UPDATE _jobs_work_usage SET count=-1 WHERE id='schedules'")).toThrow();
    expect(f.work('unknown')).toMatchObject({ occupied: 1, open_occurrences: 1 });
  } finally { f.close(); }
});
