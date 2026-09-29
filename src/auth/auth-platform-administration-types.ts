/** Server-side contracts for the protected administration organization. */

import type {
  AuthTenantMember,
  AuthTenantMemberPage,
  AuthTenantRoleDescriptor,
} from './auth-tenant-administration-types';
import type { TenantStatus } from './tenancy/tenancy-types';

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
    canReadTenantMembers: boolean;
    canManageTenants: boolean;
    canCreateTenants: boolean;
    canTransferOwnership: boolean;
  };
  roles: readonly AuthTenantRoleDescriptor[];
}

export interface AuthPlatformTenant {
  tenantId: string;
  kind: 'organization';
  slug: string;
  name: string;
  status: TenantStatus;
  authorizationGeneration: number;
  createdAt: number;
  updatedAt: number;
  suspendedAt: number | null;
  memberCount: number;
  activeMemberCount: number;
}

export interface AuthPlatformTenantPage {
  tenants: readonly AuthPlatformTenant[];
  page: {
    limit: number;
    count: number;
    hasMore: boolean;
    nextCursor: string | null;
  };
}

export interface AuthPlatformTenantListInput {
  status?: TenantStatus;
  limit?: number;
  cursor?: string;
  search?: string;
}

export interface AuthPlatformTenantCreateResult {
  tenant: AuthPlatformTenant;
  owner: AuthTenantMember;
}

export interface AuthPlatformTenantUpdateResult {
  tenant: AuthPlatformTenant;
}

export type AuthPlatformCustomerMemberPage = AuthTenantMemberPage;
