/** Shared notification authority and audience projection for HTTP, Sync, and server facades. */

import type { RequestAuthorizationAccess } from '../auth/authorization-access';
import {
  canManageServiceDataScope,
  effectiveServiceDataRoles,
} from '../auth/service-data-authority';
import type { ServiceDataScope } from '../auth/service-data-scope';
import type { PermissionKey } from '../auth/types';

/** Tenant permission which grants notification administration in the active tenant. */
export const NOTIFICATION_MANAGE_PERMISSION = 'notifications:manage' as PermissionKey;

/** Single mode uses platform admin; multi mode uses live tenant authority only. */
export function canManageNotificationScope(
  access: RequestAuthorizationAccess,
  scope: ServiceDataScope,
  privilegedSystem = false,
): boolean {
  return canManageServiceDataScope(
    access,
    scope,
    NOTIFICATION_MANAGE_PERMISSION,
    privilegedSystem,
  );
}

/**
 * Resolve every effective role which may match a role-targeted notification.
 *
 * Multi-tenant and advanced profiles must use the live authorization scope;
 * `AuthContext.tenantRole` is only the retained membership role in advanced
 * mode and is not an additive RBAC assignment. The platform role is retained
 * only as the no-kernel single-tenant compatibility fallback.
 */
export function notificationAudienceRoles(
  access: RequestAuthorizationAccess,
  scope: ServiceDataScope,
): readonly string[] {
  return effectiveServiceDataRoles(access, scope);
}
