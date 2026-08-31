/** Mutable test provider used by native SDK integration fixtures. */

import type { JWK } from 'jose';
import type { NativeFetch } from './adapter-types';
import {
  signTestIdToken, testIssuer, testJson, testMetadata, testServerUrl, testTokenResponse,
} from './test-provider';

export interface NativeTestProviderState {
  authUrl: string;
  rejectInitialAccess: boolean;
  omitRefreshRotation: boolean;
  refreshFailureStatus: number;
  invalidRefreshIdToken: boolean;
  omitRefreshIdToken: boolean;
  invalidAuthorizationIdToken: boolean;
  subject: string;
  authorizationCalls: number;
  refreshGate: Promise<void> | null;
  enforceSingleUse: boolean;
  consumedRefreshTokens: Set<string>;
  refreshCalls: number;
  resourceCalls: number;
  tokenBodies: URLSearchParams[];
  revokedTokens: string[];
}

export function createNativeTestProvider(
  key: CryptoKey,
  publicJwk: JWK,
  state: NativeTestProviderState,
): NativeFetch {
  return async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.endsWith('/.well-known/openid-configuration')) return testJson(testMetadata());
    if (url === `${testIssuer}/jwks`) return testJson({ keys: [publicJwk] });
    if (url === `${testIssuer}/token`) return tokenResponse(key, state, init);
    if (url === `${testIssuer}/revoke`) {
      state.revokedTokens.push(new URLSearchParams(String(init?.body ?? '')).get('token') ?? '');
      return new Response(null, { status: 200 });
    }
    if (url === `${testServerUrl}/api/private`) {
      state.resourceCalls += 1;
      const requestHeaders = input instanceof Request ? input.headers : undefined;
      const authorization = new Headers(init?.headers ?? requestHeaders).get('Authorization');
      if (state.rejectInitialAccess && authorization === 'Bearer access-initial') {
        return new Response(null, { status: 401 });
      }
      return testJson({ authorization });
    }
    return new Response(null, { status: 404 });
  };
}

async function tokenResponse(
  key: CryptoKey,
  state: NativeTestProviderState,
  init?: RequestInit,
): Promise<Response> {
  const body = new URLSearchParams(String(init?.body ?? ''));
  state.tokenBodies.push(body);
  if (body.get('grant_type') === 'refresh_token') {
    state.refreshCalls += 1;
    const refreshToken = body.get('refresh_token') ?? '';
    if (state.enforceSingleUse && state.consumedRefreshTokens.has(refreshToken)) {
      return testJson({ error: 'invalid_grant' }, 400);
    }
    state.consumedRefreshTokens.add(refreshToken);
    if (state.refreshGate) await state.refreshGate;
    await new Promise((resolve) => setTimeout(resolve, 5));
    if (state.refreshFailureStatus) {
      return testJson({ error: 'temporarily_unavailable' }, state.refreshFailureStatus);
    }
    if (state.omitRefreshRotation) {
      return testJson({ access_token: 'access-rotated', expires_in: 3600, token_type: 'Bearer' });
    }
    const idToken = state.omitRefreshIdToken
      ? undefined
      : state.invalidRefreshIdToken
        ? 'invalid.id.token'
        : await signTestIdToken(key, undefined, state.subject);
    return testJson(testTokenResponse('access-rotated', 'refresh-rotated', idToken));
  }
  const nonce = new URL(state.authUrl).searchParams.get('nonce') ?? '';
  state.authorizationCalls += 1;
  const suffix = state.authorizationCalls === 1 ? '' : `-${state.authorizationCalls}`;
  return testJson(testTokenResponse(
    `access-initial${suffix}`,
    `refresh-initial${suffix}`,
    state.invalidAuthorizationIdToken
      ? 'invalid.id.token'
      : await signTestIdToken(key, nonce, state.subject),
  ));
}
