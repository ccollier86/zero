import { describe, expect, test } from 'bun:test';
import { createAdministrationOperatorResolver } from './auth-administration-membership';
import { resolveAuthBehaviorConfig } from './auth-config';
import { createAuthorizationKernel } from './authorization-kernel';
import type { AuthorizationRoleService } from './authorization-role-service';
import type { TenancyService } from './tenancy/tenancy-service';

describe('Administration Organization operator resolution', () => {
  test('keeps app-only and application authority independent in advanced mode', () => {
    const kernel = createAuthorizationKernel(resolveAuthBehaviorConfig({
      tenancy: 'multi',
      authorization: {
        mode: 'advanced',
        permissions: {
          'documents:read': { scope: 'tenant' },
        },
        roles: {
          builder: { permissions: ['documents:read'] },
        },
      },
    }));
    let roleKeys: readonly string[] = ['builder'];
    const resolve = createAdministrationOperatorResolver(
      tenancy(),
      kernel,
      {
        resolveTenantRoles: () => ({
          scopeKind: 'tenant',
          scopeId: 'ten_admin',
          tenantId: 'ten_admin',
          membershipId: 'tmem_admin',
          userId: 'u_member',
          roles: roleKeys,
          revision: `roles:${roleKeys.join(',')}`,
        }),
      } as unknown as AuthorizationRoleService,
    );

    expect(resolve('u_member')).toBe(false);
    roleKeys = ['builder', 'access-manager'];
    expect(resolve('u_member')).toBe(true);
    roleKeys = ['builder'];
    expect(resolve('u_member')).toBe(false);
  });

  test('does not infer operator status from simple administration membership', () => {
    const kernel = createAuthorizationKernel(resolveAuthBehaviorConfig({
      tenancy: 'multi',
      authorization: 'simple',
    }));
    let roleKey = 'member';
    const service = tenancy(() => roleKey);
    const resolve = createAdministrationOperatorResolver(service, kernel, null);

    expect(resolve('u_member')).toBe(false);
    roleKey = 'administrator';
    expect(resolve('u_member')).toBe(true);
  });
});

function tenancy(roleKey: () => string = () => 'member'): TenancyService {
  return {
    getAdministrationTenant: () => ({
      tenantId: 'ten_admin',
      status: 'active',
    }),
    getMembership: () => ({
      membershipId: 'tmem_admin',
      status: 'active',
      roleKey: roleKey(),
    }),
  } as unknown as TenancyService;
}
