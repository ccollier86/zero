import { afterEach, describe, expect, test } from 'bun:test';

import { createReactiveDB, type ReactiveDB } from '../sync/reactive-db';
import { installAuthAuthorityRevision } from './auth-authority-revision';
import { readAuthAuthorityRevision } from './auth-authority-revision';
import { resolveAuthAuditConfig } from './auth-audit-config';
import { AuthAuditService } from './auth-audit-service';
import { resolveAuthBehaviorConfig } from './auth-config';
import {
  readInstalledAuthProfile,
  reconcileInstalledAuthProfile,
} from './auth-profile-state';
import { defineAuthTables } from './auth-schema';
import { createAuthorizationKernel } from './authorization-kernel';
import { defineAuthorizationRoleTables } from './authorization-role-schema';
import { AuthorizationRoleService } from './authorization-role-service';
import { AuthorizationRoleStore } from './authorization-role-store';
import { TenantStore } from './tenancy/tenant-store';
import { defineTenancyTables } from './tenancy/tenancy-schema';
import { TenancyService } from './tenancy/tenancy-service';
import type { TenantMembershipRecord } from './tenancy/tenancy-types';
import { AuthError } from './types';
import { UserStore } from './user-store';

const databases: ReactiveDB[] = [];

afterEach(() => {
  for (const db of databases.splice(0).reverse()) db.dispose();
});

