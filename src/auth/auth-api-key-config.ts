/** Strict normalization for Guardian's optional user-bound API-key capability. */

import { parseTokenTTL } from '../tokens/token-utils';
import {
  assertOnlyKeys,
  assertOptionalBoolean,
  assertOptionalString,
  assertPlainRecord,
  compareAuthConfigKeys,
} from './auth-config-validation';
import type {
  AuthApiKeyConfig,
  AuthApiKeyOptions,
  ResolvedAuthAuthorizationConfig,
  ResolvedAuthApiKeyConfig,
  ResolvedAuthTenancyConfig,
} from './types';
import { resolveAuthApiKeyExpiry } from './auth-api-key-time';

const API_KEY_FIELDS = [
  'enabled',
  'selfService',
  'administratorIssuance',
  'eligibleScopeRoles',
  'defaultTTL',
  'maxTTL',
  'maxActivePerUser',
] as const;

const DEFAULT_TTL = '30d';
const MAX_TTL = '90d';
const MAX_ACTIVE_KEYS = 100;

export function resolveAuthApiKeyConfig(
  config: AuthApiKeyConfig | undefined,
): ResolvedAuthApiKeyConfig {
  const options = normalizeInput(config);
  assertOptionalBoolean(options.enabled, 'API key config enabled');
  assertOptionalBoolean(options.selfService, 'API key config selfService');
  assertOptionalBoolean(
    options.administratorIssuance,
    'API key config administratorIssuance',
  );
  assertOptionalString(options.defaultTTL, 'API key config defaultTTL');
  assertOptionalString(options.maxTTL, 'API key config maxTTL');

  const enabled = typeof config === 'boolean'
    ? config
    : options.enabled ?? false;
  const selfService = typeof config === 'boolean'
    ? config
    : options.selfService ?? false;
  const administratorIssuance = typeof config === 'boolean'
    ? false
    : options.administratorIssuance ?? false;
  if (!enabled && (selfService || administratorIssuance)) {
    throw new Error(
      '[auth] API key issuance cannot be enabled while API keys are disabled.',
    );
  }

  const defaultTTL = options.defaultTTL ?? DEFAULT_TTL;
  const maxTTL = options.maxTTL ?? MAX_TTL;
  const defaultTTLms = parseApiKeyTTL(defaultTTL, 'defaultTTL');
  const maxTTLms = parseApiKeyTTL(maxTTL, 'maxTTL');
  if (defaultTTLms > maxTTLms) {
    throw new Error('[auth] API key config defaultTTL cannot exceed maxTTL.');
  }
  if (resolveAuthApiKeyExpiry(Date.now(), maxTTLms) === null) {
    throw new Error(
      '[auth] API key config maxTTL must produce a JavaScript Date-compatible expiry.',
    );
  }

  const eligibleScopeRoles = normalizeEligibleRoles(options.eligibleScopeRoles);
  const maxActivePerUser = options.maxActivePerUser ?? 10;
  if (!Number.isSafeInteger(maxActivePerUser)
    || maxActivePerUser < 1
    || maxActivePerUser > MAX_ACTIVE_KEYS) {
    throw new Error(
      `[auth] API key config maxActivePerUser must be an integer from 1 to ${MAX_ACTIVE_KEYS}.`,
    );
  }

  return Object.freeze({
    enabled,
    selfService,
    administratorIssuance,
    ...(eligibleScopeRoles ? { eligibleScopeRoles } : {}),
    defaultTTL,
    defaultTTLms,
    maxTTL,
    maxTTLms,
    maxActivePerUser,
  });
}

/**
 * Validate the global key-eligibility allowlist against the completed registry.
 * Administration-only roles are valid eligible subjects in the Administration
 * Organization. Their assignment remains fenced by membership/role services,
 * and credential authority remains live, tenant-bound and ceiling-constrained.
 */
export function validateAuthApiKeyRoles(
  config: ResolvedAuthApiKeyConfig,
  _tenancy: ResolvedAuthTenancyConfig,
  authorization: ResolvedAuthAuthorizationConfig,
): void {
  if (!config.eligibleScopeRoles || authorization.mode !== 'advanced') return;
  for (const roleKey of config.eligibleScopeRoles) {
    if (!authorization.roles[roleKey]) {
      throw new Error(
        `[auth] API key eligible scope role is not declared: "${roleKey}".`,
      );
    }
  }
}

function normalizeInput(config: AuthApiKeyConfig | undefined): AuthApiKeyOptions {
  if (config === undefined || typeof config === 'boolean') return {};
  assertPlainRecord(config, 'API key config');
  assertOnlyKeys(config, API_KEY_FIELDS, 'API key config');
  return config;
}

function parseApiKeyTTL(value: string, field: string): number {
  let milliseconds: number;
  try {
    milliseconds = parseTokenTTL(value, `API key ${field}`);
  } catch {
    throw new Error(
      `[auth] API key config ${field} must be a positive duration using s, m, h, or d.`,
    );
  }
  if (!Number.isSafeInteger(milliseconds) || milliseconds <= 0) {
    throw new Error(
      `[auth] API key config ${field} must be a positive duration using s, m, h, or d.`,
    );
  }
  return milliseconds;
}

function normalizeEligibleRoles(value: readonly string[] | undefined): readonly string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error('[auth] API key config eligibleScopeRoles must be a non-empty array.');
  }
  const normalized = value.map((entry) => {
    if (typeof entry !== 'string' || entry.trim().length === 0) {
      throw new Error(
        '[auth] API key config eligibleScopeRoles must contain non-empty strings.',
      );
    }
    return entry.trim();
  });
  const unique = [...new Set(normalized)].sort(compareAuthConfigKeys);
  if (unique.length !== normalized.length) {
    throw new Error('[auth] API key config eligibleScopeRoles must not contain duplicates.');
  }
  return Object.freeze(unique);
}
