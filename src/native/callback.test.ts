import { describe, expect, test } from 'bun:test';
import { validateAuthorizationCallback } from './callback';
import { NativeAuthError } from './errors';

const expected = {
  redirectUri: 'com.example.app:/oauth/callback?channel=desktop',
  state: 'expected-state',
  issuer: 'https://zero.example',
};

interface CallbackChange {
  state?: string;
  issuer?: string | null;
  path?: string;
}

describe('native authorization callback validation', () => {
  test('accepts one code bound to redirect, state, and response issuer', () => {
    const callback = new URL(expected.redirectUri);
    callback.searchParams.set('code', 'one-time-code');
    callback.searchParams.set('state', expected.state);
    callback.searchParams.set('iss', expected.issuer);
    expect(validateAuthorizationCallback(callback.href, expected)).toEqual({ code: 'one-time-code' });
  });

  test.each<[string, string, CallbackChange]>([
    ['wrong state', 'OIDC_STATE_MISMATCH', { state: 'attacker-state' }],
    ['missing issuer', 'OIDC_RESPONSE_ISS_MISMATCH', { issuer: null }],
    ['wrong issuer', 'OIDC_RESPONSE_ISS_MISMATCH', { issuer: 'https://attacker.example' }],
    ['wrong callback path', 'OIDC_REDIRECT_MISMATCH', { path: '/stolen' }],
  ])('rejects %s', (_name, code, change) => {
    const callback = new URL(expected.redirectUri);
    callback.searchParams.set('code', 'code');
    callback.searchParams.set('state', change.state ?? expected.state);
    if (change.issuer !== null) callback.searchParams.set('iss', change.issuer ?? expected.issuer);
    if (change.path) callback.pathname = change.path;
    expectCode(() => validateAuthorizationCallback(callback.href, expected), code);
  });

  test('rejects duplicate security parameters', () => {
    const callback = new URL(expected.redirectUri);
    callback.searchParams.append('state', expected.state);
    callback.searchParams.append('state', expected.state);
    callback.searchParams.set('iss', expected.issuer);
    callback.searchParams.set('code', 'code');
    expectCode(() => validateAuthorizationCallback(callback.href, expected), 'OIDC_CALLBACK_INVALID');
  });

  test('rejects duplicated fixed redirect parameters', () => {
    const callback = new URL(expected.redirectUri);
    callback.searchParams.append('channel', 'attacker');
    callback.searchParams.set('state', expected.state);
    callback.searchParams.set('iss', expected.issuer);
    callback.searchParams.set('code', 'code');
    expectCode(() => validateAuthorizationCallback(callback.href, expected), 'OIDC_REDIRECT_MISMATCH');
  });
});

function expectCode(action: () => unknown, code: string): void {
  try {
    action();
    throw new Error('expected callback rejection');
  } catch (error) {
    expect(error).toBeInstanceOf(NativeAuthError);
    expect((error as NativeAuthError).code).toBe(code);
  }
}
