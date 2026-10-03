/**
 * storage-studio-policy.ts
 *
 * Normalizes Storage Studio commands and applies deterministic policy checks.
 * It has no database, adapter, HTTP, or rendering responsibilities.
 */

import type { ResolvedStorageStudioConfig } from './storage-config';
import { StorageDomainError } from './storage-domain-error';
import {
  normalizeStorageByteLimit,
  normalizeStorageMimeTypes,
  normalizeStorageName,
} from './storage-input';
import type { StorageStudioAuthority } from './storage-studio-authority';
import { requireStorageStudioCapability } from './storage-studio-authority';
import type {
  StorageStudioDriveUpdateRequest,
  StorageStudioProvisionRequest,
} from './storage-studio-contracts';
import {
  resolveStorageStudioOwnership,
  type StorageStudioOwnerChoice,
} from './storage-studio-ownership';
import type { StorageStudioOperationRecord } from './storage-studio-store';
import type { GrantPermissionParams } from './types';

export const STORAGE_STUDIO_OPERATION_TTL_MS = 30 * 24 * 60 * 60 * 1_000;

const OPERATION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const DRIVE_KEY_PATTERN = /^[a-z][a-z0-9_-]{0,99}$/u;

export interface NormalizedStorageProvision {
  operationId: string;
  owner: StorageStudioOwnerChoice;
  ownership: ReturnType<typeof resolveStorageStudioOwnership>;
  key: string;
  name: string;
  maxSize: number;
  maxFileSize: number;
  allowedMimeTypes: readonly string[];
  public: boolean;
  creatorAccess: StorageStudioProvisionRequest['creatorAccess'];
  hashInput: object;
}

export interface NormalizedStorageDriveUpdate {
  operationId: string;
  expectedRevision: number;
  name?: string;
  maxSize?: number;
  maxFileSize?: number;
  allowedMimeTypes?: readonly string[];
  public?: boolean;
}

export function normalizeStorageProvision(
  authority: StorageStudioAuthority,
  request: StorageStudioProvisionRequest,
  config: ResolvedStorageStudioConfig,
  tenancyMode: 'single' | 'multi',
): NormalizedStorageProvision {
  const operationId = normalizeStorageOperationId(request.operationId);
  requireStorageStudioCapability(
    authority,
    request.owner === 'personal' ? 'provision-personal' : 'provision-organization',
  );
  const ownership = resolveStorageStudioOwnership({
    tenancyMode,
    choice: request.owner,
    userId: authority.actor.userId,
    tenantId: authority.scope.scopeKind === 'tenant'
      ? authority.scope.tenantId
      : null,
  });
  if (ownership.scopeKind !== authority.scope.scopeKind
    || ownership.scopeId !== storageStudioScopeId(authority)) {
    throw new StorageDomainError(
      'STORAGE_AUTHORITY_REQUIRED',
      'Storage owner does not match the active scope.',
    );
  }
  const maxSize = normalizeConfiguredStorageLimit(
    request.maxSize ?? config.limits.defaultDriveSizeBytes,
    config.limits.maxDriveSizeBytes,
    'Storage drive size',
  );
  const maxFileSize = normalizeConfiguredStorageLimit(
    request.maxFileSize ?? config.limits.defaultFileSizeBytes,
    config.limits.maxFileSizeBytes,
    'Storage file size',
  );
  if (maxSize > 0 && maxFileSize > maxSize) {
    throw new StorageDomainError(
      'STORAGE_INPUT_INVALID',
      'Storage file limit cannot exceed the drive limit.',
    );
  }
  const isPublic = request.public ?? false;
  if (isPublic && !config.publicAccess.allowPublicDrives) {
    throw new StorageDomainError(
      'STORAGE_POLICY_VIOLATION',
      'Public storage drives are disabled.',
    );
  }
  const normalized: NormalizedStorageProvision = {
    operationId,
    owner: request.owner,
    ownership,
    key: normalizeStorageDriveKey(request.key),
    name: normalizeStorageName(request.name, 'Storage drive name'),
    maxSize,
    maxFileSize,
    allowedMimeTypes: normalizeStorageMimeTypes(request.allowedMimeTypes ?? ['*']),
    public: isPublic,
    creatorAccess: request.creatorAccess ?? 'admin',
    hashInput: {},
  };
  normalized.hashInput = {
    owner: normalized.owner,
    key: normalized.key,
    name: normalized.name,
    maxSize,
    maxFileSize,
    allowedMimeTypes: normalized.allowedMimeTypes,
    public: isPublic,
    creatorAccess: normalized.creatorAccess,
  };
  return normalized;
}