describe('multi/simple role adoption', () => {
  test('projects every retained role, rebinds session families, and excludes removed memberships', () => {
    const harness = createHarness();
    const graph = seedMembershipGraph(harness);
    const managerBefore = graph.manager.authorizationGeneration;
    const removedBefore = harness.tenancy.getMembershipById(
      graph.removed.membershipId,
    )!.authorizationGeneration;
    seedSessionArtifacts(harness.db, graph.manager);

    expect(harness.roles.adoptSimpleTenantMembershipRoles()).toEqual({
      memberships: 4,
      assignments: 4,
    });
    const expectedRoles: Array<[string, string]> = [
      [graph.manager.membershipId, 'manager'],
      [graph.member.membershipId, 'member'],
      [graph.owner.membershipId, 'owner'],
      [graph.suspended.membershipId, 'manager'],
    ];
    expect(activeRoles(harness.db)).toEqual(
      expectedRoles.sort(([left], [right]) => left.localeCompare(right)),
    );
    expect(harness.roles.resolveTenantRoles(subject(graph.owner))?.roles)
      .toEqual(['owner']);
    expect(harness.roles.resolveTenantRoles(subject(graph.manager))?.roles)
      .toEqual(['manager']);
    expect(harness.roles.resolveTenantRoles(subject(graph.member))?.roles)
      .toEqual(['member']);
    expect(harness.roles.resolveTenantRoles(subject(graph.suspended))).toBeNull();
    expect(harness.roles.getRetainedTenantRoleSet(subject(graph.suspended))?.roles)
      .toEqual(['manager']);
    expect(harness.roles.getRetainedTenantRoleSet(subject(graph.removed))?.roles)
      .toEqual([]);

    const managerAfter = harness.tenancy.getMembershipById(
      graph.manager.membershipId,
    )!.authorizationGeneration;
    expect(managerAfter).toBe(managerBefore + 1);
    expect(harness.tenancy.getMembershipById(graph.removed.membershipId)
      ?.authorizationGeneration).toBe(removedBefore);
    expect((harness.db.prepare(`
      SELECT membership_authorization_generation AS generation
      FROM _auth_sessions WHERE session_id = 'web-manager'
    `).get() as { generation: number }).generation).toBe(managerAfter);
    expect((harness.db.prepare(`
      SELECT DISTINCT membership_authorization_generation AS generation
      FROM _auth_native_sessions WHERE family_id = 'native-family'
    `).all() as Array<{ generation: number }>)).toEqual([{ generation: managerAfter }]);
    expect(count(harness.db, '_auth_native_requests')).toBe(0);
    expect(count(harness.db, '_auth_native_codes')).toBe(0);
  });

  test('validates the complete retained registry before any assignment or generation mutation', () => {
    const harness = createHarness();
    const graph = seedMembershipGraph(harness);
    harness.tenancy.updateMembershipRole(graph.member.membershipId, 'retired-role');
    const generations = membershipGenerations(harness.db);

    expect(() => harness.roles.adoptSimpleTenantMembershipRoles()).toThrow(
      `membership roles are undeclared or retired: ${graph.member.membershipId}=retired-role`,
    );
    expect(count(harness.db, '_auth_tenant_membership_roles')).toBe(0);
    expect(membershipGenerations(harness.db)).toEqual(generations);

    harness.tenancy.updateMembershipRole(graph.member.membershipId, 'member');
    harness.db.prepare(`
      INSERT INTO _auth_tenant_membership_roles (
        assignment_id, tenant_id, membership_id, user_id, role_key,
        source, source_id, created_by, created_at, revoked_by, revoked_at
      ) VALUES ('old-history', ?, ?, ?, 'member', 'migration', 'old', NULL, ?, NULL, ?)
    `).run(
      graph.member.tenantId,
      graph.member.membershipId,
      graph.member.userId,
      Date.now() - 10,
      Date.now(),
    );
    expect(() => harness.roles.adoptSimpleTenantMembershipRoles()).toThrow(
      'advanced tenant assignment history already exists',
    );
  });

  test('never re-seeds a removed historical owner during normal advanced reconciliation', () => {
    const harness = createHarness();
    insertUser(harness.db, 'owner-a', 0);
    insertUser(harness.db, 'owner-b', 1);
    const created = harness.tenancy.createTenant({
      slug: 'owners', name: 'Owners', ownerUserId: 'owner-a',
    });
    const retainedOwner = harness.tenancy.addMembership({
      tenantId: created.tenant.tenantId,
      userId: 'owner-b',
      roleKey: 'owner',
      createdBy: 'owner-a',
    });
    const removedOwner = harness.tenancy.removeMembership(
      created.ownerMembership.membershipId,
    );

    expect(harness.roles.reconcileProtectedTenantOwners()).toBe(1);
    expect(harness.roles.resolveTenantRoles(subject(retainedOwner))?.roles)
      .toEqual(['owner']);
    expect(harness.roles.getRetainedTenantRoleSet(subject(removedOwner))?.roles)
      .toEqual([]);
    expect(harness.db.prepare(`
      SELECT COUNT(*) AS count FROM _auth_tenant_membership_roles
      WHERE membership_id = ?
    `).get(removedOwner.membershipId)).toEqual({ count: 0 });
  });

  test('rolls back partial assignments, generations, session rebinding, audit, and revision', () => {
    const harness = createHarness();
    const graph = seedMembershipGraph(harness);
    seedSessionArtifacts(harness.db, graph.manager);
    reconcileInstalledAuthProfile({
      db: harness.db,
      requested: { tenancy: 'multi', authorization: 'simple' },
      beforeCommit: () => {},
    });
    const audit = new AuthAuditService(
      harness.db,
      resolveAuthAuditConfig(undefined),
    );
    const before = fullTransitionSnapshot(harness.db);

    expect(() => reconcileInstalledAuthProfile({
      db: harness.db,
      requested: { tenancy: 'multi', authorization: 'advanced' },
      audit,
      beforeCommit: () => {
        const evidence = harness.roles.adoptSimpleTenantMembershipRoles();
        expect(evidence.assignments).toBe(4);
        expect(count(harness.db, '_auth_tenant_membership_roles')).toBe(4);
        expect(count(harness.db, '_auth_native_requests')).toBe(0);
        throw new Error('injected failure after adoption writes');
      },
    })).toThrow('injected failure after adoption writes');

    expect(fullTransitionSnapshot(harness.db)).toEqual(before);
    expect(readInstalledAuthProfile(harness.db)).toMatchObject({
      generation: 1, tenancy: 'multi', authorization: 'simple',
    });
  });

  test('fences cached role-service mutations inside the writer transaction', () => {
    const harness = createHarness();
    seedMembershipGraph(harness);
    const before = fullTransitionSnapshot(harness.db);
    harness.users.setRuntimeProfileGuard(() => {
      throw new AuthError(
        'stale profile',
        'AUTH_PROFILE_CHANGED',
        503,
      );
    });

    expect(() => harness.roles.adoptSimpleTenantMembershipRoles()).toThrow(
      expect.objectContaining({ code: 'AUTH_PROFILE_CHANGED', status: 503 }),
    );
    expect(fullTransitionSnapshot(harness.db)).toEqual(before);
  });
});

