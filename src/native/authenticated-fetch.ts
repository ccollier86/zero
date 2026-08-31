/** Bearer-authenticated requests with proactive refresh and one 401 retry. */

import type { NativeFetch } from './adapter-types';
import { NativeAuthError } from './errors';

export interface NativeAccessSession {
  accessToken(): Promise<string | null>;
  refreshAfterUnauthorized(previousToken: string): Promise<string | null>;
}

/** Create a credential-safe fetch bound to the issuer's origin. */
export function createAuthenticatedFetch(
  issuer: string,
  fetcher: NativeFetch,
  sessions: NativeAccessSession,
): NativeFetch {
  const issuerOrigin = new URL(issuer).origin;
  return async (input, init) => {
    const request = createRequest(input, init, issuer);
    if (new URL(request.url).origin !== issuerOrigin) {
      throw new NativeAuthError(
        'Authenticated requests must target the Zero issuer origin.',
        'NATIVE_REQUEST_ORIGIN_MISMATCH',
      );
    }

    const token = await sessions.accessToken();
    if (!token) throw new NativeAuthError('Authentication is required.', 'NATIVE_NOT_AUTHENTICATED');
    let response = await send(fetcher, request, token);
    if (response.status === 401) {
      const refreshed = await sessions.refreshAfterUnauthorized(token);
      if (!refreshed) {
        throw new NativeAuthError('Authentication is required.', 'NATIVE_NOT_AUTHENTICATED');
      }
      response = await send(fetcher, request, refreshed);
    }
    return response;
  };
}

function createRequest(input: RequestInfo | URL, init: RequestInit | undefined, issuer: string): Request {
  if (input instanceof Request) return new Request(input, init);
  const target = input instanceof URL ? input : new URL(input, `${issuer}/`);
  return new Request(target, init);
}

function send(fetcher: NativeFetch, request: Request, token: string): Promise<Response> {
  const attempt = request.clone();
  const headers = new Headers(attempt.headers);
  headers.set('Authorization', `Bearer ${token}`);
  return fetcher(attempt, {
    headers,
    redirect: 'manual',
    credentials: 'omit',
  });
}
