import { Database } from 'bun:sqlite';
import { expect, test } from 'bun:test';

import { defineAuthTables } from '../auth/auth-schema';
import { defineAuthTenantOnboardingTables } from '../auth/auth-tenant-onboarding-schema';
import { defineTenancyTables } from '../auth/tenancy/tenancy-schema';
import { createReactiveDB } from '../sync/reactive-db';
import { migrations } from './index';
import { Migrator } from './migrator';

const TABLES = [
  '_auth_tenant_invitations',
  '_auth_tenant_join_requests',
  '_auth_email_outbox',
] as const;

test('migration 013 matches the runtime tenant-onboarding schema and is idempotent', () => {
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
    expect(migrator.run('013')).toContain('013');

    defineAuthTables(runtime);
    defineTenancyTables(runtime);
    defineAuthTenantOnboardingTables(runtime);

    for (const table of TABLES) {
      expect(tableShape(migratedDb, table)).toEqual(tableShape(runtimeDb, table));
    }
    expect(triggerShape(migratedDb)).toEqual(triggerShape(runtimeDb));

    const migration = migrations.find((entry) => entry.version === '013')!;
    migration.up(migratedDb);
    migration.up(migratedDb);
    for (const table of TABLES) {
      expect(tableShape(migratedDb, table)).toEqual(tableShape(runtimeDb, table));
    }
  } finally {
    runtime.dispose();
    migrator.dispose();
    runtimeDb.close();
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