interface Harness {
  db: ReactiveDB;
  users: UserStore;
  tenancy: TenancyService;
  roles: AuthorizationRoleService;
}

function createHarness(): Harness {
  const db = createReactiveDB({ mode: 'memory' });
  databases.push(db);
  db.exec('PRAGMA foreign_keys = ON');
  defineAuthTables(db);
  defineTenancyTables(db);
  defineAuthorizationRoleTables(db);
  installAuthAuthorityRevision(db);
  const users = new UserStore(db, { tenancyMode: 'multi' });
  const tenancy = new TenancyService(new TenantStore(db));
  const kernel = createAuthorizationKernel(resolveAuthBehaviorConfig({
    tenancy: 'multi',
    authorization: 'advanced',
  }));
  const roles = new AuthorizationRoleService(
    db,
    new AuthorizationRoleStore(db),
    kernel,
    users,
    tenancy,
  );
  return { db, users, tenancy, roles };
}

function seedMembershipGraph(harness: Harness) {
  for (const [index, userId] of [
    'owner', 'manager', 'member', 'suspended', 'removed',
  ].entries()) insertUser(harness.db, userId, index);
  const created = harness.tenancy.createTenant({
    slug: 'adoption', name: 'Adoption', ownerUserId: 'owner',
  });
  const manager = harness.tenancy.addMembership({
    tenantId: created.tenant.tenantId,
    userId: 'manager', roleKey: 'manager', createdBy: 'owner',
  });
  const member = harness.tenancy.addMembership({
    tenantId: created.tenant.tenantId,
    userId: 'member', roleKey: 'member', createdBy: 'owner',
  });
  const suspended = harness.tenancy.addMembership({
    tenantId: created.tenant.tenantId,
    userId: 'suspended', roleKey: 'manager', createdBy: 'owner',
  });
  harness.tenancy.suspendMembership(suspended.membershipId);
  const removedCandidate = harness.tenancy.addMembership({
    tenantId: created.tenant.tenantId,
    userId: 'removed', roleKey: 'member', createdBy: 'owner',
  });
  const removed = harness.tenancy.removeMembership(removedCandidate.membershipId);
  return {
    owner: created.ownerMembership,
    manager,
    member,
    suspended: harness.tenancy.getMembershipById(suspended.membershipId)!,
    removed,
  };
}

function seedSessionArtifacts(db: ReactiveDB, membership: TenantMembershipRecord): void {
  const now = Date.now();
  db.prepare(`
    INSERT INTO _auth_sessions (
      session_id, user_id, kind, status, generation, scope_kind, scope_id,
      tenant_id, membership_id, tenant_authorization_generation,
      membership_authorization_generation, provenance, authenticated_at,
      created_at, last_seen_at, expires_at, revoked_at, revocation_reason
    ) VALUES ('web-manager', ?, 'web', 'active', 0, 'tenant', ?, ?, ?, 0, ?,
      'local', ?, ?, ?, ?, NULL, NULL)
  `).run(
    membership.userId,
    membership.tenantId,
    membership.tenantId,
    membership.membershipId,
    membership.authorizationGeneration,
    now,
    now,
    now,
    now + 60_000,
  );
  for (const [tokenId, consumedAt] of [['native-a', now], ['native-b', null]] as const) {
    db.prepare(`
      INSERT INTO _auth_native_sessions (
        token_id, family_id, user_id, client_id, token_hash, scope,
        auth_generation, expires_at, created_at, consumed_at, revoked_at,
        replaced_by, rotation_count, scope_kind, scope_id, tenant_id,
        membership_id, tenant_authorization_generation,
        membership_authorization_generation
      ) VALUES (?, 'native-family', ?, 'desktop', ?, 'openid', 0, ?, ?, ?,
        NULL, NULL, 0, 'tenant', ?, ?, ?, 0, ?)
    `).run(
      tokenId,
      membership.userId,
      `hash-${tokenId}`,
      now + 60_000,
      now,
      consumedAt,
      membership.tenantId,
      membership.tenantId,
      membership.membershipId,
      membership.authorizationGeneration,
    );
  }
  db.prepare(`
    INSERT INTO _auth_native_requests (
      request_id, request_hash, client_id, redirect_uri, scope, state, nonce,
      code_challenge, bound_user_id, created_at, expires_at, consumed_at,
      scope_kind, scope_id, tenant_id, membership_id,
      tenant_authorization_generation, membership_authorization_generation
    ) VALUES ('native-request', 'request-hash', 'desktop', 'zero://callback',
      'openid', 'state', 'nonce', 'challenge', ?, ?, ?, NULL, 'tenant', ?, ?, ?, 0, ?)
  `).run(
    membership.userId,
    now,
    now + 60_000,
    membership.tenantId,
    membership.tenantId,
    membership.membershipId,
    membership.authorizationGeneration,
  );
  db.prepare(`
    INSERT INTO _auth_native_codes (
      code_id, code_hash, request_id, user_id, client_id, redirect_uri,
      scope, nonce, code_challenge, auth_generation, created_at, expires_at,
      consumed_at, scope_kind, scope_id, tenant_id, membership_id,
      tenant_authorization_generation, membership_authorization_generation
    ) VALUES ('native-code', 'code-hash', 'native-request', ?, 'desktop',
      'zero://callback', 'openid', 'nonce', 'challenge', 0, ?, ?, NULL,
      'tenant', ?, ?, ?, 0, ?)
  `).run(
    membership.userId,
    now,
    now + 60_000,
    membership.tenantId,
    membership.tenantId,
    membership.membershipId,
    membership.authorizationGeneration,
  );
}

