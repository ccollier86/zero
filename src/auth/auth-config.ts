/**
 * auth-config.ts
 *
 * Public auth behavior configuration facade. Concern-specific normalization
 * lives in focused modules; this file preserves the established validation
 * order and resolved config shape used by runtime code.
 */

import { resolveAuthAuditConfig } from './auth-audit-config';
import {
  normalizeAuthAccount,
  normalizeAuthBootstrap,
  normalizeAuthMfa,
  normalizeAuthRegistration,
} from './auth-config-account';
import {
  normalizeAuthAuthorization,
  validateVerifiedDomainRoles,
} from './auth-config-authorization';
import {
  normalizeAuthAccountEmails,
  normalizeAuthBranding,
  normalizeAuthEmailTemplates,
} from './auth-config-email';
import { normalizeAuthTenancy } from './auth-config-tenancy';
import {
  isPolicyTrustedAuthUserProperty,
  normalizeAuthUserProperties,
} from './auth-config-user-properties';
import {
  assertOnlyKeys,
  assertPlainRecord,
} from './auth-config-validation';
import { resolveAuthRequestAdmissionConfig } from './auth-request-admission-config';
import { resolveNativeAuthConfig } from './native/config';
import type {
  AuthBehaviorConfig,
  NormalizedAuthBehaviorConfig,
  ResolvedUserPropertyFieldConfig,
} from './types';

const AUTH_BEHAVIOR_FIELDS = [
  'audit',
  'tenancy',
  'authorization',
  'registration',
  'bootstrap',
  'requestAdmission',
  'account',
  'mfa',
  'accountEmails',
  'branding',
  'emails',
  'userProperties',
  'strictUserProperties',
  'nativeApps',
] as const;

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
 * Missing config preserves public registration after setup, while an empty
 * installation fails closed until an operator configures a bootstrap secret.
 * Legacy first-registration-wins behavior remains available only through an
 * explicit `bootstrap: 'public'` selection.
 */
export function resolveAuthBehaviorConfig(
  config: AuthBehaviorConfig = {},
): NormalizedAuthBehaviorConfig {
  assertPlainRecord(config, 'Auth config');
  assertOnlyKeys(config, AUTH_BEHAVIOR_FIELDS, 'Auth config');
  if (config.strictUserProperties !== undefined
    && typeof config.strictUserProperties !== 'boolean') {
    throw new Error('[auth] Auth config strictUserProperties must be a boolean.');
  }

  const tenancy = normalizeAuthTenancy(config.tenancy);
  const authorization = normalizeAuthAuthorization(config.authorization, tenancy);
  validateVerifiedDomainRoles(tenancy, authorization);

  return {
    audit: resolveAuthAuditConfig(config.audit),
    tenancy,
    authorization,
    bootstrap: normalizeAuthBootstrap(config.bootstrap),
    requestAdmission: resolveAuthRequestAdmissionConfig(config.requestAdmission),
    registration: normalizeAuthRegistration(config.registration),
    account: normalizeAuthAccount(config.account),
    mfa: normalizeAuthMfa(config.mfa),
    accountEmails: normalizeAuthAccountEmails(config.accountEmails),
    branding: normalizeAuthBranding(config.branding),
    emails: normalizeAuthEmailTemplates(config.emails),
    userProperties: normalizeAuthUserProperties(config.userProperties),
    strictUserProperties: config.strictUserProperties ?? false,
    nativeApps: resolveNativeAuthConfig(config.nativeApps),
  };
}

/**
 * Return true when a resolved user property can be trusted by authorization
 * policy. Resource policy uses this instead of checking editability ad hoc.
 */
export function isPolicyTrustedUserProperty(
  field: ResolvedUserPropertyFieldConfig,
): boolean {
  return isPolicyTrustedAuthUserProperty(field);
}
