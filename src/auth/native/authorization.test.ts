import { describe, expect, test } from 'bun:test';
import { NativeAuthorizationError } from './authorization-error';
import { parseNativeAuthorizationRequest } from './authorization';
import type { NativeAuthorizationErrorCode } from './types';

const CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';
const STATE = 'state-0123456789-abcdefghijklmnop';
const NONCE = 'nonce-0123456789-abcdefghijklmnop';

function validRequest(): URLSearchParams {
  return new URLSearchParams({
    response_type: 'code',
    client_id: 'desktop-app',
    redirect_uri: 'http://127.0.0.1:49152/oauth/callback',
    code_challenge: CHALLENGE,
    code_challenge_method: 'S256',
    state: STATE,
    nonce: NONCE,
    scope: 'openid profile email profile',
  });
}

function expectCode(
  params: URLSearchParams,
  code: NativeAuthorizationErrorCode
): void {
  try {
    parseNativeAuthorizationRequest(params);
    throw new Error('Expected native authorization parsing to fail.');
  } catch (error) {
    expect(error).toBeInstanceOf(NativeAuthorizationError);
    expect((error as NativeAuthorizationError).code).toBe(code);
  }
}

describe('parseNativeAuthorizationRequest', () => {
  test('parses a strict code, PKCE, and OIDC identity request', () => {
    const params = validRequest();
    expect(parseNativeAuthorizationRequest(params)).toEqual({
      responseType: 'code',
      clientId: 'desktop-app',
      redirectUri: 'http://127.0.0.1:49152/oauth/callback',
      codeChallenge: CHALLENGE,
      codeChallengeMethod: 'S256',
      state: STATE,
      nonce: NONCE,
      scopes: ['openid', 'profile', 'email'],
    });
  });

  test('rejects implicit flow and absent OpenID scope', () => {
    const implicit = validRequest();
    implicit.set('response_type', 'token');
    expectCode(implicit, 'unsupported_response_type');
    const scope = validRequest();
    scope.set('scope', 'profile');
    expectCode(scope, 'invalid_scope');
  });

  test('rejects non-S256 PKCE and weak transaction binding', () => {
    const plain = validRequest();
    plain.set('code_challenge_method', 'plain');
    expectCode(plain, 'invalid_request');
    const state = validRequest();
    state.set('state', 'short');
    expectCode(state, 'invalid_request');
  });

  test('rejects duplicate singleton, API scopes, and resource parameters', () => {
    const duplicate = validRequest();
    duplicate.append('client_id', 'attacker');
    expectCode(duplicate, 'invalid_request');
    const apiScope = validRequest();
    apiScope.set('scope', 'openid records:read');
    expectCode(apiScope, 'invalid_scope');
    const resource = validRequest();
    resource.set('resource', 'https://api.example.com');
    expectCode(resource, 'invalid_target');
  });
});
