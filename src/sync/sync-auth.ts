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

  const verifier = auth.getTokenVerifier();
  try {
    // This check intentionally precedes the missing-token branch. An optional
    // anonymous socket is still using the managed Sync runtime's authority
    // policy and must not survive an installed-profile transition.
    verifier?.assertCurrentProfile?.();
  } catch {
    return authResolutionFailed();
  }

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

  if (!verifier) {
    return {
      ok: false,
      closeCode: 1011,
      reason: 'Auth not initialized',
    };
  }

  try {
    if (verifier.resolveAuthContext) {
      const authContext = await verifier.resolveAuthContext(token);
      verifier.assertCurrentProfile?.();
      return authContext
        ? { ok: true, authContext }
        : invalidTokenResolution();
    }

    // Compatibility for standalone sync integrations. Platform auth always
    // exposes resolveAuthContext so current account gates are enforced.
    const payload = await verifier.verifyAccessToken(token);
    verifier.assertCurrentProfile?.();
    if (
      !payload ||
      typeof payload.email !== 'string' ||
      typeof payload.role !== 'string'
    ) return invalidTokenResolution();

    return {
      ok: true,
      authContext: {
        userId: payload.sub,
        email: payload.email,
        role: payload.role,
      },
    };
  } catch {
    return authResolutionFailed();
  }
}

function authResolutionFailed(): SyncAuthResolution {
  return {
    ok: false,
    closeCode: 1011,
    reason: 'Auth resolution failed',
  };
}

function invalidTokenResolution(): SyncAuthResolution {
  return {
    ok: false,
    closeCode: 4001,
    reason: 'Invalid auth token',
  };
}
