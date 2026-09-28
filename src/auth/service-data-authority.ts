/**
 * Shared management policy for framework-owned application/tenant data.
 *
 * Platform account administration and tenant data-plane administration are
 * deliberately separate. A global `users.role = admin` remains the legacy
 * management authority only in single-tenant application scope. In multi
 * mode, authority must come from the live tenant authorization projection.
 */

import type { RequestAuthorizationAccess } from './authorization-access';
import type { ServiceDataScope } from './service-data-scope';
import type { PermissionKey } from './types';

/**
 * Test whether the current live scope may administer one built-in service.
 *
 * `privilegedSystem` is reserved for an explicitly sealed system execution
 * (for example `workflow.runAsSystem()`). It must never be derived from a
 * request, token claim, or caller-supplied tenant id.
 */
export function canManageServiceDataScope(
  access: RequestAuthorizationAccess,
  scope: ServiceDataScope,
  permission: PermissionKey,
  privilegedSystem = false,
): boolean {
  if (privilegedSystem) return true;

  const actor = access.context;
  if (!actor) return false;

  // Preserve the historical single-tenant platform-admin contract.
  if (scope.scopeKind === 'application') return actor.role === 'admin';

  const authorization = access.authorization;
  return authorization?.scopeKind === 'tenant'
    && authorization.tenantId === scope.tenantId
    && actor.tenantId === scope.tenantId
    && (
      authorization.allPermissions === true
      || authorization.roles.includes('owner')
      || authorization.permissions.includes(permission)
    );
}

/**
 * Project the complete role audience for one validated data scope.
 *
 * Advanced tenant membership.role_key is a compatibility/storage field, not
 * an additive authorization assignment. Tenant callers therefore never fall
 * back to `AuthContext.tenantRole`; only the live authorization projection is
 * authoritative. Application scope retains `users.role` alongside advanced
 * application assignments so historical single-tenant role targeting and
 * platform-admin Storage behavior remain compatible.
 */
export function effectiveServiceDataRoles(
  access: RequestAuthorizationAccess,
  scope: ServiceDataScope,
): readonly string[] {
  const actor = access.context;
  if (!actor) return Object.freeze([]);

  const authorization = access.authorization;
  if (scope.scopeKind === 'tenant') {
    if (authorization?.scopeKind !== 'tenant'
      || authorization.tenantId !== scope.tenantId) {
      return Object.freeze([]);
    }
    return Object.freeze([...new Set(authorization.roles)]);
  }

  if (authorization?.scopeKind === 'application') {
    return Object.freeze([...new Set([...authorization.roles, actor.role])]);
  }
  return Object.freeze([actor.role]);
}
