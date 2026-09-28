interface AuthRoleLabelSource {
  key: string;
  label: string;
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
