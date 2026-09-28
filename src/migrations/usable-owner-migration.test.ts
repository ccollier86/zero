import { Database } from 'bun:sqlite';
import { describe, expect, test } from 'bun:test';

import { defineAuthTables } from '../auth/auth-schema';
import { defineAuthorizationRoleTables } from '../auth/authorization-role-schema';
import { createReactiveDB } from '../sync/reactive-db';
import { migrations } from './index';
import { Migrator } from './migrator';

interface TriggerRow {
  name: string;
  sql: string;
}

describe('migration 016 usable-owner invariants', () => {
  test('repairs every owner trigger to current runtime SQL', () => {
    const migrated = new Database(':memory:');
    const runtimeRaw = new Database(':memory:');
    const runtime = createReactiveDB({ database: runtimeRaw });
    const migrator = createMigrator(migrated);

    try {
      migrated.exec('PRAGMA foreign_keys = ON');
      runtimeRaw.exec('PRAGMA foreign_keys = ON');
      expect(migrator.run('015').at(-1)).toBe('015');

      defineAuthTables(runtime);
      defineAuthorizationRoleTables(runtime);
      const expected = ownerTriggerShape(runtimeRaw);
      expect(expected.length).toBeGreaterThan(0);

      installStatusOnlyOwnerTriggers(migrated, expected.map((trigger) => trigger.name));
      const stale = ownerTriggerShape(migrated);
      expect(stale).not.toEqual(expected);
      expect(stale.every((trigger) => trigger.sql.includes('OLD.status'))).toBe(true);
      expect(stale.some((trigger) => trigger.sql.includes('password_change_required')))
        .toBe(false);

      expect(migrator.run('016')).toEqual(['016']);
      const repaired = ownerTriggerShape(migrated);
      expect(repaired).toEqual(expected);

      const repairedSql = repaired.map((trigger) => trigger.sql).join('\n');
      expect(repairedSql).toContain('status');
      expect(repairedSql).toContain('password_change_required');
      expect(repairedSql).toContain('email_verification_required');
      expect(repairedSql).toContain('email_verified_at');
      expect(tableExists(migrated, '_auth_registration_intents')).toBe(true);
    } finally {
      runtime.dispose();
      migrator.dispose();
      runtimeRaw.close();
      migrated.close();
    }
  });

  test('fails closed without recording 016 as applied and rolls trigger repair back', () => {
    const db = new Database(':memory:');
    const migrator = createMigrator(db);

    try {
      db.exec('PRAGMA foreign_keys = ON');
      expect(migrator.run('015').at(-1)).toBe('015');
      expect(tableExists(db, '_auth_registration_intents')).toBe(true);

      const triggerNames = ownerTriggerShape(db).map((trigger) => trigger.name);
      installStatusOnlyOwnerTriggers(db, triggerNames);
      const stale = ownerTriggerShape(db);

      insertUser(db, {
        userId: 'unrecoverable-owner',
        passwordChangeRequired: true,
        emailVerificationRequired: false,
      });
      insertUser(db, {
        userId: 'unrelated-registration',
        emailVerificationRequired: true,
      });
      insertRegistrationIntent(db, 'unrelated-registration');
      insertApplicationOwner(db, 'unrecoverable-owner', 'bootstrap');

      expect(() => migrator.run('016')).toThrow(
        'application owners but none can authenticate',
      );

      expect(ownerTriggerShape(db)).toEqual(stale);
      expect(migrator.status().find((status) => status.version === '016'))
        .toMatchObject({ applied: false, lastStatus: 'failed' });
      expect(countRows(db, `
        SELECT COUNT(*) AS count FROM _migrations WHERE version = '016'
      `)).toBe(0);
      expect(countRows(db, `
        SELECT COUNT(*) AS count FROM _zero_migrations
        WHERE version = '016' AND status = 'applied'
      `)).toBe(0);
      expect(countRows(db, `
        SELECT COUNT(*) AS count FROM _zero_migrations
        WHERE version = '016' AND status = 'failed'
      `)).toBe(1);
    } finally {
      migrator.dispose();
      db.close();
    }
  });

  test('permits exact intent-bound pre-verification application and tenant owners', () => {
    const db = new Database(':memory:');
    const migrator = createMigrator(db);

    try {
      db.exec('PRAGMA foreign_keys = ON');
      expect(migrator.run('015').at(-1)).toBe('015');
      expect(tableExists(db, '_auth_registration_intents')).toBe(true);

      const triggerNames = ownerTriggerShape(db).map((trigger) => trigger.name);
      installStatusOnlyOwnerTriggers(db, triggerNames);
      insertUser(db, {
        userId: 'pending-bootstrap-owner',
        emailVerificationRequired: true,
      });
      insertRegistrationIntent(db, 'pending-bootstrap-owner');
      insertApplicationOwner(db, 'pending-bootstrap-owner', 'bootstrap');
      insertUser(db, {
        userId: 'pending-tenant-owner',
        emailVerificationRequired: true,
      });
      insertRegistrationIntent(db, 'pending-tenant-owner', 'pending-tenant');
      insertTenantOwner(db, 'pending-tenant', 'pending-tenant-owner');

      expect(migrator.run('016')).toEqual(['016']);
      expect(migrator.status().find((status) => status.version === '016'))
        .toMatchObject({ applied: true, lastStatus: 'applied' });
      expect(countRows(db, `
        SELECT COUNT(*) AS count FROM _auth_application_role_assignments
        WHERE user_id = 'pending-bootstrap-owner'
          AND role_key = 'owner' AND revoked_at IS NULL
      `)).toBe(1);
      expect(countRows(db, `
        SELECT COUNT(*) AS count FROM _auth_tenant_memberships
        WHERE tenant_id = 'pending-tenant' AND user_id = 'pending-tenant-owner'
          AND role_key = 'owner' AND status = 'active'
      `)).toBe(1);
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

function ownerTriggerShape(db: Database): TriggerRow[] {
  return (db.query(`
    SELECT name, sql FROM sqlite_master
    WHERE type = 'trigger' AND name LIKE 'trg_auth_%owner%'
    ORDER BY name
  `).all() as TriggerRow[]).map((trigger) => ({
    name: trigger.name,
    sql: normalizeSql(trigger.sql),
  }));
}

function installStatusOnlyOwnerTriggers(db: Database, names: readonly string[]): void {
  for (const name of names) {
    if (!/^trg_auth_[a-z0-9_]+$/.test(name)) {
      throw new Error(`Unsafe trigger name in test fixture: ${name}`);
    }
    db.exec(`DROP TRIGGER IF EXISTS ${name}`);
    db.exec(`
      CREATE TRIGGER ${name}
      AFTER UPDATE OF status ON users
      WHEN OLD.status = 'active' AND NEW.status <> 'active'
      BEGIN
        SELECT 1;
      END
    `);
  }
}

function insertUser(db: Database, input: {
  userId: string;
  passwordChangeRequired?: boolean;
  emailVerificationRequired: boolean;
}): void {
  db.query(`
    INSERT INTO users (
      user_id, username, email, role, status, password_change_required,
      email_verified_at, email_verification_required, mfa_required,
      created_at, updated_at
    ) VALUES (?, ?, ?, 'admin', 'active', ?, NULL, ?, 0, 1, NULL)
  `).run(
    input.userId,
    input.userId,
    `${input.userId}@example.test`,
    input.passwordChangeRequired ? 1 : 0,
    input.emailVerificationRequired ? 1 : 0,
  );
}

function insertRegistrationIntent(
  db: Database,
  userId: string,
  tenantId: string | null = null,
): void {
  db.query(`
    INSERT INTO _auth_registration_intents (
      user_id, mfa_enrollment_requested, tenant_id, created_at
    ) VALUES (?, 0, ?, 1)
  `).run(userId, tenantId);
}

function insertTenantOwner(db: Database, tenantId: string, userId: string): void {
  db.query(`
    INSERT INTO _auth_tenants (
      tenant_id, slug, name, status, authorization_generation,
      created_by, created_at, updated_at, suspended_at
    ) VALUES (?, ?, ?, 'active', 0, ?, 1, 1, NULL)
  `).run(tenantId, tenantId, tenantId, userId);
  db.query(`
    INSERT INTO _auth_tenant_memberships (
      membership_id, tenant_id, user_id, status, role_key,
      authorization_generation, joined_at, created_at, updated_at,
      suspended_at, removed_at, created_by
    ) VALUES (?, ?, ?, 'active', 'owner', 0, 1, 1, 1, NULL, NULL, ?)
  `).run(`membership-${tenantId}`, tenantId, userId, userId);
}

function insertApplicationOwner(
  db: Database,
  userId: string,
  source: 'bootstrap' | 'manual',
): void {
  db.query(`
    INSERT INTO _auth_application_role_assignments (
      assignment_id, application_id, user_id, role_key, source, source_id,
      created_by, created_at, revoked_by, revoked_at
    ) VALUES (?, 'application', ?, 'owner', ?, 'legacy-fixture', ?, 1, NULL, NULL)
  `).run(`owner-${userId}`, userId, source, userId);
}

function tableExists(db: Database, name: string): boolean {
  return Boolean(db.query(`
    SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?
  `).get(name));
}

function countRows(db: Database, sql: string): number {
  return (db.query(sql).get() as { count: number }).count;
}

function normalizeSql(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim();
}
