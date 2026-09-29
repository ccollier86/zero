import type { AuthTenantRoleDescriptor } from '../../frontend/client/auth-types';

/** Roles that the current administration actor can grant to another person. */
export function platformAssignableRoles(
  roles: readonly AuthTenantRoleDescriptor[],
): AuthTenantRoleDescriptor[] {
  return roles.filter((role) => (
    role.administrationOnly
    && role.assignable
    && role.grantable
    && role.key !== 'owner'
  ));
}
