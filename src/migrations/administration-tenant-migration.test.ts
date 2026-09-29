import { Database } from 'bun:sqlite';
import { describe, expect, test } from 'bun:test';

import { migration } from './definitions/024_administration_tenant';

function defineLegacyGraph(db: Database): void {
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE users (
      user_id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      password_change_required INTEGER NOT NULL,
      email_verification_required INTEGER NOT NULL,
      email_verified_at INTEGER
    );
    CREATE TABLE _auth_tenants (
      tenant_id TEXT PRIMARY KEY,
      slug TEXT NOT NULL,
      name TEXT NOT NULL,
      status TEXT NOT NULL,
      authorization_generation INTEGER NOT NULL,
      created_by TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      suspended_at INTEGER
    );
    CREATE TABLE _auth_tenant_memberships (
      membership_id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      status TEXT NOT NULL,
      role_key TEXT,
      authorization_generation INTEGER NOT NULL,
      joined_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      created_by TEXT NOT NULL
    );
    CREATE TABLE _auth_audit_events (
      event_id TEXT PRIMARY KEY,
      action TEXT NOT NULL,
      outcome TEXT NOT NULL,
      scope_kind TEXT NOT NULL,
      tenant_id TEXT,
      actor_user_id TEXT,
      actor_provenance TEXT NOT NULL,
      target_type TEXT,
      target_id TEXT
    );
  `);
}

describe('migration 024 administration tenant', () => {
  test('adopts only one exact audited bootstrap tenant and protects it', () => {
    const db = new Database(':memory:');
    try {
      defineLegacyGraph(db);
      db.exec(`
        INSERT INTO users VALUES ('owner', 'active', 0, 0, 1);
        INSERT INTO _auth_tenants VALUES (
          'tenant-admin', 'administration', 'Administration', 'active', 0,
          'owner', 1, 1, NULL
        );
        INSERT INTO _auth_tenant_memberships VALUES (
          'membership-owner', 'tenant-admin', 'owner', 'active', 'owner', 0,
          1, 1, 1, 'owner'
        );
        INSERT INTO _auth_audit_events VALUES (
          'audit-bootstrap', 'tenant.created', 'succeeded', 'tenant',
          'tenant-admin', 'owner', 'bootstrap', 'tenant', 'tenant-admin'
        );
      `);

      migration.up(db);
      migration.up(db);
      expect(db.query(`SELECT kind FROM _auth_tenants
        WHERE tenant_id = 'tenant-admin'`).get()).toEqual({ kind: 'administration' });
      expect(() => db.exec(`UPDATE _auth_tenants SET status = 'suspended'
        WHERE tenant_id = 'tenant-admin'`)).toThrow('AUTH_ADMINISTRATION_TENANT_PROTECTED');
      expect(() => db.exec(`DELETE FROM _auth_tenants
        WHERE tenant_id = 'tenant-admin'`)).toThrow('AUTH_ADMINISTRATION_TENANT_PROTECTED');
    } finally {
      db.close();
    }
  });

  test('does not guess when bootstrap provenance names multiple tenants', () => {
    const db = new Database(':memory:');
    try {
      defineLegacyGraph(db);
      db.exec(`
        INSERT INTO users VALUES ('owner', 'active', 0, 0, 1);
        INSERT INTO _auth_tenants VALUES
          ('one', 'one', 'One', 'active', 0, 'owner', 1, 1, NULL),
          ('two', 'two', 'Two', 'active', 0, 'owner', 2, 2, NULL);
        INSERT INTO _auth_tenant_memberships VALUES
          ('membership-one', 'one', 'owner', 'active', 'owner', 0, 1, 1, 1, 'owner'),
          ('membership-two', 'two', 'owner', 'active', 'owner', 0, 2, 2, 2, 'owner');
        INSERT INTO _auth_audit_events VALUES
          ('audit-one', 'tenant.created', 'succeeded', 'tenant', 'one',
            'owner', 'bootstrap', 'tenant', 'one'),
          ('audit-two', 'tenant.created', 'succeeded', 'tenant', 'two',
            'owner', 'bootstrap', 'tenant', 'two');
      `);

      migration.up(db);
      expect(db.query(`SELECT COUNT(*) AS count FROM _auth_tenants
        WHERE kind = 'administration'`).get()).toEqual({ count: 0 });
    } finally {
      db.close();
    }
  });

  test('leaves absent or weak bootstrap evidence as an ordinary organization', () => {
    const db = new Database(':memory:');
    try {
      defineLegacyGraph(db);
      db.exec(`
        INSERT INTO users VALUES ('owner', 'active', 0, 0, 1);
        INSERT INTO _auth_tenants VALUES (
          'weak', 'weak', 'Weak evidence', 'active', 0, 'owner', 1, 1, NULL
        );
        INSERT INTO _auth_tenant_memberships VALUES (
          'membership-weak', 'weak', 'owner', 'suspended', 'owner', 0,
          1, 1, 1, 'owner'
        );
        INSERT INTO _auth_audit_events VALUES (
          'audit-weak', 'tenant.created', 'succeeded', 'tenant',
          'weak', 'owner', 'bootstrap', 'tenant', 'weak'
        );
      `);

      migration.up(db);
      expect(db.query(`SELECT kind FROM _auth_tenants
        WHERE tenant_id = 'weak'`).get()).toEqual({ kind: 'organization' });
    } finally {
      db.close();
    }
  });

  test('enforces one administration tenant and makes its kind one-way', () => {
    const db = new Database(':memory:');
    try {
      defineLegacyGraph(db);
      db.exec(`
        INSERT INTO users VALUES ('owner', 'active', 0, 0, 1);
        INSERT INTO _auth_tenants VALUES
          ('admin', 'admin', 'Admin', 'active', 0, 'owner', 1, 1, NULL),
          ('customer', 'customer', 'Customer', 'active', 0, 'owner', 2, 2, NULL);
        INSERT INTO _auth_tenant_memberships VALUES (
          'membership-admin', 'admin', 'owner', 'active', 'owner', 0,
          1, 1, 1, 'owner'
        );
        INSERT INTO _auth_audit_events VALUES (
          'audit-admin', 'tenant.created', 'succeeded', 'tenant',
          'admin', 'owner', 'bootstrap', 'tenant', 'admin'
        );
      `);
      migration.up(db);

      expect(() => db.exec(`UPDATE _auth_tenants SET kind = 'organization'
        WHERE tenant_id = 'admin'`)).toThrow('AUTH_ADMINISTRATION_TENANT_PROTECTED');
      expect(() => db.exec(`UPDATE _auth_tenants SET kind = 'administration'
        WHERE tenant_id = 'customer'`)).toThrow('AUTH_ADMINISTRATION_TENANT_PROTECTED');
      expect(() => db.exec(`INSERT INTO _auth_tenants VALUES (
        'second-admin', 'second-admin', 'Second', 'active', 0,
        'owner', 3, 3, NULL, 'administration'
      )`)).toThrow();
    } finally {
      db.close();
    }
  });

  test('permits only the exact pending bootstrap provisioning rollback delete', () => {
    const db = new Database(':memory:');
    try {
      defineLegacyGraph(db);
      db.exec(`
        CREATE TABLE _auth_registration_provisioning (
          user_id TEXT PRIMARY KEY,
          tenant_id TEXT,
          is_bootstrap INTEGER NOT NULL
        );
        INSERT INTO users VALUES ('owner', 'active', 0, 0, 1);
        INSERT INTO _auth_tenants VALUES (
          'provisional', 'provisional', 'Provisional', 'active', 0,
          'owner', 1, 1, NULL
        );
        INSERT INTO _auth_tenant_memberships VALUES (
          'membership-provisional', 'provisional', 'owner', 'active', 'owner', 0,
          1, 1, 1, 'owner'
        );
        INSERT INTO _auth_audit_events VALUES (
          'audit-provisional', 'tenant.created', 'succeeded', 'tenant',
          'provisional', 'owner', 'bootstrap', 'tenant', 'provisional'
        );
        INSERT INTO _auth_registration_provisioning VALUES (
          'owner', 'provisional', 1
        );
      `);
      migration.up(db);
      expect(db.query(`SELECT kind FROM _auth_tenants
        WHERE tenant_id = 'provisional'`).get()).toEqual({ kind: 'administration' });
      expect(() => db.exec(`DELETE FROM _auth_tenants
        WHERE tenant_id = 'provisional'`)).not.toThrow();
      expect(db.query(`SELECT tenant_id FROM _auth_tenants
        WHERE tenant_id = 'provisional'`).get()).toBeNull();
    } finally {
      db.close();
    }
  });

  test('protects the administration tenant after bootstrap provisioning finalizes', () => {
    const db = new Database(':memory:');
    try {
      defineLegacyGraph(db);
      db.exec(`
        CREATE TABLE _auth_registration_provisioning (
          user_id TEXT PRIMARY KEY,
          tenant_id TEXT,
          is_bootstrap INTEGER NOT NULL
        );
        INSERT INTO users VALUES ('owner', 'active', 0, 0, 1);
        INSERT INTO _auth_tenants VALUES (
          'admin', 'admin', 'Administration', 'active', 0,
          'owner', 1, 1, NULL
        );
        INSERT INTO _auth_tenant_memberships VALUES (
          'membership-admin', 'admin', 'owner', 'active', 'owner', 0,
          1, 1, 1, 'owner'
        );
        INSERT INTO _auth_audit_events VALUES (
          'audit-admin', 'tenant.created', 'succeeded', 'tenant',
          'admin', 'owner', 'bootstrap', 'tenant', 'admin'
        );
        INSERT INTO _auth_registration_provisioning VALUES ('owner', 'admin', 1);
      `);

      migration.up(db);
      db.exec(`DELETE FROM _auth_registration_provisioning WHERE user_id = 'owner'`);
      expect(() => db.exec(`DELETE FROM _auth_tenants
        WHERE tenant_id = 'admin'`)).toThrow('AUTH_ADMINISTRATION_TENANT_PROTECTED');
    } finally {
      db.close();
    }
  });
});
