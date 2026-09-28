import { afterEach, describe, expect, test } from 'bun:test';

import { createReactiveDB, type ReactiveDB } from '../sync/reactive-db';
import { resolveAuthAuditConfig } from './auth-audit-config';
import { AuthAuditService } from './auth-audit-service';
import {
  installAuthAuthorityRevision,
  readAuthAuthorityRevision,
} from './auth-authority-revision';
import {
  InstalledAuthProfileGuard,
  readInstalledAuthProfile,
  reconcileInstalledAuthProfile,
} from './auth-profile-state';
import { defineAuthTables } from './auth-schema';
import { defineAuthorizationRoleTables } from './authorization-role-schema';
import { defineTenancyTables } from './tenancy/tenancy-schema';

const databases: ReactiveDB[] = [];

afterEach(() => {
  for (const db of databases.splice(0).reverse()) db.dispose();
});

describe('installed auth profile state', () => {
  test('persists an exact generation, makes restarts no-ops, and fences ABA changes', () => {
    const db = createDb();
    const before = readAuthAuthorityRevision(db)!;
    const first = reconcile(db, 'single', 'simple');
    expect(first).toMatchObject({
      kind: 'initialized',
      committed: { generation: 1, tenancy: 'single', authorization: 'simple' },
    });
    expect(readAuthAuthorityRevision(db)).toBe(before + 1);
    const original = new InstalledAuthProfileGuard(db, first.committed);

    const restarted = reconcile(db, 'single', 'simple');
    expect(restarted).toMatchObject({ kind: 'unchanged', committed: { generation: 1 } });
    expect(readAuthAuthorityRevision(db)).toBe(before + 1);
    expect(original.isCurrent()).toBe(true);

    const second = reconcile(db, 'multi', 'simple');
    expect(second).toMatchObject({
      kind: 'pristine-correction',
      committed: { generation: 2, tenancy: 'multi', authorization: 'simple' },
    });
    const third = reconcile(db, 'single', 'simple');
    expect(third.committed.generation).toBe(3);
    expect(original.isCurrent()).toBe(false);
    expect(() => original.assertCurrent()).toThrow(expect.objectContaining({
      code: 'AUTH_PROFILE_CHANGED',
      status: 503,
    }));
  });

  test('infers an ordinary unmarked multi/simple install but requires explicit direct adoption', () => {
    const simple = createDb();
    seedTenant(simple, 'member');
    const installed = reconcile(simple, 'multi', 'simple');
    expect(installed).toMatchObject({
      kind: 'initialized',
      installed: { tenancy: 'multi', authorization: 'simple' },
      committed: { generation: 1, tenancy: 'multi', authorization: 'simple' },
    });

    const ambiguous = createDb();
    seedTenant(ambiguous, 'member');
    let ambiguityError: unknown;
    try {
      reconcile(ambiguous, 'multi', 'advanced');
    } catch (error) {
      ambiguityError = error;
    }
    expect(ambiguityError).toBeInstanceOf(Error);
    expect((ambiguityError as Error).message).toBe(
      '[auth] Cannot infer the installed auth profile: this unmarked database '
        + 'contains tenant data but no advanced assignment history. That is '
        + 'ambiguous between multi/simple and a damaged multi/advanced install. '
        + 'Inspect or restore the prior profile. Only when the database truly '
        + 'came from multi/simple, start multi/advanced once with '
        + 'auth.authorization.legacySimpleRoleAdoption=true; remove the '
        + 'idempotent assertion after startup persists the profile marker.',
    );
    expect(readInstalledAuthProfile(ambiguous)).toBeNull();

    const explicitlyAdopted = reconcile(
      ambiguous,
      'multi',
      'advanced',
      true,
    );
    expect(explicitlyAdopted).toMatchObject({
      kind: 'simple-to-advanced',
      legacySimpleRoleAdoption: true,
      markerExisted: false,
      committed: { generation: 1, tenancy: 'multi', authorization: 'advanced' },
    });
  });

  test('uses all assignment history for inference and rejects reverse or tenancy-axis reinterpretation', () => {
    const advanced = createDb();
    const seeded = seedTenant(advanced, 'member');
    advanced.prepare(`
      INSERT INTO _auth_tenant_membership_roles (
        assignment_id, tenant_id, membership_id, user_id, role_key, source,
        source_id, created_by, created_at, revoked_by, revoked_at
      ) VALUES ('assignment-retired', ?, ?, ?, 'member', 'migration',
        'history', NULL, ?, NULL, ?)
    `).run(
      seeded.tenantId,
      seeded.membershipId,
      seeded.userId,
      Date.now() - 1,
      Date.now(),
    );
    const inferred = reconcile(advanced, 'multi', 'advanced');
    expect(inferred.installed).toMatchObject({
      tenancy: 'multi', authorization: 'advanced',
    });
    expect(() => reconcile(advanced, 'multi', 'simple')).toThrow(
      'Advanced assignments cannot be reinterpreted through membership.role_key',
    );
    expect(() => reconcile(advanced, 'single', 'advanced')).toThrow(
      'Changing between single-tenant and multi-tenant authority',
    );
    expect(readInstalledAuthProfile(advanced)).toEqual(inferred.committed);
  });

  test.each([
    ['live', Date.now() + 60_000],
    ['expired', Date.now() - 60_000],
  ] as const)('blocks %s pending provisioning before transition mutation', (_name, leaseExpiry) => {
    const db = createDb();
    const seeded = seedTenant(db, 'member');
    reconcile(db, 'multi', 'simple');
    db.prepare(`
      INSERT INTO _auth_registration_provisioning (
        registration_id, user_id, tenant_id, is_bootstrap,
        lease_owner_hash, lease_expires_at, created_at
      ) VALUES ('pending-profile-transition', ?, ?, 0, ?, ?, ?)
    `).run(
      seeded.userId,
      seeded.tenantId,
      'a'.repeat(64),
      leaseExpiry,
      Date.now() - 120_000,
    );
    let callbackRan = false;
    expect(() => reconcileInstalledAuthProfile({
      db,
      requested: { tenancy: 'multi', authorization: 'advanced' },
      beforeCommit: () => { callbackRan = true; },
    })).toThrow('registration provisioning receipt is pending');
    expect(callbackRan).toBe(false);
    expect(readInstalledAuthProfile(db)).toMatchObject({
      generation: 1, tenancy: 'multi', authorization: 'simple',
    });
    expect(count(db, '_auth_tenant_membership_roles')).toBe(0);
    expect(count(db, '_auth_audit_events')).toBe(0);
  });

  test('commits adoption evidence, system audit, marker, and authority revision atomically', () => {
    const db = createDb();
    seedTenant(db, 'member');
    reconcile(db, 'multi', 'simple');
    const audit = new AuthAuditService(db, resolveAuthAuditConfig(undefined));
    const before = readAuthAuthorityRevision(db)!;
    const adopted = reconcileInstalledAuthProfile({
      db,
      requested: { tenancy: 'multi', authorization: 'advanced' },
      audit,
      beforeCommit: () => ({ memberships: 1, assignments: 1 }),
    });
    expect(adopted.committed).toMatchObject({ generation: 2, authorization: 'advanced' });
    expect(readAuthAuthorityRevision(db)).toBeGreaterThan(before);
    expect(audit.listPlatform({ action: 'application.auth-profile-adopted' }).events)
      .toEqual([expect.objectContaining({
        actorProvenance: 'system',
        targetType: 'auth-profile',
        metadata: {
          'from-profile': 'multi/simple',
          'to-profile': 'multi/advanced',
          memberships: 1,
          assignments: 1,
          'legacy-assertion': false,
        },
      })]);

    const marker = readInstalledAuthProfile(db);
    const auditCount = count(db, '_auth_audit_events');
    const revision = readAuthAuthorityRevision(db);
    expect(() => reconcileInstalledAuthProfile({
      db,
      requested: { tenancy: 'multi', authorization: 'advanced' },
      audit,
      beforeCommit: () => { throw new Error('injected readiness failure'); },
    })).toThrow('injected readiness failure');
    expect(readInstalledAuthProfile(db)).toEqual(marker);
    expect(count(db, '_auth_audit_events')).toBe(auditCount);
    expect(readAuthAuthorityRevision(db)).toBe(revision);
  });
});

