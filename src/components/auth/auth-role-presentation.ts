interface AuthRoleLabelSource {
  key: string;
  label: string;
}

interface AuthRoleAccessSource extends AuthRoleLabelSource {
  permissions: readonly string[];
  allPermissions: boolean;
}

export interface AuthAssignedRolePresentation {
  key: string;
  label: string;
  retired: boolean;
}

export interface AuthRoleAccessPresentation {
  assignedRoles: AuthAssignedRolePresentation[];
  allPermissions: boolean;
  permissions: string[];
}

/** Build a presentation-only role-label lookup while preserving unknown keys. */
export function createAuthRoleLabelMap(
  roles: readonly AuthRoleLabelSource[],
): ReadonlyMap<string, string> {
  return new Map(roles.map((role) => [role.key, role.label]));
}

/** Resolve a configured role label, falling back to the key for retired roles. */
export function authRoleLabel(
  roleKey: string,
  labels: ReadonlyMap<string, string>,
): string {
  return labels.get(roleKey) ?? roleKey;
}

/**
 * Project configured roles into a stable, presentation-safe access summary.
 * Unknown assigned keys stay visible as retired roles and never grant access.
 */
export function projectAuthRoleAccess(
  descriptors: readonly AuthRoleAccessSource[],
  assignedRoleKeys: readonly string[],
): AuthRoleAccessPresentation {
  const descriptorsByKey = new Map(descriptors.map((role) => [role.key, role]));
  const assignedKeys = [...new Set(assignedRoleKeys)].sort(compareText);
  const activeRoles = assignedKeys.flatMap((key) => {
    const role = descriptorsByKey.get(key);
    return role ? [role] : [];
  });
  const allPermissions = activeRoles.some((role) => role.allPermissions);

  return {
    assignedRoles: assignedKeys
      .map((key) => {
        const role = descriptorsByKey.get(key);
        return {
          key,
          label: role?.label ?? key,
          retired: role === undefined,
        };
      })
      .sort((left, right) => compareText(left.key, right.key)),
    allPermissions,
    permissions: allPermissions
      ? []
      : [...new Set(activeRoles.flatMap((role) => role.permissions))].sort(compareText),
  };
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
