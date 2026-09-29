import { Database } from 'bun:sqlite';
import { expect, test } from 'bun:test';

import { defineAuthTables } from '../auth/auth-schema';
import { defineAuthTenantOnboardingTables } from '../auth/auth-tenant-onboarding-schema';
import { defineTenancyTables } from '../auth/tenancy/tenancy-schema';
import { createReactiveDB } from '../sync/reactive-db';
import { migrations } from './index';
import { Migrator } from './migrator';

const PARITY_TABLES = [
  '_auth_tenants',
  '_auth_sessions',
  '_auth_session_continuations',
  '_auth_native_codes',
  '_auth_native_sessions',
  '_auth_tenant_invitations',
] as const;

test('001 through 027 introduce auth columns once and match fresh runtime schema', () => {
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
    expect(migrator.run('023').at(-1)).toBe('023');
    expect(columnNames(migratedDb, '_auth_tenants')).not.toContain('kind');
    for (const table of [
      '_auth_sessions',
      '_auth_session_continuations',
      '_auth_native_codes',
      '_auth_native_sessions',
    ]) expect(columnNames(migratedDb, table)).not.toContain('mfa_verified_at');
    expect(columnNames(migratedDb, '_auth_tenant_invitations'))
      .not.toContain('grant_snapshot_json');

    expect(migrator.run('024')).toEqual(['024']);
    expect(columnNames(migratedDb, '_auth_tenants').at(-1)).toBe('kind');
    expect(migrator.run('025')).toEqual(['025']);
    for (const table of [
      '_auth_sessions',
      '_auth_session_continuations',
      '_auth_native_codes',
      '_auth_native_sessions',
    ]) expect(columnNames(migratedDb, table).at(-1)).toBe('mfa_verified_at');
    expect(migrator.run('026')).toEqual(['026']);
    expect(columnNames(migratedDb, '_auth_tenant_invitations').slice(-2)).toEqual([
      'grant_snapshot_json',
      'grant_snapshot_fingerprint',
    ]);
    expect(migrator.run('027')).toEqual(['027']);

    defineAuthTables(runtime);
    defineTenancyTables(runtime);
    defineAuthTenantOnboardingTables(runtime);
    for (const table of PARITY_TABLES) {
      expect(tableShape(migratedDb, table)).toEqual(tableShape(runtimeDb, table));
    }
    expect(triggerShape(migratedDb, '_auth_tenants'))
      .toEqual(triggerShape(runtimeDb, '_auth_tenants'));
    expect(triggerShape(migratedDb, '_auth_tenant_invitations'))
      .toEqual(triggerShape(runtimeDb, '_auth_tenant_invitations'));
  } finally {
    runtime.dispose();
    migrator.dispose();
    runtimeDb.close();
    migratedDb.close();
  }
});

function columnNames(db: Database, table: string): string[] {
  return (db.query(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>)
    .map((column) => column.name);
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

function triggerShape(db: Database, table: string): Array<{ name: string; sql: string }> {
  return (db.query(`SELECT name, sql FROM sqlite_master
    WHERE type = 'trigger' AND tbl_name = ?
      AND name NOT LIKE 'trg_zero_authority_%'
    ORDER BY name`).all(table) as Array<{
      name: string;
      sql: string;
    }>).map((trigger) => ({
      name: trigger.name,
      sql: trigger.sql.replace(/\s+/g, ' ').trim(),
    }));
}
