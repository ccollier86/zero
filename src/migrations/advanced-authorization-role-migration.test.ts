import { Database } from 'bun:sqlite';
import { expect, test } from 'bun:test';

import { defineAuthTables } from '../auth/auth-schema';
import { defineAuthorizationRoleTables } from '../auth/authorization-role-schema';
import { createReactiveDB } from '../sync/reactive-db';
import { migrations } from './index';
import { Migrator } from './migrator';

const ROLE_TABLES = [
  '_auth_application_authorization_state',
  '_auth_application_role_assignments',
  '_auth_tenant_membership_roles',
] as const;

test('migration 011 matches runtime advanced-role schema and preserves upgrades fail-closed', () => {
  const migratedDb = new Database(':memory:');
  const runtimeDb = new Database(':memory:');
  const runtime = createReactiveDB({ database: runtimeDb });
  const migrator = new Migrator({
    database: migratedDb,
    dbPath: ':memory:',
    migrations,
    createBackups: false,
    log: () => {},
  });

  try {
    migratedDb.exec('PRAGMA foreign_keys = ON');
    runtimeDb.exec('PRAGMA foreign_keys = ON');
    migrator.run('010');
    seedPreAdvancedOwner(migratedDb);

    expect(migrator.run('011')).toEqual(['011']);
    expect(migratedDb.query(`
      SELECT tenant_id, user_id, role_key
      FROM _auth_tenant_memberships WHERE membership_id = 'legacy-membership'
    `).get()).toEqual({
      tenant_id: 'legacy-tenant',
      user_id: 'legacy-owner',
      role_key: 'owner',
    });
    // Schema migration never guesses an application owner or silently grants
    // advanced authority. Runtime performs explicit config/bootstrap adoption.
    expect(countRows(migratedDb, '_auth_application_role_assignments')).toBe(0);
    expect(countRows(migratedDb, '_auth_tenant_membership_roles')).toBe(0);

    defineAuthTables(runtime);
    defineAuthorizationRoleTables(runtime, { registrationProvisioning: false });
    for (const table of ROLE_TABLES) {
      expect(tableShape(migratedDb, table)).toEqual(tableShape(runtimeDb, table));
    }
    expect(authorizationTriggerShape(migratedDb))
      .toEqual(authorizationTriggerShape(runtimeDb));
    expect(JSON.stringify(authorizationTriggerShape(migratedDb)))
      .not.toContain('_auth_registration_provisioning');

    const m011 = migrations.find((migration) => migration.version === '011')!;
    m011.up(migratedDb);
    m011.up(migratedDb);
    expect(countRows(migratedDb, '_auth_application_role_assignments')).toBe(0);
    for (const table of ROLE_TABLES) {
      expect(tableShape(migratedDb, table)).toEqual(tableShape(runtimeDb, table));
    }
  } finally {
    runtime.dispose();
    migrator.dispose();
    runtimeDb.close();
    migratedDb.close();
  }
});

function seedPreAdvancedOwner(db: Database): void {
  db.run(`
    INSERT INTO users (
      user_id, username, email, role, status, password_change_required,
      email_verification_required, mfa_required, created_at, updated_at
    ) VALUES (
      'legacy-owner', 'legacy-owner', 'legacy-owner@example.test', 'admin',
      'active', 0, 0, 0, 1, NULL
    )
  `);
  db.run(`
    INSERT INTO _auth_tenants (
      tenant_id, slug, name, status, authorization_generation,
      created_by, created_at, updated_at, suspended_at
    ) VALUES (
      'legacy-tenant', 'legacy', 'Legacy', 'active', 0,
      'legacy-owner', 1, 1, NULL
    )
  `);
  db.run(`
    INSERT INTO _auth_tenant_memberships (
      membership_id, tenant_id, user_id, status, role_key,
      authorization_generation, joined_at, created_at, updated_at,
      suspended_at, removed_at, created_by
    ) VALUES (
      'legacy-membership', 'legacy-tenant', 'legacy-owner', 'active', 'owner',
      0, 1, 1, 1, NULL, NULL, 'legacy-owner'
    )
  `);
}

function countRows(db: Database, table: string): number {
  return (db.query(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count;
}

function tableShape(db: Database, table: string) {
  return {
    columns: db.query(`PRAGMA table_info(${table})`).all(),
    foreignKeys: db.query(`PRAGMA foreign_key_list(${table})`).all(),
    indexes: (db.query(`PRAGMA index_list(${table})`).all() as Array<{
      name: string;
      unique: number;
      partial: number;
    }>).map((index) => ({
      name: index.name,
      unique: index.unique,
      partial: index.partial,
      columns: db.query(`PRAGMA index_info(${index.name})`).all(),
    })).sort((left, right) => left.name.localeCompare(right.name)),
  };
}

function authorizationTriggerShape(db: Database): Array<{ name: string; sql: string }> {
  return (db.query(`
    SELECT name, sql FROM sqlite_master
    WHERE type = 'trigger' AND name LIKE 'trg_auth_%owner%'
    ORDER BY name
  `).all() as Array<{ name: string; sql: string }>).map((row) => ({
    name: row.name,
    sql: row.sql.replace(/\s+/g, ' ').trim(),
  }));
}
