/**
 * storage-studio-catalog.ts
 *
 * Reads and projects the managed-drive catalog for one sealed Guardian scope.
 * It does not provision, mutate, or delete drives.
 */

import type { ResolvedStorageStudioConfig } from './storage-config';
import { StorageDomainError } from './storage-domain-error';
import type { StorageService } from './storage-service';
import type { StorageStudioAuthority } from './storage-studio-authority';
import { requireStorageStudioCapability } from './storage-studio-authority';
import type {
  StorageStudioCapabilities,
  StorageStudioDrive,
  StorageStudioDriveListRequest,
  StorageStudioDrivePage,
  StorageStudioDriveProfileView,
} from './storage-studio-contracts';
import { storageStudioCapabilityPolicy } from './storage-studio-contracts';
import {
  resolveStorageStudioOwnership,
  type StorageStudioOwnerChoice,
} from './storage-studio-ownership';
import { normalizeStorageDriveKey, storageStudioScopeId } from './storage-studio-policy';
import type { StorageStudioDriveProfile } from './storage-studio-schema';
import type { StorageStudioStore } from './storage-studio-store';
import type {
  DriveRecord,
  StorageAccessCapabilities,
} from './types';

export interface StorageStudioCatalogOptions {
  readonly storage: StorageService;
  readonly store: StorageStudioStore;
  readonly config: ResolvedStorageStudioConfig;
  readonly tenancyMode: 'single' | 'multi';
}

/** Scope-safe catalog query and projection service. */
export class StorageStudioCatalog {
  constructor(private readonly options: StorageStudioCatalogOptions) {}

  capabilities(authority: StorageStudioAuthority): StorageStudioCapabilities {
    return Object.freeze({
      enabled: true,
      scopeKind: authority.scope.scopeKind,
      ownerChoices: authority.ownerChoices,
      canReadCatalog: authority.canReadCatalog,
      canProvisionOrganization: authority.canProvisionOrganization,
      canProvisionPersonal: authority.canProvisionPersonal,
      canManage: authority.canManage,
      canDelete: authority.canDelete,
      policy: storageStudioCapabilityPolicy(this.options.config),
    });
  }

  list(
    authority: StorageStudioAuthority,
    userProperties: Record<string, string>,
    request: StorageStudioDriveListRequest = {},
  ): StorageStudioDrivePage {
    if (!authority.canReadCatalog && !authority.canProvisionPersonal) {
      requireStorageStudioCapability(authority, 'catalog');
    }
    const page = this.options.store.listProfiles({
      kind: authority.scope.scopeKind,
      id: storageStudioScopeId(authority),
      actorUserId: authority.actor.userId,
      includeScopeCatalog: authority.canReadCatalog,
    }, request);
    const items = page.profiles
      .map((profile) => this.project(profile, authority, userProperties))
      .filter((drive): drive is StorageStudioDrive => drive !== null);
    const limit = Math.min(Math.max(request.limit ?? 50, 1), 100);
    return Object.freeze({
      items: Object.freeze(items),
      page: Object.freeze({
        limit,
        count: items.length,
        hasMore: page.nextCursor !== null,
        nextCursor: page.nextCursor,
      }),
    });
  }

  get(
    authority: StorageStudioAuthority,
    userProperties: Record<string, string>,
    driveId: string,
  ): StorageStudioDrive {
    const profile = this.requireProfile(authority, driveId);
    const projected = this.project(profile, authority, userProperties);
    if (!projected) throw storageDriveNotFound();
    if (!authority.canReadCatalog
      && !isStoragePersonalOwner(profile, authority)) throw storageDriveNotFound();
    return projected;
  }

  getByKey(
    authority: StorageStudioAuthority,
    userProperties: Record<string, string>,
    key: string,
    owner: StorageStudioOwnerChoice = 'organization',
  ): StorageStudioDrive {
    const ownership = resolveStorageStudioOwnership({
      tenancyMode: this.options.tenancyMode,
      choice: owner,
      userId: authority.actor.userId,
      tenantId: authority.scope.scopeKind === 'tenant'
        ? authority.scope.tenantId
        : null,
    });
    const profile = this.options.store.getProfileByKey(
      ownership.scopeKind,
      ownership.scopeId,
      ownership.ownerKind,
      ownership.ownerId,
      normalizeStorageDriveKey(key),
    );
    if (!profile) throw storageDriveNotFound();
    return this.get(authority, userProperties, profile.drive_id);
  }

