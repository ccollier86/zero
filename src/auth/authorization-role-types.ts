import type { PermissionKey } from './types';
import type {
  ResolvedAuthPermissionConfig,
  ResolvedAuthRoleTemplateConfig,
} from './types';

export type AuthorizationAssignmentSource =
  | 'bootstrap'
  | 'manual'
  | 'migration'
  | 'system';

export type AuthorizationAssignmentScopeKind = 'application' | 'tenant';

/** One retained role-assignment record. Revoked records remain auditable. */
export interface AuthorizationRoleAssignmentRecord {
  assignmentId: string;
  scopeKind: AuthorizationAssignmentScopeKind;
  scopeId: string;
  userId: string;
  tenantId: string | null;
  membershipId: string | null;
  roleKey: string;
  source: AuthorizationAssignmentSource;
  sourceId: string | null;
  createdBy: string | null;
  createdAt: number;
  revokedBy: string | null;
  revokedAt: number | null;
}

/** Live additive roles plus the durable revision that produced them. */
export interface AuthorizationRoleSet {
  readonly scopeKind: AuthorizationAssignmentScopeKind;
  readonly scopeId: string;
  readonly userId: string;
  readonly tenantId?: string;
  readonly membershipId?: string;
  readonly roles: readonly string[];
  readonly revision: string;
}

/** Expanded, immutable authority returned by the headless assignment service. */
export interface ExpandedAuthorizationRoleSet extends AuthorizationRoleSet {
  readonly permissions: readonly PermissionKey[];
  readonly allPermissions: boolean;
}

/** Detailed registry metadata for authenticated administration surfaces. */
export interface AuthorizationRegistrySnapshot {
  readonly permissions: Readonly<Record<PermissionKey, ResolvedAuthPermissionConfig>>;
  readonly roles: Readonly<Record<string, ResolvedAuthRoleTemplateConfig & {
    readonly assignable: boolean;
  }>>;
}

export interface AssignApplicationRoleInput {
  userId: string;
  roleKey: string;
  createdBy: string;
  sourceId?: string;
}

export interface RemoveApplicationRoleInput {
  userId: string;
  roleKey: string;
  revokedBy: string;
}

export interface ReplaceApplicationRolesInput {
  userId: string;
  roleKeys: readonly string[];
  changedBy: string;
}

export interface TransferApplicationOwnershipInput {
  ownerUserId: string;
  targetUserId: string;
  changedBy: string;
}

/** Internal receipt-bound cleanup for a registration that never finalized. */
export interface RollbackProvisionalApplicationOwnerInput {
  userId: string;
  registrationId: string;
}

/** Receipt identity used to verify authority before registration finalization. */
export interface RegistrationProvisioningAuthorityInput {
  registrationId: string;
  userId: string;
  tenantId: string | null;
  isBootstrap: boolean;
}

export interface ApplicationOwnershipTransferResult {
  owner: ExpandedAuthorizationRoleSet;
  previousOwner: ExpandedAuthorizationRoleSet;
}

export interface AssignTenantRoleInput {
  tenantId: string;
  membershipId: string;
  roleKey: string;
  createdBy: string;
  sourceId?: string;
}

export interface RemoveTenantRoleInput {
  tenantId: string;
  membershipId: string;
  roleKey: string;
  revokedBy: string;
}

export type AuthorizationRoleAssignmentErrorCode =
  | 'AUTHORIZATION_ADVANCED_REQUIRED'
  | 'AUTHORIZATION_SCOPE_MISMATCH'
  | 'AUTHORIZATION_SUBJECT_NOT_FOUND'
  | 'AUTHORIZATION_SUBJECT_INACTIVE'
  | 'AUTHORIZATION_ROLE_UNDECLARED'
  | 'AUTHORIZATION_SYSTEM_ROLE_PROTECTED'
  | 'AUTHORIZATION_ADMINISTRATION_SCOPE_REQUIRED'
  | 'AUTHORIZATION_ADMINISTRATION_ROLE_REQUIRED'
  | 'AUTHORIZATION_OWNERSHIP_REQUIRED'
  | 'AUTHORIZATION_OWNERSHIP_TARGET_INVALID'
  | 'AUTHORIZATION_LAST_OWNER';

export class AuthorizationRoleAssignmentError extends Error {
  readonly name = 'AuthorizationRoleAssignmentError';

  constructor(
    message: string,
    readonly code: AuthorizationRoleAssignmentErrorCode,
  ) {
    super(message);
  }
}
