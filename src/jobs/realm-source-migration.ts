/** FK-enabled additive upgrade: retain 001 and rebuild only its scheduling FK graph. */
import type { Database } from 'bun:sqlite';
import type { Migration } from '../migrations/types';
import { quoteSqlIdentifier } from '../sync/identity';
import type { TableSchema } from '../sync/types';
import { JOB_TABLES } from './realm-schema';
import { JOB_SOURCE_SCHEDULE_TABLE, JOB_SOURCE_TABLES } from './realm-source-schema';

const GRAPH = ['job_schedules', '_jobs_admissions', '_jobs_cursors', '_jobs_occurrences'] as const;
const DROP_ORDER = ['_jobs_occurrences', '_jobs_cursors', '_jobs_admissions', 'job_schedules'] as const;
const stagingName = (table: string) => '_jobs_002_stage_' + table;
interface SchemaObject { type: string; name: string; tbl_name: string; sql: string | null }

function createTable(database: Database, name: string, schema: TableSchema): void {
  database.run('CREATE TABLE ' + quoteSqlIdentifier(name) + ' (' + Object.entries(schema)
    .map(([column, definition]) => quoteSqlIdentifier(column) + ' ' + definition).join(',') + ')');
}
function assertForeignKeys(database: Database): void {
  if (database.query('PRAGMA foreign_key_check').get()) throw new Error('Jobs source migration found inconsistent foreign keys.');
}
function columnList(table: string): string {
  return Object.keys(JOB_TABLES[table]!).map(quoteSqlIdentifier).join(',');
}

/** Exported separately so realm.ts can append 002 without changing the historical 001 closure. */
export const JOB_SOURCE_MIGRATION: Migration = Object.freeze({
  version: '002', description: 'Source-owned scheduling with retained source policy and intent evidence', safety: 'safe',
  up(database: Database) {
    // The managed migrator owns the transaction. Foreign-key enforcement cannot
    // be disabled inside it, and deferred DROP-parent debts survive a matching
    // replacement table even when foreign_key_check is empty. Remove children
    // first instead; all original data remains in transaction-owned staging.
    if (!database.inTransaction) throw new Error('Jobs source migration requires its managed transaction.');
    if (database.query<{ foreign_keys: number }, []>('PRAGMA foreign_keys').get()?.foreign_keys !== 1) {
      throw new Error('Jobs source migration requires foreign-key enforcement.');
    }
    assertForeignKeys(database);
    const objects = database.query<SchemaObject, []>("SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE type IN ('table','index','trigger') ORDER BY type,name").all();
    const graph = new Set<string>(GRAPH);
    for (const object of objects) {
      if (object.type !== 'table') continue;
      const references = database.query<{ table: string }, []>('PRAGMA foreign_key_list(' + quoteSqlIdentifier(object.name) + ')').all();
      if (!graph.has(object.name) && references.some(reference => graph.has(reference.table))) {
        throw new Error('Jobs source migration found an unexpected incoming foreign key.');
      }
    }
    for (const table of GRAPH) {
      const columns = database.query<{ name: string }, []>('PRAGMA table_info(' + quoteSqlIdentifier(table) + ')').all().map(column => column.name);
      if (JSON.stringify(columns) !== JSON.stringify(Object.keys(JOB_TABLES[table]!))) {
        throw new Error('Jobs source migration found an unexpected historical table shape.');
      }
      if (!objects.some(object => object.type === 'table' && object.name === table && object.sql)) {
        throw new Error('Jobs source migration could not retain historical table definitions.');
      }
    }
    // Keep private inputs/seals inside the same owned Fabric file, not SQLite's
    // host-default TEMP directory (Bun's TEMP_STORE=1 may spill there). These
    // copies are dropped before commit; rollback removes them on failure.
    for (const table of GRAPH) database.run('CREATE TABLE ' + quoteSqlIdentifier(stagingName(table)) + ' AS SELECT ' + columnList(table) + ' FROM ' + quoteSqlIdentifier(table));
    for (const table of DROP_ORDER) database.run('DROP TABLE ' + quoteSqlIdentifier(table));
    for (const [name, schema] of Object.entries(JOB_SOURCE_TABLES)) createTable(database, name, schema);
    createTable(database, 'job_schedules', JOB_SOURCE_SCHEDULE_TABLE);
    for (const table of GRAPH.slice(1)) database.run(objects.find(object => object.type === 'table' && object.name === table)!.sql!);
    for (const table of GRAPH) {
      database.run('INSERT INTO ' + quoteSqlIdentifier(table) + ' (' + columnList(table) + ') SELECT ' + columnList(table) + ' FROM main.' + quoteSqlIdentifier(stagingName(table)));
      // Stream the staged rows against the retained primary-key index. EXCEPT
      // would build a large temporary sorting tree containing private payloads.
      const unequal = Object.keys(JOB_TABLES[table]!).map(column => 'old.' + quoteSqlIdentifier(column) + ' IS NOT actual.' + quoteSqlIdentifier(column)).join(' OR ');
      const mismatch = database.query('SELECT 1 FROM main.' + quoteSqlIdentifier(stagingName(table)) + ' old LEFT JOIN ' + quoteSqlIdentifier(table)
        + ' actual ON actual.id=old.id WHERE actual.id IS NULL OR ' + unequal + ' LIMIT 1').get();
      const count = database.query<{ old_count: number; actual_count: number }, []>('SELECT (SELECT count(*) FROM main.' + quoteSqlIdentifier(stagingName(table))
        + ') AS old_count,(SELECT count(*) FROM ' + quoteSqlIdentifier(table) + ') AS actual_count').get()!;
      if (mismatch || count.old_count !== count.actual_count) throw new Error('Jobs source migration could not retain historical rows.');
    }
    // Restore original SQL, including unknown application-added indexes/triggers,
    // rather than reinterpreting immutable admissions, authority seals or receipts.
    for (const object of objects) if (graph.has(object.tbl_name) && object.type === 'index' && object.sql) database.run(object.sql);
    for (const object of objects) if (graph.has(object.tbl_name) && object.type === 'trigger' && object.sql) database.run(object.sql);
    for (const sql of SOURCE_SQL) database.run(sql);
    assertForeignKeys(database);
    for (const table of GRAPH) database.run('DROP TABLE main.' + quoteSqlIdentifier(stagingName(table)));
  },
});

