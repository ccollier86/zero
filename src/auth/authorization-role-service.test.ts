import { afterEach, describe, expect, test } from 'bun:test';
import { Elysia } from 'elysia';

import { createReactiveDB, type ReactiveDB } from '../sync/reactive-db';
import { createSyncAuthorizationScope } from '../sync/sync-authorization-scope';
import { createEmailRuntime } from '../email/runtime';
import { resolveAuthBehaviorConfig } from './auth-config';
import { resolveAuthAuditConfig } from './auth-audit-config';
import { AuthAuditService } from './auth-audit-service';
import { installAuthAuthorityRevision } from './auth-authority-revision';
import { buildAdminConfigResponse } from './auth-admin-config-response';
import { AuthRuntime } from './auth-runtime';
import { defineAuthTables } from './auth-schema';
import { createAuthorizationKernel, type AuthorizationKernel } from './authorization-kernel';
import { AuthorizationRoleService } from './authorization-role-service';
import { AuthorizationRoleStore } from './authorization-role-store';
import {
  AuthorizationRoleAssignmentError,
  type AuthorizationRoleAssignmentErrorCode,
} from './authorization-role-types';
import { createAuthMiddleware } from './auth.middleware';
import { AuthError, type AuthContext } from './types';
import type { TokenService } from './token-service';
import { TenantStore } from './tenancy/tenant-store';
import { TenancyService } from './tenancy/tenancy-service';
import { UserStore } from './user-store';

interface Harness {
  db: ReactiveDB;
  kernel: AuthorizationKernel;
  users: UserStore;
  store: AuthorizationRoleStore;
  roles: AuthorizationRoleService;
  tenancy: TenancyService | null;
}

const databases: ReactiveDB[] = [];

afterEach(() => {
  for (const db of databases.splice(0).reverse()) db.dispose();
});

