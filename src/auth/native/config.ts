import { assertNativeRedirectUri } from './redirect-uri';
import { assertNativeIssuer } from './issuer';
import {
  duration,
  resolveNativeRefreshPolicy,
  resolveNativeRequestPolicy,
} from './policy-config';
import type {
  NativeAuthClientConfig,
  NativeAuthConfig,
  ResolvedNativeAuthClientConfig,
  ResolvedNativeAuthConfig,
} from './types';

const CLIENT_ID = /^[A-Za-z0-9._~-]{1,128}$/;
const IDENTITY_SCOPES = new Set(['openid', 'profile', 'email']);
const NATIVE_TTL_MAX = {
  requestTTL: 3_600_000,
  codeTTL: 600_000,
  refreshTokenTTL: 31_536_000_000,
} as const;

export function defineNativeAuthConfig<T extends NativeAuthConfig>(config: T): T {
  return config;
}

export function resolveNativeAuthConfig(
  config: NativeAuthConfig = {}
): ResolvedNativeAuthConfig {
  const clients = (config.clients ?? []).map(resolveClient);
  const ids = clients.map((client) => client.clientId);
  if (new Set(ids).size !== ids.length) fail('clientId values must be unique.');
  return {
    enabled: config.enabled ?? clients.length > 0,
    issuer: config.issuer === undefined ? undefined : assertNativeIssuer(config.issuer),
    requestTTL: validateTTL(config.requestTTL ?? '15m', 'requestTTL'),
    codeTTL: validateTTL(config.codeTTL ?? '3m', 'codeTTL'),
    refreshTokenTTL: validateTTL(config.refreshTokenTTL ?? '30d', 'refreshTokenTTL'),
    requestAdmission: resolveNativeRequestPolicy(config.requestAdmission),
    refreshRotation: resolveNativeRefreshPolicy(config.refreshRotation),
    clients,
  };
}

function resolveClient(client: NativeAuthClientConfig): ResolvedNativeAuthClientConfig {
  if (!CLIENT_ID.test(client.clientId)) fail('clientId is malformed.');
  if (!client.name.trim() || client.name !== client.name.trim()) fail('name is malformed.');
  const redirectUris = unique(client.redirectUris, 'redirectUris');
  if (redirectUris.length === 0) fail(`${client.clientId} needs a redirect URI.`);
  redirectUris.forEach(assertNativeRedirectUri);
  const scopes = unique(client.scopes ?? ['openid', 'profile', 'email'], 'scopes');
  if (!scopes.includes('openid')) fail(`${client.clientId} must allow openid.`);
  if (scopes.some((scope) => !IDENTITY_SCOPES.has(scope))) fail('scope is unsupported.');
  return { clientId: client.clientId, name: client.name, redirectUris, scopes };
}

function unique<T extends string>(values: readonly T[], label: string): T[] {
  if (values.some((value) => !value || value !== value.trim())) fail(`${label} is malformed.`);
  if (new Set(values).size !== values.length) fail(`${label} contains duplicates.`);
  return [...values];
}

function validateTTL(value: string, label: keyof typeof NATIVE_TTL_MAX): string {
  duration(value, label, NATIVE_TTL_MAX[label]);
  return value;
}

function fail(message: string): never {
  throw new Error(`[native-auth] ${message}`);
}
