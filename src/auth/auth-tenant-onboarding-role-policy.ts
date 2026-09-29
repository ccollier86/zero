/** Shared role-admission policy for invitations and join-request approval. */

import type { AuthorizationKernel } from './authorization-kernel';
import { isRoleAssignableToTenantKind } from './authorization-registry';
import {
  canGrantAuthorizationRole,
  type AuthorizationRoleGrantCeiling,
} from './authorization-role-grant';
import type { AuthTenantRoleGrantCeiling } from './auth-tenant-onboarding-types';
import type { TenantKind } from './tenancy/tenancy-types';
import { AuthError } from './types';

export const AUTH_TENANT_MAX_ROLE_COUNT = 32;

export function normalizeAuthTenantOnboardingRoleKeys(input: {
  kernel: AuthorizationKernel;
  roleKeys: readonly string[];
  tenantKind: TenantKind;
  ceiling?: AuthTenantRoleGrantCeiling | AuthorizationRoleGrantCeiling;
}): readonly string[] {
  if (!Array.isArray(input.roleKeys)
    || input.roleKeys.length < 1
    || input.roleKeys.length > AUTH_TENANT_MAX_ROLE_COUNT) {
    throw invalidRoleSelection();
  }
  const keys = [...new Set(input.roleKeys.map((key) => (
    typeof key === 'string' ? key.trim() : ''
  )).filter(Boolean))].sort(compareKeys);
  if (keys.length < 1 || keys.length > AUTH_TENANT_MAX_ROLE_COUNT) {
    throw invalidRoleSelection();
  }
  if (input.kernel.authorization.mode === 'simple' && keys.length !== 1) {
    throw invalidRoleSelection();
  }
  for (const key of keys) {
    const role = input.kernel.authorization.roles[key];
    if (!role) {
      throw new AuthError(
        `Authorization role is not declared: ${key}`,
        'AUTHORIZATION_ROLE_UNDECLARED',
        422,
      );
    }
    if (role.system || key === 'owner') {
      throw new AuthError(
        'Protected roles cannot be granted through onboarding',
        'TENANT_OWNER_ROLE_PROTECTED',
        409,
      );
    }
    if (!isRoleAssignableToTenantKind(
      key,
      input.tenantKind,
      input.kernel.authorization,
    )) {
      throw input.tenantKind === 'administration'
        ? administrationRoleRequired(key)
        : administrationRoleScopeRequired(key);
    }
    if (input.ceiling && !canGrantAuthorizationRole({
      kernel: input.kernel,
      tenantKind: input.tenantKind,
      role,
      ceiling: input.ceiling,
    })) {
      throw new AuthError(
        'An onboarding role exceeds the acting member authority',
        'TENANT_ROLE_ESCALATION_FORBIDDEN',
        403,
      );
    }
  }
  return Object.freeze(keys);
}

export function isDefaultTenantMemberRole(roles: readonly string[]): boolean {
  return roles.length === 1 && roles[0] === 'member';
}

function invalidRoleSelection(): AuthError {
  return new AuthError(
    'Onboarding role selection is invalid',
    'TENANT_ROLE_SELECTION_INVALID',
    422,
  );
}

function administrationRoleScopeRequired(roleKey: string): AuthError {
  return new AuthError(
    `Role requires the administration organization: ${roleKey}`,
    'AUTHORIZATION_ADMINISTRATION_SCOPE_REQUIRED',
    422,
  );
}

function administrationRoleRequired(roleKey: string): AuthError {
  return new AuthError(
    `Role is not assignable to the administration organization: ${roleKey}`,
    'AUTHORIZATION_ADMINISTRATION_ROLE_REQUIRED',
    422,
  );
}

function compareKeys(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
