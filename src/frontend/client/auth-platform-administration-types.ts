/** Browser-safe contracts for the protected administration organization. */

import type {
  AuthTenantAddMemberParams,
  AuthTenantInvitation,
  AuthTenantInvitationListParams,
  AuthTenantInvitationPage,
  AuthTenantIssueInvitationParams,
  AuthTenantIssueInvitationResult,
  AuthTenantMemberListParams,
  AuthTenantMemberMutationResult,
  AuthTenantMemberPage,
  AuthTenantOwnershipTransferResult,
  AuthTenantRoleDescriptor,
  AuthTenantUpdateMemberParams,
} from './auth-types';

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
    canReadInvitations: boolean;
    canManageInvitations: boolean;
    canReadTenants: boolean;
    /** Actor may inspect safe customer-member projections. */
    canReadTenantMembers: boolean;
    canManageTenants: boolean;
    /** Actor may create a tenant and resolve its initial owner account. */
    canCreateTenants: boolean;
    canTransferOwnership: boolean;
  };
  roles: AuthTenantRoleDescriptor[];
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

/** Namespaced SDK surface; every route requires an active administration scope. */
export interface AuthPlatformAdminSdkSurface {
  getConfig(): Promise<AuthPlatformAdministrationConfig>;
  listMembers(params?: AuthTenantMemberListParams): Promise<AuthTenantMemberPage>;
  addMember(params: AuthTenantAddMemberParams): Promise<AuthTenantMemberMutationResult>;
  updateMember(
    membershipId: string,
    params: AuthTenantUpdateMemberParams,
  ): Promise<AuthTenantMemberMutationResult>;
  removeMember(membershipId: string): Promise<AuthTenantMemberMutationResult>;
  transferOwnership(membershipId: string): Promise<AuthTenantOwnershipTransferResult>;
  listInvitations(
    params?: AuthTenantInvitationListParams,
  ): Promise<AuthTenantInvitationPage>;
  issueInvitation(
    params: AuthTenantIssueInvitationParams,
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
}
