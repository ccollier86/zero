/** Pure current-role/property projection with fake repositories. This does not qualify persistence, sessions or destination commits. */
import { expect, test } from 'bun:test';
import { resolveAuthBehaviorConfig } from '../auth/auth-config';
import { createAuthorizationKernel } from '../auth/authorization-kernel';
import { applicationServiceDataScope, trustedSystemServiceDataScope } from '../auth/service-data-scope';
import type { UserStore } from '../auth/user-store';
import type { TenancyService } from '../auth/tenancy';
import type { AuthorizationRoleAssignmentResolver } from '../auth/authorization-access';
import { createMessagingRecipientPolicy } from './recipient-policy';

test('single-tenant notice eligibility reads the current platform role, trusted properties and account status on every call', () => {
  let role = 'admin', status = 'active', department = 'support';
  const users = { getUserById: () => ({ userId: 'agent-one', email: 'private@example.test', role, status }), getProperties: () => ({ department }) } as unknown as UserStore;
  const kernel = createAuthorizationKernel(resolveAuthBehaviorConfig({ userProperties: { department: { editableBy: 'admin', useInPolicies: true } } }));
  const policy = createMessagingRecipientPolicy({ users, tenancy: null, kernel, roles: null, support: { staff: { platformRole: 'admin', properties: { department: 'support' } } }, assertCurrent() {} });
  expect(policy(applicationServiceDataScope(), 'agent-one')).toBe(true);
  department = 'other'; expect(policy(applicationServiceDataScope(), 'agent-one')).toBe(false);
  department = 'support'; role = 'user'; expect(policy(applicationServiceDataScope(), 'agent-one')).toBe(false);
  role = 'admin'; status = 'disabled'; expect(policy(applicationServiceDataScope(), 'agent-one')).toBe(false);
});
test('advanced notice eligibility resolves all current assignments rather than relying on users.role or a cached facade', () => {
  let assigned = true;
  const users = { getUserById: () => ({ userId: 'agent-one', email: 'private@example.test', role: 'user', status: 'active' }), getProperties: () => ({}) } as unknown as UserStore;
  const kernel = createAuthorizationKernel(resolveAuthBehaviorConfig({ authorization: { mode: 'advanced', permissions: { 'messages:support': {} }, roles: { agent: { permissions: ['messages:support'] } } } }));
  const roles: AuthorizationRoleAssignmentResolver = {
    resolveApplicationRoles: id => ({ scopeKind: 'application', scopeId: 'application', userId: id, roles: assigned ? ['agent'] : [], revision: String(assigned) }),
    resolveTenantRoles: () => null,
  };
  const policy = createMessagingRecipientPolicy({ users, tenancy: null, kernel, roles, support: { staff: { permission: 'messages:support' } }, assertCurrent() {} });
  expect(policy(applicationServiceDataScope(), 'agent-one')).toBe(true); assigned = false; expect(policy(applicationServiceDataScope(), 'agent-one')).toBe(false);
});
test('organization notice policy is pinned to live membership and never projects tenant authority into application scope', () => {
  let active = true;
  const users = { getUserById: () => ({ userId: 'agent-one', email: 'private@example.test', role: 'admin', status: 'active' }), getProperties: () => ({}) } as unknown as UserStore;
  const tenancy = { getTenant: (id: string) => id === 'tenant-one' ? { tenantId: id, kind: 'organization', status: 'active', authorizationGeneration: 0 } : null,
    getMembership: (id: string) => id === 'tenant-one' && active ? { membershipId: 'member-one', status: 'active', roleKey: 'owner', authorizationGeneration: 0 } : null } as unknown as TenancyService;
  const kernel = createAuthorizationKernel(resolveAuthBehaviorConfig({ tenancy: 'multi' }));
  const policy = createMessagingRecipientPolicy({ users, tenancy, kernel, roles: null, support: { staff: { permission: 'tenant.members:manage' } }, assertCurrent() {} });
  const scope = trustedSystemServiceDataScope({ scopeKind: 'tenant', tenantId: 'tenant-one' });
  expect(policy(scope, 'agent-one')).toBe(true);
  expect(policy(trustedSystemServiceDataScope({ scopeKind: 'tenant', tenantId: 'other-tenant' }), 'agent-one')).toBe(false);
  expect(policy(applicationServiceDataScope(), 'agent-one')).toBe(false); active = false; expect(policy(scope, 'agent-one')).toBe(false);
});
