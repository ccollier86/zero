import { describe, expect, test } from 'bun:test';
import { isAuthPublicConfig } from './auth-public-config-parser';

describe('public auth config parser', () => {
  test('accepts minimal legacy-compatible and complete current config shapes', () => {
    expect(isAuthPublicConfig({ registration: registration() })).toBe(true);
    expect(isAuthPublicConfig({
      registration: registration(),
      apiKeys: {
        enabled: true,
        selfService: false,
        administratorIssuance: false,
        defaultTTL: '01d',
        maxTTL: '030d',
        maxActivePerUser: 1,
      },
    })).toBe(true);
    expect(isAuthPublicConfig({
      registration: registration(),
      tenancy: {
        mode: 'multi',
        terminology: { singular: 'practice', plural: 'practices' },
        creation: { mode: 'authenticated' },
        onboarding: {
          invitations: {
            enabled: true,
            accountCreation: true,
            delivery: { default: 'email', email: true, manual: true },
          },
          joinRequests: { enabled: true },
          verifiedDomains: { enabled: true, admission: 'request-to-join' },
        },
      },
      authorization: { mode: 'advanced' },
      apiKeys: {
        enabled: true,
        selfService: true,
        administratorIssuance: true,
        defaultTTL: '12h',
        maxTTL: '30d',
        maxActivePerUser: 7,
      },
      bootstrap: {
        required: false,
        mode: 'secret',
        available: false,
        secretRequired: false,
      },
      accountEmails: {
        adminCreatedUser: true,
        passwordReset: true,
        passwordChangedNotice: true,
        emailVerification: true,
      },
      account: {
        requireEmailVerification: true,
        emailVerificationPath: '/verify-email',
        emailVerificationReady: true,
      },
      mfa: {
        enabled: true,
        policy: 'optional',
        methods: ['email', 'totp'],
        availableMethods: ['totp'],
        allowUserChoice: true,
        allowMultipleMethods: false,
        rememberDevice: false,
        recoveryCodes: false,
        ready: true,
      },
      userProperties: {
        locale: {
          key: 'locale',
          type: 'enum',
          values: ['en', 'es'],
          editableBy: 'user',
          useInPolicies: false,
        },
      },
      strictUserProperties: true,
    })).toBe(true);
  });

  test('rejects malformed nested capabilities before render-time access', () => {
    const invalid = [
      null,
      [],
      { registration: { ...registration(), mode: 'publci' } },
      { registration: registration(), tenancy: { mode: 'many' } },
      {
        registration: registration(),
        apiKeys: {
          enabled: true,
          selfService: true,
          administratorIssuance: false,
          defaultTTL: '30d',
          maxTTL: '90d',
          maxActivePerUser: 0,
        },
      },
      {
        registration: registration(),
        apiKeys: {
          enabled: true,
          selfService: 'yes',
          administratorIssuance: false,
          defaultTTL: '30d',
          maxTTL: '90d',
          maxActivePerUser: 10,
        },
      },
      {
        registration: registration(),
        apiKeys: {
          enabled: true,
          selfService: true,
          administratorIssuance: false,
          defaultTTL: 'forever',
          maxTTL: '90d',
          maxActivePerUser: 10,
        },
      },
      {
        registration: registration(),
        apiKeys: {
          enabled: true,
          selfService: true,
          administratorIssuance: false,
          defaultTTL: '90d',
          maxTTL: '30d',
          maxActivePerUser: 10,
        },
      },
      {
        registration: registration(),
        apiKeys: {
          enabled: true,
          selfService: true,
          administratorIssuance: false,
          defaultTTL: '30d',
          maxTTL: '90d',
          maxActivePerUser: 101,
        },
      },
      {
        registration: registration(),
        tenancy: {
          mode: 'multi',
          onboarding: {
            invitations: {
              enabled: true,
              accountCreation: true,
              delivery: { default: 'manual', manual: true, email: 'yes' },
            },
            joinRequests: { enabled: true },
          },
        },
      },
      {
        registration: registration(),
        mfa: {
          enabled: true,
          policy: 'optional',
          methods: ['sms'],
          availableMethods: [],
          allowUserChoice: true,
          allowMultipleMethods: false,
          rememberDevice: false,
          recoveryCodes: false,
          ready: true,
        },
      },
      {
        registration: registration(),
        userProperties: {
          department: { key: 'department', type: 'object', editableBy: 'user' },
        },
      },
    ];

    for (const candidate of invalid) expect(isAuthPublicConfig(candidate)).toBe(false);
  });
});

function registration() {
  return {
    mode: 'public',
    bootstrapRequired: false,
    registrationEnabled: true,
    publicRegistrationEnabled: true,
    userCount: 1,
  };
}
