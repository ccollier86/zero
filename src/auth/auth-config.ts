/**
 * auth-config.ts
 *
 * Owns auth behavior configuration helpers and normalization. This file is a
 * pure config layer; it does not read requests, mutate the database, or start
 * Elysia plugins.
 */

import type {
  AuthEmailBrandingConfig,
  AuthEmailTemplate,
  AuthEmailTemplateKey,
  AuthEmailTemplates,
} from './auth-email-templates';
import type {
  AuthAccountConfig,
  AuthAccountEmailConfig,
  AuthAuthorizationConfig,
  AuthAuthorizationMode,
  AuthAuthorizationOwnerAdoptionConfig,
  AuthAdministrationTenantConfig,
  AuthPermissionConfig,
  AuthPermissionScope,
  AuthRegistrationConfig,
  AuthRoleTemplateConfig,
  AuthBehaviorConfig,
  AuthBootstrapConfig,
  AuthBootstrapMode,
  AuthMfaMethodType,
  AuthMfaPolicy,
  AuthMfaQrRobustness,
  AuthMfaConfig,
  AuthRegistrationMode,
  NormalizedAuthBehaviorConfig,
  AuthTenancyConfig,
  AuthTenantCreationMode,
  AuthTenancyMode,
  ResolvedAuthAccountConfig,
  ResolvedAuthAccountEmailConfig,
  ResolvedAuthAuthorizationConfig,
  ResolvedAuthPermissionConfig,
  ResolvedAuthRoleTemplateConfig,
  ResolvedAuthBootstrapConfig,
  ResolvedAuthMfaConfig,
  ResolvedAuthTenancyConfig,
  ResolvedUserPropertyFieldConfig,
  UserPropertyEditableBy,
  UserPropertyFieldConfig,
  UserPropertyFieldType,
} from './types';
import { resolveNativeAuthConfig } from './native/config';
import { resolveAuthRequestAdmissionConfig } from './auth-request-admission-config';
import { resolveAuthTenantOnboardingConfig } from './auth-tenant-onboarding-config';
import { canonicalizeEmail, isValidEmail } from './auth-email-identity';
import {
  validateAuthorizationRegistry,
  validatePermissionKey,
  validateRoleKey,
} from './authorization-kernel';
import {
  mergeAuthorizationPermissionConfigs,
  mergeAuthorizationRoleConfigs,
} from './authorization-registry';
import { resolveAuthAuditConfig } from './auth-audit-config';

const VALID_PROPERTY_TYPES = new Set<UserPropertyFieldType>([
  'string',
  'enum',
  'boolean',
  'number',
]);

const VALID_TENANCY_MODES = new Set<AuthTenancyMode>(['single', 'multi']);

const VALID_TENANT_CREATION_MODES = new Set<AuthTenantCreationMode>([
  'authenticated',
  'platform-admin',
  'disabled',
]);

const DEFAULT_TENANT_TERMINOLOGY = Object.freeze({
  singular: 'organization',
  plural: 'organizations',
});

const MAX_TENANT_TERM_LENGTH = 40;

const VALID_AUTHORIZATION_MODES = new Set<AuthAuthorizationMode>([
  'simple',
  'advanced',
]);

const VALID_PERMISSION_SCOPES = new Set<AuthPermissionScope>([
  'application',
  'tenant',
]);

const MAX_TENANT_ID_LENGTH = 256;

const MAX_PERMISSION_COUNT = 512;
const MAX_ROLE_COUNT = 128;
const MAX_AUTHORIZATION_REGISTRY_VERSION = 2_147_483_647;
const MAX_AUTH_LABEL_LENGTH = 120;
const MAX_AUTH_DESCRIPTION_LENGTH = 500;

const VALID_BOOTSTRAP_MODES = new Set<AuthBootstrapMode>([
  'secret',
  'public',
  'disabled',
]);

const MIN_BOOTSTRAP_SECRET_LENGTH = 32;

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
  'domainMailboxProof',
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

const VALID_REGISTRATION_MODES = new Set<AuthRegistrationMode>([
  'public',
  'admin-only',
  'disabled',
]);