describe('advanced authorization role runtime', () => {
  test('expands additive application roles, allPermissions, and durable revisions', () => {
    const harness = createHarness('single');
    insertUser(harness.db, 'u_owner', 0, 'admin');
    insertUser(harness.db, 'u_subject', 1, 'admin');

    harness.roles.establishBootstrapOwner('u_owner');
    expect(harness.roles.getExpandedApplicationRoles('u_owner')).toMatchObject({
      roles: ['owner'],
      allPermissions: true,
      permissions: Object.keys(harness.kernel.authorization.permissions).sort(),
    });

    // A platform admin is not implicitly an application owner or role manager.
    expect(harness.roles.getExpandedApplicationRoles('u_subject')).toMatchObject({
      roles: [],
      permissions: [],
      allPermissions: false,
      revision: 'application:application:0',
    });
    const first = harness.roles.assignApplicationRole({
      userId: 'u_subject', roleKey: 'reader', createdBy: 'u_owner',
    });
    expect(first.authority).toMatchObject({
      roles: ['reader'],
      permissions: ['documents:read'],
      revision: 'application:application:1',
    });
    const second = harness.roles.assignApplicationRole({
      userId: 'u_subject', roleKey: 'writer', createdBy: 'u_owner',
    });
    expect(second.authority).toMatchObject({
      roles: ['reader', 'writer'],
      permissions: ['documents:read', 'documents:write'],
      revision: 'application:application:2',
    });
    expect(harness.roles.assignApplicationRole({
      userId: 'u_subject', roleKey: 'writer', createdBy: 'u_owner',
    }).authority.revision).toBe('application:application:2');
    expect(harness.roles.removeApplicationRole({
      userId: 'u_subject', roleKey: 'reader', revokedBy: 'u_owner',
    })).toMatchObject({
      roles: ['writer'],
      permissions: ['documents:write'],
      revision: 'application:application:3',
    });

    expectRoleError(() => harness.roles.assignApplicationRole({
      userId: 'u_subject', roleKey: 'owner', createdBy: 'u_owner',
    }), 'AUTHORIZATION_SYSTEM_ROLE_PROTECTED');
    expectRoleError(() => harness.roles.assignApplicationRole({
      userId: 'u_subject', roleKey: 'undeclared', createdBy: 'u_owner',
    }), 'AUTHORIZATION_ROLE_UNDECLARED');
  });

  test('rechecks application-role subject eligibility inside the write transaction', () => {
    const harness = createHarness('single');
    insertUser(harness.db, 'u_actor', 0);
    insertUser(harness.db, 'u_subject', 1);

    const restoreTransaction = interleaveBeforeNextTransaction(harness.db, () => {
      expect(harness.users.updateUser('u_subject', { status: 'suspended' })?.status)
        .toBe('suspended');
    });
    try {
      expectRoleError(() => harness.roles.assignApplicationRole({
        userId: 'u_subject',
        roleKey: 'reader',
        createdBy: 'u_actor',
      }), 'AUTHORIZATION_SUBJECT_INACTIVE');
    } finally {
      restoreTransaction();
    }

    expect(harness.roles.getRetainedApplicationRoleKeys('u_subject')).toEqual([]);
  });

  test('exposes deterministic registry metadata only through the admin-safe response', () => {
    const harness = createHarness('single');
    const config = resolveAuthBehaviorConfig({
      authorization: {
        mode: 'advanced',
        permissions: { 'documents:read': { label: 'Read documents' } },
        roles: { reader: { permissions: ['documents:read'] } },
      },
    });
    const response = buildAdminConfigResponse(
      harness.users,
      config,
      null,
      createEmailRuntime(false, {}),
      { canManageUsers: true, canManageGlobalAdmins: true },
    );
    if (!('permissions' in response.authorization)
      || !response.authorization.permissions
      || !response.authorization.roles) {
      throw new Error('Advanced admin config did not expose authorization metadata');
    }

    expect(Object.keys(response.authorization.permissions)).toContain('application.roles:read');
    expect(Object.keys(response.authorization.permissions)).toContain('documents:read');
    expect(response.authorization.roles.owner).toMatchObject({
      system: true,
      allPermissions: true,
      assignable: false,
    });
    expect(response.authorization.roles.reader).toMatchObject({ assignable: true });
    expect(response.authorization).not.toHaveProperty('assignments');
  });

  test('adopts one exact existing application owner atomically and idempotently', () => {
    const harness = createHarness('single');
    insertUser(harness.db, 'u_admin_a', 0, 'admin');
    insertUser(harness.db, 'u_admin_b', 1, 'admin');

    expect(harness.roles.hasActiveApplicationOwner()).toBe(false);
    expect(harness.roles.resolveApplicationRoles('u_admin_a')?.roles).toEqual([]);
    const adopted = harness.roles.adoptApplicationOwner({
      email: 'admin-0@example.test',
    });
    expect(adopted).toEqual({ userId: 'u_admin_a', changed: true });
    expect(harness.roles.adoptApplicationOwner({ userId: 'u_admin_a' }))
      .toEqual({ userId: 'u_admin_a', changed: false });
    expectRoleError(
      () => harness.roles.adoptApplicationOwner({ userId: 'u_admin_b' }),
      'AUTHORIZATION_OWNERSHIP_TARGET_INVALID',
    );
    expect(harness.roles.resolveApplicationRoles('u_admin_a')?.roles).toEqual(['owner']);
    expect(harness.roles.resolveApplicationRoles('u_admin_b')?.roles).toEqual([]);
    expectRoleError(
      () => harness.roles.adoptApplicationOwner({ email: 'missing@example.test' }),
      'AUTHORIZATION_SUBJECT_NOT_FOUND',
    );
  });

  test('creates the fresh bootstrap owner in the same transaction as the first user', async () => {
    const harness = createHarness('single');
    harness.users.setAuthorizationBootstrapper(harness.roles);

    harness.db.exec(`
      CREATE TRIGGER fail_bootstrap_application_owner
      BEFORE INSERT ON _auth_application_role_assignments
      WHEN NEW.role_key = 'owner'
      BEGIN
        SELECT RAISE(ABORT, 'injected advanced owner failure');
      END
    `);
    await expect(harness.users.createUser({
      username: 'rollback',
      email: 'rollback@example.test',
      password: 'password123',
    })).rejects.toThrow('injected advanced owner failure');
    expect(harness.users.countUsers()).toBe(0);
    expect(harness.users.isBootstrapRequired()).toBe(true);

    harness.db.exec('DROP TRIGGER fail_bootstrap_application_owner');
    const first = await harness.users.createUser({
      username: 'first',
      email: 'first@example.test',
      password: 'password123',
    });
    expect(harness.roles.resolveApplicationRoles(first.userId)?.roles).toEqual(['owner']);
    expect(harness.users.isBootstrapRequired()).toBe(false);
  });

  test('rolls back only the receipt-bound owner of a still-pending bootstrap', () => {
    const harness = createHarness('single');
    insertUser(harness.db, 'u_provisional', 0);
    harness.db.prepare(`
      INSERT INTO _auth_registration_provisioning (
        registration_id, user_id, tenant_id, is_bootstrap, created_at
      ) VALUES (?, ?, NULL, 1, ?)
    `).run('registration_exact', 'u_provisional', Date.now());
    harness.roles.establishBootstrapOwner('u_provisional', 'registration_exact');
    expect(harness.roles.hasProvisionalApplicationOwner({
      userId: 'u_provisional',
      registrationId: 'registration_exact',
    })).toBe(true);
    expect(harness.roles.hasProvisionalApplicationOwner({
      userId: 'u_provisional',
      registrationId: 'registration_wrong',
    })).toBe(false);
    expect(harness.roles.hasProvisionalRegistrationAuthority({
      userId: 'u_provisional',
      registrationId: 'registration_exact',
      tenantId: null,
      isBootstrap: true,
    })).toBe(true);

    expect(() => harness.db.prepare(`
      UPDATE _auth_application_role_assignments
      SET revoked_at = ?, revoked_by = ?
      WHERE user_id = ? AND role_key = 'owner' AND revoked_at IS NULL
    `).run(Date.now(), 'u_provisional', 'u_provisional'))
      .toThrow('AUTH_LAST_ACTIVE_APPLICATION_OWNER');
    expectAuthError(
      () => harness.users.deleteUser('u_provisional'),
      'LAST_ACTIVE_APPLICATION_OWNER_REQUIRED',
    );

    expect(harness.roles.rollbackProvisionalApplicationOwner({
      userId: 'u_provisional',
      registrationId: 'registration_wrong',
    })).toBe(false);
    expect(harness.roles.resolveApplicationRoles('u_provisional')?.roles)
      .toEqual(['owner']);

    // Finalizing the receipt closes the narrow trigger exception. Even raw
    // SQL cannot turn the finalized installation ownerless.
    harness.db.prepare(`
      DELETE FROM _auth_registration_provisioning WHERE registration_id = ?
    `).run('registration_exact');
    expect(harness.roles.hasProvisionalApplicationOwner({
      userId: 'u_provisional',
      registrationId: 'registration_exact',
    })).toBe(false);
    expect(harness.roles.rollbackProvisionalApplicationOwner({
      userId: 'u_provisional',
      registrationId: 'registration_exact',
    })).toBe(false);
    expect(() => harness.db.prepare(`
      DELETE FROM _auth_application_role_assignments
      WHERE user_id = 'u_provisional' AND role_key = 'owner'
    `).run()).toThrow('AUTH_LAST_ACTIVE_APPLICATION_OWNER');

    harness.db.prepare(`
      INSERT INTO _auth_registration_provisioning (
        registration_id, user_id, tenant_id, is_bootstrap, created_at
      ) VALUES (?, ?, NULL, 1, ?)
    `).run('registration_exact', 'u_provisional', Date.now());
    expect(harness.roles.rollbackProvisionalApplicationOwner({
      userId: 'u_provisional',
      registrationId: 'registration_exact',
    })).toBe(true);
    expect(harness.roles.resolveApplicationRoles('u_provisional')?.roles).toEqual([]);
    expect(harness.users.deleteUser('u_provisional')).toBe(true);
  });

  test('keeps provisional application-owner rollback idempotent after exact raw cleanup', () => {
    const harness = createHarness('single');
    insertUser(harness.db, 'u_provisional_absent', 0);
    harness.db.prepare(`
      INSERT INTO _auth_registration_provisioning (
        registration_id, user_id, tenant_id, is_bootstrap, created_at
      ) VALUES (?, ?, NULL, 1, ?)
    `).run('registration_absent', 'u_provisional_absent', Date.now());
    harness.roles.establishBootstrapOwner(
      'u_provisional_absent',
      'registration_absent',
    );

    expect(harness.db.prepare(`
      DELETE FROM _auth_application_role_assignments
      WHERE user_id = ? AND role_key = 'owner' AND source_id = ?
      RETURNING assignment_id
    `).all('u_provisional_absent', 'registration_absent')).toHaveLength(1);
    expect(harness.roles.hasProvisionalRegistrationAuthority({
      userId: 'u_provisional_absent',
      registrationId: 'registration_absent',
      tenantId: null,
      isBootstrap: true,
    })).toBe(false);
    expect(harness.roles.rollbackProvisionalApplicationOwner({
      userId: 'u_provisional_absent',
      registrationId: 'registration_absent',
    })).toBe(true);
    expect(harness.users.deleteUser('u_provisional_absent')).toBe(true);
  });

  test('allows only an exact pending registration to delete its provisional tenant owner', () => {
    const harness = createHarness('multi');
    insertUser(harness.db, 'u_provisional_owner', 0);
    insertUser(harness.db, 'u_unrelated', 1);
    harness.db.prepare(`
      INSERT INTO _auth_registration_provisioning (
        registration_id, user_id, tenant_id, is_bootstrap, created_at
      ) VALUES (?, ?, NULL, 0, ?)
    `).run('registration_tenant', 'u_provisional_owner', Date.now());
    const created = harness.tenancy!.createTenant({
      slug: 'provisional-tenant',
      name: 'Provisional Tenant',
      ownerUserId: 'u_provisional_owner',
    });
    harness.db.prepare(`
      UPDATE _auth_registration_provisioning SET tenant_id = ?
      WHERE registration_id = ? AND user_id = ?
    `).run(
      created.tenant.tenantId,
      'registration_tenant',
      'u_provisional_owner',
    );
    expect(harness.roles.hasProvisionalRegistrationAuthority({
      registrationId: 'registration_tenant',
      userId: 'u_provisional_owner',
      tenantId: created.tenant.tenantId,
      isBootstrap: false,
    })).toBe(true);

    // A marker for another identity is not an owner-lifecycle bypass.
    harness.db.prepare(`
      UPDATE _auth_registration_provisioning SET user_id = ?
      WHERE registration_id = ?
    `).run('u_unrelated', 'registration_tenant');
    expect(() => harness.db.prepare(`
      DELETE FROM _auth_tenants WHERE tenant_id = ?
    `).run(created.tenant.tenantId)).toThrow('AUTH_LAST_ACTIVE_TENANT_OWNER');

    harness.db.prepare(`
      UPDATE _auth_registration_provisioning SET user_id = ?
      WHERE registration_id = ?
    `).run('u_provisional_owner', 'registration_tenant');
    expect(harness.db.prepare(`
      DELETE FROM _auth_tenants WHERE tenant_id = ?
    `).run(created.tenant.tenantId).changes).toBeGreaterThan(0);
    expect(harness.roles.hasProvisionalRegistrationAuthority({
      registrationId: 'registration_tenant',
      userId: 'u_provisional_owner',
      tenantId: created.tenant.tenantId,
      isBootstrap: false,
    })).toBe(false);
    expect(harness.tenancy!.getTenant(created.tenant.tenantId)).toBeNull();
  });

  test('blocks an ownerless installed runtime until exact configured adoption succeeds', async () => {
    const db = createReactiveDB({ mode: 'memory' });
    databases.push(db);
    db.exec('PRAGMA foreign_keys = ON');
    defineAuthTables(db);
    insertUser(db, 'u_existing_a', 0, 'admin');
    insertUser(db, 'u_existing_b', 1, 'admin');
    const dependencies = {
      getEmailRuntime: () => createEmailRuntime(false, {}),
      getPlatformTokenService: () => null,
    };
    const baseConfig = { db };
    const blocked = new AuthRuntime(
      baseConfig,
      resolveAuthBehaviorConfig({ authorization: { mode: 'advanced' } }),
      dependencies,
    );

    await expect(blocked.start()).rejects.toMatchObject({
      name: 'AuthError',
      code: 'AUTHORIZATION_OWNERSHIP_REQUIRED',
      status: 503,
      message: expect.stringContaining(
        'existing users but no active application owner',
      ),
    });
    expect((db.prepare(`
      SELECT COUNT(*) AS count FROM _auth_application_role_assignments
    `).get() as { count: number }).count).toBe(0);

    const adopted = new AuthRuntime(
      baseConfig,
      resolveAuthBehaviorConfig({
        authorization: {
          mode: 'advanced',
          ownerAdoption: { userId: 'u_existing_b' },
        },
      }),
      dependencies,
    );
    await adopted.start();
    expect(adopted.getAuthorizationRoleService()
      ?.resolveApplicationRoles('u_existing_b')?.roles).toEqual(['owner']);
    expect(adopted.getAuthorizationRoleService()
      ?.resolveApplicationRoles('u_existing_a')?.roles).toEqual([]);
    expect(adopted.getAuditService()?.listPlatform({
      action: 'application.ownership-adopted',
    }).events).toContainEqual(expect.objectContaining({
      outcome: 'succeeded',
      actorProvenance: 'system',
      targetId: 'u_existing_b',
    }));
    adopted.getAuthorizationRoleService()!.transferApplicationOwnership({
      ownerUserId: 'u_existing_b',
      targetUserId: 'u_existing_a',
      changedBy: 'u_existing_b',
    });
    expect(adopted.getAuthorizationRoleService()
      ?.resolveApplicationRoles('u_existing_a')?.roles).toEqual(['owner']);
    expect(adopted.getAuthorizationRoleService()
      ?.resolveApplicationRoles('u_existing_b')?.roles).toEqual([]);
    await adopted.stop();

    // Keeping a now-stale adoption selector after ownership transfer is
    // harmless: startup must never silently re-grant the prior owner.
    const restarted = new AuthRuntime(
      baseConfig,
      resolveAuthBehaviorConfig({
        authorization: {
          mode: 'advanced',
          ownerAdoption: { email: 'admin-1@example.test' },
        },
      }),
      dependencies,
    );
    await restarted.start();
    expect(restarted.getAuthorizationRoleService()
      ?.resolveApplicationRoles('u_existing_a')?.roles).toEqual(['owner']);
    expect(restarted.getAuthorizationRoleService()
      ?.resolveApplicationRoles('u_existing_b')?.roles).toEqual([]);
    expect((db.prepare(`
      SELECT COUNT(*) AS count FROM _auth_application_role_assignments
      WHERE role_key = 'owner' AND revoked_at IS NULL
    `).get() as { count: number }).count).toBe(1);
    await restarted.stop();
  });

  test('rechecks tenant membership eligibility inside every role write transaction', () => {
    for (const operation of ['assign', 'remove', 'replace'] as const) {
      const harness = createHarness('multi');
      const tenancy = harness.tenancy!;
      insertUser(harness.db, `u_owner_${operation}`, 0);
      insertUser(harness.db, `u_member_${operation}`, 1);
      const tenant = tenancy.createTenant({
        slug: `transaction-${operation}`,
        name: `Transaction ${operation}`,
        ownerUserId: `u_owner_${operation}`,
      });
      const membership = tenancy.addMembership({
        tenantId: tenant.tenant.tenantId,
        userId: `u_member_${operation}`,
        roleKey: 'member',
        createdBy: `u_owner_${operation}`,
      });
      if (operation === 'remove') {
        harness.roles.assignTenantRole({
          tenantId: tenant.tenant.tenantId,
          membershipId: membership.membershipId,
          roleKey: 'auditor',
          createdBy: `u_owner_${operation}`,
        });
      }

      const restoreTransaction = interleaveBeforeNextTransaction(harness.db, () => {
        expect(tenancy.suspendMembership(membership.membershipId).status)
          .toBe('suspended');
      });
      try {
        expectRoleError(() => {
          if (operation === 'assign') {
            harness.roles.assignTenantRole({
              tenantId: tenant.tenant.tenantId,
              membershipId: membership.membershipId,
              roleKey: 'auditor',
              createdBy: `u_owner_${operation}`,
            });
            return;
          }
          if (operation === 'remove') {
            harness.roles.removeTenantRole({
              tenantId: tenant.tenant.tenantId,
              membershipId: membership.membershipId,
              roleKey: 'auditor',
              revokedBy: `u_owner_${operation}`,
            });
            return;
          }
          harness.roles.replaceTenantRoles({
            tenantId: tenant.tenant.tenantId,
            membershipId: membership.membershipId,
            roleKeys: ['auditor'],
            changedBy: `u_owner_${operation}`,
          });
        }, 'AUTHORIZATION_SUBJECT_INACTIVE');
      } finally {
        restoreTransaction();
      }

      expect(harness.roles.getRetainedTenantRoleKeys({
        tenantId: tenant.tenant.tenantId,
        membershipId: membership.membershipId,
        userId: `u_member_${operation}`,
      })).toEqual(operation === 'remove' ? ['auditor'] : []);
    }
  });

  test('enforces tenant boundaries, live membership state, and owner synchronization', () => {
    const harness = createHarness('multi');
    const tenancy = harness.tenancy!;
    insertUser(harness.db, 'u_owner_a', 0);
    insertUser(harness.db, 'u_owner_b', 1);
    insertUser(harness.db, 'u_member', 2);
    const tenantA = tenancy.createTenant({
      slug: 'tenant-a', name: 'Tenant A', ownerUserId: 'u_owner_a',
    });
    const tenantB = tenancy.createTenant({
      slug: 'tenant-b', name: 'Tenant B', ownerUserId: 'u_owner_b',
    });
    const memberA = tenancy.addMembership({
      tenantId: tenantA.tenant.tenantId,
      userId: 'u_member',
      roleKey: 'member',
      createdBy: 'u_owner_a',
    });
    const memberB = tenancy.addMembership({
      tenantId: tenantB.tenant.tenantId,
      userId: 'u_member',
      roleKey: 'member',
      createdBy: 'u_owner_b',
    });

    expect(harness.roles.resolveTenantRoles({
      tenantId: tenantA.tenant.tenantId,
      membershipId: tenantA.ownerMembership.membershipId,
      userId: 'u_owner_a',
    })?.roles).toEqual(['owner']);
    expectRoleError(() => harness.roles.assignTenantRole({
      tenantId: tenantB.tenant.tenantId,
      membershipId: memberA.membershipId,
      roleKey: 'auditor',
      createdBy: 'u_owner_b',
    }), 'AUTHORIZATION_SCOPE_MISMATCH');
    expect(() => harness.store.insertTenant({
      tenantId: tenantB.tenant.tenantId,
      membershipId: memberA.membershipId,
      userId: 'u_member',
      roleKey: 'auditor',
      source: 'manual',
      createdBy: 'u_owner_b',
    })).toThrow();

    const assigned = harness.roles.assignTenantRole({
      tenantId: tenantA.tenant.tenantId,
      membershipId: memberA.membershipId,
      roleKey: 'auditor',
      createdBy: 'u_owner_a',
    });
    expect(assigned.authority).toMatchObject({
      roles: ['auditor'],
      permissions: ['documents:read'],
      revision: `tenant:${tenantA.tenant.tenantId}:${memberA.membershipId}:1`,
    });
    expect(harness.roles.resolveTenantRoles({
      tenantId: tenantB.tenant.tenantId,
      membershipId: memberB.membershipId,
      userId: 'u_member',
    })?.roles).toEqual([]);

    tenancy.suspendMembership(memberA.membershipId);
    expect(harness.roles.resolveTenantRoles({
      tenantId: tenantA.tenant.tenantId,
      membershipId: memberA.membershipId,
      userId: 'u_member',
    })).toBeNull();
    expect(harness.roles.getRetainedTenantRoleSet({
      tenantId: tenantA.tenant.tenantId,
      membershipId: memberA.membershipId,
      userId: 'u_member',
    })).toMatchObject({
      roles: ['auditor'],
      revision: expect.stringContaining(
        `tenant:${tenantA.tenant.tenantId}:${memberA.membershipId}:`,
      ),
    });
    tenancy.reactivateMembership(memberA.membershipId);

    const secondOwner = tenancy.addMembership({
      tenantId: tenantA.tenant.tenantId,
      userId: 'u_owner_b',
      roleKey: 'owner',
      createdBy: 'u_owner_a',
    });
    expect(harness.roles.resolveTenantRoles({
      tenantId: tenantA.tenant.tenantId,
      membershipId: secondOwner.membershipId,
      userId: 'u_owner_b',
    })?.roles).toEqual(['owner']);
    tenancy.updateMembershipRole(secondOwner.membershipId, 'member');
    expect(harness.roles.resolveTenantRoles({
      tenantId: tenantA.tenant.tenantId,
      membershipId: secondOwner.membershipId,
      userId: 'u_owner_b',
    })?.roles).toEqual([]);
    expectRoleError(() => harness.roles.assignTenantRole({
      tenantId: tenantA.tenant.tenantId,
      membershipId: memberA.membershipId,
      roleKey: 'owner',
      createdBy: 'u_owner_a',
    }), 'AUTHORIZATION_SYSTEM_ROLE_PROTECTED');
    expect(() => harness.db.prepare(`
      INSERT INTO _auth_tenant_membership_roles (
        assignment_id, tenant_id, membership_id, user_id, role_key,
        source, source_id, created_by, created_at, revoked_by, revoked_at
      ) VALUES (?, ?, ?, ?, 'owner', 'system', 'raw-mismatch', ?, ?, NULL, NULL)
    `).run(
      'raw-mismatched-owner',
      tenantA.tenant.tenantId,
      memberA.membershipId,
      'u_member',
      'u_owner_a',
      Date.now(),
    )).toThrow('AUTH_TENANT_OWNER_ASSIGNMENT_MISMATCH');
  });

  test('keeps administration-only roles inert and unassignable in customer tenants', () => {
    const harness = createHarness('multi');
    const tenancy = harness.tenancy!;
    insertUser(harness.db, 'u_customer_owner', 0);
    insertUser(harness.db, 'u_admin_owner', 1);
    insertUser(harness.db, 'u_subject', 2);
    const customer = tenancy.createTenant({
      slug: 'customer',
      name: 'Customer',
      ownerUserId: 'u_customer_owner',
    });
    const administration = tenancy.createTenant({
      slug: 'administration',
      name: 'Administration',
      ownerUserId: 'u_admin_owner',
      kind: 'administration',
    });
    const customerMember = tenancy.addMembership({
      tenantId: customer.tenant.tenantId,
      userId: 'u_subject',
      roleKey: 'member',
      createdBy: 'u_customer_owner',
    });
    const adminMember = tenancy.addMembership({
      tenantId: administration.tenant.tenantId,
      userId: 'u_subject',
      roleKey: 'member',
      createdBy: 'u_admin_owner',
    });

    expectRoleError(() => harness.roles.assignTenantRole({
      tenantId: customer.tenant.tenantId,
      membershipId: customerMember.membershipId,
      roleKey: 'administrator',
      createdBy: 'u_customer_owner',
    }), 'AUTHORIZATION_ADMINISTRATION_SCOPE_REQUIRED');
    expectRoleError(() => harness.roles.replaceTenantRoles({
      tenantId: customer.tenant.tenantId,
      membershipId: customerMember.membershipId,
      roleKeys: ['access-manager'],
      changedBy: 'u_customer_owner',
    }), 'AUTHORIZATION_ADMINISTRATION_SCOPE_REQUIRED');
    expectRoleError(() => harness.roles.assignTenantRole({
      tenantId: customer.tenant.tenantId,
      membershipId: customerMember.membershipId,
      roleKey: 'platform-reader',
      createdBy: 'u_customer_owner',
    }), 'AUTHORIZATION_ADMINISTRATION_SCOPE_REQUIRED');

    // Simulate a retained pre-upgrade assignment. It remains visible for
    // cleanup but cannot contribute live customer authority.
    harness.store.insertTenant({
      tenantId: customer.tenant.tenantId,
      membershipId: customerMember.membershipId,
      userId: 'u_subject',
      roleKey: 'administrator',
      source: 'migration',
      sourceId: 'legacy-test',
      createdBy: 'u_customer_owner',
    });
    expect(harness.roles.getRetainedTenantRoleKeys({
      tenantId: customer.tenant.tenantId,
      membershipId: customerMember.membershipId,
      userId: 'u_subject',
    })).toContain('administrator');
    expect(harness.roles.resolveTenantRoles({
      tenantId: customer.tenant.tenantId,
      membershipId: customerMember.membershipId,
      userId: 'u_subject',
    })?.roles).not.toContain('administrator');
    harness.store.insertTenant({
      tenantId: customer.tenant.tenantId,
      membershipId: customerMember.membershipId,
      userId: 'u_subject',
      roleKey: 'platform-reader',
      source: 'migration',
      sourceId: 'legacy-custom-application-role-test',
      createdBy: 'u_customer_owner',
    });
    expect(harness.roles.getRetainedTenantRoleKeys({
      tenantId: customer.tenant.tenantId,
      membershipId: customerMember.membershipId,
      userId: 'u_subject',
    })).toContain('platform-reader');
    expect(harness.roles.resolveTenantRoles({
      tenantId: customer.tenant.tenantId,
      membershipId: customerMember.membershipId,
      userId: 'u_subject',
    })?.roles).not.toContain('platform-reader');

    expect(harness.roles.assignTenantRole({
      tenantId: administration.tenant.tenantId,
      membershipId: adminMember.membershipId,
      roleKey: 'member',
      createdBy: 'u_admin_owner',
    }).authority.roles).toContain('member');

    expect(harness.roles.assignTenantRole({
      tenantId: administration.tenant.tenantId,
      membershipId: adminMember.membershipId,
      roleKey: 'access-manager',
      createdBy: 'u_admin_owner',
    }).authority.permissions).toEqual(expect.arrayContaining([
      'tenant.members:manage',
      'tenant.roles:manage',
      'tenant.invitations:manage',
    ]));
    expect(harness.roles.assignTenantRole({
      tenantId: administration.tenant.tenantId,
      membershipId: adminMember.membershipId,
      roleKey: 'platform-reader',
      createdBy: 'u_admin_owner',
    }).authority.roles).toContain('platform-reader');
  });

  test('audits legacy tenant-owner role repair in the repair transaction', () => {
    const db = createReactiveDB({ mode: 'memory' });
    databases.push(db);
    db.exec('PRAGMA foreign_keys = ON');
    defineAuthTables(db);
    const audit = new AuthAuditService(db, resolveAuthAuditConfig(undefined));
    const users = new UserStore(db, { tenancyMode: 'multi', auditService: audit });
    insertUser(db, 'u_legacy_owner', 0, 'admin');
    const tenancy = new TenancyService(new TenantStore(db));
    const created = tenancy.createTenant({
      slug: 'legacy-owner',
      name: 'Legacy Owner',
      ownerUserId: 'u_legacy_owner',
    });
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
      audit,
    );

    expect(roles.reconcileProtectedTenantOwners()).toBe(1);
    expect(roles.resolveTenantRoles({
      tenantId: created.tenant.tenantId,
      membershipId: created.ownerMembership.membershipId,
      userId: 'u_legacy_owner',
    })?.roles).toEqual(['owner']);
    expect(audit.listPlatform({
      action: 'application.tenant-owner-roles-reconciled',
    }).events).toEqual([
      expect.objectContaining({
        outcome: 'succeeded',
        actorProvenance: 'system',
        metadata: { count: 1 },
      }),
    ]);
    expect(roles.reconcileProtectedTenantOwners()).toBe(0);
  });

  test('protects the last active application and tenant owner across global lifecycle writes', () => {
    const single = createHarness('single');
    insertUser(single.db, 'u_owner', 0, 'user');
    insertUser(single.db, 'u_platform_admin', 1, 'admin');
    single.roles.establishBootstrapOwner('u_owner');

    expectAuthError(
      () => single.users.updateUser('u_owner', { status: 'suspended' }),
      'LAST_ACTIVE_APPLICATION_OWNER_REQUIRED',
    );
    expectAuthError(
      () => single.users.updateUser('u_owner', { passwordChangeRequired: true }),
      'LAST_ACTIVE_APPLICATION_OWNER_REQUIRED',
    );
    expectAuthError(
      () => single.users.updateUser('u_owner', { emailVerificationRequired: true }),
      'LAST_ACTIVE_APPLICATION_OWNER_REQUIRED',
    );
    expect(single.users.updateUser('u_owner', {
      emailVerificationRequired: true,
      emailVerifiedAt: Date.now(),
    })?.emailVerifiedAt).toBeNumber();
    expectAuthError(
      () => single.users.updateUser('u_owner', { email: 'owner-changed@example.test' }),
      'LAST_ACTIVE_APPLICATION_OWNER_REQUIRED',
    );
    expect(() => single.db.prepare(`
      UPDATE users SET email_verified_at = NULL WHERE user_id = ?
    `).run('u_owner')).toThrow('AUTH_LAST_ACTIVE_APPLICATION_OWNER');
    expectAuthError(
      () => single.users.deleteUser('u_owner'),
      'LAST_ACTIVE_APPLICATION_OWNER_REQUIRED',
    );
    // A platform admin does not satisfy the application-owner invariant.
    expect(single.users.getUserById('u_platform_admin')?.status).toBe('active');
    single.users.updateUser('u_platform_admin', { passwordChangeRequired: true });
    expect(() => single.db.prepare(`
      INSERT INTO _auth_application_role_assignments (
        assignment_id, application_id, user_id, role_key, source, source_id,
        created_by, created_at, revoked_by, revoked_at
      ) VALUES (
        'ineligible-owner', 'application', 'u_platform_admin', 'owner',
        'manual', NULL, 'u_owner', 1, NULL, NULL
      )
    `).run()).toThrow('AUTH_APPLICATION_OWNER_TARGET_INELIGIBLE');
    single.users.updateUser('u_platform_admin', { passwordChangeRequired: false });
    single.roles.establishBootstrapOwner('u_platform_admin');
    expect(single.users.updateUser('u_owner', { status: 'suspended' })?.status)
      .toBe('suspended');

    const multi = createHarness('multi');
    insertUser(multi.db, 'u_tenant_owner', 0);
    insertUser(multi.db, 'u_inactive_owner', 1, 'admin');
    const tenant = multi.tenancy!.createTenant({
      slug: 'lifecycle', name: 'Lifecycle', ownerUserId: 'u_tenant_owner',
    });
    multi.tenancy!.addMembership({
      tenantId: tenant.tenant.tenantId,
      userId: 'u_inactive_owner',
      roleKey: 'owner',
      createdBy: 'u_tenant_owner',
    });
    multi.users.updateUser('u_inactive_owner', { status: 'suspended' });
    expectAuthError(
      () => multi.users.updateUser('u_tenant_owner', { status: 'suspended' }),
      'LAST_ACTIVE_TENANT_OWNER_REQUIRED',
    );
    expectAuthError(
      () => multi.users.deleteUser('u_tenant_owner'),
      'LAST_ACTIVE_TENANT_OWNER_REQUIRED',
    );
  });

  test('applies assignment changes to HTTP decisions and Sync fingerprints immediately', async () => {
    const harness = createHarness('single');
    insertUser(harness.db, 'u_actor', 0);
    insertUser(harness.db, 'u_subject', 1);
    harness.roles.establishBootstrapOwner('u_actor');
    const context: AuthContext = {
      userId: 'u_subject',
      email: 'user-1@example.test',
      role: 'user',
      sessionKind: 'web',
      sessionId: 'ses_subject',
      sessionGeneration: 0,
      sessionScopeKind: 'application',
      sessionScopeId: 'application',
    };
    const tokens = {
      assertCurrentProfile() {},
      resolveAuthContext: async () => ({
        ...context,
        authorizationAssignmentRevision:
          harness.roles.resolveApplicationRoles('u_subject')?.revision,
      }),
    } as unknown as TokenService;
    const app = new Elysia()
      .onError(({ error, set }) => {
        if (!(error instanceof AuthError)) return undefined;
        set.status = error.status;
        return { error: error.message, code: error.code };
      })
      .use(createAuthMiddleware(() => tokens, {
        getAuthorizationKernel: () => harness.kernel,
        getRoleAssignments: () => harness.roles,
      }))
      .get('/documents', () => ({ ok: true }), {
        zeroAuth: { permission: 'documents:read' },
      });

    const beforeRevision = harness.roles.resolveApplicationRoles('u_subject')!.revision;
    const beforeScope = createSyncAuthorizationScope({
      ...context,
      authorizationAssignmentRevision: beforeRevision,
    }, 'policy-v1');
    expect((await app.handle(request('/documents'))).status).toBe(403);

    harness.roles.assignApplicationRole({
      userId: 'u_subject', roleKey: 'reader', createdBy: 'u_actor',
    });
    const afterRevision = harness.roles.resolveApplicationRoles('u_subject')!.revision;
    const afterScope = createSyncAuthorizationScope({
      ...context,
      authorizationAssignmentRevision: afterRevision,
    }, 'policy-v1');
    expect(afterRevision).not.toBe(beforeRevision);
    expect(afterScope).not.toBe(beforeScope);
    expect((await app.handle(request('/documents'))).status).toBe(200);

    harness.roles.removeApplicationRole({
      userId: 'u_subject', roleKey: 'reader', revokedBy: 'u_actor',
    });
    expect((await app.handle(request('/documents'))).status).toBe(403);
  });

  test('keeps role persistence isolated across separate application runtimes', () => {
    const appA = createHarness('single');
    const appB = createHarness('single');
    for (const harness of [appA, appB]) {
      insertUser(harness.db, 'u_actor', 0);
      insertUser(harness.db, 'u_subject', 1);
      harness.roles.establishBootstrapOwner('u_actor');
    }
    appA.roles.assignApplicationRole({
      userId: 'u_subject', roleKey: 'reader', createdBy: 'u_actor',
    });

    expect(appA.roles.resolveApplicationRoles('u_subject')?.roles).toEqual(['reader']);
    expect(appB.roles.resolveApplicationRoles('u_subject')?.roles).toEqual([]);
  });
});

