/**
 * storage-config.ts
 *
 * Normalizes the server-owned Storage and opt-in Storage Studio configuration.
 * This module owns validation and immutable defaults only; it does not open a
 * database, provision drives, evaluate Guardian authority, or mount routes.
 */

import type { GrantType, PermissionLevel } from './types';
import {
  resolveStorageStudioDefaultGrants,
  resolveStorageStudioLimits,
  resolveStorageStudioPublicAccess,
} from './storage-config-policy';
import {
  assertKnownKeys,
  assertPlainObject,
  enumValue,
  optionalBoolean,
  positiveInteger,
} from './storage-config-validation';

/** Physical namespace boundary requested for newly provisioned Studio drives. */
export type StorageStudioIsolation = 'shared-cas';

/** One engine ACL installed on every newly provisioned Studio drive. */
export interface StorageStudioDefaultGrantConfig {
  grantType: GrantType;
  /** Required only for property grants. */
  grantKey?: string;
  grantValue: string;
  permission: PermissionLevel;
}

/** Drive-count and byte policies applied by Storage Studio provisioning. */
export interface StorageStudioLimitsConfig {
  maxOrganizationDrives?: number;
  maxPersonalDrivesPerUser?: number;
  /** Zero means no configured object-count ceiling. */
  maxObjectsPerDrive?: number;
  /** Zero means unlimited, matching the existing storage-engine contract. */
  defaultDriveSizeBytes?: number;
  /** Zero means unlimited. */
  defaultFileSizeBytes?: number;
  /** Zero means no configured upper bound. */
  maxDriveSizeBytes?: number;
  /** Zero means no configured upper bound. */
  maxFileSizeBytes?: number;
  /** Aggregate in-flight upload reservations per drive; zero is unlimited. */
  maxConcurrentUploadBytes?: number;
}

/** Public-read capabilities that Studio provisioning may grant. */
export interface StorageStudioPublicAccessConfig {
  allowPublicDrives?: boolean;
  allowPublicObjects?: boolean;
}

/** Opt-in organization/user drive control-plane policy. */
export interface StorageStudioConfig {
  /** Storage Studio is inert unless explicitly enabled. Default: false. */
  enabled?: boolean;
  /** Permit organization drives (application drives in single mode). Default: true. */
  organizationDrives?: boolean;
  /** Permit user-owned drives inside the active application/tenant scope. Default: false. */
  personalDrives?: boolean;
  /** Permit an authorized user to provision their own personal drive. Default: false. */
  personalSelfService?: boolean;
  /** Blob namespace boundary for newly provisioned drives. Default: shared-cas. */
  isolation?: StorageStudioIsolation;
  /** Engine ACLs installed atomically with a newly provisioned drive. */
  defaultGrants?: readonly StorageStudioDefaultGrantConfig[];
  limits?: StorageStudioLimitsConfig;
  publicAccess?: StorageStudioPublicAccessConfig;
  /** Maximum presigned/upload capability lifetime, in seconds. */
  maxCapabilityTTL?: number;
}

/** Built-in authenticated file-storage settings used by createApp(). */
export interface AppStorageConfig {
  /**
   * HMAC secret for presigned URLs and upload grants. Explicit config wins
   * over ZERO_STORAGE_SIGNING_SECRET. When both are omitted, Zero persists a
   * random key in the durable system database during storage startup.
   */
  signingSecret?: string;
  /** Default capability expiry in seconds. Default: 3600. */
  defaultPresignedTTL?: number;
  /** Optional managed organization/user drive control plane. */
  studio?: StorageStudioConfig;
}

/** Fully normalized byte and drive-count policy. */
export interface ResolvedStorageStudioLimits {
  readonly maxOrganizationDrives: number;
  readonly maxPersonalDrivesPerUser: number;
  readonly maxObjectsPerDrive: number;
  readonly defaultDriveSizeBytes: number;
  readonly defaultFileSizeBytes: number;
  readonly maxDriveSizeBytes: number;
  readonly maxFileSizeBytes: number;
  readonly maxConcurrentUploadBytes: number;
}

/** Fully normalized public-read policy. */
export interface ResolvedStorageStudioPublicAccess {
  readonly allowPublicDrives: boolean;
  readonly allowPublicObjects: boolean;
}

/** Immutable Storage Studio policy consumed by services and capability routes. */
export interface ResolvedStorageStudioConfig {
  readonly enabled: boolean;
  readonly organizationDrives: boolean;
  readonly personalDrives: boolean;
  readonly personalSelfService: boolean;
  readonly isolation: StorageStudioIsolation;
  readonly defaultGrants: readonly Readonly<StorageStudioDefaultGrantConfig>[];
  readonly limits: Readonly<ResolvedStorageStudioLimits>;
  readonly publicAccess: Readonly<ResolvedStorageStudioPublicAccess>;
  readonly maxCapabilityTTL: number;
}

