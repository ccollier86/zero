/**
 * storage-studio-response.ts
 *
 * Validates and freezes untrusted Storage Studio HTTP responses. It owns no
 * transport, cache, React lifecycle, or mutation retry behavior.
 */

import type {
  StorageStudioCapabilities,
  StorageStudioDrive,
  StorageStudioDrivePage,
  StorageStudioJobPage,
  StorageStudioJobView,
  StorageStudioMutationReceipt,
} from '../../storage/storage-studio-contracts';
import type {
  DriveRecordWithAccess,
  PermissionLevel,
  StorageAccessCapabilities,
} from '../../storage/types';

const OWNER_KINDS = new Set(['application', 'organization', 'user']);
const SCOPE_KINDS = new Set(['application', 'tenant']);
const OWNER_CHOICES = new Set(['organization', 'personal']);
const LIFECYCLES = new Set([
  'provisioning',
  'ready',
  'degraded',
  'suspended',
  'deleting',
  'deleted',
  'restoring',
  'failed',
]);
const ISOLATION_MODES = new Set(['shared-cas']);
const PERMISSIONS = new Set<PermissionLevel>(['read', 'write', 'admin']);
const JOB_KINDS = new Set(['provision', 'delete', 'restore', 'transfer', 'reconcile', 'cleanup']);
const JOB_STATUSES = new Set(['queued', 'running', 'succeeded', 'failed', 'cancelled']);

export function parseStorageStudioCapabilities(value: unknown): StorageStudioCapabilities {
  const record = responseRecord(value, 'capabilities');
  const policy = responseRecord(record.policy, 'capability policy');
  const ownerChoices = responseArray(record.ownerChoices, 'owner choices');
  if (record.enabled !== true
    || !SCOPE_KINDS.has(String(record.scopeKind))
    || !ownerChoices.every((choice) => OWNER_CHOICES.has(String(choice)))) {
    throw invalidStorageStudioResponse('capabilities');
  }
  return Object.freeze({
    enabled: true,
    scopeKind: record.scopeKind as StorageStudioCapabilities['scopeKind'],
    ownerChoices: Object.freeze([
      ...new Set(ownerChoices as StorageStudioCapabilities['ownerChoices']),
    ]),
    canReadCatalog: responseBoolean(record.canReadCatalog, 'capabilities'),
    canProvisionOrganization: responseBoolean(record.canProvisionOrganization, 'capabilities'),
    canProvisionPersonal: responseBoolean(record.canProvisionPersonal, 'capabilities'),
    canManage: responseBoolean(record.canManage, 'capabilities'),
    canDelete: responseBoolean(record.canDelete, 'capabilities'),
    policy: Object.freeze({
      isolation: enumValue(policy.isolation, ISOLATION_MODES, 'capability policy') as StorageStudioCapabilities['policy']['isolation'],
      allowPublicDrives: responseBoolean(policy.allowPublicDrives, 'capability policy'),
      allowPublicObjects: responseBoolean(policy.allowPublicObjects, 'capability policy'),
      maxCapabilityTTL: nonNegativeInteger(policy.maxCapabilityTTL, 'capability policy'),
      maxOrganizationDrives: nonNegativeInteger(policy.maxOrganizationDrives, 'capability policy'),
      maxPersonalDrivesPerUser: nonNegativeInteger(policy.maxPersonalDrivesPerUser, 'capability policy'),
      defaultDriveSizeBytes: nonNegativeInteger(policy.defaultDriveSizeBytes, 'capability policy'),
      defaultFileSizeBytes: nonNegativeInteger(policy.defaultFileSizeBytes, 'capability policy'),
      maxDriveSizeBytes: nonNegativeInteger(policy.maxDriveSizeBytes, 'capability policy'),
      maxFileSizeBytes: nonNegativeInteger(policy.maxFileSizeBytes, 'capability policy'),
      maxObjectsPerDrive: nonNegativeInteger(policy.maxObjectsPerDrive, 'capability policy'),
      maxConcurrentUploadBytes: nonNegativeInteger(policy.maxConcurrentUploadBytes, 'capability policy'),
    }),
  });
}

