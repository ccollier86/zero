/** Authenticated readiness route for the request's server-derived data realm. */

import { Elysia } from 'elysia';
import {
  isDatabaseError,
  normalizeDatabaseError,
} from '../databases/database-error';
import { extractAuthContext } from './auth-context';
import {
  DataRealmReadinessContractError,
  parseDataRealmReadinessSnapshot,
  type DataRealmReadinessSnapshot,
} from './data-realm-readiness-types';
import { applyAuthPrivateNoStore } from './auth-response-cache';
import { IdentityProjectionError } from './identity-projection-error';
import type { TokenService } from './token-service';
import { AuthError, type AuthContext } from './types';

export interface DataRealmReadinessRequest {
  /** Live Guardian authority derived from the request credential. */
  readonly auth: AuthContext;
  readonly signal: AbortSignal;
}

/**
 * Narrow adapter implemented by the system/app-plane composition root.
 * Implementations resolve the target exclusively from `auth`; neither route
 * accepts a tenant, target, database, or path supplied by the caller.
 */
export interface DataRealmReadinessService {
  inspect(request: DataRealmReadinessRequest):
    | DataRealmReadinessSnapshot
    | Promise<DataRealmReadinessSnapshot>;
  retry(request: DataRealmReadinessRequest):
    | DataRealmReadinessSnapshot
    | Promise<DataRealmReadinessSnapshot>;
}

export interface DataRealmReadinessPluginConfig {
  getTokenService(): TokenService | null;
  getReadinessService(): DataRealmReadinessService | null;
}

/**
 * Mount inside the `/auth` plugin, before its namespace catch-all.
 *
 * Resulting routes:
 * - `GET /auth/data-realm/readiness`
 * - `POST /auth/data-realm/readiness/retry`
 */
export function createDataRealmReadinessPlugin(
  config: DataRealmReadinessPluginConfig,
) {
  return new Elysia({
    name: 'auth-data-realm-readiness',
    prefix: '/data-realm',
  })
    .get('/readiness', async ({ request, set }) => {
      applyAuthPrivateNoStore(set);
      return runDataRealmReadinessOperation(config, request, 'inspect');
    })
    .post('/readiness/retry', async ({ request, set }) => {
      applyAuthPrivateNoStore(set);
      return runDataRealmReadinessOperation(config, request, 'retry');
    });
}

async function runDataRealmReadinessOperation(
  config: DataRealmReadinessPluginConfig,
  request: Request,
  operation: 'inspect' | 'retry',
): Promise<DataRealmReadinessSnapshot> {
  const tokenService = config.getTokenService();
  const readinessService = config.getReadinessService();
  if (!tokenService || !readinessService) {
    throw new AuthError('Auth not initialized', 'AUTH_NOT_READY', 503);
  }

  const auth = await extractAuthContext(request, tokenService);
  if (!auth) throw new AuthError('Unauthorized', 'UNAUTHORIZED', 401);

  try {
    const readiness = await readinessService[operation]({
      auth,
      signal: request.signal,
    });
    return parseDataRealmReadinessSnapshot(readiness);
  } catch (cause) {
    if (cause instanceof AuthError) throw cause;
    if (cause instanceof DataRealmReadinessContractError) {
      throw new AuthError(
        'Data realm readiness is unavailable',
        'DATA_REALM_READINESS_INVALID',
        500,
      );
    }
    if (cause instanceof IdentityProjectionError) {
      throw dataRealmAvailabilityError(cause.retryable);
    }
    if (isDatabaseError(cause)) {
      throw dataRealmAvailabilityError(normalizeDatabaseError(cause).retryable);
    }
    throw cause;
  }
}

function dataRealmAvailabilityError(retryable: boolean): AuthError {
  return new AuthError(
    retryable ? 'Data realm is not ready' : 'Data realm is unavailable',
    retryable ? 'DATA_REALM_NOT_READY' : 'DATA_REALM_UNAVAILABLE',
    503,
  );
}
