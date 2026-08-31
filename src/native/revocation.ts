/** RFC 7009 native refresh-token revocation. */

import type { NativeFetch } from './adapter-types';
import { NativeAuthError } from './errors';
import type { NativeOidcMetadata } from './oidc-types';

/** Revoke when advertised; local session deletion remains authoritative. */
export async function revokeNativeRefreshToken(
  client: { metadata: NativeOidcMetadata; clientId: string; fetch: NativeFetch },
  refreshToken: string,
  signal?: AbortSignal,
): Promise<void> {
  if (!client.metadata.revocation_endpoint) return;
  const body = new URLSearchParams({
    token: refreshToken,
    token_type_hint: 'refresh_token',
    client_id: client.clientId,
  });
  const response = await client.fetch(client.metadata.revocation_endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    cache: 'no-store',
    credentials: 'omit',
    redirect: 'error',
    signal,
  });
  if (!response.ok) {
    throw new NativeAuthError(
      'Session revocation failed.',
      'OIDC_REVOCATION_FAILED',
      response.status,
    );
  }
}
