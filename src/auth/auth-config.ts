/**
 * auth-config.ts
 *
 * Owns auth behavior configuration helpers and normalization. This file is a
 * pure config layer; it does not read requests, mutate the database, or start
 * Elysia plugins.
 */

import type {
  AuthAccountEmailConfig,
  AuthBehaviorConfig,
  ResolvedAuthAccountEmailConfig,
  ResolvedAuthBehaviorConfig,
  ResolvedUserPropertyFieldConfig,
  UserPropertyEditableBy,
  UserPropertyFieldConfig,
  UserPropertyFieldType,
} from './types';

const VALID_PROPERTY_TYPES = new Set<UserPropertyFieldType>([
  'string',
  'enum',
  'boolean',
  'number',
]);

const POLICY_TRUSTED_EDITORS = new Set<UserPropertyEditableBy>([
  'admin',
  'system',
  'none',
]);

/**
 * Type helper for auth config files.
 *
 * Returns the config unchanged at runtime while preserving literal TypeScript
 * inference for registration modes, property keys, and enum values.
 */
export function defineAuthConfig<T extends AuthBehaviorConfig>(config: T): T {
  return config;
}

/**
 * Normalize developer auth config into stable defaults used by runtime code.
 *
 * Missing config preserves existing public-registration behavior. First-user
 * bootstrap is always handled by the auth plugin as an admin account.
 */
export function resolveAuthBehaviorConfig(
  config: AuthBehaviorConfig = {}
): ResolvedAuthBehaviorConfig {
  const registration = config.registration ?? {};

  return {
    registration: {
      mode: registration.mode ?? 'public',
    },
    accountEmails: normalizeAccountEmails(config.accountEmails),
    userProperties: normalizeUserProperties(config.userProperties ?? {}),
    strictUserProperties: config.strictUserProperties ?? false,
  };
}

function normalizeAccountEmails(
  config: AuthAccountEmailConfig = {}
): ResolvedAuthAccountEmailConfig {
  return {
    adminCreatedUser: config.adminCreatedUser ?? false,
    passwordReset: config.passwordReset ?? true,
    passwordChangedNotice: config.passwordChangedNotice ?? false,
    manualPasswordReset: config.manualPasswordReset ?? true,
    actionTokenTTL: config.actionTokenTTL ?? '1h',
    requestCooldown: config.requestCooldown ?? '5m',
    resetPath: config.resetPath ?? '/reset-password',
    setupPath: config.setupPath ?? '/setup-password',
  };
}

function normalizeUserProperties(
  fields: Record<string, UserPropertyFieldConfig>
): Record<string, ResolvedUserPropertyFieldConfig> {
  const normalized: Record<string, ResolvedUserPropertyFieldConfig> = {};

  for (const [key, field] of Object.entries(fields)) {
    const type = field.type ?? inferPropertyType(field);
    if (!VALID_PROPERTY_TYPES.has(type)) {
      throw new Error(`[auth] Unsupported user property type for "${key}": ${type}`);
    }

    if (type === 'enum' && (!field.values || field.values.length === 0)) {
      throw new Error(`[auth] Enum user property "${key}" must define values.`);
    }

    const editableBy = field.editableBy ?? 'user';
    const useInPolicies = field.useInPolicies ?? false;
    if (useInPolicies && !POLICY_TRUSTED_EDITORS.has(editableBy)) {
      throw new Error(
        `[auth] User property "${key}" cannot set useInPolicies: true while editableBy is "${editableBy}".`
      );
    }

    normalized[key] = {
      key,
      type,
      label: field.label,
      values: field.values,
      default: field.default === undefined ? undefined : String(field.default),
      editableBy,
      useInPolicies,
      description: field.description,
    };
  }

  return normalized;
}

/**
 * Return true when a resolved user property can be trusted by authorization
 * policy. Resource policy uses this instead of checking editability ad hoc.
 */
export function isPolicyTrustedUserProperty(field: ResolvedUserPropertyFieldConfig): boolean {
  return field.useInPolicies && POLICY_TRUSTED_EDITORS.has(field.editableBy);
}

function inferPropertyType(field: UserPropertyFieldConfig): UserPropertyFieldType {
  if (field.values) return 'enum';
  if (typeof field.default === 'boolean') return 'boolean';
  if (typeof field.default === 'number') return 'number';
  return 'string';
}
