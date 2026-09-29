/** Comparable, secret-free fingerprint of live request authority. */

import type { AuthContext, AuthContextAuthorityReference } from './types';

/**
 * Include every field that can change effective identity/scope plus the
 * server-owned properties used by policy and built-in service grants.
 */
export function authContextAuthorityFingerprint(
  context: AuthContext | null,
  properties: Readonly<Record<string, string>> = {},
): string {
  if (!context) return 'anonymous';
  return JSON.stringify([
    context.userId,
    context.email,
    context.role,
    context.authGeneration ?? null,
    context.clientId ?? null,
    context.sessionKind ?? null,
    context.scope ? [...context.scope].sort(compareKeys) : null,
    context.sessionId ?? null,
    context.mfaVerifiedAt ?? null,
    context.sessionGeneration ?? null,
    context.sessionScopeKind ?? null,
    context.sessionScopeId ?? null,
    context.tenantId ?? null,
    context.membershipId ?? null,
    context.tenantKind ?? null,
    context.tenantRole ?? null,
    context.tenantAuthorizationGeneration ?? null,
    context.membershipAuthorizationGeneration ?? null,
    context.authorizationAssignmentRevision ?? null,
    Object.entries(properties).sort(([left], [right]) => compareKeys(left, right)),
  ]);
}

/** Compare a rehydrated context to the exact captured session authority. */
export function authContextMatchesAuthorityReference(
  context: AuthContext,
  reference: AuthContextAuthorityReference,
): boolean {
  const scopes = [...(context.scope ?? [])].sort(compareKeys);
  return context.userId === reference.userId
    && context.role === reference.platformRole
    && context.authGeneration === reference.authGeneration
    && context.sessionKind === reference.sessionKind
    && context.sessionId === reference.sessionId
    && (context.mfaVerifiedAt ?? null) === reference.mfaVerifiedAt
    && (context.sessionGeneration ?? null) === reference.sessionGeneration
    && (context.clientId ?? null) === reference.clientId
    && JSON.stringify(scopes) === JSON.stringify(reference.identityScopes)
    && context.sessionScopeKind === reference.sessionScopeKind
    && context.sessionScopeId === reference.sessionScopeId
    && (context.tenantId ?? null) === reference.tenantId
    && (context.membershipId ?? null) === reference.membershipId
    && (context.tenantKind ?? null) === reference.tenantKind
    && (context.tenantRole ?? null) === reference.tenantRole
    && (context.tenantAuthorizationGeneration ?? null)
      === reference.tenantAuthorizationGeneration
    && (context.membershipAuthorizationGeneration ?? null)
      === reference.membershipAuthorizationGeneration
    && (context.authorizationAssignmentRevision ?? null)
      === reference.authorizationAssignmentRevision;
}

/**
 * Detach and validate a caller-owned authority reference before an async
 * boundary. The returned value contains no credential material and is safe to
 * retain only for trusted server-side ceremony fencing.
 */
export function snapshotAuthContextAuthorityReference(
  reference: AuthContextAuthorityReference,
): AuthContextAuthorityReference | null {
  if (reference.version !== 1
    || !isNonEmptyText(reference.userId)
    || !isNonEmptyText(reference.platformRole)
    || !isGeneration(reference.authGeneration)
    || (reference.sessionKind !== 'web' && reference.sessionKind !== 'native')
    || !isNonEmptyText(reference.sessionId)
    || !isNullableTimestamp(reference.mfaVerifiedAt)
    || !isNullableGeneration(reference.sessionGeneration)
    || !isNullableText(reference.clientId)
    || !Array.isArray(reference.identityScopes)
    || !reference.identityScopes.every((scope) => typeof scope === 'string')
    || (reference.sessionScopeKind !== 'application'
      && reference.sessionScopeKind !== 'tenant')
    || !isNonEmptyText(reference.sessionScopeId)
    || !isNullableText(reference.tenantId)
    || !isNullableText(reference.membershipId)
    || (reference.tenantKind !== null
      && reference.tenantKind !== 'organization'
      && reference.tenantKind !== 'administration')
    || !isNullableText(reference.tenantRole)
    || !isNullableGeneration(reference.tenantAuthorizationGeneration)
    || !isNullableGeneration(reference.membershipAuthorizationGeneration)
    || !isNullableText(reference.authorizationAssignmentRevision)) {
    return null;
  }

  if (reference.sessionKind === 'web') {
    if (reference.sessionGeneration === null || reference.clientId !== null) return null;
  } else if (reference.sessionGeneration !== null || reference.clientId === null) {
    return null;
  }

  if (reference.sessionScopeKind === 'application') {
    if (reference.tenantId !== null
      || reference.membershipId !== null
      || reference.tenantKind !== null
      || reference.tenantRole !== null
      || reference.tenantAuthorizationGeneration !== null
      || reference.membershipAuthorizationGeneration !== null) return null;
  } else if (reference.tenantId === null
    || reference.membershipId === null
    || reference.tenantKind === null
    || reference.tenantAuthorizationGeneration === null
    || reference.membershipAuthorizationGeneration === null) {
    return null;
  }

  return Object.freeze({
    version: 1,
    userId: reference.userId,
    platformRole: reference.platformRole,
    authGeneration: reference.authGeneration,
    sessionKind: reference.sessionKind,
    sessionId: reference.sessionId,
    mfaVerifiedAt: reference.mfaVerifiedAt,
    sessionGeneration: reference.sessionGeneration,
    clientId: reference.clientId,
    identityScopes: Object.freeze([...reference.identityScopes]),
    sessionScopeKind: reference.sessionScopeKind,
    sessionScopeId: reference.sessionScopeId,
    tenantId: reference.tenantId,
    membershipId: reference.membershipId,
    tenantKind: reference.tenantKind,
    tenantRole: reference.tenantRole,
    tenantAuthorizationGeneration: reference.tenantAuthorizationGeneration,
    membershipAuthorizationGeneration: reference.membershipAuthorizationGeneration,
    authorizationAssignmentRevision: reference.authorizationAssignmentRevision,
  });
}

/** Opaque stable binding used inside signed profile-auth ceremony tokens. */
export function authContextAuthorityReferenceFingerprint(
  reference: AuthContextAuthorityReference,
): string {
  const hasher = new Bun.CryptoHasher('sha256');
  hasher.update(JSON.stringify([
    reference.version,
    reference.userId,
    reference.platformRole,
    reference.authGeneration,
    reference.sessionKind,
    reference.sessionId,
    reference.mfaVerifiedAt,
    reference.sessionGeneration,
    reference.clientId,
    reference.identityScopes,
    reference.sessionScopeKind,
    reference.sessionScopeId,
    reference.tenantId,
    reference.membershipId,
    reference.tenantKind,
    reference.tenantRole,
    reference.tenantAuthorizationGeneration,
    reference.membershipAuthorizationGeneration,
    reference.authorizationAssignmentRevision,
  ]));
  return hasher.digest('hex');
}

function compareKeys(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isNonEmptyText(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isNullableText(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

function isGeneration(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function isNullableGeneration(value: unknown): value is number | null {
  return value === null || isGeneration(value);
}

function isNullableTimestamp(value: unknown): value is number | null {
  return value === null || (Number.isSafeInteger(value) && Number(value) >= 0);
}
