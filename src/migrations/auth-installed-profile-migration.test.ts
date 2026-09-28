import { Database } from 'bun:sqlite';
import { expect, test } from 'bun:test';

import { installAuthAuthorityRevision } from '../auth/auth-authority-revision';
import { defineAuthTables } from '../auth/auth-schema';
import { createReactiveDB } from '../sync/reactive-db';
import { migrations } from './index';
import { Migrator } from './migrator';

test('migration 023 installs the frozen profile schema and authority triggers', () => {
  const database = new Database(':memory:');
  const migrator = new Migrator({
    database,
    dbPath: ':memory:',
    migrations,
    createBackups: false,
    log: () => {},
  });

  try {
    expect(migrator.run('022').at(-1)).toBe('022');
    expect(database.query(`
      SELECT name FROM sqlite_master
      WHERE type = 'table' AND name = '_auth_installed_profile'
    `).get()).toBeNull();
    expect(migrator.run('023')).toEqual(['023']);

    expect(profileColumns(database)).toEqual([
      ['singleton', 'INTEGER', 0, 1],
      ['version', 'INTEGER', 1, 0],
      ['generation', 'INTEGER', 1, 0],
      ['tenancy', 'TEXT', 1, 0],
      ['authorization', 'TEXT', 1, 0],
      ['updated_at', 'INTEGER', 1, 0],
    ]);
    const sql = (database.query(`
      SELECT sql FROM sqlite_master
      WHERE type = 'table' AND name = '_auth_installed_profile'
    `).get() as { sql: string }).sql;
    expect(normalize(sql)).toContain('check(singleton=1)');
    expect(normalize(sql)).toContain('check(version=1)');
    expect(normalize(sql)).toContain('check(generation>=1)');
    expect(normalize(sql)).toContain("check(tenancyin('single','multi'))");
    expect(normalize(sql)).toContain("check(authorizationin('simple','advanced'))");

    const triggerNames = (database.query(`
      SELECT name FROM sqlite_master
      WHERE type = 'trigger'
        AND name LIKE 'trg_zero_authority__auth_installed_profile_%'
      ORDER BY name
    `).all() as Array<{ name: string }>).map((row) => row.name);
    expect(triggerNames).toEqual([
      'trg_zero_authority__auth_installed_profile_delete_v1',
      'trg_zero_authority__auth_installed_profile_insert_v1',
      'trg_zero_authority__auth_installed_profile_update_v1',
    ]);

    const before = authorityRevision(database);
    database.query(`
      INSERT INTO _auth_installed_profile (
        singleton, version, generation, tenancy, authorization, updated_at
      ) VALUES (1, 1, 1, 'single', 'simple', 0)
    `).run();
    expect(authorityRevision(database)).toBe(before + 1);
    database.query(`
      UPDATE _auth_installed_profile
      SET generation = 2, authorization = 'advanced', updated_at = 1
      WHERE singleton = 1
    `).run();
    expect(authorityRevision(database)).toBe(before + 2);
  } finally {
    migrator.dispose();
    database.close();
  }
});

test('migration 023 profile table stays in parity with runtime schema creation', () => {
  const migrated = new Database(':memory:');
  const migrator = new Migrator({
    database: migrated,
    dbPath: ':memory:',
    migrations,
    createBackups: false,
    log: () => {},
  });
  const runtimeRaw = new Database(':memory:');
  const runtime = createReactiveDB({ database: runtimeRaw });

  try {
    migrator.run('023');
    defineAuthTables(runtime);
    installAuthAuthorityRevision(runtime);
    expect(profileColumns(runtimeRaw)).toEqual(profileColumns(migrated));
    expect(normalize(tableSql(runtimeRaw))).toBe(normalize(tableSql(migrated)));
  } finally {
    runtime.dispose();
    runtimeRaw.close();
    migrator.dispose();
    migrated.close();
  }
});

function profileColumns(database: Database): Array<[string, string, number, number]> {
  return (database.query('PRAGMA table_info(_auth_installed_profile)').all() as Array<{
    name: string;
    type: string;
    notnull: number;
    pk: number;
  }>).map((column) => [column.name, column.type, column.notnull, column.pk]);
}

function tableSql(database: Database): string {
  return (database.query(`
    SELECT sql FROM sqlite_master
    WHERE type = 'table' AND name = '_auth_installed_profile'
  `).get() as { sql: string }).sql;
}

function normalize(sql: string): string {
  return sql.toLowerCase().replace(/\s+/g, '').replaceAll('"', '');
}

function authorityRevision(database: Database): number {
  return (database.query(`
    SELECT revision FROM _auth_authority_revision WHERE singleton = 1
  `).get() as { revision: number }).revision;
}