  requireProfile(
    authority: StorageStudioAuthority,
    driveId: string,
  ): StorageStudioDriveProfile {
    const profile = this.options.store.getProfile(driveId);
    if (!profile
      || profile.scope_kind !== authority.scope.scopeKind
      || profile.scope_id !== storageStudioScopeId(authority)) throw storageDriveNotFound();
    return profile;
  }

  private project(
    profile: StorageStudioDriveProfile,
    authority: StorageStudioAuthority,
    userProperties: Record<string, string>,
  ): StorageStudioDrive | null {
    const drive = this.options.storage.getDriveForScope(profile.drive_id, authority.scope);
    if (!drive) return null;
    const access = profile.lifecycle === 'ready'
      ? resolveStorageObjectAccess(this.options.storage, drive, authority, userProperties)
      : noStorageObjectAccess(drive, authority);
    const personalOwner = isStoragePersonalOwner(profile, authority);
    const canManage = authority.canManage || personalOwner;
    return Object.freeze({
      drive: Object.freeze({ ...drive, access }),
      profile: projectStorageProfile(profile),
      control: Object.freeze({
        canManage,
        canDelete: authority.canDelete || personalOwner,
        canSuspend: canManage && profile.lifecycle === 'ready',
        canRestore: canManage
          && (profile.lifecycle === 'suspended' || profile.lifecycle === 'deleted'),
      }),
    });
  }
}

export function isStoragePersonalOwner(
  profile: StorageStudioDriveProfile,
  authority: StorageStudioAuthority,
): boolean {
  return profile.owner_kind === 'user' && profile.owner_id === authority.actor.userId;
}

export function storageDriveNotFound(): StorageDomainError {
  return new StorageDomainError('STORAGE_DRIVE_NOT_FOUND', 'Storage drive was not found.');
}

function resolveStorageObjectAccess(
  storage: StorageService,
  drive: DriveRecord,
  authority: StorageStudioAuthority,
  userProperties: Record<string, string>,
): StorageAccessCapabilities {
  const permits = (permission: 'read' | 'write' | 'admin') => storage.checkAccess(
    drive.drive_id,
    null,
    authority.actor.userId,
    authority.dataRoles,
    userProperties,
    permission,
    authority.scope,
  );
  const canRead = permits('read');
  const canWrite = permits('write');
  const canAdmin = permits('admin');
  return Object.freeze({
    effectiveAccess: canAdmin ? 'admin' : canWrite ? 'write' : canRead ? 'read' : null,
    canRead,
    canWrite,
    canAdmin,
    isOwner: drive.owner_id === authority.actor.userId,
    isPlatformAdmin: authority.scope.scopeKind === 'application'
      && authority.actor.role === 'admin',
    isPublic: drive.public === 1,
  });
}

function noStorageObjectAccess(
  drive: DriveRecord,
  authority: StorageStudioAuthority,
): StorageAccessCapabilities {
  return Object.freeze({
    effectiveAccess: null,
    canRead: false,
    canWrite: false,
    canAdmin: false,
    isOwner: drive.owner_id === authority.actor.userId,
    isPlatformAdmin: false,
    isPublic: false,
  });
}

function projectStorageProfile(
  profile: StorageStudioDriveProfile,
): StorageStudioDriveProfileView {
  return Object.freeze({
    driveId: profile.drive_id,
    key: profile.drive_key,
    ownerKind: profile.owner_kind,
    ownerId: profile.owner_id,
    scopeKind: profile.scope_kind,
    lifecycle: profile.lifecycle,
    revision: profile.revision,
    isolation: profile.isolation_mode,
    generation: profile.generation,
    createdAt: profile.created_at,
    updatedAt: profile.updated_at,
    readyAt: profile.ready_at,
    degradedAt: profile.degraded_at,
    suspendedAt: profile.suspended_at,
    deletingAt: profile.deleting_at,
    deletedAt: profile.deleted_at,
    restoringAt: profile.restoring_at,
    failedAt: profile.failed_at,
    failureCode: profile.failure_code,
  });
}
