import { Database } from 'bun:sqlite';
import { expect, test } from 'bun:test';

import { installAuthAuthorityRevision } from '../auth/auth-authority-revision';
import { defineAuthTables } from '../auth/auth-schema';
import { createReactiveDB } from '../sync/reactive-db';
import { migration } from './definitions/027_authorization_registry_manifest';

test('migration 027 installs the frozen registry manifest schema and authority triggers', () => {
  const database = new Database(':memory:');
  try {
    migration.up(database);
    migration.up(database);
    expect(columns(database)).toEqual([
      ['singleton', 'INTEGER', 0, 1],
      ['version', 'INTEGER', 1, 0],
      ['registry_version', 'INTEGER', 1, 0],
      ['fingerprint', 'TEXT', 1, 0],
      ['manifest_json', 'TEXT', 1, 0],
      ['updated_at', 'INTEGER', 1, 0],
    ]);
    const sql = normalize(tableSql(database));
    expect(sql).toContain('check(singleton=1)');
    expect(sql).toContain('check(version=1)');
    expect(sql).toContain('check(registry_version>=1)');
    expect(sql).toContain('check(length(fingerprint)=64)');

    const triggerNames = (database.query(`
      SELECT name FROM sqlite_master
      WHERE type = 'trigger'
        AND name LIKE 'trg_zero_authority__auth_authorization_manifest_%'
      ORDER BY name
    `).all() as Array<{ name: string }>).map((row) => row.name);
    expect(triggerNames).toEqual([
      'trg_zero_authority__auth_authorization_manifest_delete_v1',
      'trg_zero_authority__auth_authorization_manifest_insert_v1',
      'trg_zero_authority__auth_authorization_manifest_update_v1',
    ]);

    const fingerprint = 'a'.repeat(64);
    const before = authorityRevision(database);
    database.query(`
      INSERT INTO _auth_authorization_manifest (
        singleton, version, registry_version, fingerprint, manifest_json, updated_at
      ) VALUES (1, 1, 1, ?, '{}', 0)
    `).run(fingerprint);
    expect(authorityRevision(database)).toBe(before + 1);
    database.query(`
      UPDATE _auth_authorization_manifest
      SET registry_version = 2, fingerprint = ?, manifest_json = '{"v":2}', updated_at = 1
      WHERE singleton = 1
    `).run('b'.repeat(64));
    expect(authorityRevision(database)).toBe(before + 2);
  } finally {
    database.close();
  }
});

test('migration 027 registry table stays in parity with runtime schema creation', () => {
  const migrated = new Database(':memory:');
  const runtimeRaw = new Database(':memory:');
  const runtime = createReactiveDB({ database: runtimeRaw });
  try {
    migration.up(migrated);
    defineAuthTables(runtime);
    installAuthAuthorityRevision(runtime);
    expect(columns(runtimeRaw)).toEqual(columns(migrated));
    expect(normalize(tableSql(runtimeRaw))).toBe(normalize(tableSql(migrated)));
  } finally {
    runtime.dispose();
    runtimeRaw.close();
    migrated.close();
  }
});

function columns(database: Database): Array<[string, string, number, number]> {
  return (database.query('PRAGMA table_info(_auth_authorization_manifest)').all() as Array<{
    name: string;
    type: string;
    notnull: number;
    pk: number;
  }>).map((column) => [column.name, column.type, column.notnull, column.pk]);
}

function tableSql(database: Database): string {
  return (database.query(`
    SELECT sql FROM sqlite_master
    WHERE type = 'table' AND name = '_auth_authorization_manifest'
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
