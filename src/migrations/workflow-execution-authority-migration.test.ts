import { Database } from 'bun:sqlite';
import { expect, test } from 'bun:test';
import { createReactiveDB } from '../sync/reactive-db';
import {
  defineWorkflowExecutionAuthorityTables,
} from '../workflows/workflow-execution-authority';
import { migrations } from './index';
import { Migrator } from './migrator';

const TABLES = [
  '_workflow_execution_authorities',
  '_workflow_step_executions',
] as const;

test('migration 014 matches runtime authority tables and is idempotent', () => {
  const migrated = new Database(':memory:');
  const runtimeRaw = new Database(':memory:');
  const runtime = createReactiveDB({ database: runtimeRaw });
  const migrator = new Migrator({
    database: migrated,
    dbPath: ':memory:',
    migrations,
    createBackups: false,
    log: () => {},
  });

  try {
    migrator.run('013');
    expect(migrator.run('014')).toEqual(['014']);
    expect(migrator.run('014')).toEqual([]);

    defineWorkflowExecutionAuthorityTables(runtime);
    expect(shape(migrated)).toEqual(shape(runtimeRaw));
    expect(indexes(migrated)).toEqual([
      'idx_workflow_authority_tenant_actor',
      'idx_workflow_step_executions_instance',
      'sqlite_autoindex__workflow_execution_authorities_1',
      'sqlite_autoindex__workflow_step_executions_1',
      'sqlite_autoindex__workflow_step_executions_2',
    ]);
  } finally {
    migrator.dispose();
    runtime.dispose();
    runtimeRaw.close();
    migrated.close();
  }
});

function shape(db: Database) {
  return Object.fromEntries(TABLES.map((table) => [
    table,
    (db.query(`PRAGMA table_info(${table})`).all() as Array<{
      name: string;
      type: string;
      notnull: number;
      dflt_value: string | null;
      pk: number;
    }>).map((column) => ({
      name: column.name,
      type: column.type,
      notnull: column.notnull,
      default: column.dflt_value,
      pk: column.pk,
    })),
  ]));
}

function indexes(db: Database): string[] {
  return TABLES.flatMap((table) =>
    (db.query(`PRAGMA index_list(${table})`).all() as Array<{ name: string }>)
      .map((row) => row.name))
    .sort();
}
