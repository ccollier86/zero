/** Shared ownership policy for HTTP and request-equivalent workflow facades. */

import type { RequestAuthorizationAccess } from '../auth/authorization-access';
import { canManageServiceDataScope } from '../auth/service-data-authority';
import type { ServiceDataScope } from '../auth/service-data-scope';
import type { PermissionKey } from '../auth/types';

/** Tenant permission which grants administration of every workflow in scope. */
export const WORKFLOW_MANAGE_PERMISSION = 'workflows:manage' as PermissionKey;

/**
 * Single mode preserves the historical global-platform-admin behavior.
 * Multi mode deliberately ignores users.role=admin: tenant owner,
 * allPermissions, or workflows:manage must come from the live tenant scope.
 */
export function canManageWorkflowScope(
  access: RequestAuthorizationAccess,
  scope: ServiceDataScope,
): boolean {
  return canManageServiceDataScope(access, scope, WORKFLOW_MANAGE_PERMISSION);
}
