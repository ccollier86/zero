import { Database } from 'bun:sqlite';
import { describe, expect, test } from 'bun:test';

import { defineAuthTables } from '../auth/auth-schema';
import { defineAuthTenantOnboardingTables } from '../auth/auth-tenant-onboarding-schema';
import { defineTenancyTables } from '../auth/tenancy/tenancy-schema';
import { defineVerifiedDomainTables } from '../auth/verified-domain-schema';
import { createReactiveDB } from '../sync/reactive-db';
import { migrations } from './index';
import { Migrator } from './migrator';

const TABLES = [
  '_auth_request_admissions',
  '_auth_email_outbox',
  '_auth_tenant_domain_claims',
  '_auth_tenant_domain_policies',
  '_auth_domain_mailbox_tokens',
  '_auth_mailbox_proofs',
  '_auth_domain_onboarding_transactions',
  '_auth_domain_join_request_provenance',
  '_auth_tenant_membership_provenance',
  '_auth_tenant_admission_blocks',
] as const;

describe('migration 017 verified-domain onboarding', () => {
  test('matches the runtime schema and remains idempotent', () => {
    const migrated = new Database(':memory:');
    const runtimeRaw = new Database(':memory:');
    const runtime = createReactiveDB({ database: runtimeRaw });
    const migrator = createMigrator(migrated);
    try {
      migrated.exec('PRAGMA foreign_keys = ON');
      runtimeRaw.exec('PRAGMA foreign_keys = ON');
      expect(migrator.run('017').at(-1)).toBe('017');

      defineAuthTables(runtime);
      defineTenancyTables(runtime);
      defineAuthTenantOnboardingTables(runtime);
      defineVerifiedDomainTables(runtime);

      for (const table of TABLES) {
        expect(tableShape(migrated, table)).toEqual(tableShape(runtimeRaw, table));
      }
      expect(columnShape(migrated, 'users', 'email_generation')).toEqual(
        columnShape(runtimeRaw, 'users', 'email_generation'),
      );
      expect(domainTriggerShape(migrated)).toEqual(domainTriggerShape(runtimeRaw));

      const migration = migrations.find((entry) => entry.version === '017')!;
      migration.up(migrated);
      migration.up(migrated);
      for (const table of TABLES) {
        expect(tableShape(migrated, table)).toEqual(tableShape(runtimeRaw, table));
      }
    } finally {
      runtime.dispose();
      migrator.dispose();
      runtimeRaw.close();
      migrated.close();
    }
  });

  test('preserves existing request-admission and account-email rows while widening enums', () => {
    const db = new Database(':memory:');
    const migrator = createMigrator(db);
    try {
      expect(migrator.run('016').at(-1)).toBe('016');
      db.query(`INSERT INTO _auth_request_admissions (
        admission_id, flow, source_hash, subject_hash, created_at
      ) VALUES ('existing-admission', 'login', NULL, NULL, 1)`).run();
      db.query(`INSERT INTO _auth_email_outbox (
        job_id, kind, recipient, recipient_hash, status, attempts,
        available_at, created_at, updated_at
      ) VALUES ('existing-email', 'password_reset', 'person@example.test',
        'hash', 'pending', 0, 1, 1, 1)`).run();

      expect(migrator.run('017')).toEqual(['017']);
      expect(db.query(`SELECT admission_id, flow FROM _auth_request_admissions
        WHERE admission_id = 'existing-admission'`).get()).toEqual({
        admission_id: 'existing-admission',
        flow: 'login',
      });
      expect(db.query(`SELECT job_id, kind, recipient, domain_user_id
        FROM _auth_email_outbox WHERE job_id = 'existing-email'`).get()).toEqual({
        job_id: 'existing-email',
        kind: 'password_reset',
        recipient: 'person@example.test',
        domain_user_id: null,
      });
      expect(tableSql(db, '_auth_request_admissions')).toContain("'domain-onboarding'");
      expect(tableSql(db, '_auth_email_outbox')).toContain("'domain_mailbox_proof'");
    } finally {
      migrator.dispose();
      db.close();
    }
  });
});

function createMigrator(database: Database): Migrator {
  return new Migrator({
    database,
    dbPath: ':memory:',
    migrations,
    createBackups: false,
    log: () => {},
  });
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

function domainTriggerShape(db: Database) {
  return (db.query(`SELECT name, sql FROM sqlite_master
    WHERE type = 'trigger' AND name = 'trg_auth_users_email_generation'`).all() as Array<{
      name: string;
      sql: string;
    }>).map((row) => ({ name: row.name, sql: row.sql.replace(/\s+/g, ' ').trim() }));
}

function tableSql(db: Database, table: string): string {
  return (db.query(`SELECT sql FROM sqlite_master
    WHERE type = 'table' AND name = ?`).get(table) as { sql: string }).sql;
}

function columnShape(db: Database, table: string, column: string) {
  return (db.query(`PRAGMA table_info(${table})`).all() as Array<{
    name: string;
  }>).find((candidate) => candidate.name === column);
}
