import { describe, expect, test } from 'bun:test';
import {
  assertNativeRedirectUri,
  classifyNativeRedirectUri,
  findRegisteredNativeRedirectUri,
  matchesRegisteredNativeRedirectUri,
} from './redirect-uri';

describe('native redirect URI validation', () => {
  test('allows only a loopback IP port to vary', () => {
    const registered = 'http://127.0.0.1/oauth/callback?channel=desktop';
    const requested = 'http://127.0.0.1:49152/oauth/callback?channel=desktop';
    expect(classifyNativeRedirectUri(requested)).toBe('loopback');
    expect(matchesRegisteredNativeRedirectUri(requested, registered)).toBe(true);
    expect(matchesRegisteredNativeRedirectUri(
      'http://127.0.0.1:49152/oauth/other?channel=desktop', registered
    )).toBe(false);
    expect(matchesRegisteredNativeRedirectUri(
      'http://[::1]:49152/oauth/callback?channel=desktop', registered
    )).toBe(false);
  });

  test('supports separately registered IPv6 loopback redirects', () => {
    const registered = 'http://[::1]/oauth/callback';
    const requested = 'http://[::1]:61023/oauth/callback';
    expect(matchesRegisteredNativeRedirectUri(requested, registered)).toBe(true);
    expect(findRegisteredNativeRedirectUri(requested, [registered])).toBe(registered);
  });

  test('rejects localhost, non-loopback IPs, fragments, and credentials', () => {
    for (const value of [
      'http://localhost:49152/oauth/callback',
      'http://127.0.0.2:49152/oauth/callback',
      'http://user@127.0.0.1:49152/oauth/callback',
      'http://127.0.0.1:49152/oauth/callback#fragment',
      'http://127.0.0.1:49152/oauth/callback#',
      'http://127.0.0.1:0/oauth/callback',
    ]) expect(() => assertNativeRedirectUri(value)).toThrow('Invalid native redirect');
  });

  test('rejects callback response injection and duplicate query keys', () => {
    for (const value of [
      'https://desktop.example.com/callback?code=injected',
      'com.example.desktop:/callback?state=injected',
      'http://127.0.0.1/callback?channel=a&channel=b',
      'https://desktop.example.com/callback?%65rror=injected',
      'https://desktop.example.com/callback?error_uri=injected',
      'https://desktop.example.com/callback?',
    ]) expect(classifyNativeRedirectUri(value)).toBeNull();
  });

  test('rejects characters that URL parsing can strip or normalize', () => {
    for (const value of [
      'https://desktop.example.com/oauth\\callback',
      'https://desktop.example.com/oauth/\ncallback',
      'http://127.0.0.1/oauth/\tcallback',
      'com.example.desktop:/oauth/\u0000callback',
      'com.example.desktop:/oauth/\u007fcallback',
    ]) expect(classifyNativeRedirectUri(value)).toBeNull();
  });

  test('requires exact claimed HTTPS redirects on a DNS host', () => {
    const registered = 'https://desktop.example.com/oauth/callback';
    expect(classifyNativeRedirectUri(registered)).toBe('claimed-https');
    expect(matchesRegisteredNativeRedirectUri(registered, registered)).toBe(true);
    expect(matchesRegisteredNativeRedirectUri(`${registered}/`, registered)).toBe(false);
    expect(classifyNativeRedirectUri('https://127.0.0.1/oauth/callback')).toBeNull();
    expect(classifyNativeRedirectUri('https://bad_host.example.com/callback')).toBeNull();
  });

  test('requires exact reverse-domain private-use redirects', () => {
    const registered = 'com.example.desktop:/oauth/callback';
    expect(classifyNativeRedirectUri(registered)).toBe('private-use');
    expect(matchesRegisteredNativeRedirectUri(registered, registered)).toBe(true);
    expect(matchesRegisteredNativeRedirectUri(
      'com.example.desktop:/oauth/other', registered
    )).toBe(false);
    expect(classifyNativeRedirectUri('desktop:/oauth/callback')).toBeNull();
    expect(classifyNativeRedirectUri('com.example.desktop://oauth/callback')).toBeNull();
    expect(classifyNativeRedirectUri('com.example-:/oauth/callback')).toBeNull();
  });
});