const VALID_PROPERTY_EDITORS = new Set<UserPropertyEditableBy>([
  'user',
  'admin',
  'system',
  'none',
]);

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
  config: AuthBehaviorConfig = {}
): NormalizedAuthBehaviorConfig {
  assertPlainRecord(config, 'Auth config');
  assertOnlyKeys(config, AUTH_BEHAVIOR_FIELDS, 'Auth config');
  if (config.strictUserProperties !== undefined
    && typeof config.strictUserProperties !== 'boolean') {
    throw new Error('[auth] Auth config strictUserProperties must be a boolean.');
  }

  const tenancy = normalizeTenancy(config.tenancy);
  const authorization = normalizeAuthorization(config.authorization, tenancy);
  validateVerifiedDomainRoles(tenancy, authorization);

  return {
    audit: resolveAuthAuditConfig(config.audit),
    tenancy,
    authorization,
    bootstrap: normalizeBootstrap(config.bootstrap),
    requestAdmission: resolveAuthRequestAdmissionConfig(config.requestAdmission),
    registration: normalizeRegistration(config.registration),
    account: normalizeAccount(config.account),
    mfa: normalizeMfa(config.mfa),
    accountEmails: normalizeAccountEmails(config.accountEmails),
    branding: normalizeBranding(config.branding),
    emails: normalizeEmailTemplates(config.emails),
    userProperties: normalizeUserProperties(config.userProperties),
    strictUserProperties: config.strictUserProperties ?? false,
    nativeApps: resolveNativeAuthConfig(config.nativeApps),
  };
}

function validateVerifiedDomainRoles(
  tenancy: ResolvedAuthTenancyConfig,
  authorization: ResolvedAuthAuthorizationConfig,
): void {
  const domains = tenancy.onboarding?.verifiedDomains;
  if (!domains?.enabled) return;
  if (!tenancy.onboarding?.joinRequests.enabled) {
    throw new Error(
      '[auth] Verified-domain request onboarding requires joinRequests.enabled.',
    );
  }
  for (const key of domains.allowedRequestRoles) {
    const role = authorization.roles[key];
    if (!role) {
      throw new Error(
        `[auth] Verified-domain request role is not declared: "${key}".`,
      );
    }
    if (role.system || role.allPermissions || key === 'owner') {
      throw new Error(
        `[auth] Verified-domain request role must be non-system and bounded: "${key}".`,
      );
    }
  }
}

function normalizeBootstrap(
  config: AuthBootstrapConfig | undefined
): ResolvedAuthBootstrapConfig {
  if (
    config !== undefined
    && typeof config !== 'string'
    && (config === null || typeof config !== 'object' || Array.isArray(config))
  ) {
    throw new Error(
      '[auth] Bootstrap config must be a mode string or an object with a mode.'
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
      '[auth] Bootstrap secret may only be configured with bootstrap mode "secret".'
    );
  }
  if (secret !== undefined && secret.length < MIN_BOOTSTRAP_SECRET_LENGTH) {
    throw new Error(
      `[auth] Bootstrap secret must be at least ${MIN_BOOTSTRAP_SECRET_LENGTH} characters.`
    );
  }

  return secret === undefined ? { mode } : { mode, secret };
}

