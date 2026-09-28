/** Strict OpenID Provider discovery for Zero native clients. */

import type { NativeFetch } from './adapter-types';
import { NativeAuthError } from './errors';
import type { NativeOidcMetadata } from './oidc-types';

/** Fetch and validate the issuer-bound OpenID Provider configuration. */
export async function discoverNativeOidc(
  issuer: string,
  fetcher: NativeFetch,
  signal?: AbortSignal,
): Promise<NativeOidcMetadata> {
  const response = await fetcher(`${issuer}/.well-known/openid-configuration`, {
    headers: { Accept: 'application/json' },
    cache: 'no-store',
    credentials: 'omit',
    redirect: 'error',
    signal,
  });
  if (!response.ok) {
    throw new NativeAuthError('OpenID discovery failed.', 'OIDC_DISCOVERY_FAILED', response.status);
  }

  const metadata = await response.json().catch(() => null) as NativeOidcMetadata | null;
  if (!metadata || metadata.issuer !== issuer) {
    throw new NativeAuthError('OpenID discovery returned a different issuer.', 'OIDC_ISSUER_MISMATCH');
  }
  const origin = new URL(issuer).origin;
  requireUrl(metadata.authorization_endpoint, 'authorization_endpoint', origin);
  requireUrl(metadata.token_endpoint, 'token_endpoint', origin);
  requireUrl(metadata.jwks_uri, 'jwks_uri', origin);
  if (metadata.revocation_endpoint) {
    requireUrl(metadata.revocation_endpoint, 'revocation_endpoint', origin);
  }
  if (metadata.userinfo_endpoint) {
    requireUrl(metadata.userinfo_endpoint, 'userinfo_endpoint', origin);
  }
  if (metadata.zero_tenant_sessions !== undefined) {
    const capability = metadata.zero_tenant_sessions;
    if (capability.version !== 1 || capability.proof !== 'refresh_token') {
      throw new NativeAuthError(
        'OpenID discovery has an unsupported tenant-session capability.',
        'OIDC_TENANT_SESSIONS_UNSUPPORTED',
      );
    }
    requireUrl(capability.list_endpoint, 'zero_tenant_sessions.list_endpoint', origin);
    requireUrl(capability.switch_endpoint, 'zero_tenant_sessions.switch_endpoint', origin);
  }
  if (!metadata.response_types_supported?.includes('code')) {
    throw new NativeAuthError('The issuer does not advertise the code flow.', 'OIDC_CODE_FLOW_UNSUPPORTED');
  }
  if (!metadata.grant_types_supported?.includes('authorization_code')
    || !metadata.grant_types_supported.includes('refresh_token')) {
    throw new NativeAuthError('The issuer does not advertise refreshable code grants.', 'OIDC_GRANT_UNSUPPORTED');
  }
  if (!metadata.scopes_supported?.includes('openid')) {
    throw new NativeAuthError('The issuer does not advertise the openid scope.', 'OIDC_OPENID_UNSUPPORTED');
  }
  if (!metadata.code_challenge_methods_supported?.includes('S256')) {
    throw new NativeAuthError('The issuer does not advertise PKCE S256.', 'OIDC_PKCE_UNSUPPORTED');
  }
  if (!metadata.id_token_signing_alg_values_supported?.includes('ES256')) {
    throw new NativeAuthError('The issuer does not advertise ES256 ID tokens.', 'OIDC_ES256_UNSUPPORTED');
  }
  if (!metadata.token_endpoint_auth_methods_supported?.includes('none')) {
    throw new NativeAuthError('The issuer does not support public native clients.', 'OIDC_PUBLIC_CLIENT_UNSUPPORTED');
  }
  if (metadata.authorization_response_iss_parameter_supported !== true) {
    throw new NativeAuthError('The issuer does not support authorization response iss.', 'OIDC_RESPONSE_ISS_UNSUPPORTED');
  }
  return metadata;
}

function requireUrl(value: string | undefined, field: string, origin: string): void {
  try {
    if (!value) throw new Error('missing');
    const url = new URL(value);
    const loopback = url.protocol === 'http:'
      && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if ((url.protocol !== 'https:' && !loopback) || url.origin !== origin
      || url.username || url.password || url.hash) {
      throw new Error('unsafe');
    }
  } catch {
    throw new NativeAuthError(`OpenID discovery has an invalid ${field}.`, 'OIDC_DISCOVERY_INVALID');
  }
}
