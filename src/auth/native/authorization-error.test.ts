import { describe, expect, test } from 'bun:test';
import {
  NativeAuthorizationError,
  parseNativeAuthorizationError,
  toNativeAuthorizationErrorParams,
} from './authorization-error';

describe('native authorization errors', () => {
  test('serializes a safe OAuth error with transaction binding', () => {
    const error = new NativeAuthorizationError(
      'invalid_request',
      'A valid S256 PKCE challenge is required.'
    );
    expect(Object.fromEntries(toNativeAuthorizationErrorParams(error, {
      state: 'state-value',
      issuer: 'https://auth.example.com',
    }))).toEqual({
      error: 'invalid_request',
      error_description: 'A valid S256 PKCE challenge is required.',
      state: 'state-value',
      iss: 'https://auth.example.com',
    });
  });

  test('parses known errors and drops unsafe optional fields', () => {
    const params = new URLSearchParams({
      error: 'access_denied',
      error_description: 'The user declined.',
      error_uri: 'javascript:alert(1)',
      state: 'state-value',
      iss: 'https://auth.example.com',
    });
    expect(parseNativeAuthorizationError(params)).toEqual({
      error: 'access_denied',
      errorDescription: 'The user declined.',
      errorUri: undefined,
      state: 'state-value',
      issuer: 'https://auth.example.com',
    });
  });

  test('accepts a loopback development issuer', () => {
    const params = new URLSearchParams({
      error: 'access_denied',
      iss: 'http://127.0.0.1:3000',
    });
    expect(parseNativeAuthorizationError(params)?.issuer)
      .toBe('http://127.0.0.1:3000');
  });

  test('rejects unknown and duplicated error codes', () => {
    expect(parseNativeAuthorizationError(
      new URLSearchParams({ error: 'custom_error' })
    )).toBeNull();
    const duplicate = new URLSearchParams({ error: 'access_denied' });
    duplicate.append('error', 'server_error');
    expect(parseNativeAuthorizationError(duplicate)).toBeNull();
    const duplicateState = new URLSearchParams({
      error: 'access_denied', state: 'expected',
    });
    duplicateState.append('state', 'attacker');
    expect(parseNativeAuthorizationError(duplicateState)).toBeNull();
  });
});
