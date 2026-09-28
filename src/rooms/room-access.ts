/** Shared room administration policy for HTTP and server-side facades. */

import type { RequestAuthorizationAccess } from '../auth/authorization-access';
import {
  canManageServiceDataScope,
} from '../auth/service-data-authority';
import type { ServiceDataScope } from '../auth/service-data-scope';
import type { PermissionKey } from '../auth/types';

/** Tenant permission which grants administration of every room in scope. */
export const ROOM_MANAGE_PERMISSION = 'rooms:manage' as PermissionKey;

/** Single mode uses platform admin; multi mode uses live tenant authority only. */
export function canManageRoomScope(
  access: RequestAuthorizationAccess,
  scope: ServiceDataScope,
  privilegedSystem = false,
): boolean {
  return canManageServiceDataScope(
    access,
    scope,
    ROOM_MANAGE_PERMISSION,
    privilegedSystem,
  );
}
