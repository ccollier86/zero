import { describe, expect, test } from 'bun:test';
import { resolveAuthBehaviorConfig } from '../auth-config';
import type { AuthPluginConfig } from '../types';
import { resolveNativeRuntimeConfig } from './native-runtime-config';

const client = {
  clientId: 'desktop-app',
  name: 'Desktop App',
  redirectUris: ['com.example.desktop:/oauth/callback'],
};

function resolve(plugin: Partial<AuthPluginConfig>) {
  const config = { nativeApps: { clients: [client] }, ...plugin } as AuthPluginConfig;
  return resolveNativeRuntimeConfig(config, resolveAuthBehaviorConfig(config));
}

describe('native runtime config', () => {
  test('normalizes a root issuer exactly like public config resolution', () => {
    expect(resolve({
      nativeIssuer: 'https://identity.example',
      nativeAudience: 'https://identity.example',
    })?.issuer).toBe('https://identity.example/auth');
  });

  test('rejects split issuer and API origins in the same-origin v1 contract', () => {
    expect(() => resolve({
      nativeIssuer: 'https://identity.example/auth',
      nativeAudience: 'https://api.example',
    })).toThrow('issuer and audience must share an origin');
  });

  test('requires the audience to be a canonical origin', () => {
    expect(() => resolve({
      nativeIssuer: 'https://zero.example/auth',
      nativeAudience: 'https://zero.example/api',
    })).toThrow('audience must be a canonical origin');
  });

  test.each([
    '/\\attacker.example',
    '//attacker.example',
    ' /login',
    '/log\u0000in',
    '/%2e%2e//attacker.example',
    '/a/%2e%2e//attacker.example',
  ])(
    'rejects unsafe browser auth route %s',
    (loginPath) => {
      expect(() => resolve({
        nativeIssuer: 'https://zero.example/auth',
        loginPath,
      })).toThrow('loginPath must be an absolute local path');
    },
  );
});
