import { NativeAuthorizationError } from './authorization-error';
import { isValidPkceS256Challenge } from './pkce';
import { classifyNativeRedirectUri } from './redirect-uri';
import type { NativeAuthorizationRequest, NativeIdentityScope } from './types';

const TRANSACTION_VALUE = /^[A-Za-z0-9._~-]{32,512}$/;
const CLIENT_ID = /^[A-Za-z0-9._~-]{1,128}$/;
const SCOPE_TOKEN = /^[\x21\x23-\x5B\x5D-\x7E]+$/;
const IDENTITY_SCOPES = new Set<NativeIdentityScope>(['openid', 'profile', 'email', 'phone', 'profile:write', 'contacts:write']);

export function parseNativeAuthorizationRequest(
  input: URL | URLSearchParams
): NativeAuthorizationRequest {
  const params = input instanceof URL ? input.searchParams : input;
  const responseType = required(params, 'response_type');
  if (responseType !== 'code') fail('unsupported_response_type', 'Only code is supported.');

  const clientId = required(params, 'client_id');
  if (!CLIENT_ID.test(clientId)) fail('invalid_request', 'client_id is malformed.');
  const redirectUri = required(params, 'redirect_uri');
  if (!classifyNativeRedirectUri(redirectUri)) {
    fail('invalid_request', 'redirect_uri is not a supported native URI.');
  }

  const codeChallenge = required(params, 'code_challenge');
  const method = required(params, 'code_challenge_method');
  if (method !== 'S256' || !isValidPkceS256Challenge(codeChallenge)) {
    fail('invalid_request', 'A valid S256 PKCE challenge is required.');
  }

  const state = transaction(params, 'state');
  const scopes = parseScopes(optional(params, 'scope'));
  if (!scopes.includes('openid')) fail('invalid_scope', 'openid scope is required.');
  if ((scopes.includes('profile:write') || scopes.includes('contacts:write')) && !scopes.includes('profile')) {
    fail('invalid_scope', 'profile:write requires profile scope.');
  }
  const nonce = transaction(params, 'nonce');
  const responseMode = optional(params, 'response_mode');
  if (responseMode && responseMode !== 'query') {
    fail('invalid_request', 'Only query response mode is supported.');
  }
  if (params.has('resource')) {
    fail('invalid_target', 'Resource audiences are not supported in native auth v1.');
  }

  return {
    responseType: 'code', clientId, redirectUri, codeChallenge,
    codeChallengeMethod: 'S256', state, nonce, scopes,
  };
}

function required(params: URLSearchParams, key: string): string {
  const value = optional(params, key);
  if (!value) fail('invalid_request', `${key} is required.`);
  return value;
}

function optional(params: URLSearchParams, key: string): string | undefined {
  const values = params.getAll(key);
  if (values.length > 1) fail('invalid_request', `${key} must appear once.`);
  const value = values[0];
  if (value !== undefined && (!value || value !== value.trim())) {
    fail('invalid_request', `${key} is malformed.`);
  }
  return value;
}

function transaction(params: URLSearchParams, key: string): string {
  const value = required(params, key);
  if (!TRANSACTION_VALUE.test(value)) fail('invalid_request', `${key} is malformed.`);
  return value;
}

function parseScopes(value: string | undefined): NativeIdentityScope[] {
  if (!value) return [];
  const scopes = value.split(' ');
  if (scopes.some((scope) =>
    !SCOPE_TOKEN.test(scope) || !IDENTITY_SCOPES.has(scope as NativeIdentityScope))) {
    fail('invalid_scope', 'Only the declared Guardian identity and explicit write scopes are supported.');
  }
  return [...new Set(scopes)] as NativeIdentityScope[];
}

function fail(code: ConstructorParameters<typeof NativeAuthorizationError>[0], message: string): never {
  throw new NativeAuthorizationError(code, message);
}