function createHarness(tenancyMode: 'single' | 'multi'): Harness {
  const db = createReactiveDB({ mode: 'memory' });
  databases.push(db);
  db.exec('PRAGMA foreign_keys = ON');
  defineAuthTables(db);
  const users = new UserStore(db);
  const kernel = createAuthorizationKernel(resolveAuthBehaviorConfig({
    tenancy: tenancyMode,
    authorization: {
      mode: 'advanced',
      permissions: {
        'documents:read': { label: 'Read documents' },
        'documents:write': { label: 'Write documents' },
      },
      roles: tenancyMode === 'single'
        ? {
            reader: { permissions: ['documents:read'] },
            writer: { permissions: ['documents:write'] },
          }
        : {
            auditor: { permissions: ['documents:read'] },
            'platform-reader': { permissions: ['application.users:read'] },
          },
    },
  }));
  let roles: AuthorizationRoleService | null = null;
  const tenancy = tenancyMode === 'multi'
    ? new TenancyService(new TenantStore(db, {
        onOwnerCreated: (input) => roles?.establishTenantOwner(input),
        onOwnerRoleChanged: (input) => roles?.syncTenantOwnerRole(input),
      }))
    : null;
  const store = new AuthorizationRoleStore(db);
  roles = new AuthorizationRoleService(db, store, kernel, users, tenancy);
  roles.reconcileProtectedTenantOwners();
  // Production installs the shared authority clock after every authority table
  // exists. Keep unit role writes under the same trigger side effects so their
  // mutation-result handling cannot regress to StatementResult.changes.
  installAuthAuthorityRevision(db);
  return { db, kernel, users, store, roles, tenancy };
}

