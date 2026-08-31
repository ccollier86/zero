import { describe, expect, test } from 'bun:test';
import { assertNativeRedirectUri } from './redirect-uri';

describe('native SDK redirect policy', () => {
  test('matches the provider redirect shapes locally', () => {
    for (const value of [
      'http://127.0.0.1:49152/oauth/callback',
      'http://[::1]:49152/oauth/callback',
      'https://mobile.example.com/oauth/callback',
      'com.example.mobile:/oauth/callback',
    ]) expect(() => assertNativeRedirectUri(value)).not.toThrow();

    for (const value of [
      'http://localhost:49152/callback',
      'https://127.0.0.1/callback',
      'mailto:user@example.com',
      'foo://app/callback',
      'com.example.mobile:/oauth/callback?state=injected',
      'https://mobile.example.com\\@attacker.example/callback',
      'https://mobile.example.com/oauth/\ncallback',
      'com.example.mobile:/oauth/\u007fcallback',
    ]) expect(() => assertNativeRedirectUri(value)).toThrow('registered claimed HTTPS');
  });
});