function createDb(): ReactiveDB {
  const db = createReactiveDB({ mode: 'memory' });
  databases.push(db);
  db.exec('PRAGMA foreign_keys = ON');
  defineAuthTables(db);
  defineTenancyTables(db);
  defineAuthorizationRoleTables(db);
  installAuthAuthorityRevision(db);
  return db;
}

function reconcile(
  db: ReactiveDB,
  tenancy: 'single' | 'multi',
  authorization: 'simple' | 'advanced',
  legacySimpleRoleAdoption = false,
) {
  return reconcileInstalledAuthProfile({
    db,
    requested: { tenancy, authorization },
    legacySimpleRoleAdoption,
    beforeCommit: () => {},
  });
}

function seedTenant(db: ReactiveDB, roleKey: string): {
  userId: string;
  tenantId: string;
  membershipId: string;
} {
  const userId = `user-${crypto.randomUUID()}`;
  const tenantId = `tenant-${crypto.randomUUID()}`;
  const membershipId = `membership-${crypto.randomUUID()}`;
  const now = Date.now();
  db.prepare(`
    INSERT INTO users (
      user_id, username, email, role, status, password_change_required,
      email_verification_required, mfa_required, created_at
    ) VALUES (?, ?, ?, 'user', 'active', 0, 0, 0, ?)
  `).run(userId, userId, `${userId}@example.test`, now);
  db.prepare(`
    INSERT INTO _auth_tenants (
      tenant_id, slug, name, status, authorization_generation,
      created_by, created_at, updated_at
    ) VALUES (?, ?, 'Tenant', 'active', 0, ?, ?, ?)
  `).run(tenantId, tenantId, userId, now, now);
  db.prepare(`
    INSERT INTO _auth_tenant_memberships (
      membership_id, tenant_id, user_id, status, role_key,
      authorization_generation, joined_at, created_at, updated_at, created_by
    ) VALUES (?, ?, ?, 'active', ?, 0, ?, ?, ?, ?)
  `).run(membershipId, tenantId, userId, roleKey, now, now, now, userId);
  return { userId, tenantId, membershipId };
}

function count(db: ReactiveDB, table: string): number {
  return Number((db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as {
    count: number;
  }).count);
}
