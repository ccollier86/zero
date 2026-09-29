/**
 * mfa-service.test.ts
 *
 * Verifies MFA readiness payload shaping without starting a second auth plugin
 * instance inside the HTTP integration suite.
 */

import { describe, expect, test } from 'bun:test';
import { resolveAuthBehaviorConfig } from './auth-config';
import { MfaService } from './mfa-service';
import { MfaChallengeService } from './mfa-challenge-service';
import { emitPlatformCode } from '../observability/sink';
import { OBS_CODES } from '../observability/codes';

describe('MfaService', () => {
  test('exposes enabled MFA readiness without leaking TOTP secrets', () => {
    const authConfig = resolveAuthBehaviorConfig({
      mfa: {
        enabled: true,
        policy: 'required',
        methods: ['email', 'totp'],
        totp: {
          encryptionKey: 'test-secret',
          issuer: 'Zero Tests',
        },
      },
    });
    const service = new MfaService(authConfig);

    const publicConfig = service.buildPublicConfig({ emailOtpReady: false });
    const adminConfig = service.buildAdminConfig({ emailOtpReady: false });

    expect(publicConfig).toMatchObject({
      enabled: true,
      policy: 'required',
      methods: ['email', 'totp'],
      availableMethods: ['totp'],
      allowUserChoice: true,
      allowMultipleMethods: false,
      recoveryCodes: false,
      ready: true,
    });
    expect(adminConfig.totp).toMatchObject({
      issuer: 'Zero Tests',
      encryptionConfigured: true,
      ready: true,
    });
    expect(JSON.stringify(publicConfig)).not.toContain('test-secret');
    expect(JSON.stringify(adminConfig)).not.toContain('test-secret');
  });

  test('rejects an asynchronous administration-membership policy resolver', async () => {
    const authConfig = resolveAuthBehaviorConfig({
      mfa: {
        enabled: true,
        policy: 'admin-required',
        methods: ['totp'],
        totp: { encryptionKey: 'test-secret', issuer: 'Zero Tests' },
      },
    });
    const emitted: string[] = [];
    const challenge = new MfaChallengeService(
      authConfig,
      {} as never,
      {} as never,
      {} as never,
      undefined,
      (async () => true) as never,
      (definition, options) => {
        emitted.push(definition.code);
        return emitPlatformCode(definition, options);
      },
    );

    expect(() => challenge.isMfaRequiredForUser({
      userId: 'tenant-admin',
      role: 'user',
      mfaRequired: false,
    })).toThrow(expect.objectContaining({
      code: 'AUTH_STATE_INVARIANT_FAILED',
      message: '[auth] MFA administration membership resolution must be synchronous.',
    }));
    await Promise.resolve();

    expect(emitted).toEqual([OBS_CODES.AUTH_STATE_INVARIANT_FAILED.code]);
  });
});
