/**
 * mfa-service.test.ts
 *
 * Verifies MFA readiness payload shaping without starting a second auth plugin
 * instance inside the HTTP integration suite.
 */

import { describe, expect, test } from 'bun:test';
import { resolveAuthBehaviorConfig } from './auth-config';
import { MfaService } from './mfa-service';

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
});
