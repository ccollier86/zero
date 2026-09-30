import { createTenantDatabaseRef } from '../../databases/database-binding-ref';
import type { IdentityAnchor } from '../../auth/identity-projection-types';

export const APPLICATION_IDENTITY_PROJECTION_TARGET_ID = 'application';

export function tenantProjectionTargetId(tenantId: string): string {
  return `tenant:${createTenantDatabaseRef(tenantId)}`;
}

export function userIdentityAnchor(userId: string): IdentityAnchor {
  return Object.freeze({ kind: 'user', userId });
}

export function membershipIdentityAnchor(input: {
  membershipId?: string;
  membership_id?: string;
  tenantId?: string;
  tenant_id?: string;
  userId?: string;
  user_id?: string;
}): IdentityAnchor {
  return Object.freeze({
    kind: 'membership',
    membershipId: input.membershipId ?? input.membership_id!,
    tenantId: input.tenantId ?? input.tenant_id!,
    userId: input.userId ?? input.user_id!,
  });
}
