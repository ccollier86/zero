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

function compareKeys(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
