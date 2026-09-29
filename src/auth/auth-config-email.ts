/**
 * Account-email delivery, branding, and template configuration normalization.
 */

import type {
  AuthEmailBrandingConfig,
  AuthEmailTemplate,
  AuthEmailTemplateKey,
  AuthEmailTemplates,
} from './auth-email-templates';
import type {
  AuthAccountEmailConfig,
  ResolvedAuthAccountEmailConfig,
} from './types';
import {
  assertOnlyKeys,
  assertOptionalBoolean,
  assertOptionalString,
  assertPlainRecord,
  normalizePublicPath,
} from './auth-config-validation';

const VALID_AUTH_EMAIL_TEMPLATE_KEYS = new Set<AuthEmailTemplateKey>([
  'accountSetup',
  'passwordReset',
  'passwordChanged',
  'emailVerification',
  'domainMailboxProof',
  'emailOtp',
  'mfaEnabled',
  'mfaDisabled',
  'recoveryCodesRegenerated',
]);

export function normalizeAuthAccountEmails(
  config: AuthAccountEmailConfig = {},
): ResolvedAuthAccountEmailConfig {
  assertPlainRecord(config, 'Account email config');
  assertOnlyKeys(config, [
    'adminCreatedUser',
    'passwordReset',
    'passwordChangedNotice',
    'manualPasswordReset',
    'actionTokenTTL',
    'requestCooldown',
    'resetPath',
    'setupPath',
  ], 'Account email config');
  for (const [field, value] of [
    ['adminCreatedUser', config.adminCreatedUser],
    ['passwordReset', config.passwordReset],
    ['passwordChangedNotice', config.passwordChangedNotice],
    ['manualPasswordReset', config.manualPasswordReset],
  ] as const) {
    assertOptionalBoolean(value, `Account email config ${field}`);
  }
  for (const [field, value] of [
    ['actionTokenTTL', config.actionTokenTTL],
    ['requestCooldown', config.requestCooldown],
    ['resetPath', config.resetPath],
    ['setupPath', config.setupPath],
  ] as const) {
    assertOptionalString(value, `Account email config ${field}`);
  }
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

export function normalizeAuthBranding(
  config: AuthEmailBrandingConfig = {},
): AuthEmailBrandingConfig {
  assertPlainRecord(config, 'Auth branding config');
  assertOnlyKeys(
    config,
    ['appName', 'publicUrl', 'logoUrl', 'supportEmail', 'brandColor'],
    'Auth branding config',
  );
  for (const [field, value] of Object.entries(config)) {
    assertOptionalString(value, `Auth branding config ${field}`);
  }
  return { ...config };
}

export function normalizeAuthEmailTemplates(
  templates: AuthEmailTemplates = {},
): AuthEmailTemplates {
  assertPlainRecord(templates, 'Auth email templates');
  const normalized: AuthEmailTemplates = {};

  for (const [key, template] of Object.entries(templates)) {
    if (!VALID_AUTH_EMAIL_TEMPLATE_KEYS.has(key as AuthEmailTemplateKey)) {
      throw new Error(`[auth] Unsupported auth email template key: "${key}".`);
    }
    if (typeof template !== 'function') {
      throw new Error(`[auth] Auth email template "${key}" must be a function.`);
    }
    normalized[key as AuthEmailTemplateKey] = template as AuthEmailTemplate;
  }

  return normalized;
}
