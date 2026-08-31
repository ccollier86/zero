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
    fingerprint,
  ]);
  return new Bun.CryptoHasher('sha256').update(value).digest('hex');
}
