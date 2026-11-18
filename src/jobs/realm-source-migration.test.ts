/** Memory-only migration qualification. No fixture paths, files, actors, timers or dependencies are created. */
import { Database } from 'bun:sqlite';
import { expect, test } from 'bun:test';
import { Migrator } from '../migrations/migrator';
import { hashMigration } from '../migrations/schema-snapshot';
import { jobsRealm } from './realm';
import { JOB_TABLES } from './realm-schema';
import { CURRENT_JOB_TABLES } from './realm-source-schema';
import { JOB_SOURCE_MIGRATION } from './realm-source-migration';
import { decodeJobAdmission } from './realm-model';
import { type JobAdmissionRow, jobAdmissionDigest } from './model';

const historical = jobsRealm.migrations.find(migration => migration.version === '001')!;
const graph = ['job_schedules', '_jobs_admissions', '_jobs_cursors', '_jobs_occurrences'];
const q = (value: string) => '"' + value.replaceAll('"', '""') + '"';
// Golden 001 admission: no new source discriminator may be injected when it is decoded.
const LEGACY_COMMAND = '{"actorId":"synthetic-user","definition":"synthetic.job","definitionHash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","definitionVersion":"1","id":"schedule","input":{"retained":"byte-for-byte admission"},"overlap":"skip","principal":"synthetic-session","runAs":"service","scopeId":"application","timing":{"at":"2026-12-01T00:00:00.000Z","kind":"once","maxLatenessMs":60000},"workflow":{"definitionId":"synthetic-definition","fingerprint":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","name":"synthetic.workflow","version":1,"versionId":"synthetic-version"}}';
const LEGACY_DIGEST = 'e8b095d96fc2aaacff43b9337ca550d84a392d7d251b4f8aa9314fb4d6a3bc18';

function withDatabase(run: (database: Database) => void): void {
  const database = new Database(':memory:');
  try {
    database.run('PRAGMA foreign_keys=ON'); database.run('PRAGMA temp_store=MEMORY'); run(database);
    expect(database.query("SELECT name FROM sqlite_schema WHERE name GLOB '_jobs_002_stage_*'").all()).toEqual([]);
  }
  finally { database.close(true); }
}
function migrate(database: Database, source = false): void {
  const migrator = new Migrator({ database, dbPath: ':memory:', migrations: source ? [historical, JOB_SOURCE_MIGRATION] : [historical],
    applyPragmas: false, createBackups: false, log() {} });
  try { migrator.run(); } finally { migrator.dispose(); }
}
function insert(database: Database, table: string, row: Record<string, string | number | null>): void {
  database.run('INSERT INTO ' + q(table) + ' (' + Object.keys(row).map(q).join(',') + ') VALUES (' + Object.keys(row).map(() => '?').join(',') + ')', Object.values(row));
}
function seed(database: Database): void {
  insert(database, '_jobs_owner', { id: 'application', owner_id: 'synthetic-owner', scope_id: 'application' });
  insert(database, 'job_schedules', { id: 'schedule', scope_id: 'application', actor_id: 'synthetic-user', principal: 'synthetic-session',
    definition_name: 'synthetic.job', definition_version: '1', run_as: 'service', updated_by: 'synthetic-user', control: 'active', revision: 1, generation: 1, created_at: 1, updated_at: 1 });
  insert(database, '_jobs_admissions', { id: 'schedule:1', scope_id: 'application', schedule_id: 'schedule', generation: 1,
    command_json: LEGACY_COMMAND, digest: LEGACY_DIGEST, authority_json: '{"retained":"authority seal"}', authority_mac: 'b'.repeat(64) });
  insert(database, '_jobs_cursors', { id: 'schedule', scope_id: 'application', next_due_at: 100, skipped: 0, blocked_code: null });
  insert(database, '_jobs_occurrences', { id: 'occurrence', scope_id: 'application', schedule_id: 'schedule', admission_id: 'schedule:1', generation: 1, scheduled_at: 10,
    state: 'terminal', lease_nonce: null, lease_until: null, lease_generation: 3, workflow_id: 'synthetic-workflow', receipt_json: '{"retained":"permanent dispatch receipt"}',
    terminal_status: 'completed', error_code: null, created_at: 2, updated_at: 3 });
  insert(database, '_jobs_intents', { id: 'intent', scope_id: 'application', principal: 'synthetic-session', digest: 'c'.repeat(64), result_json: '{"id":"schedule","revision":1}', created_at: 1 });
  insert(database, '_jobs_usage', { id: 'schedules', count: 1 });
}
function historicalRows(database: Database) {
  return Object.fromEntries(Object.entries(JOB_TABLES).map(([table, columns]) => [table,
    database.query('SELECT ' + Object.keys(columns).map(q).join(',') + ' FROM ' + q(table) + ' ORDER BY id').all()]));
}
function retainedObjects(database: Database) {
  return database.query<{ type: string; name: string; sql: string | null }, []>("SELECT type,name,sql FROM sqlite_schema WHERE type IN ('index','trigger') AND tbl_name IN ('job_schedules','_jobs_admissions','_jobs_cursors','_jobs_occurrences') ORDER BY name").all();
}
function source(database: Database) {
  insert(database, '_jobs_sources', { id: 'source', scope_id: 'application', identity_json: '{"kind":"synthetic"}', identity_hash: 'd'.repeat(64),
    current_generation: 1, revision: 1, state: 'active', created_at: 1, updated_at: 1 });
  insert(database, '_jobs_source_policies', { id: 'source:1', scope_id: 'application', source_id: 'source', generation: 1,
    contract_json: '{"synthetic":true}', digest: 'e'.repeat(64), created_at: 1 });
}

