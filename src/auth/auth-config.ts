/**
 * auth-config.ts
 *
 * Owns auth behavior configuration helpers and normalization. This file is a
 * pure config layer; it does not read requests, mutate the database, or start
 * Elysia plugins.
 */

import type {
  AuthEmailBrandingConfig,
  AuthEmailTemplateKey,
  AuthEmailTemplates,
} from './auth-email-templates';
import type {
  AuthAccountConfig,
  AuthAccountEmailConfig,
  AuthBehaviorConfig,
  AuthMfaMethodType,
  AuthMfaPolicy,
  AuthMfaQrRobustness,
  AuthMfaConfig,
  ResolvedAuthAccountConfig,
  ResolvedAuthAccountEmailConfig,
  ResolvedAuthBehaviorConfig,
  ResolvedAuthMfaConfig,
  ResolvedUserPropertyFieldConfig,
  UserPropertyEditableBy,
  UserPropertyFieldConfig,
  UserPropertyFieldType,
} from './types';
import { resolveNativeAuthConfig } from './native/config';

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

const VALID_AUTH_EMAIL_TEMPLATE_KEYS = new Set<AuthEmailTemplateKey>([
  'accountSetup',
  'passwordReset',
  'passwordChanged',
  'emailVerification',
  'emailOtp',
  'mfaEnabled',
  'mfaDisabled',
  'recoveryCodesRegenerated',
]);

const VALID_MFA_POLICIES = new Set<AuthMfaPolicy>([
  'optional',
  'required',
  'admin-required',
]);

const VALID_MFA_METHODS = new Set<AuthMfaMethodType>(['email', 'totp']);

const VALID_MFA_QR_ROBUSTNESS = new Set<AuthMfaQrRobustness>([
  'L',
  'M',
  'Q',
  'H',
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
    account: normalizeAccount(config.account),
    mfa: normalizeMfa(config.mfa),
    accountEmails: normalizeAccountEmails(config.accountEmails),
    branding: normalizeBranding(config.branding),
    emails: normalizeEmailTemplates(config.emails),
    userProperties: normalizeUserProperties(config.userProperties ?? {}),
    strictUserProperties: config.strictUserProperties ?? false,
    nativeApps: resolveNativeAuthConfig(config.nativeApps),
  };
}

function normalizeAccount(
  config: AuthAccountConfig = {}
): ResolvedAuthAccountConfig {
  return {
    requireEmailVerification: config.requireEmailVerification ?? false,
    emailVerificationPath: normalizePublicPath(config.emailVerificationPath, '/verify-email'),
    allowAdminMarkEmailVerified: config.allowAdminMarkEmailVerified ?? false,
  };
}

function normalizeMfa(config: AuthMfaConfig = {}): ResolvedAuthMfaConfig {
  const policy = config.policy ?? 'optional';
  if (!VALID_MFA_POLICIES.has(policy)) {
    throw new Error(`[auth] Unsupported MFA policy: "${policy}".`);
  }

  const methods = normalizeMfaMethods(config.methods ?? ['email', 'totp']);
  const qrRobustness = config.totp?.qrRobustness ?? 'M';
  if (!VALID_MFA_QR_ROBUSTNESS.has(qrRobustness)) {
    throw new Error(`[auth] Unsupported MFA QR robustness: "${qrRobustness}".`);
  }

  return {
    enabled: config.enabled ?? false,
    policy,
    methods,
    allowUserChoice: config.allowUserChoice ?? true,
    allowMultipleMethods: config.allowMultipleMethods ?? false,
    rememberDevice: config.rememberDevice ?? false,
    challengeTTL: config.challengeTTL ?? '10m',
    challengeCooldown: config.challengeCooldown ?? '1m',
    maxAttempts: normalizeMfaMaxAttempts(config.maxAttempts),
    recoveryCodes: config.recoveryCodes ?? false,
    totp: {
      issuer: firstNonEmpty(config.totp?.issuer),
      encryptionKey: firstNonEmpty(config.totp?.encryptionKey),
      qrRobustness,
    },
  };
}

function normalizeMfaMethods(methods: AuthMfaMethodType[]): AuthMfaMethodType[] {
  const normalized: AuthMfaMethodType[] = [];

  for (const method of methods) {
    if (!VALID_MFA_METHODS.has(method)) {
      throw new Error(`[auth] Unsupported MFA method: "${method}".`);
    }
    if (!normalized.includes(method)) normalized.push(method);
  }

  if (normalized.length === 0) {
    throw new Error('[auth] MFA methods must include at least one method.');
  }

  return normalized;
}

function normalizeMfaMaxAttempts(value: number | undefined): number {
  if (value === undefined) return 5;
  if (!Number.isFinite(value) || value < 1) {
    throw new Error('[auth] MFA maxAttempts must be a positive number.');
  }
  return Math.floor(value);
}

function normalizeAccountEmails(
  config: AuthAccountEmailConfig = {}
): ResolvedAuthAccountEmailConfig {
  return {
    adminCreatedUser: config.adminCreatedUser ?? false,
    passwordReset: config.passwordReset ?? true,
    // Reserved until password mutations have a committed-change notification
    // sender. Never advertise a configured switch that has no delivery path.
    passwordChangedNotice: false,
    manualPasswordReset: config.manualPasswordReset ?? true,
    actionTokenTTL: config.actionTokenTTL ?? '1h',
    requestCooldown: config.requestCooldown ?? '5m',
    resetPath: normalizePublicPath(config.resetPath, '/reset-password'),
    setupPath: normalizePublicPath(config.setupPath, '/setup-password'),
  };
}

function normalizePublicPath(value: string | undefined, fallback: string): string {
  const path = value?.trim() || fallback;
  return path.startsWith('/') ? path : `/${path}`;
}

function normalizeBranding(
  config: AuthEmailBrandingConfig = {}
): AuthEmailBrandingConfig {
  return { ...config };
}

function firstNonEmpty(value: string | undefined): string | undefined {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function normalizeEmailTemplates(
  templates: AuthEmailTemplates = {}
): AuthEmailTemplates {
  const normalized: AuthEmailTemplates = {};

  for (const [key, template] of Object.entries(templates)) {
    if (!VALID_AUTH_EMAIL_TEMPLATE_KEYS.has(key as AuthEmailTemplateKey)) {
      throw new Error(`[auth] Unsupported auth email template key: "${key}".`);
    }
    if (typeof template !== 'function') {
      throw new Error(`[auth] Auth email template "${key}" must be a function.`);
    }
    normalized[key as AuthEmailTemplateKey] = template;
  }

  return normalized;
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
