/** Strict, reusable parser for authentication-completion response bodies. */

import type {
  AuthCompletionResult,
  AuthEmailVerificationRequiredResult,
  AuthMfaChallenge,
  AuthMfaMethod,
  AuthRegistrationResult,
  AuthRegistrationTenant,
  AuthSessionResult,
  AuthTenantListResult,
  AuthTenantOnboardingRequiredResult,
  AuthTenantSelectionRequiredResult,
  AuthTenantSummary,
  AuthUser,
} from './auth-types';
import { isCanonicalAuthTenantSlug } from './auth-tenant-identifiers';

type UnknownRecord = Record<string, unknown>;

export interface AuthRefreshResponse {
  accessToken: string;
  refreshToken: string;
  activeTenant?: AuthTenantSummary;
  user?: AuthUser;
}

/**
 * Parse and copy only the public authentication contract. Callers that wrap a
 * completion in a route-specific envelope may explicitly allow their envelope
 * keys; those values are never copied into the returned completion.
 */
export function parseAuthCompletionResult(
  value: unknown,
  allowedEnvelopeKeys: readonly string[] = [],
): AuthCompletionResult {
  const result = record(value);
  const user = parseAuthUser(result.user);

  if (result.mfaSetupRequired === true) {
    exactKeys(
      result,
      ['user', 'mfaSetupRequired', 'mfaSetupToken', 'mfa'],
      [],
      allowedEnvelopeKeys,
    );
    const mfa = exact(result.mfa, ['methods', 'allowUserChoice']);
    if (!Array.isArray(mfa.methods)
      || mfa.methods.length < 1
      || mfa.methods.some((method) => method !== 'email' && method !== 'totp')
      || new Set(mfa.methods).size !== mfa.methods.length
      || typeof mfa.allowUserChoice !== 'boolean') throw invalid();
    return Object.freeze({
      user,
      mfaSetupRequired: true,
      mfaSetupToken: text(result.mfaSetupToken, 16_384),
      mfa: Object.freeze({
        methods: Object.freeze([...mfa.methods]) as Array<'email' | 'totp'>,
        allowUserChoice: mfa.allowUserChoice,
      }),
    });
  }

  if (result.mfaChallengeRequired === true) {
    exactKeys(
      result,
      ['user', 'mfaChallengeRequired', 'mfaChallenge'],
      [],
      allowedEnvelopeKeys,
    );
    const challenge = exact(
      result.mfaChallenge,
      ['method', 'challengeToken'],
      ['challenge'],
    );
    return Object.freeze({
      user,
      mfaChallengeRequired: true,
      mfaChallenge: Object.freeze({
        method: parseAuthMfaMethod(challenge.method),
        ...(Object.hasOwn(challenge, 'challenge')
          ? { challenge: parseAuthMfaChallenge(challenge.challenge) }
          : {}),
        challengeToken: text(challenge.challengeToken, 16_384),
      }),
    });
  }

  if (result.tenantSelectionRequired === true) {
    exactKeys(
      result,
      ['user', 'tenantSelectionRequired', 'tenantSelection'],
      [],
      allowedEnvelopeKeys,
    );
    const selection = exact(result.tenantSelection, [
      'continuation', 'expiresAt', 'tenants',
    ]);
    if (!Array.isArray(selection.tenants) || selection.tenants.length === 0) throw invalid();
    const tenants = selection.tenants.map(parseTenantSummary);
    if (new Set(tenants.map((tenant) => tenant.tenantId)).size !== tenants.length) {
      throw invalid();
    }
    const parsed: AuthTenantSelectionRequiredResult = {
      user,
      tenantSelectionRequired: true,
      tenantSelection: Object.freeze({
        continuation: text(selection.continuation, 16_384),
        expiresAt: timestamp(selection.expiresAt),
        tenants: Object.freeze(tenants) as AuthTenantSummary[],
      }),
    };
    return Object.freeze(parsed);
  }

  if (result.tenantOnboardingRequired === true) {
    exactKeys(
      result,
      ['user', 'tenantOnboardingRequired', 'onboarding'],
      [],
      allowedEnvelopeKeys,
    );
    const onboarding = exact(
      result.onboarding,
      ['reason', 'continuation', 'expiresAt'],
      ['tenantCreation'],
    );
    if (onboarding.reason !== 'no_active_tenant_membership') throw invalid();
    const parsed: AuthTenantOnboardingRequiredResult = {
      user,
      tenantOnboardingRequired: true,
      onboarding: Object.freeze({
        reason: 'no_active_tenant_membership',
        continuation: text(onboarding.continuation, 16_384),
        expiresAt: timestamp(onboarding.expiresAt),
        ...(Object.hasOwn(onboarding, 'tenantCreation')
          ? { tenantCreation: parseTenantCreation(onboarding.tenantCreation) }
          : {}),
      }),
    };
    return Object.freeze(parsed);
  }

  if (result.passwordUpdated === true) {
    exactKeys(
      result,
      ['user', 'passwordUpdated', 'signInRequired'],
      [],
      allowedEnvelopeKeys,
    );
    if (result.signInRequired !== true) throw invalid();
    return Object.freeze({ user, passwordUpdated: true, signInRequired: true });
  }

  if (Object.hasOwn(result, 'accessToken') || Object.hasOwn(result, 'refreshToken')) {
    exactKeys(
      result,
      ['user', 'accessToken', 'refreshToken'],
      [
        'activeTenant', 'mfaSetupRequired', 'mfaChallengeRequired',
        'tenantSelectionRequired', 'tenantOnboardingRequired',
      ],
      allowedEnvelopeKeys,
    );
    assertFalseWhenPresent(result, [
      'mfaSetupRequired', 'mfaChallengeRequired',
      'tenantSelectionRequired', 'tenantOnboardingRequired',
    ]);
    const parsed: AuthSessionResult = {
      user,
      accessToken: text(result.accessToken, 16_384),
      refreshToken: text(result.refreshToken, 16_384),
      ...(Object.hasOwn(result, 'activeTenant')
        ? { activeTenant: parseTenantSummary(result.activeTenant) }
        : {}),
    };
    return Object.freeze(parsed);
  }

  // Email-verification-required is the sole completion represented only by
  // its user projection. The two user fields are its fail-closed discriminator.
  exactKeys(result, ['user'], [], allowedEnvelopeKeys);
  if (!user.emailVerificationRequired || user.emailVerifiedAt !== null) throw invalid();
  const parsed: AuthEmailVerificationRequiredResult = {
    user: Object.freeze({
      ...user,
      emailVerifiedAt: null,
      emailVerificationRequired: true,
    }),
  };
  return Object.freeze(parsed);
}

