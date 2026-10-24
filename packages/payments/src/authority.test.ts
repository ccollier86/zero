import { expect, test } from 'bun:test';
import { createRequestAuthorizationAccess, createAuthorizationKernel, resolveAuthBehaviorConfig } from '@zero/framework/auth';
import type { PaymentsAuthority } from '@zero/framework/payments';
import { trustedSystemServiceDataScope, applicationServiceDataScope } from '../../../src/auth/service-data-scope';
import { billingSubject } from './authority';
import { resolvePaymentsOptions } from './options';
import { fixtureOptions } from './payments-fixture';

function tenant(tenantId: string, role = 'owner'): PaymentsAuthority {
  return { access: createRequestAuthorizationAccess({ kernel: createAuthorizationKernel(resolveAuthBehaviorConfig({ tenancy: 'multi' })),
    authContext: { userId: 'same-person', email: 'fixture@example.test', role: 'user', sessionScopeKind: 'tenant', sessionScopeId: tenantId, tenantId, membershipId: `member-${tenantId}`, tenantRole: role, tenantAuthorizationGeneration: 1, membershipAuthorizationGeneration: 1 } }),
    scope: trustedSystemServiceDataScope({ scopeKind: 'tenant', tenantId }), assertCurrentAuthority: async () => {}, assertCurrentAuthoritySync: () => {} };
}
test('Guardian organization subjects and user-within-organization subjects never collide', () => {
  const options = resolvePaymentsOptions(fixtureOptions), a = tenant('alpha'), b = tenant('beta');
  expect(billingSubject(a, options, 'manage')).toEqual({ kind: 'organization', id: 'alpha' });
  expect(billingSubject(b, options, 'manage')).toEqual({ kind: 'organization', id: 'beta' });
  expect(billingSubject(a, { ...options, subject: 'user' }, 'read')).toEqual({ kind: 'user', id: 'same-person', tenantId: 'alpha' });
  expect(() => billingSubject(tenant('alpha', 'member'), options, 'manage')).toThrow('Forbidden');
  expect(() => billingSubject(a, options, 'refund')).toThrow('Forbidden');
});
test('organization-only configuration and mismatched live data scopes fail closed', () => {
  const options = resolvePaymentsOptions({ ...fixtureOptions, subject: 'organization' }), current = tenant('alpha');
  expect(() => billingSubject({ ...current, scope: applicationServiceDataScope(), access: createRequestAuthorizationAccess({ kernel: null, authContext: { userId: 'u', email: 'u@example.test', role: 'admin' } }) }, options, 'read')).toThrow('validated tenant session');
  expect(() => billingSubject({ ...current, scope: trustedSystemServiceDataScope({ scopeKind: 'tenant', tenantId: 'beta' }) }, options, 'manage')).toThrow('no longer current');
});
