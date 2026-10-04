/** Live Administration Organization operator detection for security policy. */

import type { AuthorizationKernel } from './authorization-kernel';
import { rolesProjectApplicationAuthority } from './authorization-registry';
import type { AuthorizationRoleService } from './authorization-role-service';
import type { TenancyService } from './tenancy/tenancy-service';

/**
 * Resolve whether a user currently holds application authority through the
 * protected Administration Organization. An ordinary app-only membership is
 * deliberately not a platform-operator signal.
 *
 * This intentionally reads live tenancy state on every call. It is a security
 * policy predicate, not a claim suitable for caching in a token or user row.
 */
export function createAdministrationOperatorResolver(
  tenancy: TenancyService | null,
  kernel: AuthorizationKernel,
  roles: AuthorizationRoleService | null,
): (userId: string) => boolean {
  return (userId) => {
    if (!tenancy) return false;
    const tenant = tenancy.getAdministrationTenant();
    if (!tenant || tenant.status !== 'active') return false;
    const membership = tenancy.getMembership(tenant.tenantId, userId);
    if (!membership || membership.status !== 'active') return false;
    const roleKeys: readonly string[] = kernel.authorization.mode === 'advanced'
      ? roles?.resolveTenantRoles({
          tenantId: tenant.tenantId,
          membershipId: membership.membershipId,
          userId,
        })?.roles ?? []
      : membership.roleKey
        ? [membership.roleKey]
        : [];
    return rolesProjectApplicationAuthority(kernel.authorization, roleKeys);
  };
}
