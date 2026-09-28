import { Database } from 'bun:sqlite';
import { describe, expect, test } from 'bun:test';

import { defineAuthTables } from '../auth/auth-schema';
import { defineAuthTenantOnboardingTables } from '../auth/auth-tenant-onboarding-schema';
import { defineTenancyTables } from '../auth/tenancy/tenancy-schema';
import { TenantStore } from '../auth/tenancy/tenant-store';
import { TenancyService } from '../auth/tenancy/tenancy-service';
import {
  defineVerifiedDomainReleaseTables,
  defineVerifiedDomainTables,
} from '../auth/verified-domain-schema';
import { UserStore } from '../auth/user-store';
import { createReactiveDB } from '../sync/reactive-db';
import { migrations } from './index';
import { Migrator } from './migrator';

const RELEASE_GRAPH = [
  '_auth_tenant_domain_claims',
  '_auth_tenant_domain_policies',
  '_auth_domain_onboarding_transactions',
  '_auth_domain_join_request_provenance',
  '_auth_tenant_membership_provenance',
  '_auth_released_domain_join_provenance',
] as const;

describe('migration 019 verified-domain release', () => {
  test('preserves the complete claim graph and matches the final runtime schema', async () => {
    const migrated = new Database(':memory:');
    const runtimeRaw = new Database(':memory:');
    const migrator = createMigrator(migrated);
    const seeded = createReactiveDB({ database: migrated, clearChangesOnStart: false });
    const runtime = createReactiveDB({ database: runtimeRaw });
    try {
      migrated.exec('PRAGMA foreign_keys = ON');
      runtimeRaw.exec('PRAGMA foreign_keys = ON');
      expect(migrator.run('017').at(-1)).toBe('017');
      // The migration created the physical schema; register the same tables
      // with ReactiveDB before using the typed stores to seed real FK rows.
      defineAuthTables(seeded);
      defineTenancyTables(seeded);
      defineAuthTenantOnboardingTables(seeded);
      const users = new UserStore(seeded);
      const owner = await users.createUser({
        username: 'migration-release-owner',
        email: 'migration-release-owner@example.test',
        password: 'password123',
        role: 'admin',
        status: 'active',
        emailVerifiedAt: 1,
      });
      const applicant = await users.createUser({
        username: 'migration-release-applicant',
        email: 'person@acme.com',
        password: 'password123',
        role: 'user',
        status: 'active',
        emailVerifiedAt: 1,
      });
      const tenant = new TenancyService(new TenantStore(seeded)).createTenant({
        name: 'Migration Release',
        slug: 'migration-release',
        ownerUserId: owner.userId,
      });
      seedClaimGraph(migrated, {
        tenantId: tenant.tenant.tenantId,
        membershipId: tenant.ownerMembership.membershipId,
        ownerId: owner.userId,
        applicantId: applicant.userId,
      });

      expect(migrator.run('019')).toEqual(['018', '019']);
      expect(migrated.query(`SELECT claim_id, tenant_id, domain, released_at,
        released_by, quarantine_until FROM _auth_tenant_domain_claims`).get()).toEqual({
        claim_id: 'claim-existing',
        tenant_id: tenant.tenant.tenantId,
        domain: 'acme.com',
        released_at: null,
        released_by: null,
        quarantine_until: null,
      });
      expect(migrated.query(`SELECT claim_id, enabled, request_role_key
        FROM _auth_tenant_domain_policies`).get()).toEqual({
        claim_id: 'claim-existing',
        enabled: 1,
        request_role_key: 'member',
      });
      expect(migrated.query(`SELECT transaction_id, claim_id, consumed_at
        FROM _auth_domain_onboarding_transactions`).get()).toEqual({
        transaction_id: 'transaction-existing',
        claim_id: 'claim-existing',
        consumed_at: null,
      });
      expect(migrated.query(`SELECT join_request_id, claim_id, domain
        FROM _auth_domain_join_request_provenance`).get()).toEqual({
        join_request_id: 'join-existing',
        claim_id: 'claim-existing',
        domain: 'acme.com',
      });
      expect(migrated.query(`SELECT membership_id, claim_id, domain
        FROM _auth_tenant_membership_provenance`).get()).toEqual({
        membership_id: tenant.ownerMembership.membershipId,
        claim_id: 'claim-existing',
        domain: 'acme.com',
      });
      expect(migrated.query('PRAGMA foreign_key_check').all()).toEqual([]);

      defineAuthTables(runtime);
      defineTenancyTables(runtime);
      defineAuthTenantOnboardingTables(runtime);
      defineVerifiedDomainTables(runtime);
      defineVerifiedDomainReleaseTables(runtime);
      for (const table of RELEASE_GRAPH) {
        expect(tableShape(migrated, table)).toEqual(tableShape(runtimeRaw, table));
      }
      expect(releaseTriggerShape(migrated)).toEqual(releaseTriggerShape(runtimeRaw));

      const migration = migrations.find((entry) => entry.version === '019')!;
      migration.up(migrated);
      migration.up(migrated);
      expect(migrated.query(`SELECT COUNT(*) AS count
        FROM _auth_tenant_domain_claims`).get()).toEqual({ count: 1 });
    } finally {
      seeded.dispose();
      runtime.dispose();
      migrator.dispose();
      runtimeRaw.close();
      migrated.close();
    }
  });

  test('permits one active replacement while retaining an immutable released claim', () => {
    const db = new Database(':memory:');
    const migrator = createMigrator(db);
    try {
      db.exec('PRAGMA foreign_keys = ON');
      migrator.run('019');
      db.query(`INSERT INTO users (
        user_id, username, email, role, status, created_at, updated_at
      ) VALUES ('owner', 'owner', 'owner@example.test', 'admin', 'active', 1, 1)`).run();
      db.query(`INSERT INTO _auth_tenants (
        tenant_id, name, slug, status, authorization_generation,
        created_by, created_at, updated_at
      ) VALUES ('tenant-a', 'Tenant A', 'tenant-a', 'active', 0, 'owner', 1, 1)`).run();
      insertClaim(db, 'released', 'tenant-a', 'acme.com', 'owner');
      db.query(`UPDATE _auth_tenant_domain_claims SET
        status = 'lost', challenge_digest = NULL, challenge_expires_at = NULL,
        verification_digest = NULL, next_check_at = NULL, valid_until = NULL,
        lease_owner = NULL, lease_expires_at = NULL, revision = revision + 1,
        updated_at = 2, released_at = 2, released_by = NULL, quarantine_until = 3
        WHERE claim_id = 'released'`).run();
      insertClaim(db, 'replacement', 'tenant-a', 'acme.com', 'owner');
      expect(() => insertClaim(db, 'collision', 'tenant-a', 'acme.com', 'owner'))
        .toThrow('UNIQUE constraint failed');
      expect(db.query(`SELECT claim_id, released_at FROM _auth_tenant_domain_claims
        WHERE domain = 'acme.com' ORDER BY claim_id`).all()).toEqual([
        { claim_id: 'released', released_at: 2 },
        { claim_id: 'replacement', released_at: null },
      ]);
      expect(() => db.query(`UPDATE _auth_tenant_domain_claims SET domain = 'other.com'
        WHERE claim_id = 'released'`).run()).toThrow('AUTH_RELEASED_DOMAIN_CLAIM_IMMUTABLE');
    } finally {
      migrator.dispose();
      db.close();
    }
  });

  test('fails before rebuilding when an unknown claim-dependent table exists', () => {
    const db = new Database(':memory:');
    const migrator = createMigrator(db);
    try {
      migrator.run('017');
      db.exec(`CREATE TABLE app_claim_dependency (
        id TEXT PRIMARY KEY,
        claim_id TEXT NOT NULL REFERENCES _auth_tenant_domain_claims(claim_id)
      )`);
      const migration = migrations.find((entry) => entry.version === '019')!;
      expect(() => migration.up(db)).toThrow('unknown claim dependent');
      expect(columnNames(db, '_auth_tenant_domain_claims')).not.toContain('released_at');
      expect(db.query(`SELECT name FROM sqlite_master
        WHERE type = 'table' AND name LIKE '_auth_v019_%'`).all()).toEqual([]);
    } finally {
      migrator.dispose();
      db.close();
    }
  });
});

