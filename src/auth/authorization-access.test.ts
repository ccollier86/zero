import { describe, expect, test } from 'bun:test';
import { resolveAuthBehaviorConfig } from './auth-config';
import { createAuthAuthorizationSnapshot } from './auth-authorization-snapshot';
import {
  createAuthorizationSubjectSnapshot,
  createRequestAuthorizationAccess,
} from './authorization-access';
import { createAuthorizationKernel } from './authorization-kernel';
import { AuthError, type AuthContext } from './types';
import { OBS_CODES } from '../observability/codes';
import { emitPlatformCode } from '../observability/sink';

const permissions = {
  'documents:read': { label: 'Read documents' },
  'documents:write': { label: 'Write documents' },
};

function createKernel(
  tenancy: 'single' | 'multi',
  mode: 'simple' | 'advanced' = 'simple',
) {
  return createAuthorizationKernel(resolveAuthBehaviorConfig({
    tenancy,
    authorization: {
      mode,
      permissions,
      roles: {
        clinician: { permissions: ['documents:read'] },
        owner: { allPermissions: true, system: true },
      },
    },
    userProperties: {
      department: { editableBy: 'admin', useInPolicies: true },
    },
  }));
}

describe('request authorization access', () => {
  test('projects administration-organization application authority without broadening legacy admin', () => {
    for (const mode of ['simple', 'advanced'] as const) {
      const kernel = createKernel('multi', mode);
      const roleAssignments = mode === 'advanced' ? {
        resolveApplicationRoles: () => null,
        resolveTenantRoles: ({ tenantId, membershipId, userId }: {
          tenantId: string;
          membershipId: string;
          userId: string;
        }) => ({
          scopeKind: 'tenant' as const,
          scopeId: tenantId,
          tenantId,
          membershipId,
          userId,
          roles: ['owner'],
          revision: 'tenant-assignment-1',
        }),
      } : null;
      const context = (tenantKind: 'organization' | 'administration'): AuthContext => ({
        userId: `u_${mode}_${tenantKind}`,
        email: `${mode}-${tenantKind}@example.test`,
        role: 'user',
        sessionScopeKind: 'tenant',
        sessionScopeId: `ten_${tenantKind}`,
        tenantId: `ten_${tenantKind}`,
        tenantKind,
        membershipId: `tmem_${tenantKind}`,
        tenantRole: 'owner',
        tenantAuthorizationGeneration: 2,
        membershipAuthorizationGeneration: 3,
      });

      const customer = createRequestAuthorizationAccess({
        kernel,
        authContext: context('organization'),
        roleAssignments,
      });
      expect(customer.requirePermission('documents:read').scopeKind).toBe('tenant');
      expect(customer.applicationAuthorization).toBeNull();
      expect(() => customer.requirePermission('application.users:read'))
        .toThrow(expect.objectContaining({ code: 'FORBIDDEN' }));

      const administration = createRequestAuthorizationAccess({
        kernel,
        authContext: context('administration'),
        roleAssignments,
      });
      expect(administration.applicationAuthorization).toMatchObject({
        scopeKind: 'application',
        roles: ['owner'],
        allPermissions: true,
      });
      expect(administration.requirePermission('application.users:manage').scopeKind)
        .toBe('application');
      expect(createAuthAuthorizationSnapshot(
        context('administration'),
        kernel,
        administration,
      )).toMatchObject({
        scope: { kind: 'tenant', tenantId: 'ten_administration' },
        applicationScope: {
          kind: 'application',
          permissions: expect.arrayContaining(['application.users:manage']),
        },
      });
      expect(() => administration.requirePlatformAdmin())
        .toThrow(expect.objectContaining({ code: 'FORBIDDEN' }));
    }
  });

  test('makes administration-only simple roles inert in customer organizations', () => {
    const kernel = createKernel('multi', 'simple');
    const access = createRequestAuthorizationAccess({
      kernel,
      authContext: {
        userId: 'u_customer_admin_role',
        email: 'customer-admin-role@example.test',
        role: 'user',
        sessionScopeKind: 'tenant',
        sessionScopeId: 'ten_customer',
        tenantId: 'ten_customer',
        tenantKind: 'organization',
        membershipId: 'tmem_customer',
        tenantRole: 'administrator',
        tenantAuthorizationGeneration: 1,
        membershipAuthorizationGeneration: 1,
      },
    });
    expect(access.authorization).toBeNull();
    expect(access.applicationAuthorization).toBeNull();
  });

  test('fences every cached authority accessor after the runtime profile changes', () => {
    const kernel = createKernel('multi');
    const authContext: AuthContext = {
      userId: 'u_cached',
      email: 'cached@example.test',
      role: 'admin',
      sessionScopeKind: 'tenant',
      sessionScopeId: 'ten_cached',
      tenantId: 'ten_cached',
      membershipId: 'tmem_cached',
      tenantRole: 'owner',
      tenantAuthorizationGeneration: 1,
      membershipAuthorizationGeneration: 1,
    };
    let current = true;
    const access = createRequestAuthorizationAccess({
      kernel,
      authContext,
      assertCurrentProfile() {
        if (current) return;
        throw new AuthError(
          'This runtime auth profile is stale',
          'AUTH_PROFILE_CHANGED',
          503,
        );
      },
    });

    expect(access.context).toBe(authContext);
    expect(access.authorization?.tenantId).toBe('ten_cached');
    expect(access.authorize('user')?.tenantId).toBe('ten_cached');
    expect(access.requireUser()).toBe(authContext);
    expect(access.requirePlatformAdmin()).toBe(authContext);
    expect(access.requireAuthorizationScope().tenantId).toBe('ten_cached');
    expect(access.requireTenant().tenantId).toBe('ten_cached');
    expect(access.hasPermission('documents:read')).toBe(true);
    expect(access.requirePermission('documents:read').tenantId).toBe('ten_cached');
    expect(access.requireAnyPermission(['documents:read']).tenantId).toBe('ten_cached');

    current = false;
    const staleReads = [
      () => access.context,
      () => access.authorization,
      () => access.authorize('user'),
      () => access.requireUser(),
      () => access.requirePlatformAdmin(),
      () => access.requireAuthorizationScope(),
      () => access.requireTenant(),
      () => access.hasPermission('documents:read'),
      () => access.requirePermission('documents:read'),
      () => access.requireAnyPermission(['documents:read']),
    ];
    for (const read of staleReads) {
      expect(read).toThrow(expect.objectContaining({
        code: 'AUTH_PROFILE_CHANGED',
        status: 503,
      }));
    }

    // The transport-neutral projection helper remains pure. Only the cached
    // request authority facade owns the runtime-generation assertion.
    expect(createAuthorizationSubjectSnapshot(kernel, authContext).authorization)
      .toMatchObject({ tenantId: 'ten_cached', roles: ['owner'] });
  });

  test('preserves the single/simple role contract and live trusted properties', () => {
    const kernel = createKernel('single');
    let propertyReads = 0;
    const access = createRequestAuthorizationAccess({
      kernel,
      authContext: {
        userId: 'u_clinician',
        email: 'clinician@example.test',
        role: 'clinician',
      },
      propertyStore: {
        getProperties() {
          propertyReads += 1;
          return { department: 'clinical' };
        },
      },
    });

    expect(propertyReads).toBe(0);
    expect(access.authorization).toMatchObject({
      tenancy: 'single',
      scopeKind: 'application',
      roles: ['clinician'],
      permissions: ['documents:read'],
    });
    expect(propertyReads).toBe(0);
    expect(access.hasPermission('documents:read')).toBe(true);
    expect(access.hasPermission('documents:write')).toBe(false);
    expect(access.requireAnyPermission(['documents:write', 'documents:read']))
      .toBe(access.authorization!);
    expect(() => access.requireAnyPermission([])).toThrow(
      'anyPermissions must be a non-empty string array',
    );
    expect(access.authorize({
      permission: 'documents:read',
      properties: { department: 'clinical' },
    })).toBe(access.authorization);
    expect(propertyReads).toBe(1);
    expect(() => access.requirePlatformAdmin()).toThrow('Forbidden');
    expect(() => access.requireTenant()).toThrow('Forbidden');
  });

  test('keeps unmapped single/simple platform roles valid but permission-inert', () => {
    const kernel = createKernel('single');
    const access = createRequestAuthorizationAccess({
      kernel,
      authContext: {
        userId: 'u_platform_admin',
        email: 'admin@example.test',
        role: 'admin',
      },
    });

    expect(access.requirePlatformAdmin().userId).toBe('u_platform_admin');
    expect(access.authorize('admin')).toBe(access.authorization);
    expect(access.authorization).toMatchObject({
      scopeKind: 'application',
      roles: ['admin'],
      permissions: [],
    });
    expect(access.hasPermission('documents:read')).toBe(false);
    expect(() => access.authorize({ anyPermissions: ['documents:read'] }))
      .toThrow('Forbidden');
    expect(() => access.authorize({ scopeRole: 'clinician' })).toThrow('Forbidden');
  });

  test('does not promote an unmapped platform role when the scope-role registry is empty', () => {
    const kernel = createAuthorizationKernel(resolveAuthBehaviorConfig({
      tenancy: 'single',
      authorization: {
        mode: 'simple',
        permissions,
        roles: {},
      },
    }));
    const access = createRequestAuthorizationAccess({
      kernel,
      authContext: {
        userId: 'u_platform_admin',
        email: 'admin@example.test',
        role: 'admin',
      },
    });

    expect(access.requirePlatformAdmin().userId).toBe('u_platform_admin');
    expect(access.authorize('admin')).toBe(access.authorization);
    expect(access.authorization).toMatchObject({ roles: ['admin'], permissions: [] });
    expect(access.hasPermission('documents:read')).toBe(false);
    expect(() => access.authorize({ permission: 'documents:read' })).toThrow('Forbidden');
    expect(() => access.authorize({ scopeRole: 'admin' }))
      .toThrow('references undeclared scope role "admin"');
  });

  test('expands only the session-bound multi/simple membership role', () => {
    const kernel = createKernel('multi');
    const authContext: AuthContext = {
      userId: 'u_member',
      email: 'member@example.test',
      role: 'user',
      sessionKind: 'web',
      sessionId: 'ses_member',
      sessionGeneration: 0,
      sessionScopeKind: 'tenant',
      sessionScopeId: 'ten_clinic',
      tenantId: 'ten_clinic',
      membershipId: 'tmem_member',
      tenantRole: 'owner',
      tenantAuthorizationGeneration: 2,
      membershipAuthorizationGeneration: 4,
    };
    const access = createRequestAuthorizationAccess({ kernel, authContext });

    expect(access.requireTenant()).toMatchObject({
      tenantId: 'ten_clinic',
      membershipId: 'tmem_member',
      roles: ['owner'],
      allPermissions: true,
    });
    expect(access.requirePermission('documents:write')).toBe(access.authorization!);
    expect(() => access.authorize('admin')).toThrow('Forbidden');
  });

  test('fails scoped authorization closed when a multi session is not tenant-bound', () => {
    const kernel = createKernel('multi');
    const access = createRequestAuthorizationAccess({
      kernel,
      authContext: {
        userId: 'u_unbound',
        email: 'unbound@example.test',
        role: 'user',
        sessionKind: 'native',
        sessionId: 'native_family',
      },
    });

    expect(access.authorization).toBeNull();
    expect(access.authorize('user')).toBeNull();
    expect(access.hasPermission('documents:read')).toBe(false);
    expect(() => access.authorize({ tenant: 'required' })).toThrow('Forbidden');
  });

  test('fails advanced scope closed without a live assignment resolver', () => {
    const kernel = createKernel('multi', 'advanced');
    const subject = createAuthorizationSubjectSnapshot(kernel, {
      userId: 'u_advanced',
      email: 'advanced@example.test',
      role: 'admin',
      sessionKind: 'web',
      sessionId: 'ses_advanced',
      sessionGeneration: 0,
      sessionScopeKind: 'tenant',
      sessionScopeId: 'ten_advanced',
      tenantId: 'ten_advanced',
      membershipId: 'tmem_advanced',
      // A simple membership column is not an advanced assignment row.
      tenantRole: 'owner',
      tenantAuthorizationGeneration: 1,
      membershipAuthorizationGeneration: 1,
    });
    const access = createRequestAuthorizationAccess({
      kernel,
      authContext: {
        userId: 'u_advanced',
        email: 'advanced@example.test',
        role: 'admin',
        sessionScopeKind: 'tenant',
        sessionScopeId: 'ten_advanced',
        tenantId: 'ten_advanced',
        membershipId: 'tmem_advanced',
        tenantRole: 'owner',
        tenantAuthorizationGeneration: 1,
        membershipAuthorizationGeneration: 1,
      },
    });

    expect(subject.authorization).toBeNull();
    expect(access.authorization).toBeNull();
    expect(access.hasPermission('documents:read')).toBe(false);
    expect(() => access.requireTenant()).toThrow('Forbidden');
    expect(() => access.authorize({ scopeRole: 'owner' })).toThrow('Forbidden');
  });

  test('keeps a valid unassigned advanced membership distinct from an invalid one', () => {
    const kernel = createKernel('multi', 'advanced');
    const authContext: AuthContext = {
      userId: 'u_member',
      email: 'member@example.test',
      role: 'user',
      sessionScopeKind: 'tenant',
      sessionScopeId: 'ten_clinic',
      tenantId: 'ten_clinic',
      membershipId: 'tmem_member',
      tenantAuthorizationGeneration: 0,
      membershipAuthorizationGeneration: 0,
    };
    const active = createRequestAuthorizationAccess({
      kernel,
      authContext,
      roleAssignments: {
        resolveApplicationRoles: () => null,
        resolveTenantRoles: () => ({
          scopeKind: 'tenant',
          scopeId: 'ten_clinic',
          tenantId: 'ten_clinic',
          membershipId: 'tmem_member',
          userId: 'u_member',
          roles: [],
          revision: 'tenant:ten_clinic:tmem_member:0',
        }),
      },
    });
    const inactive = createRequestAuthorizationAccess({
      kernel,
      authContext,
      roleAssignments: {
        resolveApplicationRoles: () => null,
        resolveTenantRoles: () => null,
      },
    });

    expect(active.requireTenant()).toMatchObject({ roles: [], permissions: [] });
    expect(inactive.authorization).toBeNull();
  });

  for (const tenancy of ['single', 'multi'] as const) {
    test(`keeps retired ${tenancy}/advanced assignments inert without hiding declared authority`, () => {
      const kernel = createKernel(tenancy, 'advanced');
      const userId = `u_${tenancy}_retired`;
      const tenantId = `ten_${tenancy}_retired`;
      const membershipId = `tmem_${tenancy}_retired`;
      const authContext: AuthContext = tenancy === 'single'
        ? {
            userId,
            email: `${tenancy}-retired@example.test`,
            role: 'user',
            sessionScopeKind: 'application',
            sessionScopeId: 'application',
          }
        : {
            userId,
            email: `${tenancy}-retired@example.test`,
            role: 'user',
            sessionScopeKind: 'tenant',
            sessionScopeId: tenantId,
            tenantId,
            membershipId,
            tenantAuthorizationGeneration: 2,
            membershipAuthorizationGeneration: 4,
          };
      let roles: readonly string[] = ['clinician', 'retired-role'];
      const roleAssignments = {
        resolveApplicationRoles: () => tenancy === 'single' ? ({
          scopeKind: 'application' as const,
          scopeId: 'application',
          userId,
          roles,
          revision: 'application:application:7',
        }) : null,
        resolveTenantRoles: () => tenancy === 'multi' ? ({
          scopeKind: 'tenant' as const,
          scopeId: tenantId,
          tenantId,
          membershipId,
          userId,
          roles,
          revision: `${tenantId}:${membershipId}:4`,
        }) : null,
      };
      const access = createRequestAuthorizationAccess({
        kernel,
        authContext,
        roleAssignments,
      });

      expect(access.requireAuthorizationScope()).toMatchObject({
        roles: ['clinician'],
        permissions: ['documents:read'],
      });
      expect(access.hasPermission('documents:read')).toBe(true);
      expect(access.hasPermission('documents:write')).toBe(false);
      expect(access.authorization?.roles).not.toContain('retired-role');
      expect(() => access.authorize({ scopeRole: 'retired-role' }))
        .toThrow('references undeclared scope role "retired-role"');

      roles = ['retired-role'];
      const retiredOnly = createRequestAuthorizationAccess({
        kernel,
        authContext,
        roleAssignments,
      });
      expect(retiredOnly.requireAuthorizationScope()).toMatchObject({
        roles: [],
        permissions: [],
      });
      expect(retiredOnly.authorization?.allPermissions).not.toBe(true);
      expect(retiredOnly.hasPermission('documents:read')).toBe(false);
      expect(() => retiredOnly.authorize({ scopeRole: 'clinician' }))
        .toThrow('Forbidden');
    });
  }

  test('keeps legacy user/admin enforcement available without a kernel', () => {
    const user = createRequestAuthorizationAccess({
      kernel: null,
      authContext: {
        userId: 'u_legacy',
        email: 'legacy@example.test',
        role: 'user',
      },
    });

    expect(user.authorize('user')).toBeNull();
    expect(() => user.authorize('admin')).toThrow('Forbidden');
    expect(() => user.authorize({ permission: 'documents:read' }))
      .toThrow('Auth policy services are unavailable');
  });

  test('keeps API keys out of legacy policies and admits explicit route policies', () => {
    const authContext = {
      userId: 'u_api_key',
      email: 'api-key@example.test',
      role: 'clinician',
      credentialKind: 'api-key' as const,
    };
    const access = createRequestAuthorizationAccess({
      kernel: createKernel('single'),
      authContext,
    });

    expect(access.context).toBeNull();
    expect(access.authorization).toBeNull();
    expect(access.applicationAuthorization).toBeNull();
    expect(access.authorize('optional')).toBeNull();
    expect(access.context).toBeNull();
    expect(() => access.requireUser()).toThrow('Forbidden');
    expect(access.hasPermission('documents:read')).toBe(false);
    expect(() => access.requirePermission('documents:read')).toThrow('Forbidden');
    expect(() => access.authorize('user')).toThrow(expect.objectContaining({
      code: 'FORBIDDEN',
      status: 403,
    }));
    expect(access.authorize({
      credentials: ['session', 'api-key'],
      permission: 'documents:read',
    })).toBe(access.authorization);
    expect(access.requireUser()).toBe(authContext);
    expect(access.hasPermission('documents:read')).toBe(true);
    expect(access.requirePermission('documents:read')).toBe(access.authorization!);
    expect(access.authorize('optional')).toBeNull();
    expect(access.context).toBeNull();
    expect(access.authorization).toBeNull();
    expect(() => access.authorize('user')).toThrow('Forbidden');
    expect(access.context).toBeNull();
    expect(access.authorize({
      credentials: ['api-key'],
      permission: 'documents:read',
    })).toBe(access.authorization);

    const legacyAccess = createRequestAuthorizationAccess({
      kernel: null,
      authContext,
    });
    expect(legacyAccess.context).toBeNull();
    expect(legacyAccess.authorize(false)).toBeNull();
    expect(legacyAccess.context).toBeNull();
    expect(() => legacyAccess.authorize('user')).toThrow('Forbidden');
    expect(legacyAccess.authorize({
      credentials: ['session', 'api-key'],
      user: 'required',
    })).toBeNull();
    expect(legacyAccess.requireUser()).toBe(authContext);
  });

  test('fails closed when a trusted-property policy has no live store', () => {
    const access = createRequestAuthorizationAccess({
      kernel: createKernel('single'),
      authContext: {
        userId: 'u_missing_store',
        email: 'missing-store@example.test',
        role: 'clinician',
      },
    });

    expect(() => access.authorize({ properties: { department: 'clinical' } }))
      .toThrow(expect.objectContaining({
        code: 'AUTH_POLICY_UNAVAILABLE',
        status: 503,
      }));
  });

  test('rejects an asynchronous public profile fence before granting access', async () => {
    const emitted: string[] = [];
    const access = createRequestAuthorizationAccess({
      kernel: null,
      authContext: {
        userId: 'u_async_profile',
        email: 'async-profile@example.test',
        role: 'admin',
      },
      assertCurrentProfile: (async () => {
        throw new Error('private profile rejection');
      }) as never,
      emitCode: (definition, options) => {
        emitted.push(definition.code);
        return emitPlatformCode(definition, options);
      },
    });

    expect(() => access.requirePlatformAdmin()).toThrow(expect.objectContaining({
      code: 'AUTH_STATE_INVARIANT_FAILED',
      status: 500,
      message: '[auth] Request authorization profile guard must be synchronous.',
    }));
    await Promise.resolve();

    expect(emitted).toEqual([OBS_CODES.AUTH_STATE_INVARIANT_FAILED.code]);
  });

  test('rejects asynchronous structural property and role resolvers', async () => {
    const emitted: string[] = [];
    const emitCode = (definition: Parameters<typeof emitPlatformCode>[0],
      options: Parameters<typeof emitPlatformCode>[1]) => {
      emitted.push(definition.code);
      return emitPlatformCode(definition, options);
    };
    const authContext: AuthContext = {
      userId: 'u_async_resolver',
      email: 'async-resolver@example.test',
      role: 'clinician',
      sessionScopeKind: 'application',
      sessionScopeId: 'application',
    };
    const propertyAccess = createRequestAuthorizationAccess({
      kernel: createKernel('single'),
      authContext,
      propertyStore: {
        getProperties: (async () => ({ department: 'clinical' })) as never,
      },
      emitCode,
    });
    expect(() => propertyAccess.authorize({
      properties: { department: 'clinical' },
    })).toThrow(expect.objectContaining({
      code: 'AUTH_STATE_INVARIANT_FAILED',
      message: '[auth] Authorization property resolution must be synchronous.',
    }));

    const roleAccess = createRequestAuthorizationAccess({
      kernel: createKernel('single', 'advanced'),
      authContext,
      roleAssignments: {
        resolveApplicationRoles: (async () => null) as never,
        resolveTenantRoles: () => null,
      },
      emitCode,
    });
    expect(() => roleAccess.requireAuthorizationScope()).toThrow(expect.objectContaining({
      code: 'AUTH_STATE_INVARIANT_FAILED',
      message: '[auth] Application role resolution must be synchronous.',
    }));
    await Promise.resolve();

    expect(emitted).toEqual([
      OBS_CODES.AUTH_STATE_INVARIANT_FAILED.code,
      OBS_CODES.AUTH_STATE_INVARIANT_FAILED.code,
    ]);
  });
});