function normalizeTenancy(
  config: AuthTenancyConfig | undefined
): ResolvedAuthTenancyConfig {
  if (
    config !== undefined
    && typeof config !== 'string'
    && (config === null || typeof config !== 'object' || Array.isArray(config))
  ) {
    throw new Error('[auth] Tenancy config must be a mode string or an object with a mode.');
  }
  if (config !== undefined && typeof config !== 'string') {
    assertPlainRecord(config, 'Tenancy config');
  }
  const mode = typeof config === 'string'
    ? config
    : config?.mode === undefined ? 'single' : config.mode;
  if (!VALID_TENANCY_MODES.has(mode)) {
    throw new Error(`[auth] Unsupported tenancy mode: "${String(mode)}".`);
  }
  if (typeof config !== 'string' && config !== undefined) {
    assertOnlyKeys(
      config,
      ['mode', 'terminology', 'creation', 'onboarding', 'administration'],
      'Tenancy config',
    );
  }

  const terminologyInput = typeof config === 'string' ? undefined : config?.terminology;
  const creationInput = typeof config === 'string' ? undefined : config?.creation;
  const onboardingInput = typeof config === 'string' ? undefined : config?.onboarding;
  const administrationInput = typeof config === 'string'
    ? undefined
    : config?.administration;
  if (mode === 'single' && (terminologyInput !== undefined
    || creationInput !== undefined || onboardingInput !== undefined
    || administrationInput !== undefined)) {
    throw new Error(
      '[auth] Tenancy terminology, creation, onboarding, and administration policy '
        + 'require tenancy mode "multi".'
    );
  }

  if (terminologyInput !== undefined) {
    assertPlainRecord(terminologyInput, 'Tenancy terminology');
    assertOnlyKeys(terminologyInput, ['singular', 'plural'], 'Tenancy terminology');
  }
  if (creationInput !== undefined) {
    assertPlainRecord(creationInput, 'Tenant creation config');
    assertOnlyKeys(creationInput, ['mode'], 'Tenant creation config');
  }
  const administration = normalizeAdministrationTenant(administrationInput);

  const creationMode = (creationInput?.mode
    ?? (mode === 'multi' ? 'authenticated' : 'disabled')) as AuthTenantCreationMode;
  if (!VALID_TENANT_CREATION_MODES.has(creationMode)) {
    throw new Error(
      `[auth] Unsupported tenant creation mode: "${String(creationMode)}".`
    );
  }

  const terminology = Object.freeze({
    singular: normalizeTenantTerm(
      terminologyInput?.singular,
      DEFAULT_TENANT_TERMINOLOGY.singular,
      'singular',
    ),
    plural: normalizeTenantTerm(
      terminologyInput?.plural,
      DEFAULT_TENANT_TERMINOLOGY.plural,
      'plural',
    ),
  });
  return Object.freeze({
    mode,
    terminology,
    creation: Object.freeze({ mode: creationMode }),
    ...(mode === 'multi'
      ? { onboarding: resolveAuthTenantOnboardingConfig(onboardingInput) }
      : {}),
    ...(mode === 'multi' && administration
      ? { administration }
      : {}),
  });
}

function normalizeAdministrationTenant(
  input: AuthAdministrationTenantConfig | undefined,
): Readonly<AuthAdministrationTenantConfig> | null {
  if (input === undefined) return null;
  assertPlainRecord(input, 'Administration tenant config');
  assertOnlyKeys(input, ['adoptTenantId'], 'Administration tenant config');
  if (input.adoptTenantId === undefined) return Object.freeze({});
  if (typeof input.adoptTenantId !== 'string') {
    throw new Error('[auth] Administration adoptTenantId must be a string.');
  }
  const adoptTenantId = input.adoptTenantId.trim();
  if (!adoptTenantId || adoptTenantId.length > MAX_TENANT_ID_LENGTH) {
    throw new Error(
      `[auth] Administration adoptTenantId must contain 1-${MAX_TENANT_ID_LENGTH} characters.`,
    );
  }
  return Object.freeze({ adoptTenantId });
}

function normalizeTenantTerm(
  value: unknown,
  fallback: string,
  field: 'singular' | 'plural',
): string {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`[auth] Tenant terminology ${field} must be a non-empty string.`);
  }
  const normalized = value.trim().toLocaleLowerCase('en-US');
  if (normalized.length > MAX_TENANT_TERM_LENGTH) {
    throw new Error(
      `[auth] Tenant terminology ${field} may not exceed ${MAX_TENANT_TERM_LENGTH} characters.`
    );
  }
  return normalized;
}