/** Parse registration's optional newly-created tenant envelope. */
export function parseAuthRegistrationResult(value: unknown): AuthRegistrationResult {
  const source = record(value);
  const completion = parseAuthCompletionResult(value, ['tenant']);
  if (!Object.hasOwn(source, 'tenant')) return completion;
  return Object.freeze({
    ...completion,
    tenant: parseRegistrationTenant(source.tenant),
  });
}

/** Require the completion union to contain a fully established session. */
export function parseAuthSessionResult(value: unknown): AuthSessionResult {
  const completion = parseAuthCompletionResult(value);
  if (!('accessToken' in completion)) throw invalid();
  return completion;
}

/** MFA completion routes add a validated method projection to the envelope. */
export function parseAuthMfaCompletionResult(value: unknown): AuthCompletionResult {
  const source = record(value);
  if (!Object.hasOwn(source, 'method')) throw invalid();
  parseAuthMfaMethod(source.method);
  return parseAuthCompletionResult(value, ['method']);
}

/** Refresh rotates credentials without repeating the required user projection. */
export function parseAuthRefreshResponse(value: unknown): AuthRefreshResponse {
  const response = exact(
    value,
    ['accessToken', 'refreshToken'],
    ['activeTenant', 'user'],
  );
  return Object.freeze({
    accessToken: text(response.accessToken, 16_384),
    refreshToken: text(response.refreshToken, 16_384),
    ...(Object.hasOwn(response, 'activeTenant')
      ? { activeTenant: parseTenantSummary(response.activeTenant) }
      : {}),
    ...(Object.hasOwn(response, 'user')
      ? { user: parseAuthUser(response.user) }
      : {}),
  });
}

