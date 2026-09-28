/** Lifecycle state for one tenant control-plane record. */
export type TenantStatus = 'active' | 'suspended' | 'archived';

/** Lifecycle state for the retained relationship between a user and tenant. */
export type TenantMembershipStatus = 'active' | 'suspended' | 'removed';

/** Reserved simple-mode role that protects the tenant ownership invariant. */
export const TENANT_OWNER_ROLE_KEY = 'owner' as const;

/** Internal tenant record exposed only through the server-side tenancy module. */
export interface TenantRecord {
  tenantId: string;
  slug: string;
  name: string;
  status: TenantStatus;
  authorizationGeneration: number;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
  suspendedAt: number | null;
}

/** Internal retained membership record for one user in one tenant. */
export interface TenantMembershipRecord {
  membershipId: string;
  tenantId: string;
  userId: string;
  status: TenantMembershipStatus;
  /** Simple-mode role. Advanced-mode assignment rows may eventually make this null. */
  roleKey: string | null;
  authorizationGeneration: number;
  joinedAt: number;
  createdAt: number;
  updatedAt: number;
  suspendedAt: number | null;
  removedAt: number | null;
  createdBy: string;
}

/** One live tenant choice suitable for server-side session selection. */
export interface ActiveTenantMembership {
  tenant: TenantRecord;
  membership: TenantMembershipRecord;
}

export interface CreateTenantWithOwnerInput {
  slug: string;
  name: string;
  ownerUserId: string;
  /** Defaults to the initial owner's user ID. */
  createdBy?: string;
}

export interface CreateTenantMembershipInput {
  tenantId: string;
  userId: string;
  roleKey: string;
  createdBy: string;
}

export interface TenantCreationResult {
  tenant: TenantRecord;
  ownerMembership: TenantMembershipRecord;
}

/** Result of the explicit protected tenant-ownership lifecycle. */
export interface TenantOwnershipTransferResult {
  previousOwnerMembership: TenantMembershipRecord;
  ownerMembership: TenantMembershipRecord;
}

/** Canonical identifiers prepared before an atomic tenant/session transaction. */
export interface PreparedTenantCreation {
  tenantId: string;
  membershipId: string;
  slug: string;
  name: string;
  ownerUserId: string;
  createdBy: string;
  createdAt: number;
}

export type TenancyErrorCode =
  | 'TENANT_INVALID_SLUG'
  | 'TENANT_INVALID_NAME'
  | 'TENANT_INVALID_ROLE'
  | 'TENANT_NOT_FOUND'
  | 'TENANT_NOT_ACTIVE'
  | 'TENANT_STATUS_CONFLICT'
  | 'TENANT_SLUG_TAKEN'
  | 'TENANT_USER_NOT_FOUND'
  | 'TENANT_MEMBERSHIP_NOT_FOUND'
  | 'TENANT_MEMBERSHIP_EXISTS'
  | 'TENANT_MEMBERSHIP_STATUS_CONFLICT'
  | 'TENANT_LAST_OWNER'
  | 'TENANT_USABLE_OWNER_REQUIRED'
  | 'TENANT_OWNERSHIP_REQUIRED'
  | 'TENANT_OWNERSHIP_TARGET_INVALID';

/** Domain error for the persistence/control-plane tenancy boundary. */
export class TenancyError extends Error {
  constructor(
    message: string,
    readonly code: TenancyErrorCode,
  ) {
    super(message);
    this.name = 'TenancyError';
  }
}
