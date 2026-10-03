/** Durable, secret-free Guardian audit projection for Storage ACL mutations. */

import type { AuthAuditService } from '../auth/auth-audit-service';
import type { ServiceDataScope } from '../auth/service-data-scope';
import type { AuthContext } from '../auth/types';
import type { PermissionRecord } from './types';

export type StorageAclAuditProvenance = 'authenticated-request' | 'system';

export interface StorageAclAuditAuthority {
  readonly context: AuthContext | null;
  readonly scope: ServiceDataScope;
  /** Execution provenance; continuations retain the initiator without impersonating a session. */
  readonly provenance?: StorageAclAuditProvenance;
}

export function appendStorageAclAudit(
  audit: AuthAuditService | null | undefined,
  authority: StorageAclAuditAuthority | undefined,
  action: 'storage.permission-granted' | 'storage.permission-revoked',
  permission: PermissionRecord,
): void {
  if (!audit || !authority) return;
  const actor = authority.context;
  const provenance = authority.provenance
    ?? (actor ? 'authenticated-request' : 'system');
  audit.append({
    action,
    outcome: 'succeeded',
    scope: authority.scope.scopeKind === 'tenant'
      ? { kind: 'tenant', tenantId: authority.scope.tenantId }
      : { kind: 'application' },
    actor: actor
      ? {
          userId: actor.userId,
          membershipId: actor.membershipId,
          ...(provenance === 'authenticated-request'
            ? {
                sessionId: actor.sessionId,
                sessionKind: actor.sessionKind,
                clientId: actor.clientId,
              }
            : {}),
          provenance,
        }
      : { provenance: 'system' },
    target: { type: 'storage-drive', id: permission.drive_id },
    metadata: {
      permission_id: permission.permission_id,
      acl_scope: permission.object_id ? 'object' : 'drive',
      object_id: permission.object_id,
      grant_type: permission.grant_type,
      permission: permission.permission,
    },
  });
}
