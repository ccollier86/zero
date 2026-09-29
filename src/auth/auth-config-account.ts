/**
 * Registration, bootstrap, account, and MFA configuration normalization.
 */

import type {
  AuthAccountConfig,
  AuthBootstrapConfig,
  AuthBootstrapMode,
  AuthMfaConfig,
  AuthMfaMethodType,
  AuthMfaPolicy,
  AuthMfaQrRobustness,
  AuthRegistrationConfig,
  AuthRegistrationMode,
  ResolvedAuthAccountConfig,
  ResolvedAuthBootstrapConfig,
  ResolvedAuthMfaConfig,
} from './types';
import {
  assertOnlyKeys,
  assertOptionalBoolean,
  assertOptionalString,
  assertPlainRecord,
  firstNonEmpty,
  normalizePublicPath,
} from './auth-config-validation';

const VALID_BOOTSTRAP_MODES = new Set<AuthBootstrapMode>([
  'secret',
  'public',
  'disabled',
]);

const MIN_BOOTSTRAP_SECRET_LENGTH = 32;

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

const VALID_REGISTRATION_MODES = new Set<AuthRegistrationMode>([
  'public',
  'admin-only',
  'disabled',
]);

export function normalizeAuthBootstrap(
  config: AuthBootstrapConfig | undefined,
): ResolvedAuthBootstrapConfig {
  if (
    config !== undefined
    && typeof config !== 'string'
    && (config === null || typeof config !== 'object' || Array.isArray(config))
  ) {
    throw new Error(
      '[auth] Bootstrap config must be a mode string or an object with a mode.',
    );
  }
  if (config !== undefined && typeof config !== 'string') {
    assertPlainRecord(config, 'Bootstrap config');
    assertOnlyKeys(config, ['mode', 'secret'], 'Bootstrap config');
  }

  const mode = typeof config === 'string' ? config : config?.mode ?? 'secret';
  if (!VALID_BOOTSTRAP_MODES.has(mode)) {
    throw new Error(`[auth] Unsupported bootstrap mode: "${String(mode)}".`);
  }

  const secret = typeof config === 'string' ? undefined : config?.secret;
  if (secret !== undefined && typeof secret !== 'string') {
    throw new Error('[auth] Bootstrap secret must be a string.');
  }
  if (secret !== undefined && mode !== 'secret') {
    throw new Error(
      '[auth] Bootstrap secret may only be configured with bootstrap mode "secret".',
    );
  }
  if (secret !== undefined && secret.length < MIN_BOOTSTRAP_SECRET_LENGTH) {
    throw new Error(
      `[auth] Bootstrap secret must be at least ${MIN_BOOTSTRAP_SECRET_LENGTH} characters.`,
    );
  }

  return secret === undefined ? { mode } : { mode, secret };
}

export function normalizeAuthRegistration(
  config: AuthRegistrationConfig | undefined,
): { mode: AuthRegistrationMode } {
  if (config !== undefined) {
    assertPlainRecord(config, 'Registration config');
    assertOnlyKeys(config, ['mode'], 'Registration config');
  }
  const mode = config?.mode ?? 'public';
  if (!VALID_REGISTRATION_MODES.has(mode)) {
    throw new Error(`[auth] Unsupported registration mode: "${String(mode)}".`);
  }
  return { mode };
}

export function normalizeAuthAccount(
  config: AuthAccountConfig = {},
): ResolvedAuthAccountConfig {
  assertPlainRecord(config, 'Account config');
  assertOnlyKeys(config, [
    'requireEmailVerification',
    'emailVerificationPath',
    'allowAdminMarkEmailVerified',
  ], 'Account config');
  assertOptionalBoolean(
    config.requireEmailVerification,
    'Account config requireEmailVerification',
  );
  assertOptionalBoolean(
    config.allowAdminMarkEmailVerified,
    'Account config allowAdminMarkEmailVerified',
  );
  assertOptionalString(
    config.emailVerificationPath,
    'Account config emailVerificationPath',
  );
  return {
    requireEmailVerification: config.requireEmailVerification ?? false,
    emailVerificationPath: normalizePublicPath(config.emailVerificationPath, '/verify-email'),
    allowAdminMarkEmailVerified: config.allowAdminMarkEmailVerified ?? false,
  };
}

export function normalizeAuthMfa(config: AuthMfaConfig = {}): ResolvedAuthMfaConfig {
  assertPlainRecord(config, 'MFA config');
  assertOnlyKeys(config, [
    'enabled',
    'policy',
    'methods',
    'allowUserChoice',
    'allowMultipleMethods',
    'rememberDevice',
    'challengeTTL',
    'challengeCooldown',
    'maxAttempts',
    'recoveryCodes',
    'totp',
  ], 'MFA config');
  for (const [field, value] of [
    ['enabled', config.enabled],
    ['allowUserChoice', config.allowUserChoice],
    ['allowMultipleMethods', config.allowMultipleMethods],
    ['rememberDevice', config.rememberDevice],
    ['recoveryCodes', config.recoveryCodes],
  ] as const) {
    assertOptionalBoolean(value, `MFA config ${field}`);
  }
  assertOptionalString(config.challengeTTL, 'MFA config challengeTTL');
  assertOptionalString(config.challengeCooldown, 'MFA config challengeCooldown');
  if (config.methods !== undefined && !Array.isArray(config.methods)) {
    throw new Error('[auth] MFA config methods must be an array.');
  }
  if (config.totp !== undefined) {
    assertPlainRecord(config.totp, 'MFA TOTP config');
    assertOnlyKeys(
      config.totp,
      ['issuer', 'encryptionKey', 'qrRobustness'],
      'MFA TOTP config',
    );
    assertOptionalString(config.totp.issuer, 'MFA TOTP config issuer');
    assertOptionalString(config.totp.encryptionKey, 'MFA TOTP config encryptionKey');
  }
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