test('historical 001 retains its exact checksum, frozen schema and NOT NULL ownership', () => {
  expect(hashMigration(historical)).toBe('e685208b804564ef8099324f5218dbd6cc783d8d0541e4689cba348fb42a4749');
  expect(Object.isFrozen(JOB_TABLES)).toBe(true);
  expect(JOB_TABLES.job_schedules!.actor_id).toBe('TEXT NOT NULL');
  expect(JOB_TABLES.job_schedules!.source_id).toBeUndefined();
  expect(CURRENT_JOB_TABLES.job_schedules!.actor_id).toBe('TEXT');
  withDatabase(database => {
    migrate(database);
    expect(database.query<{ name: string; notnull: number }, []>('PRAGMA table_info(job_schedules)').all().filter(column => ['actor_id', 'principal', 'updated_by'].includes(column.name)).every(column => column.notnull === 1)).toBe(true);
    expect(database.query<{ name: string }, []>('PRAGMA table_info(job_schedules)').all().some(column => column.name === 'source_id')).toBe(false);
  });
});

test('a fresh managed 001 plus 002 startup establishes the same current schema', () => {
  withDatabase(database => {
    migrate(database, true); seed(database); source(database);
    expect(database.query<{ name: string; notnull: number }, []>('PRAGMA table_info(job_schedules)').all()
      .filter(column => ['actor_id', 'principal', 'updated_by'].includes(column.name)).every(column => column.notnull === 0)).toBe(true);
    expect(database.query('PRAGMA foreign_key_check').all()).toEqual([]);
    expect(database.query('SELECT name FROM sqlite_temp_schema').all()).toEqual([]);
    expect(jobAdmissionDigest(decodeJobAdmission(database.query<JobAdmissionRow, []>('SELECT * FROM _jobs_admissions').get()!))).toBe(LEGACY_DIGEST);
  });
});