const SOURCE_SQL = [
  'CREATE UNIQUE INDEX jobs_source_identity ON _jobs_sources(scope_id,identity_hash)',
  'CREATE UNIQUE INDEX jobs_source_policy_generation ON _jobs_source_policies(source_id,generation)',
  'CREATE INDEX jobs_source_schedule_page ON job_schedules(scope_id,source_id,created_at DESC,id DESC)',
  ...['_jobs_sources', '_jobs_source_policies', '_jobs_source_intents'].flatMap(table => [
    `CREATE TRIGGER ${table}_scope BEFORE INSERT ON ${table} WHEN NOT EXISTS(SELECT 1 FROM _jobs_owner WHERE id='application' AND scope_id=NEW.scope_id) BEGIN SELECT RAISE(ABORT,'Private job source scope is inconsistent'); END`,
    `CREATE TRIGGER ${table}_scope_update BEFORE UPDATE OF id,scope_id ON ${table} WHEN OLD.id IS NOT NEW.id OR OLD.scope_id IS NOT NEW.scope_id BEGIN SELECT RAISE(ABORT,'Private job source identity is immutable'); END`,
    `CREATE TRIGGER ${table}_no_replace BEFORE INSERT ON ${table} WHEN EXISTS(SELECT 1 FROM ${table} WHERE id=NEW.id${table === '_jobs_sources' ? ' OR (scope_id=NEW.scope_id AND identity_hash=NEW.identity_hash)' : table === '_jobs_source_policies' ? ' OR (source_id=NEW.source_id AND generation=NEW.generation)' : ''}) BEGIN SELECT RAISE(ABORT,'Private job source identity cannot be replaced'); END`,
  ]),
  ...['_jobs_source_policies', '_jobs_source_intents'].flatMap(table => ['UPDATE', 'DELETE'].map(operation =>
    `CREATE TRIGGER ${table}_${operation.toLowerCase()} BEFORE ${operation} ON ${table} BEGIN SELECT RAISE(ABORT,'Private job source evidence is immutable'); END`)),
  ...['_jobs_source_policies', '_jobs_source_intents'].map(table =>
    `CREATE TRIGGER ${table}_parent BEFORE INSERT ON ${table} WHEN NOT EXISTS(SELECT 1 FROM _jobs_sources WHERE id=NEW.source_id AND scope_id=NEW.scope_id) BEGIN SELECT RAISE(ABORT,'Private job source parent is inconsistent'); END`),
  `CREATE TRIGGER _jobs_source_intents_policy BEFORE INSERT ON _jobs_source_intents WHEN NOT EXISTS(SELECT 1 FROM _jobs_source_policies WHERE source_id=NEW.source_id AND scope_id=NEW.scope_id AND generation=NEW.policy_generation) BEGIN SELECT RAISE(ABORT,'Private job source policy is inconsistent'); END`,
  `CREATE TRIGGER _jobs_sources_retain BEFORE DELETE ON _jobs_sources BEGIN SELECT RAISE(ABORT,'Private job source history must be retained'); END`,
  `CREATE TRIGGER jobs_source_identity BEFORE UPDATE OF identity_json,identity_hash,created_at ON _jobs_sources WHEN OLD.identity_json IS NOT NEW.identity_json OR OLD.identity_hash IS NOT NEW.identity_hash OR OLD.created_at IS NOT NEW.created_at BEGIN SELECT RAISE(ABORT,'Private job source ownership is immutable'); END`,
  `CREATE TRIGGER jobs_source_revision BEFORE UPDATE ON _jobs_sources WHEN NEW.revision<>OLD.revision+1 OR NEW.current_generation<OLD.current_generation OR NEW.current_generation>OLD.current_generation+1 OR (OLD.state='retired' AND NEW.state='active' AND NEW.current_generation<>OLD.current_generation+1) BEGIN SELECT RAISE(ABORT,'Private job source revision is inconsistent'); END`,
  `CREATE TRIGGER jobs_schedule_source_identity BEFORE UPDATE OF source_id ON job_schedules WHEN OLD.source_id IS NOT NEW.source_id BEGIN SELECT RAISE(ABORT,'Private schedule source ownership is immutable'); END`,
  `CREATE TRIGGER jobs_schedule_source_parent BEFORE INSERT ON job_schedules WHEN NEW.source_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM _jobs_sources WHERE id=NEW.source_id AND scope_id=NEW.scope_id) BEGIN SELECT RAISE(ABORT,'Private schedule source is inconsistent'); END`,
];