function insertUser(
  db: ReactiveDB,
  userId: string,
  index: number,
  role = 'user',
): void {
  db.prepare(`
    INSERT INTO users (
      user_id, username, email, role, status,
      password_change_required, email_verification_required, mfa_required,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, 'active', 0, 0, 0, ?, NULL)
  `).run(userId, `user-${index}`, `admin-${index}@example.test`, role, Date.now());
}

/** Inject one competing committed write immediately before the next transaction. */
function interleaveBeforeNextTransaction(
  db: ReactiveDB,
  interleaving: () => void,
): () => void {
  const original = db.transaction.bind(db);
  let armed = true;
  db.transaction = (<T>(operation: () => T): T => {
    if (armed) {
      armed = false;
      interleaving();
    }
    return original(operation);
  });
  return () => {
    db.transaction = original;
  };
}

function expectRoleError(
  operation: () => unknown,
  code: AuthorizationRoleAssignmentErrorCode,
): void {
  try {
    operation();
    throw new Error(`Expected role assignment error: ${code}`);
  } catch (error) {
    expect(error).toBeInstanceOf(AuthorizationRoleAssignmentError);
    expect((error as AuthorizationRoleAssignmentError).code).toBe(code);
  }
}

function expectAuthError(operation: () => unknown, code: string): void {
  try {
    operation();
    throw new Error(`Expected auth error: ${code}`);
  } catch (error) {
    expect(error).toBeInstanceOf(AuthError);
    expect((error as AuthError).code).toBe(code);
  }
}

function request(path: string): Request {
  return new Request(`http://zero.test${path}`, {
    headers: { Authorization: 'Bearer valid' },
  });
}
