import type { AuthPlatformRoleSelection } from '../../frontend/client/auth-platform-administration-types';
import type { AuthTenantRoleDescriptor } from '../../frontend/client/auth-types';

/** Declared administration roles that can appear in a member role editor. */
export function platformAdministrationRoleChoices(
  roles: readonly AuthTenantRoleDescriptor[],
): AuthTenantRoleDescriptor[] {
  return roles.filter((role) => (
    role.administrationOnly
    && role.assignable
    && role.key !== 'owner'
  ));
}

/** Roles that the current administration actor can grant to another person. */
export function platformAssignableRoles(
  roles: readonly AuthTenantRoleDescriptor[],
): AuthTenantRoleDescriptor[] {
  return platformAdministrationRoleChoices(roles).filter((role) => role.grantable);
}

/** Preserve the UI's runtime empty-state while narrowing a submitted role set. */
export function platformRoleSelection(
  roles: readonly string[],
): AuthPlatformRoleSelection | null {
  const [first, ...rest] = roles;
  return first ? [first, ...rest] : null;
}