export function normalizeStorageDriveUpdate(
  request: StorageStudioDriveUpdateRequest,
  config: ResolvedStorageStudioConfig,
): NormalizedStorageDriveUpdate {
  const normalized: NormalizedStorageDriveUpdate = {
    operationId: normalizeStorageOperationId(request.operationId),
    expectedRevision: normalizeStorageRevision(request.expectedRevision),
  };
  if (request.name !== undefined) {
    normalized.name = normalizeStorageName(request.name, 'Storage drive name');
  }
  if (request.maxSize !== undefined) {
    normalized.maxSize = normalizeConfiguredStorageLimit(
      request.maxSize,
      config.limits.maxDriveSizeBytes,
      'Storage drive size',
    );
  }
  if (request.maxFileSize !== undefined) {
    normalized.maxFileSize = normalizeConfiguredStorageLimit(
      request.maxFileSize,
      config.limits.maxFileSizeBytes,
      'Storage file size',
    );
  }
  if (request.allowedMimeTypes !== undefined) {
    normalized.allowedMimeTypes = normalizeStorageMimeTypes(request.allowedMimeTypes);
  }
  if (request.public !== undefined) normalized.public = request.public;
  return normalized;
}

export function normalizeStorageOperationId(value: string): string {
  if (typeof value !== 'string' || !OPERATION_ID_PATTERN.test(value)) {
    throw new StorageDomainError('STORAGE_INPUT_INVALID', 'Storage operation id is invalid.');
  }
  return value;
}

export function normalizeStorageDriveKey(value: string): string {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!DRIVE_KEY_PATTERN.test(normalized)) {
    throw new StorageDomainError('STORAGE_INPUT_INVALID', 'Storage drive key is invalid.');
  }
  return normalized;
}

export function normalizeStorageRevision(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new StorageDomainError('STORAGE_INPUT_INVALID', 'Storage revision is invalid.');
  }
  return value;
}

export function storageStudioRequestHash(input: object): string {
  return new Bun.CryptoHasher('sha256').update(JSON.stringify(input)).digest('hex');
}

export function assertStorageIdempotency(
  operation: StorageStudioOperationRecord,
  hash: string,
): void {
  if (operation.request_hash !== hash) {
    throw new StorageDomainError(
      'STORAGE_IDEMPOTENCY_CONFLICT',
      'Storage operation id was already used for different input.',
    );
  }
}

export function storageStudioScopeId(authority: StorageStudioAuthority): string {
  return authority.scope.scopeKind === 'tenant'
    ? authority.scope.tenantId
    : 'application';
}

export function storageProvisioningGrants(
  config: ResolvedStorageStudioConfig,
  request: NormalizedStorageProvision,
  authority: StorageStudioAuthority,
): readonly GrantPermissionParams[] {
  const grants: GrantPermissionParams[] = config.defaultGrants.map((grant) => ({
    grantType: grant.grantType,
    ...(grant.grantKey === undefined ? {} : { grantKey: grant.grantKey }),
    grantValue: grant.grantType === 'user' && grant.grantValue === '$creator'
      ? authority.actor.userId
      : grant.grantValue,
    permission: grant.permission,
  }));
  if (request.creatorAccess && request.creatorAccess !== 'none') {
    grants.push({
      grantType: 'user',
      grantValue: authority.actor.userId,
      permission: request.creatorAccess,
    });
  }
  return [...new Map(grants.map((grant) => [
    `${grant.grantType}\0${grant.grantKey ?? ''}\0${grant.grantValue}\0${grant.permission}`,
    grant,
  ])).values()];
}

function normalizeConfiguredStorageLimit(
  value: number,
  configuredMax: number,
  label: string,
): number {
  const normalized = normalizeStorageByteLimit(value, label);
  if (configuredMax > 0 && normalized > configuredMax) {
    throw new StorageDomainError('STORAGE_LIMIT_EXCEEDED', `${label} exceeds application policy.`);
  }
  return normalized;
}