/** Normalized server-only storage settings. */
export interface ResolvedAppStorageConfig {
  readonly signingSecret?: string;
  readonly defaultPresignedTTL: number;
  readonly studio: Readonly<ResolvedStorageStudioConfig>;
}

const APP_STORAGE_KEYS = new Set([
  'signingSecret',
  'defaultPresignedTTL',
  'studio',
]);
const STUDIO_KEYS = new Set([
  'enabled',
  'organizationDrives',
  'personalDrives',
  'personalSelfService',
  'isolation',
  'defaultGrants',
  'limits',
  'publicAccess',
  'maxCapabilityTTL',
]);
const DEFAULT_PRESIGNED_TTL = 3_600;

/**
 * Normalize built-in Storage settings without exposing secrets client-side.
 *
 * Unknown keys and malformed nested values are rejected so misspelled policy
 * cannot silently weaken drive ownership or public-access behavior.
 */
export function resolveAppStorageConfig(
  input: AppStorageConfig | undefined,
  env: Record<string, string | undefined> = Bun.env,
): ResolvedAppStorageConfig {
  const config = input === undefined
    ? Object.freeze({}) as AppStorageConfig
    : assertPlainObject(input, 'storage');
  assertKnownKeys(config, APP_STORAGE_KEYS, 'storage');

  const configuredSecret = config.signingSecret;
  if (configuredSecret !== undefined && (
    typeof configuredSecret !== 'string' || configuredSecret.trim().length === 0
  )) {
    throw new Error('[app] storage.signingSecret must be a non-empty string.');
  }
  const envSecret = env.ZERO_STORAGE_SIGNING_SECRET;
  const signingSecret = configuredSecret
    ?? (typeof envSecret === 'string' && envSecret.trim().length > 0
      ? envSecret
      : undefined);
  const defaultPresignedTTL = positiveInteger(
    config.defaultPresignedTTL ?? DEFAULT_PRESIGNED_TTL,
    'storage.defaultPresignedTTL',
  );
  const studio = resolveStorageStudioConfig(config.studio, defaultPresignedTTL);

  return Object.freeze({
    signingSecret,
    defaultPresignedTTL,
    studio,
  });
}

/** Normalize the opt-in Studio policy into a deeply immutable value. */
export function resolveStorageStudioConfig(
  input: StorageStudioConfig | undefined,
  defaultCapabilityTTL = DEFAULT_PRESIGNED_TTL,
): ResolvedStorageStudioConfig {
  const config = input === undefined
    ? Object.freeze({}) as StorageStudioConfig
    : assertPlainObject(input, 'storage.studio');
  assertKnownKeys(config, STUDIO_KEYS, 'storage.studio');

  const enabled = optionalBoolean(config.enabled, 'storage.studio.enabled') ?? false;
  const organizationDrives = optionalBoolean(
    config.organizationDrives,
    'storage.studio.organizationDrives',
  ) ?? true;
  const personalDrives = optionalBoolean(
    config.personalDrives,
    'storage.studio.personalDrives',
  ) ?? false;
  const personalSelfService = optionalBoolean(
    config.personalSelfService,
    'storage.studio.personalSelfService',
  ) ?? false;
  if (personalSelfService && !personalDrives) {
    throw new Error(
      '[app] storage.studio.personalSelfService requires personalDrives.',
    );
  }
  if (enabled && !organizationDrives && !personalDrives) {
    throw new Error(
      '[app] storage.studio must enable organizationDrives or personalDrives.',
    );
  }

  const isolation = enumValue(
    config.isolation ?? 'shared-cas',
    ['shared-cas'] as const,
    'storage.studio.isolation',
  );
  const maxCapabilityTTL = positiveInteger(
    config.maxCapabilityTTL ?? defaultCapabilityTTL,
    'storage.studio.maxCapabilityTTL',
  );
  if (defaultCapabilityTTL > maxCapabilityTTL) {
    throw new Error(
      '[app] storage.defaultPresignedTTL must not exceed storage.studio.maxCapabilityTTL.',
    );
  }

  return Object.freeze({
    enabled,
    organizationDrives,
    personalDrives,
    personalSelfService,
    isolation,
    defaultGrants: resolveStorageStudioDefaultGrants(config.defaultGrants),
    limits: resolveStorageStudioLimits(config.limits),
    publicAccess: resolveStorageStudioPublicAccess(config.publicAccess),
    maxCapabilityTTL,
  });
}