test('managed 001 to 002 preserves every old field, seal, receipt, FK and index/trigger SQL with FK enforcement continuously enabled', () => {
  withDatabase(database => {
    migrate(database); seed(database);
    database.run('CREATE INDEX synthetic_retained_index ON _jobs_occurrences(terminal_status)');
    database.run("CREATE TRIGGER synthetic_retained_trigger BEFORE UPDATE OF count ON _jobs_usage WHEN NEW.count<OLD.count BEGIN SELECT RAISE(ABORT,'synthetic retention'); END");
    const before = historicalRows(database), objects = retainedObjects(database);
    const foreignKeys = Object.fromEntries(graph.slice(1).map(table => [table, database.query('PRAGMA foreign_key_list(' + q(table) + ')').all()]));
    migrate(database, true);
    expect(historicalRows(database)).toEqual(before);
    const retainedAdmission = database.query<JobAdmissionRow, []>('SELECT * FROM _jobs_admissions').get()!;
    expect(jobAdmissionDigest(decodeJobAdmission(retainedAdmission))).toBe(LEGACY_DIGEST);
    expect(retainedAdmission.command_json).toBe(LEGACY_COMMAND);
    expect(database.query('SELECT source_id FROM job_schedules').get()).toEqual({ source_id: null });
    for (const object of objects) expect(retainedObjects(database).find(candidate => candidate.type === object.type && candidate.name === object.name)).toEqual(object);
    for (const table of graph.slice(1)) expect(database.query('PRAGMA foreign_key_list(' + q(table) + ')').all()).toEqual(foreignKeys[table]);
    expect(database.query('PRAGMA foreign_keys').get()).toEqual({ foreign_keys: 1 });
    expect(database.query('PRAGMA foreign_key_check').all()).toEqual([]);
    expect(database.query('SELECT name FROM sqlite_temp_schema').all()).toEqual([]);
    expect(database.query("SELECT name FROM sqlite_schema WHERE name LIKE '_jobs_002_stage_%'").all()).toEqual([]);
    for (const sql of ["DELETE FROM job_schedules", "DELETE FROM _jobs_occurrences", "UPDATE _jobs_admissions SET digest='changed'", "DELETE FROM _jobs_intents", "UPDATE job_schedules SET actor_id='other',revision=revision+1"]) expect(() => database.run(sql)).toThrow();
    expect(() => database.run("UPDATE _jobs_usage SET count=0 WHERE id='schedules'")).toThrow('synthetic retention');
    migrate(database, true); // A repeated managed startup is a no-op, not another rewrite.
    expect(historicalRows(database)).toEqual(before);
  });
});

test('source ownership is discriminated, scope-bound and immutable without any human identity', () => {
  withDatabase(database => {
    migrate(database); seed(database); migrate(database, true); source(database);
    const schedule = { id: 'source-schedule', scope_id: 'application', actor_id: null, principal: null, definition_name: 'synthetic.job', definition_version: '1',
      run_as: 'service', updated_by: null, control: 'active', revision: 1, generation: 1, created_at: 1, updated_at: 1, source_id: 'source' };
    insert(database, 'job_schedules', schedule);
    expect(database.query('SELECT actor_id,principal,updated_by,source_id FROM job_schedules WHERE id=?').get(schedule.id)).toEqual({ actor_id: null, principal: null, updated_by: null, source_id: 'source' });
    for (const override of [{ actor_id: 'fake-human' }, { principal: 'fake-principal' }, { updated_by: 'fake-human' }, { run_as: 'actor' }, { source_id: null }, { source_id: 'unknown' }, { scope_id: 'tenant:other' }]) {
      expect(() => insert(database, 'job_schedules', { ...schedule, ...override, id: 'rejected' })).toThrow();
    }
    expect(() => database.run("UPDATE job_schedules SET source_id=NULL,actor_id='u',principal='p',updated_by='u',revision=revision+1 WHERE id='source-schedule'")).toThrow();
    expect(() => database.run("INSERT OR REPLACE INTO job_schedules SELECT * FROM job_schedules WHERE id='source-schedule'")).toThrow();
    expect(database.query('PRAGMA foreign_key_check').all()).toEqual([]);
    const plan = JSON.stringify(database.query('EXPLAIN QUERY PLAN SELECT id FROM job_schedules WHERE scope_id=? AND source_id=? ORDER BY created_at DESC,id DESC LIMIT 32').all('application', 'source'));
    expect(plan).toContain('jobs_source_schedule_page'); expect(plan).not.toContain('TEMP B-TREE');
  });
});

