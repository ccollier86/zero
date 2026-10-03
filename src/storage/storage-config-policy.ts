/** Normalization of nested Storage Studio grants, limits, and public policy. */

import type {
  ResolvedStorageStudioLimits,
  ResolvedStorageStudioPublicAccess,
  StorageStudioDefaultGrantConfig,
  StorageStudioLimitsConfig,
  StorageStudioPublicAccessConfig,
} from './storage-config';
import {
  assertKnownKeys,
  assertPlainObject,
  boundedString,
  enumValue,
  nonNegativeSafeInteger,
  optionalBoolean,
  positiveInteger,
} from './storage-config-validation';

const LIMIT_KEYS = new Set([
  'maxOrganizationDrives',
  'maxPersonalDrivesPerUser',
  'maxObjectsPerDrive',
  'defaultDriveSizeBytes',
  'defaultFileSizeBytes',
  'maxDriveSizeBytes',
  'maxFileSizeBytes',
  'maxConcurrentUploadBytes',
]);
const PUBLIC_ACCESS_KEYS = new Set(['allowPublicDrives', 'allowPublicObjects']);
const DEFAULT_GRANT_KEYS = new Set([
  'grantType',
  'grantKey',
  'grantValue',
  'permission',
]);
const DEFAULT_ORGANIZATION_DRIVE_LIMIT = 100;
const DEFAULT_PERSONAL_DRIVE_LIMIT = 10;
const GRANT_VALUE_MAX_LENGTH = 256;
const GRANT_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_.-]{0,127}$/u;

export function resolveStorageStudioDefaultGrants(
  input: readonly StorageStudioDefaultGrantConfig[] | undefined,
): readonly Readonly<StorageStudioDefaultGrantConfig>[] {
  if (input === undefined) return Object.freeze([]);
  if (!Array.isArray(input)) {
    throw new Error('[app] storage.studio.defaultGrants must be an array.');
  }
  const seen = new Set<string>();
  const grants = input.map((raw, index) => {
    const path = `storage.studio.defaultGrants[${index}]`;
    const grant = assertPlainObject(raw, path);
    assertKnownKeys(grant, DEFAULT_GRANT_KEYS, path);
    const grantType = enumValue(
      grant.grantType,
      ['role', 'user', 'property'] as const,
      `${path}.grantType`,
    );
    const permission = enumValue(
      grant.permission,
      ['read', 'write', 'admin'] as const,
      `${path}.permission`,
    );
    const grantValue = boundedString(
      grant.grantValue,
      `${path}.grantValue`,
      GRANT_VALUE_MAX_LENGTH,
    );
    let grantKey: string | undefined;
    if (grantType === 'property') {
      grantKey = boundedString(grant.grantKey, `${path}.grantKey`, 128);
      if (!GRANT_KEY_PATTERN.test(grantKey)) {
        throw new Error(`[app] ${path}.grantKey has an invalid format.`);
      }
    } else if (grant.grantKey !== undefined) {
      throw new Error(`[app] ${path}.grantKey is valid only for property grants.`);
    }
    const identity = `${grantType}\0${grantKey ?? ''}\0${grantValue}\0${permission}`;
    if (seen.has(identity)) {
      throw new Error(`[app] ${path} duplicates an earlier default grant.`);
    }
    seen.add(identity);
    return Object.freeze({
      grantType,
      ...(grantKey === undefined ? {} : { grantKey }),
      grantValue,
      permission,
    });
  });
  return Object.freeze(grants);
}