export function parseStorageStudioDrivePage(value: unknown): StorageStudioDrivePage {
  const record = responseRecord(value, 'drive page');
  const page = responseRecord(record.page, 'drive page metadata');
  const items = responseArray(record.items, 'drive page').map(parseStorageStudioDrive);
  const count = nonNegativeInteger(page.count, 'drive page metadata');
  if (count !== items.length) throw invalidStorageStudioResponse('drive page metadata');
  const nextCursor = nullableString(page.nextCursor, 'drive page metadata');
  const hasMore = responseBoolean(page.hasMore, 'drive page metadata');
  if (hasMore !== (nextCursor !== null)) throw invalidStorageStudioResponse('drive page metadata');
  return Object.freeze({
    items: Object.freeze(items),
    page: Object.freeze({
      limit: positiveInteger(page.limit, 'drive page metadata'),
      count,
      hasMore,
      nextCursor,
    }),
  });
}

export function parseStorageStudioDrive(value: unknown): StorageStudioDrive {
  const record = responseRecord(value, 'drive');
  const drive = parseDrive(record.drive);
  const profile = responseRecord(record.profile, 'drive profile');
  const control = responseRecord(record.control, 'drive controls');
  if (profile.driveId !== drive.drive_id
    || !OWNER_KINDS.has(String(profile.ownerKind))
    || !SCOPE_KINDS.has(String(profile.scopeKind))
    || !LIFECYCLES.has(String(profile.lifecycle))
    || !ISOLATION_MODES.has(String(profile.isolation))) {
    throw invalidStorageStudioResponse('drive profile');
  }
  return Object.freeze({
    drive,
    profile: Object.freeze({
      driveId: requiredString(profile.driveId, 'drive profile'),
      key: requiredString(profile.key, 'drive profile'),
      ownerKind: profile.ownerKind as StorageStudioDrive['profile']['ownerKind'],
      ownerId: requiredString(profile.ownerId, 'drive profile'),
      scopeKind: profile.scopeKind as StorageStudioDrive['profile']['scopeKind'],
      lifecycle: profile.lifecycle as StorageStudioDrive['profile']['lifecycle'],
      revision: positiveInteger(profile.revision, 'drive profile'),
      isolation: profile.isolation as StorageStudioDrive['profile']['isolation'],
      generation: positiveInteger(profile.generation, 'drive profile'),
      createdAt: nonNegativeInteger(profile.createdAt, 'drive profile'),
      updatedAt: nonNegativeInteger(profile.updatedAt, 'drive profile'),
      readyAt: nullableTimestamp(profile.readyAt, 'drive profile'),
      degradedAt: nullableTimestamp(profile.degradedAt, 'drive profile'),
      suspendedAt: nullableTimestamp(profile.suspendedAt, 'drive profile'),
      deletingAt: nullableTimestamp(profile.deletingAt, 'drive profile'),
      deletedAt: nullableTimestamp(profile.deletedAt, 'drive profile'),
      restoringAt: nullableTimestamp(profile.restoringAt, 'drive profile'),
      failedAt: nullableTimestamp(profile.failedAt, 'drive profile'),
      failureCode: nullableString(profile.failureCode, 'drive profile'),
    }),
    control: Object.freeze({
      canManage: responseBoolean(control.canManage, 'drive controls'),
      canDelete: responseBoolean(control.canDelete, 'drive controls'),
      canSuspend: responseBoolean(control.canSuspend, 'drive controls'),
      canRestore: responseBoolean(control.canRestore, 'drive controls'),
    }),
  });
}

export function parseStorageStudioMutationReceipt(
  value: unknown,
  expectedOperationId: string,
): StorageStudioMutationReceipt<StorageStudioDrive> {
  const record = responseRecord(value, 'mutation receipt');
  if (record.operationId !== expectedOperationId) {
    throw invalidStorageStudioResponse('mutation receipt');
  }
  return Object.freeze({
    operationId: expectedOperationId,
    replayed: responseBoolean(record.replayed, 'mutation receipt'),
    value: parseStorageStudioDrive(record.value),
  });
}

export function parseStorageStudioJobPage(value: unknown): StorageStudioJobPage {
  const record = responseRecord(value, 'job page');
  const page = responseRecord(record.page, 'job page metadata');
  const items = responseArray(record.items, 'job page').map(parseStorageStudioJob);
  const count = nonNegativeInteger(page.count, 'job page metadata');
  if (count !== items.length) throw invalidStorageStudioResponse('job page metadata');
  const nextCursor = nullableString(page.nextCursor, 'job page metadata');
  const hasMore = responseBoolean(page.hasMore, 'job page metadata');
  if (hasMore !== (nextCursor !== null)) throw invalidStorageStudioResponse('job page metadata');
  return Object.freeze({
    items: Object.freeze(items),
    page: Object.freeze({
      limit: positiveInteger(page.limit, 'job page metadata'),
      count,
      hasMore,
      nextCursor,
    }),
  });
}

