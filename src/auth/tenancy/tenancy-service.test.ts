import { afterEach, describe, expect, test } from 'bun:test';
import { defineAuthTables } from '../auth-schema';
import { createReactiveDB, type ReactiveDB } from '../../sync/reactive-db';
import { OBS_CODES } from '../../observability/codes';
import { emitPlatformCode } from '../../observability/sink';
import {
  TENANT_OWNER_ROLE_KEY,
  TenantStore,
  TenancyError,
  TenancyService,
  defineTenancyTables,
  type TenancyErrorCode,
} from './index';

const databases: ReactiveDB[] = [];

afterEach(() => {
  for (const db of databases.splice(0).reverse()) db.dispose();
});

describe('tenancy persistence and control plane', () => {
  test('fails cached direct store reads and writes after the installed profile changes', () => {
    const db = createReactiveDB({ mode: 'memory' });
    databases.push(db);
    db.exec('PRAGMA foreign_keys = ON');
    defineAuthTables(db);
    insertUser(db, 'owner-a', 0);
    let current = true;
    const store = new TenantStore(db, {
      assertCurrentProfile() {
        if (!current) throw new Error('AUTH_PROFILE_CHANGED');
      },
    });
    const created = store.createTenantWithOwner({
      slug: 'profile-fence',
      name: 'Profile Fence',
      ownerUserId: 'owner-a',
    });

    expect(store.getTenant(created.tenant.tenantId)).toEqual(created.tenant);
    current = false;

    expect(() => store.getTenant(created.tenant.tenantId))
      .toThrow('AUTH_PROFILE_CHANGED');
    expect(() => store.listActiveMembershipsForUser('owner-a'))
      .toThrow('AUTH_PROFILE_CHANGED');
    expect(() => store.hasActiveAdministrationMembership('owner-a'))
      .toThrow('AUTH_PROFILE_CHANGED');
    expect(() => store.bumpTenantAuthorizationGeneration(created.tenant.tenantId))
      .toThrow('AUTH_PROFILE_CHANGED');
    expect(() => store.createTenantWithOwner({
      slug: created.tenant.slug,
      name: 'Must Not Mask Profile Change',
      ownerUserId: 'owner-a',
    })).toThrow('AUTH_PROFILE_CHANGED');
    expect(db.prepare(`
      SELECT authorization_generation AS generation
      FROM _auth_tenants WHERE tenant_id = ?
    `).get(created.tenant.tenantId)).toEqual({ generation: 0 });
  });

  test('rejects an asynchronous direct-store profile fence before authority is used', async () => {
    const db = createReactiveDB({ mode: 'memory' });
    databases.push(db);
    db.exec('PRAGMA foreign_keys = ON');
    defineAuthTables(db);
    insertUser(db, 'async-profile-owner', 0);
    const emitted: string[] = [];
    const store = new TenantStore(db, {
      assertCurrentProfile: (async () => {
        throw new Error('private profile rejection');
      }) as never,
      emitCode: (definition, options) => {
        emitted.push(definition.code);
        return emitPlatformCode(definition, options);
      },
    });

    expect(() => store.createTenantWithOwner({
      slug: 'must-not-commit',
      name: 'Must Not Commit',
      ownerUserId: 'async-profile-owner',
    })).toThrow(expect.objectContaining({
      code: 'AUTH_STATE_INVARIANT_FAILED',
      message: '[auth] Tenant runtime profile guard must be synchronous.',
    }));
    await Promise.resolve();

    expect(db.prepare('SELECT COUNT(*) AS count FROM _auth_tenants').get())
      .toEqual({ count: 0 });
    expect(emitted).toEqual([OBS_CODES.AUTH_STATE_INVARIANT_FAILED.code]);
  });

  test('keeps independent app-local stores isolated', () => {
    const appA = createHarness('shared-owner');
    const appB = createHarness('shared-owner');
    const tenantA = appA.service.createTenant({
      slug: 'same-slug',
      name: 'App A Tenant',
      ownerUserId: 'shared-owner',
    });
    const tenantB = appB.service.createTenant({
      slug: 'same-slug',
      name: 'App B Tenant',
      ownerUserId: 'shared-owner',
    });

    appA.service.suspendTenant(tenantA.tenant.tenantId);
    expect(appA.service.getTenantBySlug('same-slug')?.status).toBe('suspended');
    expect(appB.service.getTenantBySlug('same-slug')).toEqual(tenantB.tenant);
    expect(appB.service.getTenant(tenantA.tenant.tenantId)).toBeNull();
  });

  test('creates a canonical tenant and owner atomically in internal tables', () => {
    const { db, service } = createHarness('owner-a');

    // Schema setup is additive and idempotent.
    defineTenancyTables(db);
    const created = service.createTenant({
      slug: '  Acme__Labs  ',
      name: '  Acme   Labs  ',
      ownerUserId: 'owner-a',
    });

    expect(created.tenant.slug).toBe('acme-labs');
    expect(created.tenant.name).toBe('Acme Labs');
    expect(created.tenant.tenantId).toStartWith('ten_');
    expect(created.tenant.tenantId).not.toContain('acme');
    expect(created.ownerMembership.membershipId).toStartWith('tmem_');
    expect(created.ownerMembership.roleKey).toBe(TENANT_OWNER_ROLE_KEY);
    expect(created.ownerMembership.status).toBe('active');
    expect(created.ownerMembership.tenantId).toBe(created.tenant.tenantId);
    expect(service.getTenantBySlug('ACME--LABS')).toEqual(created.tenant);

    expect(db.getTableNames()).not.toContain('_auth_tenants');
    expect(db.getTableNames()).not.toContain('_auth_tenant_memberships');

    expectTenancyError(
      () => service.createTenant({
        slug: 'acme-labs',
        name: 'Impostor',
        ownerUserId: 'owner-a',
      }),
      'TENANT_SLUG_TAKEN',
    );
    expect(service.listActiveMembershipsForTenant(created.tenant.tenantId)).toHaveLength(1);

    db.exec(`
      CREATE TRIGGER fail_initial_tenant_owner
      BEFORE INSERT ON _auth_tenant_memberships
      WHEN NEW.role_key = 'owner'
      BEGIN
        SELECT RAISE(ABORT, 'injected owner membership failure');
      END
    `);
    expect(() => service.createTenant({
      slug: 'rollback-check',
      name: 'Rollback Check',
      ownerUserId: 'owner-a',
    })).toThrow('injected owner membership failure');
    db.exec('DROP TRIGGER fail_initial_tenant_owner');
    expect(service.getTenantBySlug('rollback-check')).toBeNull();
  });

  test('rejects async owner hooks and rolls tenant and role mutations back', () => {
    const db = createReactiveDB({ mode: 'memory' });
    databases.push(db);
    db.exec('PRAGMA foreign_keys = ON');
    defineAuthTables(db);
    insertUser(db, 'async-owner', 0);
    insertUser(db, 'async-member', 1);
    const emitted: string[] = [];
    const ownerHookStore = new TenantStore(db, {
      onOwnerCreated: async () => {},
      emitCode: (definition, options) => {
        emitted.push(definition.code);
        return emitPlatformCode(definition, options);
      },
    });

    expect(() => ownerHookStore.createTenantWithOwner({
      slug: 'async-owner-hook',
      name: 'Async Owner Hook',
      ownerUserId: 'async-owner',
    })).toThrow(expect.objectContaining({
      code: 'AUTH_STATE_INVARIANT_FAILED',
      message: '[auth] Tenant owner creation callback must be synchronous.',
    }));
    expect(db.prepare('SELECT COUNT(*) AS count FROM _auth_tenants').get())
      .toEqual({ count: 0 });
    expect(db.prepare('SELECT COUNT(*) AS count FROM _auth_tenant_memberships').get())
      .toEqual({ count: 0 });

    const normal = new TenancyService(new TenantStore(db));
    const created = normal.createTenant({
      slug: 'owner-role-hook',
      name: 'Owner Role Hook',
      ownerUserId: 'async-owner',
    });
    const member = normal.addMembership({
      tenantId: created.tenant.tenantId,
      userId: 'async-member',
      roleKey: 'member',
      createdBy: 'async-owner',
    });
    const roleHook = new TenancyService(new TenantStore(db, {
      onOwnerRoleChanged: async () => {},
      emitCode: (definition, options) => {
        emitted.push(definition.code);
        return emitPlatformCode(definition, options);
      },
    }));

    expect(() => roleHook.transferOwnership(
      created.ownerMembership.membershipId,
      member.membershipId,
    )).toThrow(expect.objectContaining({
      code: 'AUTH_STATE_INVARIANT_FAILED',
      message: '[auth] Tenant owner role callback must be synchronous.',
    }));
    expect(normal.getMembershipById(created.ownerMembership.membershipId)?.roleKey)
      .toBe('owner');
    expect(normal.getMembershipById(member.membershipId)?.roleKey).toBe('member');
    expect(emitted).toEqual([
      OBS_CODES.AUTH_STATE_INVARIANT_FAILED.code,
      OBS_CODES.AUTH_STATE_INVARIANT_FAILED.code,
    ]);
  });

  test('isolates multi-membership state and generations across two tenants', () => {
    const { store, service } = createHarness('owner-a', 'owner-b', 'shared-user');
    const tenantA = service.createTenant({
      slug: 'tenant-a',
      name: 'Tenant A',
      ownerUserId: 'owner-a',
    });
    const tenantB = service.createTenant({
      slug: 'tenant-b',
      name: 'Tenant B',
      ownerUserId: 'owner-b',
    });
    const memberA = service.addMembership({
      tenantId: tenantA.tenant.tenantId,
      userId: 'shared-user',
      roleKey: 'member',
      createdBy: 'owner-a',
    });
    const memberB = service.addMembership({
      tenantId: tenantB.tenant.tenantId,
      userId: 'shared-user',
      roleKey: 'member',
      createdBy: 'owner-b',
    });

    expect(service.listActiveMembershipsForUser('shared-user').map((item) => item.tenantId))
      .toEqual([tenantA.tenant.tenantId, tenantB.tenant.tenantId]);
    expect(service.listActiveTenantMembershipsForUser('shared-user')).toEqual([
      { tenant: tenantA.tenant, membership: memberA },
      { tenant: tenantB.tenant, membership: memberB },
    ]);

    const suspendedA = service.suspendMembership(memberA.membershipId);
    expect(suspendedA.status).toBe('suspended');
    expect(suspendedA.authorizationGeneration).toBe(1);
    expect(service.listActiveMembershipsForUser('shared-user').map((item) => item.tenantId))
      .toEqual([tenantB.tenant.tenantId]);
    expect(service.getMembershipById(memberB.membershipId)?.status).toBe('active');
    expect(service.getMembershipById(memberB.membershipId)?.authorizationGeneration).toBe(0);

    const reactivatedA = service.reactivateMembership(memberA.membershipId);
    expect(reactivatedA.authorizationGeneration).toBe(2);
    const promotedA = service.updateMembershipRole(memberA.membershipId, ' MANAGER ');
    expect(promotedA.roleKey).toBe('manager');
    expect(promotedA.authorizationGeneration).toBe(3);
    expect(service.updateMembershipRole(memberA.membershipId, 'manager')
      .authorizationGeneration).toBe(3);
    expect(service.bumpMembershipAuthorizationGeneration(memberA.membershipId)
      .authorizationGeneration).toBe(4);

    const suspendedTenantA = service.suspendTenant(tenantA.tenant.tenantId);
    expect(suspendedTenantA.status).toBe('suspended');
    expect(suspendedTenantA.authorizationGeneration).toBe(1);
    expect(service.suspendTenant(tenantA.tenant.tenantId).authorizationGeneration).toBe(1);
    expect(service.listActiveMembershipsForUser('shared-user').map((item) => item.tenantId))
      .toEqual([tenantB.tenant.tenantId]);
    // Tenant administration can still inspect retained active memberships.
    expect(store.listActiveMembershipsForTenant(tenantA.tenant.tenantId)
      .map((item) => item.userId)).toContain('shared-user');

    expect(service.reactivateTenant(tenantA.tenant.tenantId).authorizationGeneration).toBe(2);
    expect(service.bumpTenantAuthorizationGeneration(tenantA.tenant.tenantId)
      .authorizationGeneration).toBe(3);
    expect(service.getTenant(tenantB.tenant.tenantId)?.authorizationGeneration).toBe(0);
  });

  test('checks live administration membership with one bounded lookup', () => {
    const { service } = createHarness('owner-a', 'shared-user');
    const administration = service.createTenant({
      slug: 'administration',
      name: 'Administration',
      ownerUserId: 'owner-a',
      kind: 'administration',
    });
    expect(service.hasActiveAdministrationMembership('shared-user')).toBe(false);
    const membership = service.addMembership({
      tenantId: administration.tenant.tenantId,
      userId: 'shared-user',
      roleKey: 'administrator',
      createdBy: 'owner-a',
    });
    expect(service.hasActiveAdministrationMembership('shared-user')).toBe(true);
    service.suspendMembership(membership.membershipId);
    expect(service.hasActiveAdministrationMembership('shared-user')).toBe(false);
    service.reactivateMembership(membership.membershipId);
    expect(service.hasActiveAdministrationMembership('shared-user')).toBe(true);
    service.removeMembership(membership.membershipId);
    expect(service.hasActiveAdministrationMembership('shared-user')).toBe(false);
  });

  test('protects the last active owner across suspension and role changes', () => {
    const { service } = createHarness('owner-a', 'owner-b');
    const created = service.createTenant({
      slug: 'protected-owner',
      name: 'Protected Owner',
      ownerUserId: 'owner-a',
    });
    const firstOwner = created.ownerMembership;

    expectTenancyError(
      () => service.suspendMembership(firstOwner.membershipId),
      'TENANT_LAST_OWNER',
    );
    expectTenancyError(
      () => service.updateMembershipRole(firstOwner.membershipId, 'member'),
      'TENANT_LAST_OWNER',
    );
    expect(service.getMembershipById(firstOwner.membershipId)?.authorizationGeneration).toBe(0);

    const secondOwner = service.addMembership({
      tenantId: created.tenant.tenantId,
      userId: 'owner-b',
      roleKey: 'OWNER',
      createdBy: 'owner-a',
    });
    expect(service.suspendMembership(firstOwner.membershipId).status).toBe('suspended');
    expectTenancyError(
      () => service.updateMembershipRole(secondOwner.membershipId, 'admin'),
      'TENANT_LAST_OWNER',
    );

    service.reactivateMembership(firstOwner.membershipId);
    const demoted = service.updateMembershipRole(secondOwner.membershipId, 'admin');
    expect(demoted.roleKey).toBe('admin');
    expect(service.listActiveMembershipsForTenant(created.tenant.tenantId)
      .filter((item) => item.roleKey === TENANT_OWNER_ROLE_KEY)).toHaveLength(1);
  });

  test('requires token-eligible ownership targets and guards raw membership writes', () => {
    const { db, service } = createHarness('owner-a', 'owner-b', 'gated-target');
    const created = service.createTenant({
      slug: 'usable-owner',
      name: 'Usable Owner',
      ownerUserId: 'owner-a',
    });
    const target = service.addMembership({
      tenantId: created.tenant.tenantId,
      userId: 'gated-target',
      roleKey: 'member',
      createdBy: 'owner-a',
    });
    db.prepare(`UPDATE users SET password_change_required = 1 WHERE user_id = ?`)
      .run('gated-target');
    expectTenancyError(
      () => service.transferOwnership(
        created.ownerMembership.membershipId,
        target.membershipId,
      ),
      'TENANT_OWNERSHIP_TARGET_INVALID',
    );
    expect(() => db.prepare(`
      UPDATE _auth_tenant_memberships SET role_key = 'owner'
      WHERE membership_id = ?
    `).run(target.membershipId)).toThrow('AUTH_TENANT_OWNER_TARGET_INELIGIBLE');

    db.prepare(`
      UPDATE users
      SET password_change_required = 0,
          email_verification_required = 1,
          email_verified_at = NULL
      WHERE user_id = ?
    `).run('gated-target');
    expectTenancyError(
      () => service.transferOwnership(
        created.ownerMembership.membershipId,
        target.membershipId,
      ),
      'TENANT_OWNERSHIP_TARGET_INVALID',
    );

    const secondOwner = service.addMembership({
      tenantId: created.tenant.tenantId,
      userId: 'owner-b',
      roleKey: 'owner',
      createdBy: 'owner-a',
    });
    db.prepare(`UPDATE users SET password_change_required = 1 WHERE user_id = ?`)
      .run('owner-b');
    expect(() => db.prepare(`
      UPDATE users
      SET email_verification_required = 1, email_verified_at = NULL
      WHERE user_id = ?
    `).run('owner-a')).toThrow('AUTH_LAST_ACTIVE_TENANT_OWNER');
    expect(() => db.prepare(`
      UPDATE users SET password_change_required = 1 WHERE user_id = ?
    `).run('owner-a')).toThrow('AUTH_LAST_ACTIVE_TENANT_OWNER');
    expect(() => db.prepare(`
      UPDATE _auth_tenant_memberships SET role_key = 'member'
      WHERE membership_id = ?
    `).run(created.ownerMembership.membershipId))
      .toThrow('AUTH_LAST_ACTIVE_TENANT_OWNER');
    expect(service.getMembershipById(secondOwner.membershipId)?.roleKey).toBe('owner');
  });

  test('scopes the pre-verification owner bridge to exactly one provisioned tenant', () => {
    const { db, service } = createHarness('pending-owner');
    db.prepare(`
      UPDATE users
      SET email_verification_required = 1, email_verified_at = NULL
      WHERE user_id = ?
    `).run('pending-owner');
    db.prepare(`
      INSERT INTO _auth_registration_intents (
        user_id, mfa_enrollment_requested, tenant_id, created_at
      ) VALUES (?, 0, NULL, ?)
    `).run('pending-owner', Date.now());
    db.prepare(`
      INSERT INTO _auth_registration_provisioning (
        registration_id, user_id, tenant_id, is_bootstrap, created_at
      ) VALUES (?, ?, NULL, 0, ?)
    `).run('registration-pending-owner', 'pending-owner', Date.now());

    const created = service.createTenant({
      slug: 'pending-verification',
      name: 'Pending Verification',
      ownerUserId: 'pending-owner',
    });
    db.prepare(`
      UPDATE _auth_registration_provisioning SET tenant_id = ?
      WHERE registration_id = ?
    `).run(created.tenant.tenantId, 'registration-pending-owner');
    db.prepare(`
      UPDATE _auth_registration_intents SET tenant_id = ? WHERE user_id = ?
    `).run(created.tenant.tenantId, 'pending-owner');
    db.prepare(`
      DELETE FROM _auth_registration_provisioning WHERE registration_id = ?
    `).run('registration-pending-owner');

    expect(() => service.assertUsableOwnerInvariants()).not.toThrow();
    db.prepare(`
      INSERT INTO _auth_tenants (
        tenant_id, slug, name, status, authorization_generation,
        created_by, created_at, updated_at, suspended_at
      ) VALUES (?, ?, ?, 'active', 0, ?, ?, ?, NULL)
    `).run(
      'second-tenant',
      'second-pending-verification',
      'Second Pending Verification',
      'pending-owner',
      Date.now(),
      Date.now(),
    );
    expect(() => db.prepare(`
      INSERT INTO _auth_tenant_memberships (
        membership_id, tenant_id, user_id, status, role_key,
        authorization_generation, joined_at, created_at, updated_at,
        suspended_at, removed_at, created_by
      ) VALUES (
        'second-owner', 'second-tenant', 'pending-owner', 'active', 'owner',
        0, 1, 1, 1, NULL, NULL, 'pending-owner'
      )
    `).run()).toThrow('AUTH_TENANT_OWNER_TARGET_INELIGIBLE');
    db.prepare(`DELETE FROM _auth_tenants WHERE tenant_id = 'second-tenant'`).run();

    db.prepare(`UPDATE _auth_registration_intents SET tenant_id = 'wrong-tenant'
      WHERE user_id = 'pending-owner'`).run();
    expectTenancyError(
      () => service.assertUsableOwnerInvariants(),
      'TENANT_USABLE_OWNER_REQUIRED',
    );
  });

  test('serializes competing owner suspensions so one active owner remains', async () => {
    const harness = createHarness('owner-a', 'owner-b');
    const created = harness.service.createTenant({
      slug: 'owner-race',
      name: 'Owner Race',
      ownerUserId: 'owner-a',
    });
    const secondOwner = harness.service.addMembership({
      tenantId: created.tenant.tenantId,
      userId: 'owner-b',
      roleKey: 'owner',
      createdBy: 'owner-a',
    });
    // A second store represents another control-plane caller sharing this app DB.
    const contender = new TenancyService(new TenantStore(harness.db));

    const outcomes = await Promise.allSettled([
      Promise.resolve().then(() => harness.service.suspendMembership(
        created.ownerMembership.membershipId,
      )),
      Promise.resolve().then(() => contender.suspendMembership(secondOwner.membershipId)),
    ]);

    expect(outcomes.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = outcomes.find((result) => result.status === 'rejected');
    expect(rejected?.status).toBe('rejected');
    if (rejected?.status === 'rejected') {
      expect(rejected.reason).toBeInstanceOf(TenancyError);
      expect((rejected.reason as TenancyError).code).toBe('TENANT_LAST_OWNER');
    }
    const activeOwners = harness.service
      .listActiveMembershipsForTenant(created.tenant.tenantId)
      .filter((membership) => membership.roleKey === TENANT_OWNER_ROLE_KEY);
    expect(activeOwners).toHaveLength(1);
  });

  test('retains unique relationships and fails closed for invalid membership admission', () => {
    const { service } = createHarness('owner-a', 'member-a');
    const created = service.createTenant({
      slug: 'membership-lifecycle',
      name: 'Membership Lifecycle',
      ownerUserId: 'owner-a',
    });
    const member = service.addMembership({
      tenantId: created.tenant.tenantId,
      userId: 'member-a',
      roleKey: 'member',
      createdBy: 'owner-a',
    });

    expectTenancyError(
      () => service.addMembership({
        tenantId: created.tenant.tenantId,
        userId: 'member-a',
        roleKey: 'admin',
        createdBy: 'owner-a',
      }),
      'TENANT_MEMBERSHIP_EXISTS',
    );
    service.suspendMembership(member.membershipId);
    expectTenancyError(
      () => service.addMembership({
        tenantId: created.tenant.tenantId,
        userId: 'member-a',
        roleKey: 'member',
        createdBy: 'owner-a',
      }),
      'TENANT_MEMBERSHIP_EXISTS',
    );
    expectTenancyError(
      () => service.addMembership({
        tenantId: created.tenant.tenantId,
        userId: 'missing-user',
        roleKey: 'member',
        createdBy: 'owner-a',
      }),
      'TENANT_USER_NOT_FOUND',
    );
    expectTenancyError(
      () => service.addMembership({
        tenantId: created.tenant.tenantId,
        userId: 'member-a',
        roleKey: 'member',
        createdBy: 'missing-actor',
      }),
      'TENANT_USER_NOT_FOUND',
    );

    service.suspendTenant(created.tenant.tenantId);
    expectTenancyError(
      () => service.addMembership({
        tenantId: created.tenant.tenantId,
        userId: 'owner-a',
        roleKey: 'member',
        createdBy: 'owner-a',
      }),
      'TENANT_NOT_ACTIVE',
    );
  });
});

function createHarness(...userIds: string[]): {
  db: ReactiveDB;
  store: TenantStore;
  service: TenancyService;
} {
  const db = createReactiveDB({ mode: 'memory' });
  databases.push(db);
  db.exec('PRAGMA foreign_keys = ON');
  defineAuthTables(db);
  for (const [index, userId] of userIds.entries()) insertUser(db, userId, index);
  let now = 1_000;
  const store = new TenantStore(db, { now: () => ++now });
  return { db, store, service: new TenancyService(store) };
}

function insertUser(db: ReactiveDB, userId: string, index: number): void {
  db.prepare(`
    INSERT INTO users (
      user_id, username, email, role, status,
      password_change_required, email_verification_required, mfa_required,
      created_at, updated_at
    ) VALUES (?, ?, ?, 'user', 'active', 0, 0, 0, ?, NULL)
  `).run(userId, `user-${index}`, `user-${index}@example.test`, Date.now());
}

function expectTenancyError(fn: () => unknown, code: TenancyErrorCode): void {
  try {
    fn();
    throw new Error(`Expected tenancy error: ${code}`);
  } catch (error) {
    expect(error).toBeInstanceOf(TenancyError);
    expect((error as TenancyError).code).toBe(code);
  }
}
