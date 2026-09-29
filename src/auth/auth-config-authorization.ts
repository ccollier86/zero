/**
 * Authorization registry configuration normalization and tenancy cross-checks.
 */

import { canonicalizeEmail, isValidEmail } from './auth-email-identity';
import {
  validateAuthorizationRegistry,
  validatePermissionKey,
  validateRoleKey,
} from './authorization-kernel';
import {
  isRoleAssignableToTenantKind,
  mergeAuthorizationPermissionConfigs,
  mergeAuthorizationRoleConfigs,
} from './authorization-registry';
import type {
  AuthAuthorizationConfig,
  AuthAuthorizationMode,
  AuthAuthorizationOwnerAdoptionConfig,
  AuthPermissionConfig,
  AuthPermissionScope,
  AuthRoleTemplateConfig,
  AuthTenancyMode,
  ResolvedAuthAuthorizationConfig,
  ResolvedAuthPermissionConfig,
  ResolvedAuthRoleTemplateConfig,
  ResolvedAuthTenancyConfig,
} from './types';
import {
  assertOnlyKeys,
  assertPlainRecord,
  compareAuthConfigKeys,
} from './auth-config-validation';

const VALID_AUTHORIZATION_MODES = new Set<AuthAuthorizationMode>([
  'simple',
  'advanced',
]);

const VALID_PERMISSION_SCOPES = new Set<AuthPermissionScope>([
  'application',
  'tenant',
]);

const MAX_PERMISSION_COUNT = 512;
const MAX_ROLE_COUNT = 128;
const MAX_AUTHORIZATION_REGISTRY_VERSION = 2_147_483_647;
const MAX_AUTH_LABEL_LENGTH = 120;
const MAX_AUTH_DESCRIPTION_LENGTH = 500;

export function normalizeAuthAuthorization(
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

export function validateVerifiedDomainRoles(
  tenancy: ResolvedAuthTenancyConfig,
  authorization: ResolvedAuthAuthorizationConfig,
): void {
  const domains = tenancy.onboarding?.verifiedDomains;
  if (!domains) return;
  if (domains.enabled && !tenancy.onboarding?.joinRequests.enabled) {
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
    if (!isRoleAssignableToTenantKind(key, 'organization', authorization)) {
      throw new Error(
        `[auth] Verified-domain request role must be assignable to organization tenants: "${key}".`,
      );
    }
  }
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
  const entries = Object.entries(input)
    .sort(([left], [right]) => compareAuthConfigKeys(left, right));
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
  const entries = Object.entries(input)
    .sort(([left], [right]) => compareAuthConfigKeys(left, right));
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
      permissions: Object.freeze(rolePermissions.sort(compareAuthConfigKeys)),
      allPermissions: definition.allPermissions ?? false,
      system: definition.system ?? false,
    });
  }
  return Object.freeze(normalized);
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
