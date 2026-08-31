/** Public-client authorization-code, refresh, and revocation requests. */

import type { NativeFetch } from './adapter-types';
import { NativeAuthError } from './errors';
import type { NativeOidcMetadata, NativeTokenSet } from './oidc-types';

interface TokenClient {
  metadata: NativeOidcMetadata;
  clientId: string;
  fetch: NativeFetch;
}

/** Exchange a one-time authorization code without a client secret. */
export async function exchangeAuthorizationCode(
  client: TokenClient,
  input: { code: string; redirectUri: string; codeVerifier: string; signal?: AbortSignal },
): Promise<NativeTokenSet> {
  const tokens = await requestTokens(client, {
    grant_type: 'authorization_code',
    code: input.code,
    redirect_uri: input.redirectUri,
    code_verifier: input.codeVerifier,
    client_id: client.clientId,
  }, input.signal);
  if (!tokens.refreshToken) {
    throw new NativeAuthError('Token response omitted native session tokens.', 'OIDC_TOKEN_RESPONSE_INVALID');
  }
  return tokens;
}

/** Rotate a refresh token; Zero requires a replacement on every successful use. */
export async function refreshNativeTokens(
  client: TokenClient,
  refreshToken: string,
  signal?: AbortSignal,
): Promise<NativeTokenSet> {
  const tokens = await requestTokens(client, {
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: client.clientId,
  }, signal);
  if (!tokens.refreshToken) {
    throw new NativeAuthError('Refresh response omitted token rotation.', 'OIDC_REFRESH_ROTATION_MISSING');
  }
  return tokens;
}

async function requestTokens(
  client: TokenClient,
  params: Record<string, string>,
  signal?: AbortSignal,
): Promise<NativeTokenSet> {
  const response = await client.fetch(client.metadata.token_endpoint, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params),
    signal,
    cache: 'no-store',
    credentials: 'omit',
    redirect: 'error',
  });
  const body = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!response.ok) throw tokenEndpointError(body, response.status);
  if (!body || typeof body.access_token !== 'string' || !body.access_token
    || typeof body.expires_in !== 'number' || !Number.isFinite(body.expires_in)
    || body.expires_in <= 0 || String(body.token_type).toLowerCase() !== 'bearer') {
    throw new NativeAuthError('Token response was invalid.', 'OIDC_TOKEN_RESPONSE_INVALID');
  }
  return {
    accessToken: body.access_token,
    refreshToken: typeof body.refresh_token === 'string' ? body.refresh_token : '',
    idToken: typeof body.id_token === 'string' ? body.id_token : undefined,
    expiresIn: body.expires_in,
    scope: typeof body.scope === 'string' ? body.scope : undefined,
  };
}

function tokenEndpointError(body: Record<string, unknown> | null, status: number): NativeAuthError {
  const error = typeof body?.error === 'string' ? body.error : 'request_failed';
  const code = error.toUpperCase().replace(/[^A-Z0-9]+/g, '_').slice(0, 64);
  return new NativeAuthError('Token request failed.', `OIDC_TOKEN_${code}`, status);
}
