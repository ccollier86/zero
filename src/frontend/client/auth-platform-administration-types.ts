/** Browser-safe contracts for the protected administration organization. */

import type {
  AuthTenantAddMemberParams,
  AuthTenantInvitation,
  AuthTenantInvitationListParams,
  AuthTenantInvitationPage,
  AuthTenantIssueInvitationResult,
  AuthTenantMemberListParams,
  AuthTenantMemberMutationResult,
  AuthTenantMemberPage,
  AuthTenantOwnershipTransferResult,
  AuthTenantRoleDescriptor,
  AuthTenantMembershipStatus,
  AuthTenantUpdateMemberParams,
} from './auth-types';

/** At least one explicitly selected administration-organization role. */
export type AuthPlatformRoleSelection = readonly [string, ...string[]];

/**
 * Add an existing identity to the protected administration organization.
 *
 * Unlike an ordinary tenant member addition, this control-plane operation
 * never defaults to the customer `member` role. Callers must choose one or
 * more administration roles explicitly.
 */
export interface AuthPlatformAddMemberParams {
  email: string;
  roles: AuthPlatformRoleSelection;
}

/**
 * Update an administration member without permitting an empty mutation or an
 * explicitly empty administration-role set at the TypeScript boundary.
 */
export type AuthPlatformUpdateMemberParams =
  | {
      status: Extract<AuthTenantMembershipStatus, 'active' | 'suspended'>;
      roles?: never;
      expectedRoleRevision?: string;
    }
  | {
      status?: Extract<AuthTenantMembershipStatus, 'active' | 'suspended'>;
      roles: AuthPlatformRoleSelection;
      expectedRoleRevision: string;
    };

/** Hook input; the hook injects the current fenced role revision. */
export type AuthPlatformUpdateMemberInput =
  | {
      status: Extract<AuthTenantMembershipStatus, 'active' | 'suspended'>;
      roles?: never;
    }
  | {
      status?: Extract<AuthTenantMembershipStatus, 'active' | 'suspended'>;
      roles: AuthPlatformRoleSelection;
    };

/** Issue an administration invitation with an explicit non-empty role set. */
export interface AuthPlatformIssueInvitationParams {
  email: string;
  roles: AuthPlatformRoleSelection;
  expiresIn?: string;
  delivery?: 'manual' | 'email';
}

export type AuthPlatformTenantStatus = 'active' | 'suspended' | 'archived';
export type AuthPlatformMutableTenantStatus = Exclude<AuthPlatformTenantStatus, 'archived'>;

export interface AuthPlatformAdministrationConfig {
  authorization: 'simple' | 'advanced';
  administration: {
    tenantId: string;
    kind: 'administration';
    slug: string;
    name: string;
    membershipId: string;
  };
  capabilities: {
    canReadMembers: boolean;
    canManageMembers: boolean;
    /** Actor may assign or replace administration-organization roles. */
    canManageRoles: boolean;
    canReadInvitations: boolean;
    canManageInvitations: boolean;
    canReadTenants: boolean;
    /** Actor may inspect safe customer-member projections. */
    canReadTenantMembers: boolean;
    /** Actor may mutate customer memberships and assign customer roles. */
    canManageTenantMembers: boolean;
    canManageTenants: boolean;
    /** Actor may create a tenant and resolve its initial owner account. */
    canCreateTenants: boolean;
    canTransferOwnership: boolean;
  };
  roles: AuthTenantRoleDescriptor[];
  /** Customer-organization role descriptors projected for cross-tenant management. */
  customerRoles: AuthTenantRoleDescriptor[];
}

/** Safe customer-organization projection for the platform tenant directory. */
export interface AuthPlatformTenant {
  tenantId: string;
  kind: 'organization';
  slug: string;
  name: string;
  status: AuthPlatformTenantStatus;
  authorizationGeneration: number;
  createdAt: number;
  updatedAt: number;
  suspendedAt: number | null;
  memberCount: number;
  activeMemberCount: number;
}

export interface AuthPlatformTenantPage {
  tenants: AuthPlatformTenant[];
  page: {
    limit: number;
    count: number;
    hasMore: boolean;
    nextCursor: string | null;
  };
}

export interface AuthPlatformTenantListParams {
  status?: AuthPlatformTenantStatus;
  limit?: number;
  cursor?: string;
  search?: string;
}

export interface AuthPlatformTenantCreateParams {
  name: string;
  slug?: string;
  ownerEmail: string;
}

export interface AuthPlatformTenantCreateResult {
  tenant: AuthPlatformTenant;
  owner: AuthTenantMemberPage['members'][number];
}

export interface AuthPlatformTenantUpdateParams {
  status: AuthPlatformMutableTenantStatus;
  expectedAuthorizationGeneration: number;
}

export interface AuthPlatformTenantUpdateResult {
  tenant: AuthPlatformTenant;
}

/**
 * Receipt for a platform administrator transferring a customer workspace.
 * The actor remains authenticated because its live session belongs to the
 * protected administration organization, not to the customer workspace.
 */
export interface AuthPlatformTenantOwnershipTransferResult {
  owner: AuthTenantMemberPage['members'][number];
  previousOwner: AuthTenantMemberPage['members'][number];
  actorSessionInvalidated: false;
}

/** Namespaced SDK surface; every route requires an active administration scope. */
export interface AuthPlatformAdminSdkSurface {
  getConfig(): Promise<AuthPlatformAdministrationConfig>;
  listMembers(params?: AuthTenantMemberListParams): Promise<AuthTenantMemberPage>;
  addMember(params: AuthPlatformAddMemberParams): Promise<AuthTenantMemberMutationResult>;
  updateMember(
    membershipId: string,
    params: AuthPlatformUpdateMemberParams,
  ): Promise<AuthTenantMemberMutationResult>;
  removeMember(membershipId: string): Promise<AuthTenantMemberMutationResult>;
  transferOwnership(membershipId: string): Promise<AuthTenantOwnershipTransferResult>;
  listInvitations(
    params?: AuthTenantInvitationListParams,
  ): Promise<AuthTenantInvitationPage>;
  issueInvitation(
    params: AuthPlatformIssueInvitationParams,
  ): Promise<AuthTenantIssueInvitationResult>;
  revokeInvitation(invitationId: string): Promise<{ invitation: AuthTenantInvitation }>;
  listTenants(params?: AuthPlatformTenantListParams): Promise<AuthPlatformTenantPage>;
  createTenant(
    params: AuthPlatformTenantCreateParams,
  ): Promise<AuthPlatformTenantCreateResult>;
  updateTenant(
    tenantId: string,
    params: AuthPlatformTenantUpdateParams,
  ): Promise<AuthPlatformTenantUpdateResult>;
  listTenantMembers(
    tenantId: string,
    params?: AuthTenantMemberListParams,
  ): Promise<AuthTenantMemberPage>;
  addTenantMember(
    tenantId: string,
    params: AuthTenantAddMemberParams,
  ): Promise<AuthTenantMemberMutationResult>;
  updateTenantMember(
    tenantId: string,
    membershipId: string,
    params: AuthTenantUpdateMemberParams,
  ): Promise<AuthTenantMemberMutationResult>;
  removeTenantMember(
    tenantId: string,
    membershipId: string,
  ): Promise<AuthTenantMemberMutationResult>;
  transferTenantOwnership(
    tenantId: string,
    membershipId: string,
  ): Promise<AuthPlatformTenantOwnershipTransferResult>;
}
