/** Exercises trusted in-memory configuration only; no Doctor DB inspection or app imports. */

import { describe, expect, test } from 'bun:test';
import { resolveConfig, type AppConfig } from '../frontend/server/types';
import { authPublicPathFindings } from './auth-public-path-checks';

function resolved(auth: AppConfig['auth'] = true) {
  return resolveConfig({
    db: { mode: 'ephemeral' }, tables: {}, auth, publicPaths: [],
    email: false, ai: false, vector: false, pdf: false, kv: false,
  }, {});
}

describe('Doctor auth public-path checks', () => {
  for (const ttl of [
    { accessTokenTTL: '10m' },
    { refreshTokenTTL: '3d' },
    { accessTokenTTL: '10m', refreshTokenTTL: '3d' },
  ]) {
    test(`preserves path findings with managed TTLs ${Object.keys(ttl).join(', ')}`, () => {
      const policy = {
        account: { requireEmailVerification: true },
        accountEmails: { passwordReset: true, adminCreatedUser: true },
      };
      const expected = authPublicPathFindings(resolved(policy));
      expect(expected.map(finding => finding.code)).toContain('auth.login_path.not_public');
      expect(expected.map(finding => finding.code)).toContain('auth.registration_path.not_public');
      expect(expected.map(finding => finding.code)).toContain('auth.verification_path.not_public');
      expect(authPublicPathFindings(resolved({ ...policy, ...ttl }))).toEqual(expected);
    });
  }

  test('retains authless, explicit and public-route policies', () => {
    expect(authPublicPathFindings(resolved(false))).toEqual([]);
    expect(authPublicPathFindings({ ...resolved(), routeAuth: 'explicit' })).toEqual([]);
    expect(authPublicPathFindings({ ...resolved({ accessTokenTTL: '10m' }), publicPaths: ['/'] }))
      .toEqual([]);
  });

  test('leaves invalid behavior reporting to the owning config check', () => {
    const config = { ...resolved(), auth: { audit: { retentionDays: 0 } } };
    expect(authPublicPathFindings(config)).toEqual([]);
  });
});
