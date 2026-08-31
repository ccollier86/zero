/** Resolve only pre-validated callback targets for OAuth authorization errors. */

import { findRegisteredNativeRedirectUri } from '../native';
import type { NativeAuthorizationRequestRecord } from './native-auth-records';
import type { NativeServiceContext } from './native-service-context';

export interface NativeAuthorizationErrorTarget {
  redirectUri: string;
  state: string;
}

export function authorizationErrorTarget(
  context: NativeServiceContext,
  url: URL,
  rawRequestId?: string | null,
): NativeAuthorizationErrorTarget | null {
  if (rawRequestId) {
    const request = context.requests.get(rawRequestId);
    return request && request.consumedAt === null ? fromRequest(request) : null;
  }

  const clientId = single(url.searchParams, 'client_id');
  const redirectUri = single(url.searchParams, 'redirect_uri');
  const state = single(url.searchParams, 'state');
  if (!clientId || !redirectUri || !validState(state)) return null;
  const client = context.config.native.clients.find((item) => item.clientId === clientId);
  if (!client || !findRegisteredNativeRedirectUri(redirectUri, client.redirectUris)) return null;
  return { redirectUri, state };
}

function fromRequest(request: NativeAuthorizationRequestRecord): NativeAuthorizationErrorTarget {
  return { redirectUri: request.redirectUri, state: request.state };
}

function single(params: URLSearchParams, name: string): string | null {
  const values = params.getAll(name);
  return values.length === 1 && values[0] ? values[0] : null;
}

function validState(value: string | null): value is string {
  return Boolean(value && /^[A-Za-z0-9._~-]{32,512}$/.test(value));
}
