/** Data Studio request-scope acceptance and tenant-isolation regressions. */

import { describe, expect, test } from 'bun:test';

import type {
  RequestAuthorizationAccess,
  TenantAuthorizationScope,
} from '../auth/authorization-access';
import { trustedSystemServiceDataScope } from '../auth/service-data-scope';
import type { AuthContext } from '../auth/types';
import { DataStudioError } from './data-studio-error';
import {
  type DataStudioRouteContext,
  requireDataStudioOrganizationContext,
} from './data-studio-router-runtime';

const TENANT_ID = 'tenant-data-studio';
const MEMBERSHIP_ID = 'membership-data-studio';

describe('Data Studio request organization boundary', () => {
  test('accepts customer and administration organizations with exact live scope', () => {
    for (const tenantKind of ['organization', 'administration'] as const) {
      const context = routeContext({ tenantKind });
      const resolved = requireDataStudioOrganizationContext(context);

      expect(resolved.auth.tenantKind).toBe(tenantKind);
      expect(resolved.auth.tenantId).toBe(TENANT_ID);
      expect(resolved.zero.scope).toMatchObject({
        scopeKind: 'tenant',
        tenantId: TENANT_ID,
      });
    }
  });

  test('rejects tenant and membership mismatches without widening platform authority', () => {
    expectAuthorityRequired(routeContext({
      tenantKind: 'administration',
      authTenantId: 'another-tenant',
    }));
    expectAuthorityRequired(routeContext({
      tenantKind: 'administration',
      authMembershipId: 'another-membership',
    }));
    expectAuthorityRequired(routeContext({
      tenantKind: 'administration',
      serviceTenantId: 'another-tenant',
    }));
    expectAuthorityRequired(routeContext({ tenantKind: undefined }));
  });
});

function routeContext(options: {
  readonly tenantKind: AuthContext['tenantKind'];
  readonly authTenantId?: string;
  readonly authMembershipId?: string;
  readonly serviceTenantId?: string;
}): DataStudioRouteContext {
  const auth: AuthContext = {
    userId: 'user-data-studio',
    email: 'data-studio@example.test',
    role: 'admin',
    sessionScopeKind: 'tenant',
    sessionScopeId: options.authTenantId ?? TENANT_ID,
    tenantId: options.authTenantId ?? TENANT_ID,
    membershipId: options.authMembershipId ?? MEMBERSHIP_ID,
    ...(options.tenantKind === undefined ? {} : { tenantKind: options.tenantKind }),
  };
  const scope: TenantAuthorizationScope = Object.freeze({
    tenancy: 'multi',
    mode: 'advanced',
    scopeKind: 'tenant',
    scopeId: TENANT_ID,
    tenantId: TENANT_ID,
    membershipId: MEMBERSHIP_ID,
    roles: Object.freeze(['owner']),
    permissions: Object.freeze([]),
    revision: 'tenant:test',
  });
  const access = {
    requireUser: () => auth,
    requireTenant: () => scope,
  } as unknown as RequestAuthorizationAccess;

  return {
    access,
    zero: {
      scope: trustedSystemServiceDataScope({
        scopeKind: 'tenant',
        tenantId: options.serviceTenantId ?? TENANT_ID,
      }),
    },
  } as unknown as DataStudioRouteContext;
}

function expectAuthorityRequired(context: DataStudioRouteContext): void {
  try {
    requireDataStudioOrganizationContext(context);
    throw new Error('Expected Data Studio authority rejection');
  } catch (error) {
    expect(error).toBeInstanceOf(DataStudioError);
    expect(error).toMatchObject({ code: 'DATA_STUDIO_AUTHORITY_REQUIRED' });
  }
}
