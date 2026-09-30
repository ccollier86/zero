import { describe, expect, test } from 'bun:test';
import { resolveSafeAuthRedirect } from './redirect';

describe('resolveSafeAuthRedirect', () => {
  test('keeps a local native authorization continuation', () => {
    expect(resolveSafeAuthRedirect(
      '/auth/oauth/authorize?request_id=opaque',
      'https://app.example',
    )).toBe('/auth/oauth/authorize?request_id=opaque');
  });

  test('rejects external, protocol-relative, and backslash redirects', () => {
    for (const value of [
      'https://evil.example',
      '//evil.example',
      '/\\evil.example',
      '/%2e%2e//evil.example',
      '/a/%2e%2e//evil.example',
    ]) {
      expect(resolveSafeAuthRedirect(value, 'https://app.example')).toBe('/');
    }
  });
});