export function resolveStorageStudioLimits(
  input: StorageStudioLimitsConfig | undefined,
): Readonly<ResolvedStorageStudioLimits> {
  const limits = input === undefined
    ? Object.freeze({}) as StorageStudioLimitsConfig
    : assertPlainObject(input, 'storage.studio.limits');
  assertKnownKeys(limits, LIMIT_KEYS, 'storage.studio.limits');
  const resolved = {
    maxOrganizationDrives: positiveInteger(
      limits.maxOrganizationDrives ?? DEFAULT_ORGANIZATION_DRIVE_LIMIT,
      'storage.studio.limits.maxOrganizationDrives',
    ),
    maxPersonalDrivesPerUser: positiveInteger(
      limits.maxPersonalDrivesPerUser ?? DEFAULT_PERSONAL_DRIVE_LIMIT,
      'storage.studio.limits.maxPersonalDrivesPerUser',
    ),
    maxObjectsPerDrive: nonNegativeSafeInteger(
      limits.maxObjectsPerDrive ?? 0,
      'storage.studio.limits.maxObjectsPerDrive',
    ),
    defaultDriveSizeBytes: byteLimit(
      limits.defaultDriveSizeBytes ?? 0,
      'storage.studio.limits.defaultDriveSizeBytes',
    ),
    defaultFileSizeBytes: byteLimit(
      limits.defaultFileSizeBytes ?? 0,
      'storage.studio.limits.defaultFileSizeBytes',
    ),
    maxDriveSizeBytes: byteLimit(
      limits.maxDriveSizeBytes ?? 0,
      'storage.studio.limits.maxDriveSizeBytes',
    ),
    maxFileSizeBytes: byteLimit(
      limits.maxFileSizeBytes ?? 0,
      'storage.studio.limits.maxFileSizeBytes',
    ),
    maxConcurrentUploadBytes: byteLimit(
      limits.maxConcurrentUploadBytes ?? 0,
      'storage.studio.limits.maxConcurrentUploadBytes',
    ),
  };
  assertBoundedDefault(
    resolved.defaultDriveSizeBytes,
    resolved.maxDriveSizeBytes,
    'defaultDriveSizeBytes',
    'maxDriveSizeBytes',
  );
  assertBoundedDefault(
    resolved.defaultFileSizeBytes,
    resolved.maxFileSizeBytes,
    'defaultFileSizeBytes',
    'maxFileSizeBytes',
  );
  if (resolved.defaultDriveSizeBytes > 0
    && resolved.defaultFileSizeBytes > resolved.defaultDriveSizeBytes) {
    throw new Error(
      '[app] storage.studio.limits.defaultFileSizeBytes must not exceed defaultDriveSizeBytes.',
    );
  }
  if (resolved.maxDriveSizeBytes > 0
    && resolved.maxFileSizeBytes > resolved.maxDriveSizeBytes) {
    throw new Error(
      '[app] storage.studio.limits.maxFileSizeBytes must not exceed maxDriveSizeBytes.',
    );
  }
  return Object.freeze(resolved);
}

export function resolveStorageStudioPublicAccess(
  input: StorageStudioPublicAccessConfig | undefined,
): Readonly<ResolvedStorageStudioPublicAccess> {
  const policy = input === undefined
    ? Object.freeze({}) as StorageStudioPublicAccessConfig
    : assertPlainObject(input, 'storage.studio.publicAccess');
  assertKnownKeys(policy, PUBLIC_ACCESS_KEYS, 'storage.studio.publicAccess');
  const allowPublicDrives = optionalBoolean(
    policy.allowPublicDrives,
    'storage.studio.publicAccess.allowPublicDrives',
  ) ?? false;
  const allowPublicObjects = optionalBoolean(
    policy.allowPublicObjects,
    'storage.studio.publicAccess.allowPublicObjects',
  ) ?? false;
  if (allowPublicDrives && !allowPublicObjects) {
    throw new Error(
      '[app] storage.studio.publicAccess.allowPublicDrives requires allowPublicObjects.',
    );
  }
  return Object.freeze({ allowPublicDrives, allowPublicObjects });
}

function byteLimit(value: unknown, path: string): number {
  return nonNegativeSafeInteger(value, path);
}

function assertBoundedDefault(
  defaultValue: number,
  maximum: number,
  defaultName: string,
  maximumName: string,
): void {
  if (maximum > 0 && defaultValue > maximum) {
    throw new Error(
      `[app] storage.studio.limits.${defaultName} must not exceed ${maximumName}.`,
    );
  }
}
