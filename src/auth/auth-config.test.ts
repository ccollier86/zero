/**
 * auth-config.test.ts
 *
 * Verifies auth behavior config normalization and security validation. This
 * file owns pure config tests only; route payload behavior and user-property
 * writes are covered by integration and service tests.
 */

import { describe, expect, test } from 'bun:test';
import {
  isPolicyTrustedUserProperty,
  resolveAuthBehaviorConfig,
} from './auth-config';

describe('resolveAuthBehaviorConfig', () => {
  test('normalizes account email verification defaults and paths', () => {
    const defaults = resolveAuthBehaviorConfig();
    expect(defaults.account.requireEmailVerification).toBe(false);
    expect(defaults.account.emailVerificationPath).toBe('/verify-email');
    expect(defaults.account.allowAdminMarkEmailVerified).toBe(false);

    const configured = resolveAuthBehaviorConfig({
      account: {
        requireEmailVerification: true,
        emailVerificationPath: 'auth/verify',
        allowAdminMarkEmailVerified: true,
      },
    });
    expect(configured.account.requireEmailVerification).toBe(true);
    expect(configured.account.emailVerificationPath).toBe('/auth/verify');
    expect(configured.account.allowAdminMarkEmailVerified).toBe(true);
  });

  test('does not advertise unimplemented password-change notices', () => {
    const configured = resolveAuthBehaviorConfig({
      accountEmails: { passwordChangedNotice: true },
    });

    expect(configured.accountEmails.passwordChangedNotice).toBe(false);
  });

  test('normalizes MFA defaults and configured self-hosted TOTP settings', () => {
    const defaults = resolveAuthBehaviorConfig();
    expect(defaults.mfa.enabled).toBe(false);
    expect(defaults.mfa.policy).toBe('optional');
    expect(defaults.mfa.methods).toEqual(['email', 'totp']);
    expect(defaults.mfa.allowUserChoice).toBe(true);
    expect(defaults.mfa.allowMultipleMethods).toBe(false);
    expect(defaults.mfa.recoveryCodes).toBe(false);
    expect(defaults.mfa.totp.qrRobustness).toBe('M');

    const configured = resolveAuthBehaviorConfig({
      mfa: {
        enabled: true,
        policy: 'required',
        methods: ['totp', 'email', 'totp'],
        allowUserChoice: true,
        allowMultipleMethods: false,
        challengeTTL: '15m',
        challengeCooldown: '2m',
        maxAttempts: 3,
        recoveryCodes: false,
        totp: {
          issuer: 'Zero CRM',
          encryptionKey: 'secret',
          qrRobustness: 'Q',
        },
      },
    });

    expect(configured.mfa.enabled).toBe(true);
    expect(configured.mfa.policy).toBe('required');
    expect(configured.mfa.methods).toEqual(['totp', 'email']);
    expect(configured.mfa.challengeTTL).toBe('15m');
    expect(configured.mfa.challengeCooldown).toBe('2m');
    expect(configured.mfa.maxAttempts).toBe(3);
    expect(configured.mfa.recoveryCodes).toBe(false);
    expect(configured.mfa.totp).toEqual({
      issuer: 'Zero CRM',
      encryptionKey: 'secret',
      qrRobustness: 'Q',
    });
  });

  test('rejects unsupported MFA policy, methods, and limits', () => {
    expect(() =>
      resolveAuthBehaviorConfig({
        mfa: { policy: 'bad-policy' as never },
      })
    ).toThrow('Unsupported MFA policy');

    expect(() =>
      resolveAuthBehaviorConfig({
        mfa: { methods: ['sms' as never] },
      })
    ).toThrow('Unsupported MFA method');

    expect(() =>
      resolveAuthBehaviorConfig({
        mfa: { methods: [] },
      })
    ).toThrow('MFA methods must include');

    expect(() =>
      resolveAuthBehaviorConfig({
        mfa: { maxAttempts: 0 },
      })
    ).toThrow('MFA maxAttempts');
  });

  test('defaults user properties to self-editable and not policy trusted', () => {
    const config = resolveAuthBehaviorConfig({
      userProperties: {
        theme: {
          type: 'enum',
          values: ['light', 'dark'],
        },
      },
    });

    expect(config.userProperties.theme).toMatchObject({
      editableBy: 'user',
      useInPolicies: false,
    });
    expect(isPolicyTrustedUserProperty(config.userProperties.theme)).toBe(false);
  });

  test('allows admin, system, and none-editable properties to opt into policy use', () => {
    const config = resolveAuthBehaviorConfig({
      userProperties: {
        department: {
          type: 'enum',
          values: ['accounting', 'support'],
          editableBy: 'admin',
          useInPolicies: true,
        },
        clearance: {
          type: 'string',
          editableBy: 'system',
          useInPolicies: true,
        },
        complianceHold: {
          type: 'boolean',
          editableBy: 'none',
          useInPolicies: true,
        },
      },
    });

    expect(isPolicyTrustedUserProperty(config.userProperties.department)).toBe(true);
    expect(isPolicyTrustedUserProperty(config.userProperties.clearance)).toBe(true);
    expect(isPolicyTrustedUserProperty(config.userProperties.complianceHold)).toBe(true);
  });

  test('rejects policy trust for self-editable user properties', () => {
    expect(() =>
      resolveAuthBehaviorConfig({
        userProperties: {
          notificationsEnabled: {
            type: 'boolean',
            editableBy: 'user',
            useInPolicies: true,
          },
        },
      })
    ).toThrow('cannot set useInPolicies: true');
  });
});