function normalizeAuthorization(
  config: AuthAuthorizationConfig | undefined,
  tenancy: ResolvedAuthTenancyConfig,
): ResolvedAuthAuthorizationConfig {
  const tenancyMode = tenancy.mode;
  if (
    config !== undefined
    && typeof config !== 'string'
    && (config === null || typeof config !== 'object' || Array.isArray(config))
  ) {
    throw new Error('[auth] Authorization config must be a mode string or an object with a mode.');
  }
  if (config !== undefined && typeof config !== 'string') {
    assertPlainRecord(config, 'Authorization config');
  }
  const mode = typeof config === 'string'
    ? config
    : config?.mode === undefined ? 'simple' : config.mode;
  if (!VALID_AUTHORIZATION_MODES.has(mode)) {
    throw new Error(`[auth] Unsupported authorization mode: "${String(mode)}".`);
  }

  if (typeof config !== 'string' && config !== undefined) {
    assertOnlyKeys(
      config,
      [
        'mode',
        'registryVersion',
        'permissions',
        'roles',
        'ownerAdoption',
        'legacySimpleRoleAdoption',
      ],
      'Authorization config',
    );
  }

  const registryVersion = normalizeAuthorizationRegistryVersion(
    typeof config === 'string' ? undefined : config?.registryVersion,
  );

  const applicationPermissions = typeof config === 'string'
    ? undefined
    : config?.permissions;
  const applicationRoles = typeof config === 'string'
    ? undefined
    : config?.roles;
  const ownerAdoption = normalizeOwnerAdoption(
    typeof config === 'string' ? undefined : config?.ownerAdoption,
    tenancyMode,
    mode,
  );
  const legacySimpleRoleAdoption = normalizeLegacySimpleRoleAdoption(
    typeof config === 'string' ? undefined : config?.legacySimpleRoleAdoption,
    tenancyMode,
    mode,
  );
  const permissions = normalizePermissions(
    mergeAuthorizationPermissionConfigs(
      applicationPermissions,
      tenancyMode,
      mode,
      tenancy.terminology,
    ),
    tenancyMode === 'multi' ? 'tenant' : 'application',
  );
  const roles = normalizeRoleTemplates(
    mergeAuthorizationRoleConfigs(
      applicationRoles,
      tenancyMode,
      mode,
      tenancy.terminology,
    ),
    permissions,
  );

  // The adoption selector is an upgrade-only input, so omit it entirely when
  // it is not configured instead of publishing a new `null` field everywhere.
  const resolved: ResolvedAuthAuthorizationConfig = Object.freeze({
    mode,
    registryVersion,
    permissions,
    roles,
    ...(ownerAdoption ? { ownerAdoption } : {}),
    ...(legacySimpleRoleAdoption ? { legacySimpleRoleAdoption: true as const } : {}),
  });
  validateAuthorizationRegistry(resolved);
  return resolved;
}

function normalizeAuthorizationRegistryVersion(value: number | undefined): number {
  if (value === undefined) return 1;
  if (!Number.isSafeInteger(value)
    || value < 1
    || value > MAX_AUTHORIZATION_REGISTRY_VERSION) {
    throw new Error(
      `[auth] Authorization registryVersion must be an integer between 1 and ${MAX_AUTHORIZATION_REGISTRY_VERSION}.`,
    );
  }
  return value;
}

function normalizeLegacySimpleRoleAdoption(
  input: true | undefined,
  tenancyMode: AuthTenancyMode,
  authorizationMode: AuthAuthorizationMode,
): boolean {
  if (input === undefined) return false;
  if (input !== true) {
    throw new Error(
      '[auth] Authorization legacySimpleRoleAdoption must be true when configured.',
    );
  }
  if (tenancyMode !== 'multi' || authorizationMode !== 'advanced') {
    throw new Error(
      '[auth] Authorization legacySimpleRoleAdoption requires multi/advanced mode.',
    );
  }
  return true;
}

function normalizeOwnerAdoption(
  input: AuthAuthorizationOwnerAdoptionConfig | undefined,
  tenancyMode: AuthTenancyMode,
  authorizationMode: AuthAuthorizationMode,
): Readonly<AuthAuthorizationOwnerAdoptionConfig> | null {
  if (input === undefined) return null;
  if (tenancyMode !== 'single' || authorizationMode !== 'advanced') {
    throw new Error(
      '[auth] Authorization ownerAdoption requires single/advanced mode.',
    );
  }
  assertPlainRecord(input, 'Authorization ownerAdoption');
  assertOnlyKeys(input, ['userId', 'email'], 'Authorization ownerAdoption');
  const hasUserId = input.userId !== undefined;
  const hasEmail = input.email !== undefined;
  if (hasUserId === hasEmail) {
    throw new Error(
      '[auth] Authorization ownerAdoption requires exactly one of userId or email.',
    );
  }
  if (hasUserId) {
    if (typeof input.userId !== 'string'
      || input.userId.trim().length === 0
      || input.userId.length > 200) {
      throw new Error('[auth] Authorization ownerAdoption userId is invalid.');
    }
    return Object.freeze({ userId: input.userId.trim() });
  }
  if (typeof input.email !== 'string') {
    throw new Error('[auth] Authorization ownerAdoption email is invalid.');
  }
  const email = canonicalizeEmail(input.email);
  if (!isValidEmail(email)) {
    throw new Error('[auth] Authorization ownerAdoption email is invalid.');
  }
  return Object.freeze({ email });
}