function parseStorageStudioJob(value: unknown): StorageStudioJobView {
  const record = responseRecord(value, 'job');
  const kind = enumValue(record.kind, JOB_KINDS, 'job') as StorageStudioJobView['kind'];
  const status = enumValue(record.status, JOB_STATUSES, 'job') as StorageStudioJobView['status'];
  return Object.freeze({
    jobId: requiredString(record.jobId, 'job'),
    kind,
    status,
    generation: positiveInteger(record.generation, 'job'),
    attemptCount: nonNegativeInteger(record.attemptCount, 'job'),
    maxAttempts: positiveInteger(record.maxAttempts, 'job'),
    availableAt: nonNegativeInteger(record.availableAt, 'job'),
    failureCode: nullableString(record.failureCode, 'job'),
    createdAt: nonNegativeInteger(record.createdAt, 'job'),
    updatedAt: nonNegativeInteger(record.updatedAt, 'job'),
    completedAt: nullableTimestamp(record.completedAt, 'job'),
  });
}

function parseDrive(value: unknown): DriveRecordWithAccess {
  const record = responseRecord(value, 'drive record');
  const access = parseAccess(record.access);
  return Object.freeze({
    drive_id: requiredString(record.drive_id, 'drive record'),
    tenant_id: nullableString(record.tenant_id, 'drive record'),
    name: requiredString(record.name, 'drive record'),
    owner_id: nullableString(record.owner_id, 'drive record'),
    max_size_bytes: nonNegativeInteger(record.max_size_bytes, 'drive record'),
    max_file_size_bytes: nonNegativeInteger(record.max_file_size_bytes, 'drive record'),
    allowed_mime_types: requiredString(record.allowed_mime_types, 'drive record'),
    public: booleanInteger(record.public, 'drive record'),
    created_at: nonNegativeInteger(record.created_at, 'drive record'),
    access,
  });
}

function parseAccess(value: unknown): StorageAccessCapabilities {
  const record = responseRecord(value, 'drive access');
  const effectiveAccess = record.effectiveAccess === null
    ? null
    : enumValue(record.effectiveAccess, PERMISSIONS, 'drive access');
  return Object.freeze({
    effectiveAccess,
    canRead: responseBoolean(record.canRead, 'drive access'),
    canWrite: responseBoolean(record.canWrite, 'drive access'),
    canAdmin: responseBoolean(record.canAdmin, 'drive access'),
    isOwner: responseBoolean(record.isOwner, 'drive access'),
    isPlatformAdmin: responseBoolean(record.isPlatformAdmin, 'drive access'),
    isPublic: responseBoolean(record.isPublic, 'drive access'),
  });
}

export function invalidStorageStudioResponse(label: string): TypeError {
  return new TypeError(`Invalid Storage Studio ${label} response.`);
}

function responseRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw invalidStorageStudioResponse(label);
  }
  return value as Record<string, unknown>;
}

function responseArray(value: unknown, label: string): readonly unknown[] {
  if (!Array.isArray(value)) throw invalidStorageStudioResponse(label);
  return value;
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) throw invalidStorageStudioResponse(label);
  return value;
}

function nullableString(value: unknown, label: string): string | null {
  if (value === null) return null;
  return requiredString(value, label);
}

function responseBoolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw invalidStorageStudioResponse(label);
  return value;
}

function positiveInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw invalidStorageStudioResponse(label);
  }
  return value as number;
}

function nonNegativeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw invalidStorageStudioResponse(label);
  }
  return value as number;
}

function nullableTimestamp(value: unknown, label: string): number | null {
  return value === null ? null : nonNegativeInteger(value, label);
}

function booleanInteger(value: unknown, label: string): number {
  if (value !== 0 && value !== 1) throw invalidStorageStudioResponse(label);
  return value;
}

function enumValue<T extends string>(value: unknown, values: ReadonlySet<T>, label: string): T {
  if (typeof value !== 'string' || !values.has(value as T)) {
    throw invalidStorageStudioResponse(label);
  }
  return value as T;
}
