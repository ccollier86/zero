import {
  hasAuthorizationPermission,
  type AuthAuthorizationSnapshot,
} from '../../../frontend/client/auth-authorization-types';

export interface TenantAccountAdministrationAccess {
  canReadAccounts: boolean;
  canManageAccounts: boolean;
}

/**
 * Project account API access from the live authorization snapshot. Keeping
 * this decision ahead of the admin hooks prevents tenant-only managers from
 * probing application-scoped endpoints.
 */
export function resolveTenantAccountAdministrationAccess({
  ready,
  authorization,
}: {
  ready: boolean;
  authorization: AuthAuthorizationSnapshot | null;
}): TenantAccountAdministrationAccess {
  const canReadAccounts = ready
    && hasAuthorizationPermission(authorization, 'application.users:read');
  return {
    canReadAccounts,
    canManageAccounts: canReadAccounts
      && hasAuthorizationPermission(authorization, 'application.users:manage'),
  };
}
