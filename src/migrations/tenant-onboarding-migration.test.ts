import { Database } from 'bun:sqlite';
import { expect, test } from 'bun:test';

import { migrations } from './index';
import { Migrator } from './migrator';

const TABLES = [
  '_auth_tenant_invitations',
  '_auth_tenant_join_requests',
  '_auth_email_outbox',
] as const;

test('migration 013 freezes the historical tenant-onboarding schema and is idempotent', () => {
  const migratedDb = new Database(':memory:');
  const migrator = new Migrator({
    database: migratedDb,
    dbPath: ':memory:',
    migrations,
    createBackups: false,
    log: () => {},
  });

  try {
    migratedDb.exec('PRAGMA foreign_keys = ON');
    expect(migrator.run('013')).toContain('013');

    expect(columnNames(migratedDb, '_auth_tenant_invitations')).toEqual([
      'invitation_id', 'tenant_id', 'email', 'token_hash', 'role_keys_json',
      'status', 'issued_by', 'accepted_by_user_id', 'expires_at', 'created_at',
      'updated_at', 'accepted_at', 'revoked_at',
    ]);
    expect(JSON.stringify(triggerShape(migratedDb)))
      .not.toContain('grant_snapshot');

    const frozenShapes = Object.fromEntries(TABLES.map((table) => [
      table,
      tableShape(migratedDb, table),
    ]));
    const frozenTriggers = triggerShape(migratedDb);
    const migration = migrations.find((entry) => entry.version === '013')!;
    migration.up(migratedDb);
    migration.up(migratedDb);
    for (const table of TABLES) {
      expect(tableShape(migratedDb, table)).toEqual(frozenShapes[table]);
    }
    expect(triggerShape(migratedDb)).toEqual(frozenTriggers);
  } finally {
    migrator.dispose();
    migratedDb.close();
  }
});

test('migration 013 preserves queued account email jobs while widening the outbox', () => {
  const db = new Database(':memory:');
  const migrator = new Migrator({
    database: db,
    dbPath: ':memory:',
    migrations,
    createBackups: false,
    log: () => {},
  });
  try {
    migrator.run('012');
    db.query(`
      INSERT INTO _auth_email_outbox (
        job_id, kind, recipient, recipient_hash, native_continuation,
        status, attempts, available_at, created_at, updated_at
      ) VALUES (?, 'password_reset', ?, ?, NULL, 'pending', 0, ?, ?, ?)
    `).run('aem_existing', 'existing@example.test', 'recipient-hash', 1, 1, 1);
    migrator.run('013');
    expect(db.query(`
      SELECT job_id, kind, recipient, status, invitation_id, secret_envelope
      FROM _auth_email_outbox
    `).get()).toEqual({
      job_id: 'aem_existing',
      kind: 'password_reset',
      recipient: 'existing@example.test',
      status: 'pending',
      invitation_id: null,
      secret_envelope: null,
    });
  } finally {
    migrator.dispose();
    db.close();
  }
});

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

function columnNames(db: Database, table: string): string[] {
  return (db.query(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>)
    .map((column) => column.name);
}

function triggerShape(db: Database) {
  return (db.query(`
    SELECT name, sql FROM sqlite_master
    WHERE type = 'trigger' AND name LIKE 'trg_auth_tenant_%_binding_immutable'
    ORDER BY name
  `).all() as Array<{ name: string; sql: string }>).map((row) => ({
    name: row.name,
    sql: row.sql.replace(/\s+/g, ' ').trim(),
  }));
}
