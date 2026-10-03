/** Pure compatibility projections used by the legacy StorageManagement adapter. */

import type {
  StorageStudioCapabilities,
  StorageStudioDrive,
} from '../../storage/storage-studio-contracts';
import type { DriveRecordWithAccess } from '../../storage/types';
import type { StorageDriveRow } from './storage-management-types';

export function toLegacyStudioDrive(drive: DriveRecordWithAccess): StorageStudioDrive {
  const ownerKind = drive.tenant_id
    ? 'organization'
    : drive.owner_id
      ? 'user'
      : 'application';
  const ownerId = ownerKind === 'application'
    ? 'application'
    : ownerKind === 'organization'
      ? drive.tenant_id!
      : drive.owner_id!;
  return {
    drive,
    profile: {
      driveId: drive.drive_id,
      key: drive.drive_id,
      ownerKind,
      ownerId,
      scopeKind: drive.tenant_id ? 'tenant' : 'application',
      lifecycle: 'ready',
      revision: Math.max(1, drive.created_at),
      isolation: 'shared-cas',
      generation: 1,
      createdAt: drive.created_at,
      updatedAt: drive.created_at,
      readyAt: drive.created_at,
      degradedAt: null,
      suspendedAt: null,
      deletingAt: null,
      deletedAt: null,
      restoringAt: null,
      failedAt: null,
      failureCode: null,
    },
    control: {
      canManage: drive.access.canAdmin,
      canDelete: drive.access.canAdmin,
      canSuspend: false,
      canRestore: false,
    },
  };
}
export function legacyStorageCapabilities(
  authenticated: boolean,
  tenantScoped: boolean,
): StorageStudioCapabilities {
  return {
    enabled: true,
    scopeKind: tenantScoped ? 'tenant' : 'application',
    ownerChoices: tenantScoped ? ['organization', 'personal'] : ['personal'],
    canReadCatalog: true,
    canProvisionOrganization: authenticated && tenantScoped,
    canProvisionPersonal: authenticated,
    canManage: authenticated,
    canDelete: authenticated,
    policy: {
      isolation: 'shared-cas',
      allowPublicDrives: true,
      allowPublicObjects: true,
      maxCapabilityTTL: 3_600,
      maxOrganizationDrives: 100,
      maxPersonalDrivesPerUser: 10,
      defaultDriveSizeBytes: 0,
      defaultFileSizeBytes: 0,
      maxDriveSizeBytes: 0,
      maxFileSizeBytes: 0,
      maxObjectsPerDrive: 0,
      maxConcurrentUploadBytes: 0,
    },
  };
}

export function legacyStorageBreadcrumbs(currentPath: string | null) {
  const crumbs: Array<{ label: string; path: string | null }> = [
    { label: 'Root', path: null },
  ];
  if (!currentPath) return crumbs;
  let path = '';
  for (const segment of currentPath.split('/').filter(Boolean)) {
    path += `/${segment}`;
    crumbs.push({ label: segment, path });
  }
  return crumbs;
}

export function toLegacyStorageDriveRow(drive: StorageStudioDrive): StorageDriveRow {
  return {
    id: drive.drive.drive_id,
    name: drive.drive.name,
    max_size_bytes: drive.drive.max_size_bytes,
    max_file_size_bytes: drive.drive.max_file_size_bytes,
    allowed_mime_types: drive.drive.allowed_mime_types,
    public: drive.drive.public,
    owner_id: drive.drive.owner_id,
    access: drive.drive.access,
  };
}