test('source policy/intent evidence is retained and reactivation requires a fresh generation', () => {
  withDatabase(database => {
    migrate(database); seed(database); migrate(database, true); source(database);
    insert(database, '_jobs_source_intents', { id: 'source-intent', scope_id: 'application', source_id: 'source', policy_generation: 1, digest: 'f'.repeat(64), result_json: '{"accepted":true}', created_at: 1 });
    for (const sql of ["DELETE FROM _jobs_sources", "UPDATE _jobs_sources SET identity_json='changed',revision=revision+1", "DELETE FROM _jobs_source_policies", "UPDATE _jobs_source_policies SET contract_json='changed'", "DELETE FROM _jobs_source_intents", "UPDATE _jobs_source_intents SET result_json='changed'", "INSERT OR REPLACE INTO _jobs_sources SELECT * FROM _jobs_sources", "INSERT OR REPLACE INTO _jobs_source_policies SELECT * FROM _jobs_source_policies", "INSERT OR REPLACE INTO _jobs_source_intents SELECT * FROM _jobs_source_intents"]) expect(() => database.run(sql)).toThrow();
    expect(() => insert(database, '_jobs_source_intents', { id: 'wrong-generation', scope_id: 'application', source_id: 'source', policy_generation: 2, digest: 'f'.repeat(64), result_json: '{}', created_at: 1 })).toThrow();
    database.run("UPDATE _jobs_sources SET state='retired',revision=revision+1,updated_at=2 WHERE id='source'");
    expect(() => database.run("UPDATE _jobs_sources SET state='active',revision=revision+1 WHERE id='source'")).toThrow();
    insert(database, '_jobs_source_policies', { id: 'source:2', scope_id: 'application', source_id: 'source', generation: 2, contract_json: '{"synthetic":true}', digest: 'e'.repeat(64), created_at: 3 });
    database.run("UPDATE _jobs_sources SET state='active',current_generation=current_generation+1,revision=revision+1,updated_at=3 WHERE id='source'");
    expect(database.query('SELECT current_generation,revision,state FROM _jobs_sources').get()).toEqual({ current_generation: 2, revision: 3, state: 'active' });
    const plan = JSON.stringify(database.query('EXPLAIN QUERY PLAN SELECT id FROM _jobs_sources WHERE scope_id=? AND identity_hash=?').all('application', 'd'.repeat(64)));
    expect(plan).toContain('jobs_source_identity');
  });
});

test('late migration failure rolls back all data/DDL and removes transaction-owned staging', () => {
  withDatabase(database => {
    migrate(database); seed(database);
    // An owned synthetic name collision fails after graph replacement/restoration.
    database.run('CREATE INDEX jobs_source_policy_generation ON _jobs_usage(count)');
    const before = historicalRows(database), objects = retainedObjects(database);
    expect(() => migrate(database, true)).toThrow();
    expect(historicalRows(database)).toEqual(before); expect(retainedObjects(database)).toEqual(objects);
    expect(database.query("SELECT name FROM sqlite_schema WHERE name='_jobs_sources'").get()).toBeNull();
    expect(database.query('SELECT name FROM sqlite_temp_schema').all()).toEqual([]);
    expect(database.query('PRAGMA foreign_key_check').all()).toEqual([]);
    expect(database.query('PRAGMA foreign_keys').get()).toEqual({ foreign_keys: 1 });
  });
});

test('an unexpected incoming FK aborts without rewriting the protected scheduling graph', () => {
  withDatabase(database => {
    migrate(database); seed(database);
    database.run('CREATE TABLE synthetic_other_owner(id TEXT PRIMARY KEY, schedule_id TEXT REFERENCES job_schedules(id))');
    database.run("INSERT INTO synthetic_other_owner VALUES('other','schedule')");
    const before = historicalRows(database), objects = retainedObjects(database);
    expect(() => migrate(database, true)).toThrow('unexpected incoming foreign key');
    expect(historicalRows(database)).toEqual(before); expect(retainedObjects(database)).toEqual(objects);
    expect(database.query('SELECT name FROM sqlite_temp_schema').all()).toEqual([]);
  });
});
