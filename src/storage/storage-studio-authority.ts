/**
 * storage-studio-authority.ts
 *
 * Projects Guardian's live request authority into Storage Studio control-plane
 * capabilities. It accepts only an already-validated service scope and does
 * not query Storage data, mutate policy, or authorize object content.
 */

import type { RequestAuthorizationAccess } from '../auth/authorization-access';
import { effectiveServiceDataRoles } from '../auth/service-data-authority';
import type { AuthContext, PermissionKey } from '../auth/types';
import {
  serviceDataScopeMatchesTenant,
  type ServiceDataScope,
} from '../auth/service-data-scope';
import type { ResolvedStorageStudioConfig } from './storage-config';
import { StorageDomainError } from './storage-domain-error';
import {
  STORAGE_CATALOG_READ_PERMISSION,
  STORAGE_DRIVES_DELETE_PERMISSION,
  STORAGE_DRIVES_MANAGE_PERMISSION,
  STORAGE_DRIVES_PROVISION_PERMISSION,
  STORAGE_PERSONAL_DRIVES_PROVISION_PERMISSION,
} from './storage-studio-access';
import type { StorageStudioOwnerChoice } from './storage-studio-ownership';

export interface StorageStudioAuthority {
  readonly actor: AuthContext;
  readonly scope: ServiceDataScope;
  /** Complete live role audience used only by the existing object ACL engine. */
  readonly dataRoles: readonly string[];
  readonly canReadCatalog: boolean;
  readonly canProvisionOrganization: boolean;
  readonly canProvisionPersonal: boolean;
  readonly canManage: boolean;
  readonly canDelete: boolean;
  readonly ownerChoices: readonly StorageStudioOwnerChoice[];
}

/**
 * Resolve one request's control-plane authority from live Guardian state.
 *
 * The caller must explicitly admit the request credential first. This keeps
 * Guardian API keys invisible to legacy/session-only routes unless a route
 * opts into them.
 */
export function resolveStorageStudioAuthority(
  access: RequestAuthorizationAccess,
  scope: ServiceDataScope,
  config: ResolvedStorageStudioConfig,
): Readonly<StorageStudioAuthority> {
  if (!config.enabled) {
    throw new StorageDomainError(
      'STORAGE_STUDIO_DISABLED',
      'Storage Studio is disabled.',
    );
  }
  const actor = access.requireUser();
  const authorization = access.requireAuthorizationScope();
  if (!authorityMatchesScope(actor, authorization, scope)) {
    throw new StorageDomainError(
      'STORAGE_AUTHORITY_REQUIRED',
      'Storage Studio authority does not match the active data scope.',
    );
  }

  const elevated = authorization.allPermissions === true
    || (scope.scopeKind === 'application' && actor.role === 'admin')
    || (scope.scopeKind === 'tenant' && authorization.roles.includes('owner'));
  const has = (permission: PermissionKey): boolean => elevated
    || authorization.permissions.includes(permission);
  const canProvisionOrganization = config.organizationDrives
    && has(STORAGE_DRIVES_PROVISION_PERMISSION);
  const canProvisionPersonal = config.personalDrives
    && (
      config.personalSelfService
      || has(STORAGE_PERSONAL_DRIVES_PROVISION_PERMISSION)
    );
  const canManage = has(STORAGE_DRIVES_MANAGE_PERMISSION);
  const canDelete = has(STORAGE_DRIVES_DELETE_PERMISSION);
  const canReadCatalog = has(STORAGE_CATALOG_READ_PERMISSION);
  const ownerChoices: StorageStudioOwnerChoice[] = [];
  if (canProvisionOrganization) ownerChoices.push('organization');
  if (canProvisionPersonal) ownerChoices.push('personal');

  return Object.freeze({
    actor,
    scope,
    dataRoles: Object.freeze([...effectiveServiceDataRoles(access, scope)]),
    canReadCatalog,
    canProvisionOrganization,
    canProvisionPersonal,
    canManage,
    canDelete,
    ownerChoices: Object.freeze(ownerChoices),
  });
}

/** Require one capability without exposing role/permission distinctions. */
export function requireStorageStudioCapability(
  authority: StorageStudioAuthority,
  capability: 'catalog' | 'provision-organization' | 'provision-personal' | 'manage' | 'delete',
): void {
  const allowed = capability === 'catalog'
    ? authority.canReadCatalog
    : capability === 'provision-organization'
      ? authority.canProvisionOrganization
      : capability === 'provision-personal'
        ? authority.canProvisionPersonal
        : capability === 'manage'
          ? authority.canManage
          : authority.canDelete;
  if (!allowed) {
    throw new StorageDomainError(
      'STORAGE_AUTHORITY_REQUIRED',
      'Storage Studio authority is required.',
    );
  }
}

function authorityMatchesScope(
  actor: AuthContext,
  authorization: ReturnType<RequestAuthorizationAccess['requireAuthorizationScope']>,
  scope: ServiceDataScope,
): boolean {
  if (authorization.scopeKind !== scope.scopeKind) return false;
  if (scope.scopeKind === 'application') {
    return authorization.scopeId === 'application'
      && serviceDataScopeMatchesTenant(scope, null);
  }
  return authorization.tenantId === scope.tenantId
    && actor.tenantId === scope.tenantId
    && actor.membershipId === authorization.membershipId;
}
