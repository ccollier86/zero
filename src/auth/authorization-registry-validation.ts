import type {
  PermissionKey,
  ResolvedAuthAuthorizationConfig,
  ResolvedAuthRoleTemplateConfig,
} from './types';
import type { AuthorizationScopeKind } from './authorization-policy-types';
import {
  authorizationConfigError,
  compareAuthorizationKeys,
  isBoundedAuthorizationDisplayText,
  isPlainAuthorizationRecord,
  isUniqueAuthorizationStringArray,
  sameAuthorizationStringArray,
  uniqueSortedAuthorizationValues,
} from './authorization-kernel-utils';

const PERMISSION_KEY_PATTERN = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*(?::[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*)+$/;
const ROLE_KEY_PATTERN = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;

/** Validate one canonical namespaced permission key. */
export function validatePermissionKey(key: string): asserts key is PermissionKey {
  if (!isAuthorizationPermissionKey(key)) {
    throw authorizationConfigError(
      `Invalid permission key "${key}". Use a lowercase namespaced key such as "patients:read".`,
    );
  }
}

/** Validate one stable application/scope role-template key. */
export function validateRoleKey(key: string): void {
  if (key.length > 64 || !matchesAuthorizationRoleKeyPattern(key)) {
    throw authorizationConfigError(
      `Invalid role key "${key}". Use a lowercase stable key such as "member".`,
    );
  }
}

/**
 * Validate the normalized static permission ceiling and role-template graph.
 * This is exported so config loaders and build/Doctor tooling share one rule.
 */
export function validateAuthorizationRegistry(
  config: ResolvedAuthAuthorizationConfig,
): void {
  if (config.mode !== 'simple' && config.mode !== 'advanced') {
    throw authorizationConfigError(`Unsupported authorization mode: "${String(config.mode)}".`);
  }
  if (!isPlainAuthorizationRecord(config.permissions)
    || !isPlainAuthorizationRecord(config.roles)) {
    throw authorizationConfigError('Authorization permissions and roles must be objects.');
  }
  if (!Number.isSafeInteger(config.registryVersion)
    || config.registryVersion < 1
    || config.registryVersion > 2_147_483_647) {
    throw authorizationConfigError(
      'Authorization registryVersion must be a positive 32-bit integer.',
    );
  }
  if (Object.keys(config.permissions).length > 512 || Object.keys(config.roles).length > 128) {
    throw authorizationConfigError(
      'Authorization permission or role registry exceeds its static limit.',
    );
  }

  for (const [key, permission] of Object.entries(config.permissions)) {
    validatePermissionKey(key);
    if (!isPlainAuthorizationRecord(permission) || permission.key !== key) {
      throw authorizationConfigError(
        `Authorization permission "${key}" has inconsistent normalized metadata.`,
      );
    }
    if (!isBoundedAuthorizationDisplayText(permission.label, 120)) {
      throw authorizationConfigError(
        `Authorization label for "${key}" must be a non-empty string.`,
      );
    }
    if (permission.description !== undefined
      && !isBoundedAuthorizationDisplayText(permission.description, 500)) {
      throw authorizationConfigError(`Authorization description for "${key}" is invalid.`);
    }
    if (permission.scope !== 'application' && permission.scope !== 'tenant') {
      throw authorizationConfigError(`Authorization permission "${key}" has an invalid scope.`);
    }
  }

  for (const [key, role] of Object.entries(config.roles)) {
    validateRoleKey(key);
    validateResolvedRoleTemplate(key, role, config.permissions);
  }
}

/** Stable permission ceiling for one application or tenant projection. */
export function authorizationPermissionKeysForScope(
  config: ResolvedAuthAuthorizationConfig,
  scopeKind: AuthorizationScopeKind,
): PermissionKey[] {
  return Object.values(config.permissions)
    .filter((permission) => permission.scope === scopeKind)
    .map((permission) => permission.key)
    .sort(compareAuthorizationKeys);
}

/**
 * Expand declared roles inside exactly one authority realm.
 *
 * This scope filter is the hard boundary that keeps a customer-organization
 * owner from inheriting application-control-plane permissions through
 * `allPermissions`. The same role set may be projected into application scope
 * only after the caller proves an active administration-organization session.
 */
export function expandAuthorizationRolesForScope(
  config: ResolvedAuthAuthorizationConfig,
  roles: readonly string[],
  scopeKind: AuthorizationScopeKind,
): Readonly<{
  roles: readonly string[];
  permissions: readonly PermissionKey[];
  allPermissions: boolean;
}> {
  const declaredRoles = uniqueSortedAuthorizationValues(roles)
    .filter((role) => Object.hasOwn(config.roles, role));
  const templates = declaredRoles.map((role) => config.roles[role]!);
  const allPermissions = templates.some((template) => template.allPermissions);
  const permissions = allPermissions
    ? authorizationPermissionKeysForScope(config, scopeKind)
    : uniqueSortedAuthorizationValues(templates.flatMap((template) => template.permissions)
      .filter((permission) => config.permissions[permission]?.scope === scopeKind));
  return Object.freeze({
    roles: Object.freeze(declaredRoles),
    permissions: Object.freeze(permissions),
    allPermissions,
  });
}

/** Freeze normalized registry data before it is retained by the kernel. */
export function freezeAuthorizationConfig(
  config: ResolvedAuthAuthorizationConfig,
): ResolvedAuthAuthorizationConfig {
  const permissions = Object.freeze(Object.fromEntries(
    Object.entries(config.permissions)
      .sort(([left], [right]) => compareAuthorizationKeys(left, right))
      .map(([key, permission]) => [key, Object.freeze({ ...permission })]),
  ));
  const roles = Object.freeze(Object.fromEntries(
    Object.entries(config.roles)
      .sort(([left], [right]) => compareAuthorizationKeys(left, right))
      .map(([key, role]) => [key, Object.freeze({
        ...role,
        permissions: Object.freeze([...role.permissions]),
      })]),
  ));
  return Object.freeze({
    mode: config.mode,
    registryVersion: config.registryVersion,
    permissions,
    roles,
  });
}

export function isAuthorizationPermissionKey(value: unknown): value is string {
  return typeof value === 'string'
    && value.length <= 128
    && PERMISSION_KEY_PATTERN.test(value);
}

export function matchesAuthorizationRoleKeyPattern(value: string): boolean {
  return ROLE_KEY_PATTERN.test(value);
}

function validateResolvedRoleTemplate(
  key: string,
  role: ResolvedAuthRoleTemplateConfig,
  permissions: Readonly<Record<string, unknown>>,
): void {
  if (!isPlainAuthorizationRecord(role) || role.key !== key) {
    throw authorizationConfigError(
      `Authorization role "${key}" has inconsistent normalized metadata.`,
    );
  }
  if (!isBoundedAuthorizationDisplayText(role.label, 120)) {
    throw authorizationConfigError(
      `Authorization label for "${key}" must be a non-empty string.`,
    );
  }
  if (role.description !== undefined
    && !isBoundedAuthorizationDisplayText(role.description, 500)) {
    throw authorizationConfigError(`Authorization description for "${key}" is invalid.`);
  }
  if (typeof role.allPermissions !== 'boolean' || typeof role.system !== 'boolean') {
    throw authorizationConfigError(`Authorization role "${key}" has invalid boolean metadata.`);
  }
  if (!isUniqueAuthorizationStringArray(role.permissions)) {
    throw authorizationConfigError(
      `Authorization role "${key}" permissions must be unique strings.`,
    );
  }
  if (!sameAuthorizationStringArray(
    role.permissions,
    uniqueSortedAuthorizationValues(role.permissions),
  )) {
    throw authorizationConfigError(
      `Authorization role "${key}" permissions must be sorted deterministically.`,
    );
  }
  if (role.allPermissions && role.permissions.length > 0) {
    throw authorizationConfigError(
      `Authorization role "${key}" cannot combine allPermissions with explicit permissions.`,
    );
  }
  for (const permission of role.permissions) {
    validatePermissionKey(permission);
    if (!Object.hasOwn(permissions, permission)) {
      throw authorizationConfigError(
        `Authorization role "${key}" references undeclared permission "${permission}".`,
      );
    }
  }
}
