import { Database } from 'bun:sqlite';
import { expect, test } from 'bun:test';
import { defineAuthTables } from '../auth/auth-schema';
import { defineAuthorizationRoleTables } from '../auth/authorization-role-schema';
import { createReactiveDB } from '../sync/reactive-db';
import { migrations } from './index';
import { Migrator } from './migrator';

const PROVISIONING_TABLE = '_auth_registration_provisioning';
const ADMIN_PROVISIONING_TABLE = '_auth_admin_user_provisioning';
const OWNER_DELETE_TRIGGERS = [
  'trg_auth_application_last_owner_assignment_delete',
  'trg_auth_tenant_last_owner_assignment_delete',
] as const;

test('provisioning receipt migrations preserve history and isolate admin authority', () => {
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

    migrated.exec(`
      INSERT INTO users (user_id, username, email, role, created_at)
      VALUES ('legacy-provisioning-user', 'legacy-provisioning-user',
        'legacy-provisioning-user@test.com', 'user', 1)
    `);
    migrated.exec(`
      INSERT INTO _auth_registration_provisioning (
        registration_id, user_id, is_bootstrap, created_at
      ) VALUES ('legacy-provisioning', 'legacy-provisioning-user', 0, 1)
    `);
    const adminReceiptMigration = migrations.find(
      (migration) => migration.version === '028',
    );
    expect(adminReceiptMigration).toBeDefined();
    expect(tableExists(migrated, ADMIN_PROVISIONING_TABLE)).toBe(false);
    adminReceiptMigration!.up(migrated);
    expect(migrated.query(`
      SELECT registration_id, user_id, is_bootstrap
      FROM _auth_registration_provisioning
      WHERE registration_id = 'legacy-provisioning'
    `).get()).toEqual({
      registration_id: 'legacy-provisioning',
      user_id: 'legacy-provisioning-user',
      is_bootstrap: 0,
    });
    expect(columnNames(migrated, PROVISIONING_TABLE))
      .not.toContain('provisioning_kind');

    defineAuthTables(runtime);
    defineAuthorizationRoleTables(runtime);
    expect(tableShape(migrated, PROVISIONING_TABLE))
      .toEqual(tableShape(runtimeRaw, PROVISIONING_TABLE));
    expect(tableShape(migrated, ADMIN_PROVISIONING_TABLE))
      .toEqual(tableShape(runtimeRaw, ADMIN_PROVISIONING_TABLE));
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
    adminReceiptMigration!.up(migrated);
    expect(tableShape(migrated, ADMIN_PROVISIONING_TABLE))
      .toEqual(tableShape(runtimeRaw, ADMIN_PROVISIONING_TABLE));
    expect(triggerShape(migrated)).toEqual(triggerShape(runtimeRaw));
    expect(migrations.at(-1)?.version).toBe('032');
  } finally {
    runtime.dispose();
    migrator.dispose();
    runtimeRaw.close();
    migrated.close();
  }
});

function tableExists(db: Database, table: string): boolean {
  return Boolean(db.query(`SELECT 1 FROM sqlite_master
    WHERE type = 'table' AND name = ?`).get(table));
}

function columnNames(db: Database, table: string): string[] {
  return (db.query(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>)
    .map((column) => column.name);
}

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