function seedClaimGraph(db: Database, input: {
  tenantId: string;
  membershipId: string;
  ownerId: string;
  applicantId: string;
}): void {
  insertClaim(db, 'claim-existing', input.tenantId, 'acme.com', input.ownerId);
  db.query(`INSERT INTO _auth_tenant_domain_policies (
    claim_id, enabled, admission, request_role_key, revision,
    updated_by, created_at, updated_at
  ) VALUES ('claim-existing', 1, 'request-to-join', 'member', 2, ?, 1, 1)`).run(
    input.ownerId,
  );
  db.query(`INSERT INTO _auth_mailbox_proofs (
    proof_id, application_id, user_id, email, email_generation,
    source, proved_at, expires_at, revoked_at, created_at
  ) VALUES ('proof-existing', 'app', ?, 'person@acme.com', 1,
    'email-link', 1, 100, NULL, 1)`).run(input.applicantId);
  db.query(`INSERT INTO _auth_domain_onboarding_transactions (
    transaction_id, application_id, user_id, email, email_generation,
    auth_generation, identity_kind, identity_continuation_id, mailbox_proof_id,
    domain, claim_id, claim_revision, policy_revision, tenant_id,
    request_role_key, token_hash, expires_at, consumed_at, created_at
  ) VALUES ('transaction-existing', 'app', ?, 'person@acme.com', 1,
    0, 'session', NULL, 'proof-existing', 'acme.com', 'claim-existing', 1, 2, ?,
    'member', 'transaction-hash', 100, NULL, 1)`).run(input.applicantId, input.tenantId);
  db.query(`INSERT INTO _auth_tenant_join_requests (
    join_request_id, tenant_id, user_id, email, status, request_revision,
    requested_at, created_at, updated_at, reviewed_at, reviewed_by,
    last_decision, approved_membership_id
  ) VALUES ('join-existing', ?, ?, 'person@acme.com', 'approved', 2,
    1, 1, 1, 1, ?, 'approved', ?)`).run(
    input.tenantId,
    input.applicantId,
    input.ownerId,
    input.membershipId,
  );
  db.query(`INSERT INTO _auth_domain_join_request_provenance (
    join_request_id, tenant_id, user_id, claim_id, domain, request_role_key,
    mailbox_proof_id, blocked_until, created_at, updated_at
  ) VALUES ('join-existing', ?, ?, 'claim-existing', 'acme.com', 'member',
    'proof-existing', NULL, 1, 1)`).run(input.tenantId, input.applicantId);
  db.query(`INSERT INTO _auth_tenant_membership_provenance (
    membership_id, source, source_id, claim_id, domain, recorded_at
  ) VALUES (?, 'domain-request', 'join-existing', 'claim-existing', 'acme.com', 1)`).run(
    input.membershipId,
  );
}

