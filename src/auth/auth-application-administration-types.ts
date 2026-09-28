import type { PermissionKey, UserStatus } from './types';

/** Public-safe identity shown by the application access control plane. */
export interface AuthApplicationUserIdentity {
  userId: string;
  username: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
}

/** Application authorization projection; account-security fields are omitted. */
export interface AuthApplicationUser {
  identity: AuthApplicationUserIdentity;
  status: UserStatus;
  roles: readonly string[];
  /** Optimistic-concurrency token for the retained application-role set. */
  roleRevision: string;
  createdAt: number;
  updatedAt: number | null;
}

export interface AuthApplicationUserPage {
  users: readonly AuthApplicationUser[];
  page: Readonly<{
    limit: number;
    count: number;
    hasMore: boolean;
    nextCursor: string | null;
  }>;
}

export interface AuthApplicationUserListInput {
  limit?: number;
  cursor?: string;
  search?: string;
  status?: UserStatus;
}

export interface AuthApplicationRoleDescriptor {
  key: string;
  label: string;
  description?: string;
  permissions: readonly PermissionKey[];
  allPermissions: boolean;
  system: boolean;
  assignable: boolean;
  /** Actor-specific grant ceiling, never a statement about target authority. */
  grantable: boolean;
}

export interface AuthApplicationAdministrationConfig {
  authorization: 'advanced';
  actor: {
    userId: string;
    roles: readonly string[];
    permissions: readonly PermissionKey[];
    allPermissions: boolean;
  };
  capabilities: {
    canReadUsers: boolean;
    canManageRoles: boolean;
    canTransferOwnership: boolean;
  };
  roles: readonly AuthApplicationRoleDescriptor[];
}

export interface AuthApplicationRoleMutationResult {
  user: AuthApplicationUser;
  /** True when the caller changed its own live authorization revision. */
  actorAuthorizationChanged: boolean;
}

export interface AuthApplicationOwnershipTransferResult {
  owner: AuthApplicationUser;
  previousOwner: AuthApplicationUser;
  /** Ownership always changes the caller's live authorization revision. */
  actorAuthorizationChanged: true;
}