/** Strict tenant-list projection used to select or switch browser scope. */
export function parseAuthTenantListResult(value: unknown): AuthTenantListResult {
  const result = exact(value, ['activeTenantId', 'tenants']);
  if (!Array.isArray(result.tenants) || result.tenants.length === 0) throw invalid();
  const tenants = result.tenants.map(parseTenantSummary);
  const activeTenantId = text(result.activeTenantId, 200);
  if (new Set(tenants.map((tenant) => tenant.tenantId)).size !== tenants.length
    || !tenants.some((tenant) => tenant.tenantId === activeTenantId)) throw invalid();
  return Object.freeze({
    activeTenantId,
    tenants: Object.freeze(tenants) as AuthTenantSummary[],
  });
}

/** Strict public user projection shared by `/auth/me` and completions. */
export function parseAuthUser(value: unknown): AuthUser {
  const user = exact(value, [
    'userId', 'username', 'email', 'firstName', 'lastName', 'role', 'status',
    'passwordChangeRequired', 'emailVerifiedAt', 'emailVerificationRequired',
    'mfaRequired', 'properties', 'createdAt', 'updatedAt',
  ]);
  if ((user.status !== 'active' && user.status !== 'suspended')
    || typeof user.passwordChangeRequired !== 'boolean'
    || typeof user.emailVerificationRequired !== 'boolean'
    || typeof user.mfaRequired !== 'boolean') throw invalid();
  return Object.freeze({
    userId: text(user.userId, 200),
    username: text(user.username, 200),
    email: text(user.email, 320),
    firstName: nullableText(user.firstName, 200),
    lastName: nullableText(user.lastName, 200),
    role: text(user.role, 64),
    status: user.status,
    passwordChangeRequired: user.passwordChangeRequired,
    emailVerifiedAt: nullableTimestamp(user.emailVerifiedAt),
    emailVerificationRequired: user.emailVerificationRequired,
    mfaRequired: user.mfaRequired,
    properties: parseStringRecord(user.properties),
    createdAt: timestamp(user.createdAt),
    updatedAt: nullableTimestamp(user.updatedAt),
  });
}

function parseTenantSummary(value: unknown): AuthTenantSummary {
  const tenant = exact(value, ['tenantId', 'kind', 'slug', 'name', 'role']);
  if ((tenant.kind !== 'administration' && tenant.kind !== 'organization')
    || !isCanonicalAuthTenantSlug(tenant.slug)) throw invalid();
  return Object.freeze({
    tenantId: text(tenant.tenantId, 200),
    kind: tenant.kind,
    slug: tenant.slug,
    name: text(tenant.name, 120),
    role: tenant.role === null ? null : text(tenant.role, 64),
  });
}

function parseRegistrationTenant(value: unknown): AuthRegistrationTenant {
  const tenant = exact(value, [
    'tenantId', 'kind', 'membershipId', 'slug', 'name', 'role',
  ]);
  if ((tenant.kind !== 'administration' && tenant.kind !== 'organization')
    || !isCanonicalAuthTenantSlug(tenant.slug)) throw invalid();
  return Object.freeze({
    tenantId: text(tenant.tenantId, 200),
    kind: tenant.kind,
    membershipId: text(tenant.membershipId, 200),
    slug: tenant.slug,
    name: text(tenant.name, 120),
    role: tenant.role === null ? null : text(tenant.role, 64),
  });
}