function insertClaim(
  db: Database,
  claimId: string,
  tenantId: string,
  domain: string,
  ownerId: string | null,
): void {
  db.query(`INSERT INTO _auth_tenant_domain_claims (
    claim_id, tenant_id, domain, status, proof_method,
    challenge_digest, challenge_expires_at, verification_digest,
    verified_at, last_checked_at, next_check_at, valid_until,
    revision, lease_owner, lease_expires_at, created_by, created_at, updated_at
  ) VALUES (?, ?, ?, 'pending', 'dns-txt', 'digest', 100, NULL,
    NULL, NULL, NULL, NULL, 1, NULL, NULL, ?, 1, 1)`).run(
    claimId,
    tenantId,
    domain,
    ownerId,
  );
}

function createMigrator(database: Database): Migrator {
  return new Migrator({
    database,
    dbPath: ':memory:',
    migrations,
    createBackups: false,
    log: () => {},
  });
}

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

function releaseTriggerShape(db: Database) {
  return (db.query(`SELECT name, sql FROM sqlite_master
    WHERE type = 'trigger' AND name LIKE 'trg_auth_released_domain_%'
    ORDER BY name`).all() as Array<{ name: string; sql: string }>).map((row) => ({
    name: row.name,
    sql: row.sql.replace(/\s+/g, ' ').trim(),
  }));
}
