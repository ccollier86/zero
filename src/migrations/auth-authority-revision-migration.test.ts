import { Database } from 'bun:sqlite';
import { expect, test } from 'bun:test';

import { installAuthAuthorityRevision } from '../auth/auth-authority-revision';
import { defineAuthTables } from '../auth/auth-schema';
import { defineTenancyTables } from '../auth/tenancy/tenancy-schema';
import { createReactiveDB } from '../sync/reactive-db';
import { migrations } from './index';
import { Migrator } from './migrator';

test('migration 020 installs the durable authority revision and triggers', () => {
  const database = new Database(':memory:');
  const migrator = new Migrator({
    database,
    dbPath: ':memory:',
    migrations,
    createBackups: false,
    log: () => {},
  });

  try {
    expect(migrator.run('019').at(-1)).toBe('019');
    expect(migrator.run('020')).toEqual(['020']);

    const table = database.query(`
      SELECT name FROM sqlite_master
      WHERE type = 'table' AND name = '_auth_authority_revision'
    `).get();
    expect(table).toEqual({ name: '_auth_authority_revision' });

    const triggerNames = (database.query(`
      SELECT name FROM sqlite_master
      WHERE type = 'trigger' AND name LIKE 'trg_zero_authority_%'
      ORDER BY name
    `).all() as Array<{ name: string }>).map((row) => row.name);
    expect(triggerNames).toEqual(expect.arrayContaining([
      'trg_zero_authority_users_update_v2',
      'trg_zero_authority__auth_sessions_update_v1',
      'trg_zero_authority__auth_tenants_update_v1',
      'trg_zero_authority__auth_tenant_memberships_update_v1',
      'trg_zero_authority__auth_application_role_assignments_update_v1',
      'trg_zero_authority__auth_tenant_membership_roles_update_v1',
      'trg_zero_authority__auth_native_sessions_update_v1',
    ]));

    const before = authorityRevision(database);
    database.query(`
      INSERT INTO users (
        user_id, username, email, role, status, created_at
      ) VALUES (?, ?, ?, 'user', 'active', ?)
    `).run('migration-user', 'migration-user', 'migration@example.test', Date.now());
    expect(authorityRevision(database)).toBe(before + 1);

    database.query('UPDATE users SET first_name = ? WHERE user_id = ?')
      .run('Cosmetic', 'migration-user');
    expect(authorityRevision(database)).toBe(before + 1);
    database.query("UPDATE users SET role = 'admin' WHERE user_id = ?")
      .run('migration-user');
    expect(authorityRevision(database)).toBe(before + 2);
    database.query('UPDATE users SET email_verified_at = ? WHERE user_id = ?')
      .run(Date.now(), 'migration-user');
    expect(authorityRevision(database)).toBe(before + 3);
    expect(database.query(`
      SELECT name FROM sqlite_master
      WHERE type = 'trigger' AND name = 'trg_zero_authority_users_update_v1'
    `).get()).toBeNull();

    const beforeSession = authorityRevision(database);
    const now = Date.now();
    database.query(`
      INSERT INTO _auth_sessions (
        session_id, user_id, kind, status, generation, scope_kind, scope_id,
        provenance, authenticated_at, created_at, last_seen_at, expires_at
      ) VALUES (?, ?, 'web', 'active', 0, 'application', 'application',
        'local', ?, ?, ?, ?)
    `).run('session-1', 'migration-user', now, now, now, now + 60_000);
    expect(authorityRevision(database)).toBe(beforeSession + 1);

    // Migration 020's historical contract watched only its then-known
    // authority fields. Migration 027 owns the fail-closed v2 replacement.
    database.query(`
      UPDATE _auth_sessions SET last_seen_at = ?, expires_at = ?
      WHERE session_id = ?
    `).run(now + 1_000, now + 61_000, 'session-1');
    expect(authorityRevision(database)).toBe(beforeSession + 1);
    database.query(`
      UPDATE _auth_sessions SET status = 'revoked', generation = generation + 1
      WHERE session_id = ?
    `).run('session-1');
    expect(authorityRevision(database)).toBe(beforeSession + 2);
  } finally {
    migrator.dispose();
    database.close();
  }
});

test('migration 027 upgrades authority triggers to the frozen current contract', () => {
  const database = new Database(':memory:');
  const runtimeDatabase = new Database(':memory:');
  const runtime = createReactiveDB({ database: runtimeDatabase });
  const migrator = new Migrator({
    database,
    dbPath: ':memory:',
    migrations,
    createBackups: false,
    log: () => {},
  });

  try {
    expect(migrator.run('027').at(-1)).toBe('027');
    const triggerNames = new Set((database.query(`
      SELECT name FROM sqlite_master
      WHERE type = 'trigger' AND name LIKE 'trg_zero_authority_%'
    `).all() as Array<{ name: string }>).map((row) => row.name));
    expect(triggerNames.has('trg_zero_authority__auth_sessions_update_v2')).toBe(true);
    expect(triggerNames.has('trg_zero_authority__auth_sessions_update_v1')).toBe(false);
    expect(triggerNames.has('trg_zero_authority__auth_tenants_update_v2')).toBe(true);
    expect(triggerNames.has('trg_zero_authority__auth_tenants_update_v1')).toBe(false);
    expect(triggerNames.has('trg_zero_authority__auth_native_sessions_update_v2')).toBe(true);
    expect(triggerNames.has('trg_zero_authority__auth_native_sessions_update_v1')).toBe(false);

    defineAuthTables(runtime);
    defineTenancyTables(runtime);
    installAuthAuthorityRevision(runtime);
    expect(currentAuthorityTriggerShape(database))
      .toEqual(currentAuthorityTriggerShape(runtimeDatabase));

    const now = Date.now();
    database.query(`INSERT INTO users (
      user_id, username, email, role, status, created_at
    ) VALUES (?, ?, ?, 'user', 'active', ?)`)
      .run('v027-owner', 'v027-owner', 'v027@example.test', now);
    database.query(`INSERT INTO _auth_tenants (
      tenant_id, slug, name, created_by, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?)`)
      .run('v027-tenant', 'v027-tenant', 'V027 tenant', 'v027-owner', now, now);

    const beforeCosmetic = authorityRevision(database);
    database.query(`UPDATE _auth_tenants SET updated_at = updated_at
      WHERE tenant_id = ?`).run('v027-tenant');
    expect(authorityRevision(database)).toBe(beforeCosmetic);
    database.query(`UPDATE _auth_tenants SET kind = 'administration'
      WHERE tenant_id = ?`).run('v027-tenant');
    expect(authorityRevision(database)).toBe(beforeCosmetic + 1);
  } finally {
    runtime.dispose();
    runtimeDatabase.close();
    migrator.dispose();
    database.close();
  }
});

function currentAuthorityTriggerShape(database: Database) {
  return (database.query(`SELECT name, sql FROM sqlite_master
    WHERE type = 'trigger'
      AND name LIKE 'trg_zero_authority_%'
      AND tbl_name IN (
        '_auth_sessions', '_auth_tenants', '_auth_native_sessions',
        '_auth_authorization_manifest'
      )
    ORDER BY name`).all() as Array<{ name: string; sql: string }>).map((trigger) => ({
    name: trigger.name,
    sql: trigger.sql.replace(/\s+/g, ' ').trim(),
  }));
}

function authorityRevision(database: Database): number {
  return (database.query(`
    SELECT revision FROM _auth_authority_revision WHERE singleton = 1
  `).get() as { revision: number }).revision;
}