function normalizePermissions(
  input: Record<string, AuthPermissionConfig> | undefined,
  defaultScope: AuthPermissionScope,
): Readonly<Record<string, ResolvedAuthPermissionConfig>> {
  if (input === undefined) return Object.freeze({});
  assertPlainRecord(input, 'Authorization permissions');
  const entries = Object.entries(input).sort(([left], [right]) => compareKeys(left, right));
  if (entries.length > MAX_PERMISSION_COUNT) {
    throw new Error(
      `[auth] Authorization permissions may declare at most ${MAX_PERMISSION_COUNT} entries.`,
    );
  }

  const normalized: Record<string, ResolvedAuthPermissionConfig> = {};
  for (const [key, definition] of entries) {
    validatePermissionKey(key);
    assertPlainRecord(definition, `Authorization permission "${key}"`);
    assertOnlyKeys(
      definition,
      ['label', 'description', 'scope'],
      `Authorization permission "${key}"`,
    );
    const scope = definition.scope ?? defaultScope;
    if (!VALID_PERMISSION_SCOPES.has(scope)) {
      throw new Error(
        `[auth] Authorization permission "${key}" scope must be "application" or "tenant".`,
      );
    }
    normalized[key] = Object.freeze({
      key,
      label: normalizeDisplayText(definition.label, key, 'label', key),
      ...normalizeOptionalDescription(definition.description, `permission "${key}"`),
      scope,
    });
  }
  return Object.freeze(normalized);
}

function normalizeRoleTemplates(
  input: Record<string, AuthRoleTemplateConfig> | undefined,
  permissions: Readonly<Record<string, ResolvedAuthPermissionConfig>>,
): Readonly<Record<string, ResolvedAuthRoleTemplateConfig>> {
  if (input === undefined) return Object.freeze({});
  assertPlainRecord(input, 'Authorization roles');
  const entries = Object.entries(input).sort(([left], [right]) => compareKeys(left, right));
  if (entries.length > MAX_ROLE_COUNT) {
    throw new Error(`[auth] Authorization roles may declare at most ${MAX_ROLE_COUNT} entries.`);
  }

  const normalized: Record<string, ResolvedAuthRoleTemplateConfig> = {};
  for (const [key, definition] of entries) {
    validateRoleKey(key);
    assertPlainRecord(definition, `Authorization role "${key}"`);
    assertOnlyKeys(
      definition,
      ['label', 'description', 'permissions', 'allPermissions', 'system'],
      `Authorization role "${key}"`,
    );
    if (definition.permissions !== undefined && !Array.isArray(definition.permissions)) {
      throw new Error(`[auth] Authorization role "${key}" permissions must be an array.`);
    }
    if (definition.allPermissions !== undefined && typeof definition.allPermissions !== 'boolean') {
      throw new Error(`[auth] Authorization role "${key}" allPermissions must be a boolean.`);
    }
    if (definition.system !== undefined && typeof definition.system !== 'boolean') {
      throw new Error(`[auth] Authorization role "${key}" system must be a boolean.`);
    }

    const rolePermissions = [...(definition.permissions ?? [])];
    const seen = new Set<string>();
    for (const permission of rolePermissions) {
      if (typeof permission !== 'string') {
        throw new Error(`[auth] Authorization role "${key}" permissions must be strings.`);
      }
      validatePermissionKey(permission);
      if (!permissions[permission]) {
        throw new Error(
          `[auth] Authorization role "${key}" references undeclared permission "${permission}".`,
        );
      }
      if (seen.has(permission)) {
        throw new Error(
          `[auth] Authorization role "${key}" repeats permission "${permission}".`,
        );
      }
      seen.add(permission);
    }
    if (definition.allPermissions === true && rolePermissions.length > 0) {
      throw new Error(
        `[auth] Authorization role "${key}" cannot combine allPermissions with explicit permissions.`,
      );
    }

    normalized[key] = Object.freeze({
      key,
      label: normalizeDisplayText(definition.label, key, 'label', key),
      ...normalizeOptionalDescription(definition.description, `role "${key}"`),
      permissions: Object.freeze(rolePermissions.sort(compareKeys)),
      allPermissions: definition.allPermissions ?? false,
      system: definition.system ?? false,
    });
  }
  return Object.freeze(normalized);
}

function assertPlainRecord<T>(
  value: T,
  label: string,
): asserts value is T & Record<string, unknown> {
  if (
    value === null
    || typeof value !== 'object'
    || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  ) {
    throw new Error(`[auth] ${label} must be an object.`);
  }
}