function insertUser(db: ReactiveDB, userId: string, index: number): void {
  db.prepare(`
    INSERT INTO users (
      user_id, username, email, role, status, password_change_required,
      email_verification_required, mfa_required, created_at
    ) VALUES (?, ?, ?, 'user', 'active', 0, 0, 0, ?)
  `).run(userId, userId, `${userId}-${index}@example.test`, Date.now());
}

function subject(membership: TenantMembershipRecord) {
  return {
    tenantId: membership.tenantId,
    membershipId: membership.membershipId,
    userId: membership.userId,
  };
}

function activeRoles(db: ReactiveDB): Array<[string, string]> {
  return (db.prepare(`
    SELECT membership_id, role_key FROM _auth_tenant_membership_roles
    WHERE revoked_at IS NULL ORDER BY membership_id, role_key
  `).all() as Array<{ membership_id: string; role_key: string }>)
    .map((row) => [row.membership_id, row.role_key]);
}

function membershipGenerations(db: ReactiveDB): Array<[string, number]> {
  return (db.prepare(`
    SELECT membership_id, authorization_generation
    FROM _auth_tenant_memberships ORDER BY membership_id
  `).all() as Array<{ membership_id: string; authorization_generation: number }>)
    .map((row) => [row.membership_id, row.authorization_generation]);
}

function count(db: ReactiveDB, table: string): number {
  return Number((db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as {
    count: number;
  }).count);
}

function fullTransitionSnapshot(db: ReactiveDB) {
  return {
    marker: readInstalledAuthProfile(db),
    revision: readAuthAuthorityRevision(db),
    assignments: db.prepare(`
      SELECT * FROM _auth_tenant_membership_roles ORDER BY assignment_id
    `).all(),
    memberships: db.prepare(`
      SELECT membership_id, authorization_generation
      FROM _auth_tenant_memberships ORDER BY membership_id
    `).all(),
    web: db.prepare(`
      SELECT session_id, membership_authorization_generation
      FROM _auth_sessions ORDER BY session_id
    `).all(),
    native: db.prepare(`
      SELECT token_id, membership_authorization_generation
      FROM _auth_native_sessions ORDER BY token_id
    `).all(),
    requests: db.prepare(`
      SELECT request_id FROM _auth_native_requests ORDER BY request_id
    `).all(),
    codes: db.prepare(`
      SELECT code_id FROM _auth_native_codes ORDER BY code_id
    `).all(),
    audit: db.prepare(`
      SELECT action, metadata_json FROM _auth_audit_events
      ORDER BY occurred_at, event_id
    `).all(),
  };
}
