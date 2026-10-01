import type { PermissionKey } from './types';
import type { TenantMembershipStatus } from './tenancy/tenancy-types';
import type { TenantKind } from './tenancy/tenancy-types';

/** Public-safe member identity. Global account security fields are omitted. */
export interface AuthTenantMemberIdentity {
  userId: string;
  username: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
}

/** Public-safe retained membership projection for the active tenant only. */
export interface AuthTenantMember {
  membershipId: string;
  identity: AuthTenantMemberIdentity;
  status: TenantMembershipStatus;
  roles: readonly string[];
  /** Optimistic-concurrency token for this retained tenant-role set. */
  roleRevision: string;
  joinedAt: number;
  updatedAt: number;
}

export interface AuthTenantMemberPage {
  members: AuthTenantMember[];
  page: {
    limit: number;
    count: number;
    hasMore: boolean;
    nextCursor: string | null;
  };
}

export interface AuthTenantMemberListInput {
  limit?: number;
  cursor?: string;
  search?: string;
  status?: TenantMembershipStatus;
}

export interface AuthTenantRoleDescriptor {
  key: string;
  label: string;
  description?: string;
  permissions: readonly PermissionKey[];
  allPermissions: boolean;
  system: boolean;
  assignable: boolean;
  /** Role may be assigned only inside the protected administration organization. */
  administrationOnly: boolean;
  /** Actor-specific grant ceiling, never a statement about target authority. */
  grantable: boolean;
}

export interface AuthTenantAdministrationConfig {
  tenancy: 'multi';
  authorization: 'simple' | 'advanced';
  terminology: { singular: string; plural: string };
  tenant: {
    tenantId: string;
    kind: TenantKind;
    slug: string;
    name: string;
  };
  actor: {
    membershipId: string;
    roles: readonly string[];
    permissions: readonly PermissionKey[];
    allPermissions: boolean;
  };
  capabilities: {
    canReadMembers: boolean;
    canManageMembers: boolean;
    canReadRoles: boolean;
    canManageRoles: boolean;
    canTransferOwnership: boolean;
    canReadInvitations: boolean;
    canManageInvitations: boolean;
    canReviewJoinRequests: boolean;
  };
  roles: readonly AuthTenantRoleDescriptor[];
}

export interface AuthTenantMemberMutationResult {
  member: AuthTenantMember;
  /** True when the caller changed its own generation and must authenticate again. */
  actorSessionInvalidated: boolean;
}

export interface AuthTenantOwnershipTransferResult {
  owner: AuthTenantMember;
  previousOwner: AuthTenantMember;
  /**
   * Active-tenant ownership transfers invalidate the owner actor. A protected
   * platform administrator transferring a customer tenant does not own that
   * target session, so the same mutation engine reports false for that path.
   */
  actorSessionInvalidated: boolean;
}

export interface TenantRoleGrantCeiling {
  allPermissions: boolean;
  permissions: readonly PermissionKey[];
}
