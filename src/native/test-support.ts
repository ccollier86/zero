/** Deterministic in-process OIDC provider used by native SDK tests. */

import { exportJWK, generateKeyPair } from 'jose';
import { testClientId, testIssuer, testServerUrl } from './test-provider';
import {
  createNativeTestProvider,
  type NativeTestProviderState,
} from './test-harness-provider';
import { createZeroNativeAuth, type ZeroNativeAuthOptions } from './zero-native-auth';

const redirectUri = 'com.example.desktop:/oauth/callback';

export async function createNativeTestHarness(
  rejectInitialAccess = false, omitRefreshRotation = false, refreshFailureStatus = 0,
) {
  const keys = await generateKeyPair('ES256');
  const publicJwk = { ...await exportJWK(keys.publicKey), kid: 'test-key', use: 'sig', alg: 'ES256' };
  const vault = new Map<string, string>();
  const state: NativeTestProviderState = {
    authUrl: '', rejectInitialAccess, omitRefreshRotation, refreshFailureStatus,
    invalidRefreshIdToken: false, omitRefreshIdToken: false,
    invalidAuthorizationIdToken: false, subject: 'user-1', authorizationCalls: 0,
    refreshGate: null, enforceSingleUse: false, consumedRefreshTokens: new Set(),
    refreshCalls: 0, resourceCalls: 0, tokenBodies: [], revokedTokens: [],
  };
  const fetcher = createNativeTestProvider(keys.privateKey, publicJwk, state);
  let failSessionWrites = false;

  let callbackGate: Promise<void> | null = null;
  const clientOptions: ZeroNativeAuthOptions = {
    serverUrl: testServerUrl,
    clientId: testClientId,
    browser: { async open(url) { state.authUrl = url; } },
    callback: {
      async prepare() {
        return {
          redirectUri,
          async waitForCallback() {
            if (callbackGate) await callbackGate;
            const callbackState = new URL(state.authUrl).searchParams.get('state') ?? '';
            const callback = new URL(redirectUri);
            callback.searchParams.set('code', 'one-time-code');
            callback.searchParams.set('state', callbackState);
            callback.searchParams.set('iss', testIssuer);
            return callback.href;
          },
          async dispose() {},
        };
      },
    },
    secureStorage: {
      async get(key) { return vault.get(key) ?? null; },
      async set(key, value) {
        if (failSessionWrites && key.endsWith('.session.v1')) throw new Error('vault unavailable');
        vault.set(key, value);
      },
      async delete(key) { vault.delete(key); },
    },
    fetch: fetcher,
  };
  const auth = createZeroNativeAuth(clientOptions);
  return {
    auth,
    vault,
    tokenBodies: state.tokenBodies,
    revokedTokens: state.revokedTokens,
    authUrl: () => state.authUrl,
    refreshCalls: () => state.refreshCalls,
    resourceCalls: () => state.resourceCalls,
    setFailSessionWrites(value: boolean) { failSessionWrites = value; },
    setInvalidRefreshIdToken(value: boolean) { state.invalidRefreshIdToken = value; },
    setOmitRefreshIdToken(value: boolean) { state.omitRefreshIdToken = value; },
    setInvalidAuthorizationIdToken(value: boolean) {
      state.invalidAuthorizationIdToken = value;
    },
    setSubject(value: string) { state.subject = value; },
    setRefreshGate(value: Promise<void> | null) { state.refreshGate = value; },
    setCallbackGate(value: Promise<void> | null) { callbackGate = value; },
    setEnforceSingleUse(value: boolean) { state.enforceSingleUse = value; },
    createClient: (overrides: Partial<ZeroNativeAuthOptions> = {}) => createZeroNativeAuth({
      ...clientOptions, ...overrides,
    }),
  };
}
