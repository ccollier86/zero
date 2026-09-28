import { Database } from 'bun:sqlite';
import { expect, test } from 'bun:test';
import { defineAuthTables } from '../auth/auth-schema';
import { defineAuthorizationRoleTables } from '../auth/authorization-role-schema';
import { createReactiveDB } from '../sync/reactive-db';
import { migrations } from './index';
import { Migrator } from './migrator';

const PROVISIONING_TABLE = '_auth_registration_provisioning';
const OWNER_DELETE_TRIGGERS = [
  'trg_auth_application_last_owner_assignment_delete',
  'trg_auth_tenant_last_owner_assignment_delete',
] as const;

test('migration 015 adds crash-safe registration receipts and repairs owner guards', () => {
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
    migrated.exec('PRAGMA foreign_keys = ON');
    runtimeRaw.exec('PRAGMA foreign_keys = ON');
    migrator.run('014');
    expect(migrator.run('015')).toEqual(['015']);
    expect(migrator.run('015')).toEqual([]);

    defineAuthTables(runtime);
    defineAuthorizationRoleTables(runtime);
    expect(tableShape(migrated, PROVISIONING_TABLE))
      .toEqual(tableShape(runtimeRaw, PROVISIONING_TABLE));
    expect(triggerShape(migrated)).toEqual(triggerShape(runtimeRaw));

    const triggerSql = Object.fromEntries(
      triggerShape(migrated).map((trigger) => [trigger.name, trigger.sql]),
    );
    expect(triggerSql.trg_auth_application_last_owner_assignment_delete)
      .toContain('pending.registration_id = OLD.source_id');
    expect(triggerSql.trg_auth_application_last_owner_assignment_delete)
      .toContain('pending.is_bootstrap = 1');
    expect(triggerSql.trg_auth_tenant_last_owner_assignment_delete)
      .toContain('pending.tenant_id = OLD.tenant_id');
    expect(triggerSql.trg_auth_tenant_last_owner_assignment_delete)
      .toContain('pending.user_id = OLD.user_id');

    // The schema primitive itself is safe for runtime repair and offline
    // migration reruns, including replacement of pre-015 trigger bodies.
    migrations.find((migration) => migration.version === '015')!.up(migrated);
    expect(triggerShape(migrated)).toEqual(triggerShape(runtimeRaw));
  } finally {
    runtime.dispose();
    migrator.dispose();
    runtimeRaw.close();
    migrated.close();
  }
});

function tableShape(db: Database, table: string) {
  return {
    columns: db.query(`PRAGMA table_info(${table})`).all(),
    foreignKeys: db.query(`PRAGMA foreign_key_list(${table})`).all(),
    indexes: db.query(`PRAGMA index_list(${table})`).all(),
  };
}

function triggerShape(db: Database): Array<{ name: string; sql: string }> {
  return (db.query(`
    SELECT name, sql FROM sqlite_master
    WHERE type = 'trigger' AND name IN (${OWNER_DELETE_TRIGGERS.map(() => '?').join(', ')})
    ORDER BY name
  `).all(...OWNER_DELETE_TRIGGERS) as Array<{ name: string; sql: string }>).map((row) => ({
    name: row.name,
    sql: row.sql.replace(/\s+/g, ' ').trim(),
  }));
}