function assertOnlyKeys(
  value: object,
  allowed: readonly string[],
  label: string,
): void {
  const unknown = Object.keys(value)
    .filter((key) => !allowed.includes(key))
    .sort(compareKeys);
  if (unknown.length > 0) {
    throw new Error(`[auth] ${label} contains unsupported field "${unknown[0]}".`);
  }
}

function assertOptionalBoolean(
  value: unknown,
  label: string,
): asserts value is boolean | undefined {
  if (value !== undefined && typeof value !== 'boolean') {
    throw new Error(`[auth] ${label} must be a boolean.`);
  }
}

function assertOptionalString(
  value: unknown,
  label: string,
): asserts value is string | undefined {
  if (value !== undefined && typeof value !== 'string') {
    throw new Error(`[auth] ${label} must be a string.`);
  }
}

function normalizeDisplayText(
  value: unknown,
  fallback: string,
  field: string,
  key: string,
): string {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`[auth] Authorization ${field} for "${key}" must be a non-empty string.`);
  }
  const normalized = value.trim();
  if (normalized.length > MAX_AUTH_LABEL_LENGTH) {
    throw new Error(
      `[auth] Authorization ${field} for "${key}" may not exceed ${MAX_AUTH_LABEL_LENGTH} characters.`,
    );
  }
  return normalized;
}

function normalizeOptionalDescription(
  value: unknown,
  target: string,
): { description?: string } {
  if (value === undefined) return {};
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`[auth] Authorization description for ${target} must be a non-empty string.`);
  }
  const description = value.trim();
  if (description.length > MAX_AUTH_DESCRIPTION_LENGTH) {
    throw new Error(
      `[auth] Authorization description for ${target} may not exceed ${MAX_AUTH_DESCRIPTION_LENGTH} characters.`,
    );
  }
  return { description };
}

function compareKeys(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function normalizeRegistration(
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

function normalizeAccount(
  config: AuthAccountConfig = {}
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

function normalizeMfa(config: AuthMfaConfig = {}): ResolvedAuthMfaConfig {
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

function normalizeAccountEmails(
  config: AuthAccountEmailConfig = {}
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

function normalizePublicPath(value: string | undefined, fallback: string): string {
  const path = value?.trim() || fallback;
  return path.startsWith('/') ? path : `/${path}`;
}

function normalizeBranding(
  config: AuthEmailBrandingConfig = {}
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

function firstNonEmpty(value: string | undefined): string | undefined {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function normalizeEmailTemplates(
  templates: AuthEmailTemplates = {}
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

function normalizeUserProperties(
  fields: Record<string, UserPropertyFieldConfig> = {},
): Record<string, ResolvedUserPropertyFieldConfig> {
  assertPlainRecord(fields, 'User properties config');
  const normalized: Record<string, ResolvedUserPropertyFieldConfig> = {};

  for (const [key, field] of Object.entries(fields)) {
    assertPlainRecord(field, `User property "${key}"`);
    assertOnlyKeys(field, [
      'type',
      'label',
      'values',
      'default',
      'editableBy',
      'useInPolicies',
      'description',
    ], `User property "${key}"`);
    assertOptionalString(field.label, `User property "${key}" label`);
    assertOptionalString(field.description, `User property "${key}" description`);
    assertOptionalBoolean(field.useInPolicies, `User property "${key}" useInPolicies`);
    if (field.values !== undefined && (!Array.isArray(field.values)
      || field.values.some((value) => typeof value !== 'string'))) {
      throw new Error(`[auth] User property "${key}" values must be an array of strings.`);
    }
    if (field.default !== undefined
      && typeof field.default !== 'string'
      && typeof field.default !== 'number'
      && typeof field.default !== 'boolean') {
      throw new Error(`[auth] User property "${key}" default must be a string, number, or boolean.`);
    }
    const type = field.type ?? inferPropertyType(field);
    if (!VALID_PROPERTY_TYPES.has(type)) {
      throw new Error(`[auth] Unsupported user property type for "${key}": ${type}`);
    }

    if (type === 'enum' && (!field.values || field.values.length === 0)) {
      throw new Error(`[auth] Enum user property "${key}" must define values.`);
    }

    const editableBy = field.editableBy ?? 'user';
    if (!VALID_PROPERTY_EDITORS.has(editableBy)) {
      throw new Error(
        `[auth] Unsupported user property editor for "${key}": ${String(editableBy)}`,
      );
    }
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