function parseTenantCreation(
  value: unknown,
): NonNullable<AuthTenantOnboardingRequiredResult['onboarding']['tenantCreation']> {
  const creation = record(value);
  if (creation.allowed === false) {
    exactKeys(creation, ['allowed']);
    return Object.freeze({ allowed: false });
  }
  exactKeys(creation, ['allowed', 'continuation', 'expiresAt']);
  if (creation.allowed !== true) throw invalid();
  return Object.freeze({
    allowed: true,
    continuation: text(creation.continuation, 16_384),
    expiresAt: timestamp(creation.expiresAt),
  });
}

/** Strict public MFA method projection used by completion envelopes. */
export function parseAuthMfaMethod(value: unknown): AuthMfaMethod {
  const method = exact(value, [
    'methodId', 'type', 'label', 'status', 'isPrimary', 'createdAt',
    'verifiedAt', 'lastUsedAt',
  ]);
  if ((method.type !== 'email' && method.type !== 'totp')
    || (method.status !== 'pending'
      && method.status !== 'active'
      && method.status !== 'disabled')
    || typeof method.isPrimary !== 'boolean') throw invalid();
  return Object.freeze({
    methodId: text(method.methodId, 200),
    type: method.type,
    label: nullableText(method.label, 200),
    status: method.status,
    isPrimary: method.isPrimary,
    createdAt: timestamp(method.createdAt),
    verifiedAt: nullableTimestamp(method.verifiedAt),
    lastUsedAt: nullableTimestamp(method.lastUsedAt),
  });
}

/** Strict public MFA challenge projection used by setup and login flows. */
export function parseAuthMfaChallenge(value: unknown): AuthMfaChallenge {
  const challenge = exact(value, [
    'challengeId', 'methodType', 'expiresAt', 'delivery',
  ]);
  if ((challenge.methodType !== 'email' && challenge.methodType !== 'totp')
    || (challenge.delivery !== 'email' && challenge.delivery !== 'authenticator')) {
    throw invalid();
  }
  return Object.freeze({
    challengeId: text(challenge.challengeId, 200),
    methodType: challenge.methodType,
    expiresAt: timestamp(challenge.expiresAt),
    delivery: challenge.delivery,
  });
}

function parseStringRecord(value: unknown): Record<string, string> {
  const source = record(value);
  const result: Record<string, string> = {};
  for (const [key, entry] of Object.entries(source)) {
    if (key.length < 1 || typeof entry !== 'string') throw invalid();
    result[key] = entry;
  }
  return Object.freeze(result) as Record<string, string>;
}

function exact(
  value: unknown,
  required: readonly string[],
  optional: readonly string[] = [],
): UnknownRecord {
  const result = record(value);
  exactKeys(result, required, optional);
  return result;
}

function exactKeys(
  value: UnknownRecord,
  required: readonly string[],
  optional: readonly string[] = [],
  envelope: readonly string[] = [],
): void {
  const allowed = new Set([...required, ...optional, ...envelope]);
  if (required.some((key) => !Object.hasOwn(value, key))
    || Object.keys(value).some((key) => !allowed.has(key))) throw invalid();
}

function record(value: unknown): UnknownRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid();
  return value as UnknownRecord;
}

function assertFalseWhenPresent(value: UnknownRecord, keys: readonly string[]): void {
  for (const key of keys) {
    if (Object.hasOwn(value, key) && value[key] !== false) throw invalid();
  }
}

function text(value: unknown, maximum: number): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > maximum) {
    throw invalid();
  }
  return value;
}

function nullableText(value: unknown, maximum: number): string | null {
  return value === null ? null : text(value, maximum);
}

function timestamp(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) throw invalid();
  return Number(value);
}

function nullableTimestamp(value: unknown): number | null {
  return value === null ? null : timestamp(value);
}

function invalid(): Error {
  return new Error('[client] Zero returned an invalid authentication completion response.');
}
