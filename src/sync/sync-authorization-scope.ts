/**
 * sync-authorization-scope.ts
 *
 * Produces the opaque policy scope exchanged by the Sync restart handshake.
 * It hashes current identity and policy state; it never exposes raw policy data.
 */

import type { SyncAuthContext } from './types';

/** Return a stable scope hash, or null when the policy cannot be compared safely. */
export function createSyncAuthorizationScope(
  auth: SyncAuthContext | null,
  fingerprint: string | null,
): string | null {
  if (fingerprint === null) return null;
  const value = JSON.stringify([
    auth?.userId ?? null,
    auth?.email ?? null,
    auth?.role ?? null,
    auth?.clientId ?? null,
    auth?.sessionKind ?? null,
    auth?.scope ? [...auth.scope].sort(compareText) : null,
    auth?.sessionId ?? null,
    auth?.sessionGeneration ?? null,
    auth?.sessionScopeKind ?? null,
    auth?.sessionScopeId ?? null,
    auth?.tenantId ?? null,
    auth?.membershipId ?? null,
    auth?.tenantRole ?? null,
    auth?.tenantAuthorizationGeneration ?? null,
    auth?.membershipAuthorizationGeneration ?? null,
    auth?.authorizationAssignmentRevision ?? null,
    fingerprint,
  ]);
  return new Bun.CryptoHasher('sha256').update(value).digest('hex');
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
