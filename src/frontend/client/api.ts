/**
 * api.ts
 *
 * Eden Treaty typed API client. Provides auto-authenticated access
 * to all server routes with the unwrap() helper for clean error handling.
 *
 * Auth headers are owned by authClient.fetchWithAuth so every request has a
 * single bearer value and 401 → refresh → retry can replace it safely.
 *
 * Route types are inferred from the server's App type when possible.
 * For dynamically composed plugin routes (rooms, workflows, etc.),
 * use the route helper for typed access.
 *
 * Usage:
 * ```ts
 * // Via route helpers (typed)
 * const { room } = unwrap(await client.api.rooms.post({ name: 'Room' }));
 *
 * // Direct property access
 * const { data } = await client.api.auth.me.get();
 * ```
 */

import { treaty } from '@elysiajs/eden';
import type { App } from '../server/app-factory';
import type { AuthClient } from './auth-client';

// ─── Types ──────────────────────────────────────────────────────────────────

/**
 * Eden Treaty client. Due to Elysia's plugin composition model,
 * dynamically-composed routes resolve to index signatures at the type level.
 * Use unwrap() for clean error handling on all calls.
 */
// biome-ignore lint/suspicious/noExplicitAny: Eden Treaty requires generic any for dynamic plugin route access
export type Api = ReturnType<typeof treaty<App>> & Record<string, any>;

/** Structured error preserved from a Zero HTTP response. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly code: string | null,
    readonly body: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

// ─── Factory ────────────────────────────────────────────────────────────────

/**
 * Create an Eden Treaty client wired to the AuthClient when auth is enabled.
 *
 * - Custom fetcher owns bearer injection and 401 auto-retry when auth is available
 * - Falls back to plain fetch for auth-disabled apps
 */
export function createApi(serverUrl: string, authClient: AuthClient | null): Api {
  return treaty<App>(serverUrl, {
    fetcher: ((input: any, init?: any) => {
      const url = typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
      return authClient ? authClient.fetchWithAuth(url, init) : fetch(url, init);
    }) as typeof fetch,
  }) as Api;
}

// ─── Unwrap Helper ──────────────────────────────────────────────────────────

/**
 * Unwrap an Eden Treaty response — throws on error, returns data on success.
 *
 * Eden returns `{ data, error }` discriminated unions. This helper extracts
 * the success value or throws a descriptive error.
 *
 * @example
 * ```ts
 * const room = unwrap(await client.api.rooms.post({ name: 'Game Room' }));
 * // room is typed — no null check needed
 * ```
 */
export function unwrap<T>(
  result: { data: T; error: null } | { data: null; error: unknown },
): T {
  if (result.error !== null && result.error !== undefined) {
    const err = result.error;
    if (typeof err === 'object' && err !== null && 'value' in err) {
      const record = err as Record<string, unknown>;
      const body = record.value;
      const status = typeof record.status === 'number' ? record.status : null;
      if (body && typeof body === 'object') {
        const response = body as Record<string, unknown>;
        const message = typeof response.error === 'string'
          ? response.error
          : 'API request failed';
        const code = typeof response.code === 'string' ? response.code : null;
        throw new ApiError(message, status, code, body);
      }
      throw new ApiError(String(body), status, null, body);
    }
    throw new ApiError(String(err), null, null, err);
  }
  return result.data as T;
}
