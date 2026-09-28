import { Database } from 'bun:sqlite';
import { expect, test } from 'bun:test';
import { defineAuthAuditTables } from '../auth/auth-audit-schema';
import { createReactiveDB } from '../sync/reactive-db';
import { migrations } from './index';
import { Migrator } from './migrator';

test('migration 018 matches the runtime control-plane audit schema', () => {
  const migrated = new Database(':memory:');
  const runtimeSqlite = new Database(':memory:');
  const runtime = createReactiveDB({ database: runtimeSqlite });
  const migrator = new Migrator({
    database: migrated,
    dbPath: ':memory:',
    migrations,
    createBackups: false,
    log: () => {},
  });
  try {
    migrator.run('017');
    expect(migrator.run('018')).toEqual(['018']);
    defineAuthAuditTables(runtime);
    for (const table of ['_auth_audit_events', '_auth_audit_retention_gate']) {
      expect(tableShape(migrated, table)).toEqual(tableShape(runtimeSqlite, table));
    }
    expect(triggerShape(migrated)).toEqual(triggerShape(runtimeSqlite));
  } finally {
    runtime.dispose();
    migrator.dispose();
    runtimeSqlite.close();
    migrated.close();
  }
});

function tableShape(db: Database, table: string) {
  return {
    columns: db.query(`PRAGMA table_info(${table})`).all(),
    indexes: db.query(`PRAGMA index_list(${table})`).all(),
  };
}

function triggerShape(db: Database) {
  return db.query(`
    SELECT name, sql FROM sqlite_master
    WHERE type = 'trigger' AND name LIKE 'trg_auth_audit_events_%'
    ORDER BY name
  `).all();
}
