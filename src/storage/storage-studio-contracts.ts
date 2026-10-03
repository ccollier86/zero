/**
 * storage-studio-contracts.ts
 *
 * Defines transport-neutral Storage Studio request and response contracts.
 * These values contain logical catalog metadata only; they never expose a
 * provider namespace, object path, checksum, token, or filesystem location.
 */

import type {
  DriveRecordWithAccess,
  PermissionLevel,
} from './types';
import type {
  ResolvedStorageStudioConfig,
  StorageStudioIsolation,
} from './storage-config';
import type {
  StorageStudioOwnerChoice,
  StorageStudioOwnerKind,
  StorageStudioScopeKind,
} from './storage-studio-ownership';
import type { StorageStudioDriveLifecycle } from './storage-studio-schema';

export interface StorageStudioCapabilities {
  readonly enabled: true;
  readonly scopeKind: StorageStudioScopeKind;
  readonly ownerChoices: readonly StorageStudioOwnerChoice[];
  readonly canReadCatalog: boolean;
  readonly canProvisionOrganization: boolean;
  readonly canProvisionPersonal: boolean;
  readonly canManage: boolean;
  readonly canDelete: boolean;
  readonly policy: Readonly<{
    isolation: StorageStudioIsolation;
    allowPublicDrives: boolean;
    allowPublicObjects: boolean;
    maxCapabilityTTL: number;
    maxOrganizationDrives: number;
    maxPersonalDrivesPerUser: number;
    defaultDriveSizeBytes: number;
    defaultFileSizeBytes: number;
    maxDriveSizeBytes: number;
    maxFileSizeBytes: number;
    maxObjectsPerDrive: number;
    maxConcurrentUploadBytes: number;
  }>;
}

/** Browser-safe profile projection. Provider namespaces remain server-only. */
export interface StorageStudioDriveProfileView {
  readonly driveId: string;
  readonly key: string;
  readonly ownerKind: StorageStudioOwnerKind;
  readonly ownerId: string;
  readonly scopeKind: StorageStudioScopeKind;
  readonly lifecycle: StorageStudioDriveLifecycle;
  readonly revision: number;
  readonly isolation: StorageStudioIsolation;
  readonly generation: number;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly readyAt: number | null;
  readonly degradedAt: number | null;
  readonly suspendedAt: number | null;
  readonly deletingAt: number | null;
  readonly deletedAt: number | null;
  readonly restoringAt: number | null;
  readonly failedAt: number | null;
  readonly failureCode: string | null;
}

export interface StorageStudioControlCapabilities {
  readonly canManage: boolean;
  readonly canDelete: boolean;
  readonly canSuspend: boolean;
  readonly canRestore: boolean;
}

/** One adaptive catalog item composed from canonical drive and sidecar rows. */
export interface StorageStudioDrive {
  readonly drive: DriveRecordWithAccess;
  readonly profile: StorageStudioDriveProfileView;
  readonly control: StorageStudioControlCapabilities;
}

export interface StorageStudioDrivePage {
  readonly items: readonly StorageStudioDrive[];
  readonly page: Readonly<{
    limit: number;
    count: number;
    hasMore: boolean;
    nextCursor: string | null;
  }>;
}

export interface StorageStudioDriveListRequest {
  readonly owner?: StorageStudioOwnerChoice | 'all';
  readonly lifecycle?: StorageStudioDriveLifecycle | 'all';
  readonly search?: string;
  readonly cursor?: string;
  readonly limit?: number;
}

export interface StorageStudioProvisionRequest {
  readonly operationId: string;
  readonly owner: StorageStudioOwnerChoice;
  readonly key: string;
  readonly name: string;
  readonly maxSize?: number;
  readonly maxFileSize?: number;
  readonly allowedMimeTypes?: readonly string[];
  readonly public?: boolean;
  /** Optional explicit creator access; configured grants are installed too. */
  readonly creatorAccess?: PermissionLevel | 'none';
}

export interface StorageStudioDriveUpdateRequest {
  readonly operationId: string;
  readonly expectedRevision: number;
  readonly name?: string;
  readonly maxSize?: number;
  readonly maxFileSize?: number;
  readonly allowedMimeTypes?: readonly string[];
  readonly public?: boolean;
}

export interface StorageStudioLifecycleRequest {
  readonly operationId: string;
  readonly expectedRevision: number;
  readonly action: 'suspend' | 'resume' | 'delete' | 'restore' | 'retry';
}

export interface StorageStudioMutationReceipt<T> {
  readonly operationId: string;
  readonly replayed: boolean;
  readonly value: T;
}

/** Browser-safe provider job projection; leases and operation hashes stay private. */
export interface StorageStudioJobView {
  readonly jobId: string;
  readonly kind: 'provision' | 'delete' | 'restore' | 'transfer' | 'reconcile' | 'cleanup';
  readonly status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
  readonly generation: number;
  readonly attemptCount: number;
  readonly maxAttempts: number;
  readonly availableAt: number;
  readonly failureCode: string | null;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly completedAt: number | null;
}

export interface StorageStudioJobPage {
  readonly items: readonly StorageStudioJobView[];
  readonly page: Readonly<{
    limit: number;
    count: number;
    hasMore: boolean;
    nextCursor: string | null;
  }>;
}

/** Project normalized server policy into the browser-safe capability shape. */
export function storageStudioCapabilityPolicy(
  config: ResolvedStorageStudioConfig,
): StorageStudioCapabilities['policy'] {
  return Object.freeze({
    isolation: config.isolation,
    allowPublicDrives: config.publicAccess.allowPublicDrives,
    allowPublicObjects: config.publicAccess.allowPublicObjects,
    maxCapabilityTTL: config.maxCapabilityTTL,
    maxOrganizationDrives: config.limits.maxOrganizationDrives,
    maxPersonalDrivesPerUser: config.limits.maxPersonalDrivesPerUser,
    defaultDriveSizeBytes: config.limits.defaultDriveSizeBytes,
    defaultFileSizeBytes: config.limits.defaultFileSizeBytes,
    maxDriveSizeBytes: config.limits.maxDriveSizeBytes,
    maxFileSizeBytes: config.limits.maxFileSizeBytes,
    maxObjectsPerDrive: config.limits.maxObjectsPerDrive,
    maxConcurrentUploadBytes: config.limits.maxConcurrentUploadBytes,
  });
}
