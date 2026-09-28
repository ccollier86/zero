/** Browser-safe contracts for single/advanced application access control. */

export type AuthApplicationUserStatus = 'active' | 'suspended';

export interface AuthApplicationUserIdentity {
  userId: string;
  username: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
}

export interface AuthApplicationUser {
  identity: AuthApplicationUserIdentity;
  status: AuthApplicationUserStatus;
  roles: string[];
  /** Optimistic-concurrency token for this retained role set. */
  roleRevision: string;
  createdAt: number;
  updatedAt: number | null;
}

export interface AuthApplicationUserPage {
  users: AuthApplicationUser[];
  page: {
    limit: number;
    count: number;
    hasMore: boolean;
    nextCursor: string | null;
  };
}

export interface AuthApplicationUserListParams {
  limit?: number;
  cursor?: string;
  search?: string;
  status?: AuthApplicationUserStatus;
}

export interface AuthApplicationRoleDescriptor {
  key: string;
  label: string;
  description?: string;
  permissions: string[];
  allPermissions: boolean;
  system: boolean;
  assignable: boolean;
  grantable: boolean;
}

export interface AuthApplicationAdministrationConfig {
  authorization: 'advanced';
  actor: {
    userId: string;
    roles: string[];
    permissions: string[];
    allPermissions: boolean;
  };
  capabilities: {
    canReadUsers: boolean;
    canManageRoles: boolean;
    canTransferOwnership: boolean;
  };
  roles: AuthApplicationRoleDescriptor[];
}

export interface AuthApplicationRoleMutationResult {
  user: AuthApplicationUser;
  actorAuthorizationChanged: boolean;
}

export interface AuthApplicationOwnershipTransferResult {
  owner: AuthApplicationUser;
  previousOwner: AuthApplicationUser;
  actorAuthorizationChanged: true;
}

/** Namespaced browser SDK surface. Global identity administration is separate. */
export interface AuthApplicationAdminSdkSurface {
  getConfig(): Promise<AuthApplicationAdministrationConfig>;
  listUsers(params?: AuthApplicationUserListParams): Promise<AuthApplicationUserPage>;
  replaceUserRoles(
    userId: string,
    roles: readonly string[],
    expectedRevision: string,
  ): Promise<AuthApplicationRoleMutationResult>;
  transferOwnership(userId: string): Promise<AuthApplicationOwnershipTransferResult>;
}
