import { describe, expect, test } from 'bun:test';
import type { AppConfig } from '../frontend/server/types';
import { runPlatformDoctor } from './platform-doctor';

const client = {
  clientId: 'acme-desktop',
  name: 'Acme Desktop',
  redirectUris: ['http://127.0.0.1/oauth/callback'],
} as const;

const sourceAdmission = {
  sourceKey: () => 'doctor-test-source',
};

function config(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    db: { mode: ':memory:' },
    tables: { users: { id: 'text primary key' } },
    email: false,
    ...overrides,
  };
}

function nativeCodes(value: AppConfig): string[] {
  return runPlatformDoctor(value, { env: {} }).findings
    .map((finding) => finding.code)
    .filter((code) => code.startsWith('auth.native.'));
}

describe('native app auth doctor checks', () => {
  test('requires a canonical public URL or explicit issuer', () => {
    expect(nativeCodes(config({ auth: { nativeApps: { clients: [client] } } })))
      .toContain('auth.native.issuer_missing');
    expect(nativeCodes(config({
      app: { publicUrl: 'https://app.example.com/base' },
      auth: { nativeApps: { clients: [client] } },
    }))).toContain('auth.native.public_url_invalid');
  });

  test('accepts secure production and loopback development issuers', () => {
    expect(nativeCodes(config({
      app: { publicUrl: 'https://app.example.com/' },
      auth: { nativeApps: { clients: [client], requestAdmission: sourceAdmission } },
    }))).toEqual([]);
    expect(nativeCodes(config({
      auth: {
        nativeApps: {
          issuer: 'http://localhost:3000/auth', clients: [client],
          requestAdmission: sourceAdmission,
        },
      },
    }))).toEqual([]);
  });

  test('uses safe socket-peer admission without extra deployment configuration', () => {
    expect(nativeCodes(config({
      app: { publicUrl: 'https://app.example.com/' },
      auth: { nativeApps: { clients: [client] } },
    }))).not.toContain('auth.native.source_admission_missing');
    expect(nativeCodes(config({
      app: { publicUrl: 'https://app.example.com/' },
      auth: { nativeApps: { clients: [client], requestAdmission: sourceAdmission } },
    }))).not.toContain('auth.native.source_admission_missing');
  });

  test('rejects ambiguous or malformed trusted proxy admission config', () => {
    expect(nativeCodes(config({
      app: { publicUrl: 'https://app.example.com/' },
      auth: { nativeApps: { clients: [client], requestAdmission: {
        trustedProxyRanges: ['not-an-address'],
      } } },
    }))).toContain('auth.native.config_invalid');
    expect(nativeCodes(config({
      app: { publicUrl: 'https://app.example.com/' },
      auth: { nativeApps: { clients: [client], requestAdmission: {
        forwardedForHeader: 'x-client-ip',
      } } },
    }))).toContain('auth.native.config_invalid');
    expect(nativeCodes(config({
      app: { publicUrl: 'https://app.example.com/' },
      auth: { nativeApps: { clients: [client], requestAdmission: {
        trustedProxyRanges: ['0.0.0.0/0'],
      } } },
    }))).toContain('auth.native.config_invalid');
  });

  test('uses the same issuer and audience origin contract as runtime', () => {
    expect(nativeCodes(config({
      app: { publicUrl: 'https://app.example.com' },
      auth: {
        nativeApps: {
          issuer: 'https://identity.example.com/auth',
          clients: [client],
        },
      },
    }))).toContain('auth.native.origin_mismatch');
    expect(nativeCodes(config({
      app: { publicUrl: 'http://app.example.com' },
      auth: {
        nativeApps: {
          issuer: 'https://identity.example.com/auth',
          clients: [client],
        },
      },
    }))).toContain('auth.native.public_url_invalid');
  });

  test('reports unsafe registered redirects with their exact path', () => {
    const report = runPlatformDoctor(config({
      app: { publicUrl: 'https://app.example.com' },
      auth: { nativeApps: { clients: [{ ...client, redirectUris: ['http://example.com/callback'] }] } },
    }), { env: {} });
    const finding = report.findings.find((item) => item.code === 'auth.native.redirect_invalid');
    expect(finding?.path).toBe('auth.nativeApps.clients.0.redirectUris.0');
    expect(nativeCodes(config({
      app: { publicUrl: 'https://app.example.com' },
      auth: { nativeApps: { clients: [{ ...client, redirectUris: ['http://example.com/callback'] }] } },
    }))).toContain('auth.native.config_invalid');
  });

  test('requires clients only when native auth is active', () => {
    expect(nativeCodes(config({
      app: { publicUrl: 'https://app.example.com' },
      auth: { nativeApps: { enabled: true } },
    }))).toContain('auth.native.clients_missing');
    expect(nativeCodes(config({ auth: { nativeApps: { enabled: false } } }))).toEqual([]);
  });
});
