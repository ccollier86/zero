import type { AuthTenantRoleDescriptor } from '../../frontend/client/auth-types';

/** Keep role choices inside the active tenant's control-plane boundary. */
export function rolesForTenantKind(
  roles: readonly AuthTenantRoleDescriptor[],
  kind: 'administration' | 'organization' | null,
): AuthTenantRoleDescriptor[] {
  return roles.filter((role) => kind === 'administration'
    ? role.administrationOnly
    : !role.administrationOnly);
}
