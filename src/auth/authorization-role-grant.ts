/** Scope-aware ceilings for assigning one static role template. */

import type {
  AuthorizationKernel,
  AuthorizationScopeSnapshot,
} from './authorization-kernel';
import type { ResolvedAuthRoleTemplateConfig } from './types';
import type { TenantKind } from './tenancy/tenancy-types';

export interface AuthorizationRoleGrantCeiling {
  tenant: Pick<AuthorizationScopeSnapshot, 'allPermissions' | 'permissions'>;
  application?: Pick<AuthorizationScopeSnapshot, 'allPermissions' | 'permissions'> | null;
}

/**
 * A role can be delegated only when the actor owns every authority the role
 * would confer in this immutable tenant kind. Dormant application permissions
 * on an ordinary organization are ignored because that tenant can never
 * project application scope. In the administration organization both realms
 * are checked independently.
 */
export function canGrantAuthorizationRole(input: {
  kernel: AuthorizationKernel;
  tenantKind: TenantKind;
  role: Pick<ResolvedAuthRoleTemplateConfig, 'permissions' | 'allPermissions'>;
  ceiling: AuthorizationRoleGrantCeiling;
}): boolean {
  const { kernel, tenantKind, role, ceiling } = input;
  if (role.allPermissions) {
    if (ceiling.tenant.allPermissions !== true) return false;
    return tenantKind !== 'administration'
      || ceiling.application?.allPermissions === true;
  }

  const tenantPermissions = new Set(ceiling.tenant.permissions);
  const applicationPermissions = new Set(ceiling.application?.permissions ?? []);
  for (const permission of role.permissions) {
    const definition = kernel.authorization.permissions[permission];
    if (!definition) return false;
    if (definition.scope === 'application') {
      if (tenantKind === 'administration'
        && ceiling.application?.allPermissions !== true
        && !applicationPermissions.has(permission)) return false;
      continue;
    }
    if (ceiling.tenant.allPermissions !== true && !tenantPermissions.has(permission)) {
      return false;
    }
  }
  return true;
}

export function roleGrantCeilingFromAuthority(input: {
  scope: Pick<AuthorizationScopeSnapshot, 'allPermissions' | 'permissions'>;
  applicationScope?: Pick<
    AuthorizationScopeSnapshot,
    'allPermissions' | 'permissions'
  > | null;
}): AuthorizationRoleGrantCeiling {
  return Object.freeze({
    tenant: input.scope,
    application: input.applicationScope ?? null,
  });
}
