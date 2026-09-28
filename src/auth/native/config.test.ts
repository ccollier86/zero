import { describe, expect, test } from 'bun:test';
import { resolveNativeAuthConfig } from './config';

describe('resolveNativeAuthConfig', () => {
  test('defaults off and resolves public native client registration', () => {
    const defaults = resolveNativeAuthConfig();
    expect(defaults).toMatchObject({
      enabled: false,
      issuer: undefined,
      requestTTL: '15m',
      codeTTL: '3m',
      refreshTokenTTL: '30d',
      requestAdmission: {
        cleanupBatchSize: 100, maxOutstandingGlobal: 1_000,
        maxOutstandingPerClient: 100, maxOutstandingPerSource: 20,
        rollingWindowMs: 60_000, maxAdmissionsGlobal: 300,
        maxAdmissionsPerClient: 60, maxAdmissionsPerSource: 20,
        trustedProxyRanges: [], forwardedForHeader: 'x-forwarded-for',
      },
      refreshRotation: {
        cleanupBatchSize: 100, minRotationIntervalMs: 30_000,
        maxRotationsPerFamily: 4_096, maxActiveFamiliesPerUserClient: 10,
      },
      clients: [],
    });
    expect(defaults.requestAdmission.sourceKey).toBeFunction();
    const configured = resolveNativeAuthConfig({
      issuer: 'https://auth.example.com',
      clients: [{
        clientId: 'desktop-app',
        name: 'Example Desktop',
        redirectUris: ['http://127.0.0.1/oauth/callback'],
        scopes: ['openid', 'profile', 'email'],
      }],
    });
    expect(configured.enabled).toBe(true);
    expect(configured.issuer).toBe('https://auth.example.com/auth');
    expect(configured.clients[0]).toEqual({
      clientId: 'desktop-app',
      name: 'Example Desktop',
      redirectUris: ['http://127.0.0.1/oauth/callback'],
      scopes: ['openid', 'profile', 'email'],
    });
    expect(resolveNativeAuthConfig({
      enabled: false,
      clients: configured.clients,
    }).enabled).toBe(false);
    expect(resolveNativeAuthConfig({
      clients: [{
        clientId: 'mobile-app',
        name: 'Example Mobile',
        redirectUris: ['com.example.mobile:/oauth/callback'],
      }],
    }).clients[0]?.scopes).toEqual(['openid', 'profile', 'email']);
  });

  test('rejects duplicate clients and redirect URIs', () => {
    const client = {
      clientId: 'desktop-app',
      name: 'Desktop',
      redirectUris: ['com.example.desktop:/oauth/callback'],
    };
    expect(() => resolveNativeAuthConfig({ clients: [client, client] }))
      .toThrow('clientId values must be unique');
    expect(() => resolveNativeAuthConfig({ clients: [{
      ...client,
      redirectUris: [client.redirectUris[0], client.redirectUris[0]],
    }] })).toThrow('redirectUris contains duplicates');
  });

  test('rejects unknown native auth fields and wrong runtime shapes', () => {
    expect(() => resolveNativeAuthConfig({ enabeld: true } as never))
      .toThrow('config contains unsupported field "enabeld"');
    expect(() => resolveNativeAuthConfig({ enabled: 'true' } as never))
      .toThrow('enabled must be a boolean');
    expect(() => resolveNativeAuthConfig({ clients: 'desktop' } as never))
      .toThrow('clients must be an array');
    expect(() => resolveNativeAuthConfig({ clients: [{
      clientId: 'desktop',
      name: 'Desktop',
      redirectUris: ['com.example.desktop:/callback'],
      redirectUri: 'typo',
    } as never] })).toThrow('client contains unsupported field "redirectUri"');
    expect(() => resolveNativeAuthConfig({
      requestAdmission: { maxOutstandingGlobla: 1 } as never,
    })).toThrow('requestAdmission contains unsupported field "maxOutstandingGlobla"');
    expect(() => resolveNativeAuthConfig({
      refreshRotation: { minRotationInterval: false } as never,
    })).toThrow('minRotationInterval must be a duration string');
  });

  test('rejects unsafe registration values', () => {
    expect(() => resolveNativeAuthConfig({
      issuer: 'http://auth.example.com',
    })).toThrow('use HTTPS');
    expect(resolveNativeAuthConfig({
      issuer: 'http://localhost:3000',
    }).issuer).toBe('http://localhost:3000/auth');
    expect(resolveNativeAuthConfig({
      issuer: 'http://[::1]:3000/auth',
    }).issuer).toBe('http://[::1]:3000/auth');
    expect(() => resolveNativeAuthConfig({
      issuer: 'http://localhost.evil.example',
    })).toThrow('use HTTPS');
    expect(() => resolveNativeAuthConfig({
      issuer: 'https://auth.example.com/custom/path',
    })).toThrow("Zero's /auth path");
    expect(() => resolveNativeAuthConfig({ clients: [{
      clientId: 'desktop-app', name: 'Desktop',
      redirectUris: ['http://localhost:4000/callback'],
    }] })).toThrow('Invalid native redirect');
    expect(() => resolveNativeAuthConfig({ clients: [{
      clientId: 'desktop-app', name: 'Desktop',
      redirectUris: ['com.example.desktop:/callback'], scopes: ['profile'],
    }] })).toThrow('must allow openid');
    expect(() => resolveNativeAuthConfig({ codeTTL: '0m' }))
      .toThrow('safe duration');
  });

  test('enforces safe TTL boundaries and resolves abuse-control policy', () => {
    const sourceKey = () => 'trusted-source';
    const configured = resolveNativeAuthConfig({
      requestTTL: '1h', codeTTL: '10m', refreshTokenTTL: '365d',
      requestAdmission: {
        rollingWindow: '5m', maxAdmissionsPerSource: 7, sourceKey,
      },
      refreshRotation: {
        minRotationInterval: '0s', maxRotationsPerFamily: 8,
        maxActiveFamiliesPerUserClient: 2,
      },
    });
    expect(configured.requestAdmission).toMatchObject({
      rollingWindowMs: 300_000, maxAdmissionsPerSource: 7, sourceKey,
    });
    expect(configured.refreshRotation).toMatchObject({
      minRotationIntervalMs: 0, maxRotationsPerFamily: 8,
      maxActiveFamiliesPerUserClient: 2,
    });
    expect(() => resolveNativeAuthConfig({ requestTTL: '61m' })).toThrow('requestTTL');
    expect(() => resolveNativeAuthConfig({ codeTTL: '11m' })).toThrow('codeTTL');
    expect(() => resolveNativeAuthConfig({ refreshTokenTTL: '366d' })).toThrow('refreshTokenTTL');
    expect(() => resolveNativeAuthConfig({ requestTTL: `${Number.MAX_SAFE_INTEGER}d` }))
      .toThrow('safe duration');
    expect(() => resolveNativeAuthConfig({
      refreshRotation: { maxRotationsPerFamily: 100_001 },
    })).toThrow('maxRotationsPerFamily');
  });
});
