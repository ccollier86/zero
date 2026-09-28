/** Public-client authorization-code, refresh, and revocation requests. */

import type { NativeFetch } from './adapter-types';
import { NativeAuthError } from './errors';
import type { NativeOidcMetadata, NativeTokenSet } from './oidc-types';
import type { NativeTenantListResult, NativeTenantSummary } from './client-types';

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

/** List live tenant choices using the broker-held rotating refresh proof. */
export async function listNativeTenants(
  client: TokenClient,
  refreshToken: string,
  signal?: AbortSignal,
): Promise<NativeTenantListResult> {
  const capability = requireTenantCapability(client.metadata);
  const response = await requestForm(client, capability.list_endpoint, {
    refresh_token: refreshToken,
    client_id: client.clientId,
  }, signal);
  const body = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!response.ok) throw tokenEndpointError(body, response.status);
  if (!body || (body.activeTenantId !== null && typeof body.activeTenantId !== 'string')
    || !Array.isArray(body.tenants)) {
    throw new NativeAuthError('Tenant list response was invalid.', 'OIDC_TENANT_RESPONSE_INVALID');
  }
  const tenants = body.tenants.map(parseTenantSummary);
  if (tenants.some((tenant) => tenant === null)) {
    throw new NativeAuthError('Tenant list response was invalid.', 'OIDC_TENANT_RESPONSE_INVALID');
  }
  return {
    activeTenantId: body.activeTenantId as string | null,
    tenants: tenants as NativeTenantSummary[],
  };
}

/** Atomically replace the current native refresh family with a tenant-bound one. */
export async function switchNativeTenant(
  client: TokenClient,
  refreshToken: string,
  tenantId: string,
  signal?: AbortSignal,
): Promise<NativeTokenSet> {
  const capability = requireTenantCapability(client.metadata);
  return requestTokens(client, {
    refresh_token: refreshToken,
    client_id: client.clientId,
    tenant_id: tenantId,
  }, signal, capability.switch_endpoint);
}

async function requestTokens(
  client: TokenClient,
  params: Record<string, string>,
  signal?: AbortSignal,
  endpoint = client.metadata.token_endpoint,
): Promise<NativeTokenSet> {
  const response = await requestForm(client, endpoint, params, signal);
  const body = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!response.ok) throw tokenEndpointError(body, response.status);
  if (!body || typeof body.access_token !== 'string' || !body.access_token
    || typeof body.expires_in !== 'number' || !Number.isFinite(body.expires_in)
    || body.expires_in <= 0 || String(body.token_type).toLowerCase() !== 'bearer') {
    throw new NativeAuthError('Token response was invalid.', 'OIDC_TOKEN_RESPONSE_INVALID');
  }
  const activeTenant = body.active_tenant === undefined
    ? null
    : parseTenantSummary(body.active_tenant);
  if (body.active_tenant !== undefined && !activeTenant) {
    throw new NativeAuthError('Token tenant response was invalid.', 'OIDC_TENANT_RESPONSE_INVALID');
  }
  return {
    accessToken: body.access_token,
    refreshToken: typeof body.refresh_token === 'string' ? body.refresh_token : '',
    idToken: typeof body.id_token === 'string' ? body.id_token : undefined,
    expiresIn: body.expires_in,
    scope: typeof body.scope === 'string' ? body.scope : undefined,
    activeTenant,
  };
}

function requestForm(
  client: TokenClient,
  endpoint: string,
  params: Record<string, string>,
  signal?: AbortSignal,
): Promise<Response> {
  return client.fetch(endpoint, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params),
    signal,
    cache: 'no-store',
    credentials: 'omit',
    redirect: 'error',
  });
}

function requireTenantCapability(metadata: NativeOidcMetadata) {
  if (!metadata.zero_tenant_sessions) {
    throw new NativeAuthError(
      'The issuer does not support native tenant sessions.',
      'OIDC_TENANT_SESSIONS_UNSUPPORTED',
    );
  }
  return metadata.zero_tenant_sessions;
}

function parseTenantSummary(value: unknown): NativeTenantSummary | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const tenant = value as Record<string, unknown>;
  if (typeof tenant.tenantId !== 'string' || !tenant.tenantId || tenant.tenantId.length > 200
    || typeof tenant.slug !== 'string' || !tenant.slug || tenant.slug.length > 200
    || typeof tenant.name !== 'string' || !tenant.name || tenant.name.length > 500
    || (tenant.role !== null && typeof tenant.role !== 'string')) return null;
  return {
    tenantId: tenant.tenantId,
    slug: tenant.slug,
    name: tenant.name,
    role: tenant.role as string | null,
  };
}

function tokenEndpointError(body: Record<string, unknown> | null, status: number): NativeAuthError {
  const error = typeof body?.error === 'string' ? body.error : 'request_failed';
  const code = error.toUpperCase().replace(/[^A-Z0-9]+/g, '_').slice(0, 64);
  return new NativeAuthError('Token request failed.', `OIDC_TOKEN_${code}`, status);
}
