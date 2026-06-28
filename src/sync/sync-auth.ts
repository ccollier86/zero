/**
 * sync-auth.ts
 *
 * Resolves authentication for sync WebSocket connections. This file owns the
 * sync-layer auth contract only; token issuance, token storage, and HTTP auth
 * middleware remain owned by the auth module.
 */

import type { SyncAuthConfig, SyncAuthContext } from './types';

/**
 * Result of resolving a sync WebSocket token.
 */
export type SyncAuthResolution =
  | { ok: true; authContext: SyncAuthContext | null }
  | { ok: false; closeCode: number; reason: string };

/**
 * Verify an optional WebSocket token against the configured sync auth bridge.
 *
 * Missing auth config keeps standalone sync mode anonymous. Missing tokens are
 * allowed unless `auth.required` is true; invalid provided tokens always fail
 * closed because they indicate an attempted authenticated connection.
 */
export async function resolveSyncAuthContext(
  token: string | undefined,
  auth?: SyncAuthConfig
): Promise<SyncAuthResolution> {
  if (!auth) return { ok: true, authContext: null };

  if (!token) {
    if (auth.required) {
      return {
        ok: false,
        closeCode: 4001,
        reason: 'Auth token required',
      };
    }

    return { ok: true, authContext: null };
  }

  const verifier = auth.getTokenVerifier();
  if (!verifier) {
    return {
      ok: false,
      closeCode: 1011,
      reason: 'Auth not initialized',
    };
  }

  const payload = await verifier.verifyAccessToken(token);
  if (!payload) {
    return {
      ok: false,
      closeCode: 4001,
      reason: 'Invalid auth token',
    };
  }

  return {
    ok: true,
    authContext: {
      userId: payload.sub,
      email: payload.email,
      role: payload.role,
    },
  };
}
