/** Comparable, secret-free fingerprint of live request authority. */

import type { AuthContext } from './types';

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
    context.sessionGeneration ?? null,
    context.sessionScopeKind ?? null,
    context.sessionScopeId ?? null,
    context.tenantId ?? null,
    context.membershipId ?? null,
    context.tenantRole ?? null,
    context.tenantAuthorizationGeneration ?? null,
    context.membershipAuthorizationGeneration ?? null,
    context.authorizationAssignmentRevision ?? null,
    Object.entries(properties).sort(([left], [right]) => compareKeys(left, right)),
  ]);
}

function compareKeys(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
