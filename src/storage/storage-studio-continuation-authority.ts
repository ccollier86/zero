/** Rehydrate secret-free initiator attribution for durable system continuations. */

import { trustedSystemServiceDataScope } from '../auth/service-data-scope';
import type { StorageStudioAuthority } from './storage-studio-authority';
import type { StorageStudioOperationRecord } from './storage-studio-store';

export function storageStudioContinuationAuthority(
  operation: StorageStudioOperationRecord,
): StorageStudioAuthority {
  const tenant = operation.scope_kind === 'tenant';
  const scope = trustedSystemServiceDataScope(tenant
    ? { scopeKind: 'tenant', tenantId: operation.scope_id }
    : { scopeKind: 'application' });
  return Object.freeze({
    actor: Object.freeze({
      userId: operation.actor_user_id,
      email: '',
      role: 'system-continuation',
      ...(tenant
        ? {
            tenantId: operation.scope_id,
            membershipId: operation.actor_membership_id ?? undefined,
          }
        : {}),
    }),
    scope,
    dataRoles: Object.freeze([]),
    canReadCatalog: true,
    canProvisionOrganization: true,
    canProvisionPersonal: true,
    canManage: true,
    canDelete: true,
    ownerChoices: Object.freeze(['organization', 'personal'] as const),
  });
}
