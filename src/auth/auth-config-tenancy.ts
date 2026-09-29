/**
 * Tenancy-mode configuration normalization.
 */

import { resolveAuthTenantOnboardingConfig } from './auth-tenant-onboarding-config';
import type {
  AuthAdministrationTenantConfig,
  AuthTenancyConfig,
  AuthTenancyMode,
  AuthTenantCreationMode,
  ResolvedAuthTenancyConfig,
} from './types';
import {
  assertOnlyKeys,
  assertPlainRecord,
} from './auth-config-validation';

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
const MAX_TENANT_ID_LENGTH = 256;

export function normalizeAuthTenancy(
  config: AuthTenancyConfig | undefined,
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
        + 'require tenancy mode "multi".',
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
      `[auth] Unsupported tenant creation mode: "${String(creationMode)}".`,
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
      `[auth] Tenant terminology ${field} may not exceed ${MAX_TENANT_TERM_LENGTH} characters.`,
    );
  }
  return normalized;
}
