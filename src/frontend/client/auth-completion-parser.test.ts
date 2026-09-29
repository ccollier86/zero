import { describe, expect, test } from 'bun:test';
import {
  parseAuthCompletionResult,
  parseAuthMfaCompletionResult,
  parseAuthRefreshResponse,
  parseAuthRegistrationResult,
  parseAuthTenantListResult,
  parseAuthUser,
} from './auth-completion-parser';

describe('authentication completion response boundary', () => {
  test('parses and freezes a session while rejecting unknown or invalid scope data', () => {
    const result = parseAuthCompletionResult({
      user: user(),
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      activeTenant: tenant(),
    });

    expect('accessToken' in result && result.activeTenant?.slug).toBe('acme--east');
    expect(Object.isFrozen(result)).toBe(true);
    expect(() => parseAuthCompletionResult({
      user: user(), accessToken: 'a', refreshToken: 'r', privileged: true,
    })).toThrow('invalid authentication completion response');
    expect(() => parseAuthCompletionResult({
      user: user(), accessToken: 'a', refreshToken: 'r',
      activeTenant: { ...tenant(), slug: '-acme' },
    })).toThrow('invalid authentication completion response');
    expect(parseAuthCompletionResult({
      user: user(), accessToken: 'a', refreshToken: 'r',
      activeTenant: { ...tenant(), slug: 'a'.repeat(63) },
    })).toMatchObject({ activeTenant: { slug: 'a'.repeat(63) } });
    expect(() => parseAuthCompletionResult({
      user: user(), accessToken: 'a', refreshToken: 'r',
      activeTenant: { ...tenant(), slug: 'a'.repeat(64) },
    })).toThrow('invalid authentication completion response');
  });

  test('covers every non-session completion discriminator', () => {
    expect(parseAuthCompletionResult({
      user: user(),
      mfaSetupRequired: true,
      mfaSetupToken: 'setup-token',
      mfa: { methods: ['email', 'totp'], allowUserChoice: true },
    })).toMatchObject({ mfaSetupRequired: true });

    expect(parseAuthCompletionResult({
      user: user(),
      mfaChallengeRequired: true,
      mfaChallenge: {
        method: {
          methodId: 'method-1', type: 'email', label: 'Work email',
          status: 'active', isPrimary: true, createdAt: 1,
          verifiedAt: 2, lastUsedAt: null,
        },
        challenge: {
          challengeId: 'challenge-1', methodType: 'email',
          expiresAt: 10, delivery: 'email',
        },
        challengeToken: 'challenge-token',
      },
    })).toMatchObject({ mfaChallengeRequired: true });

    expect(parseAuthCompletionResult({
      user: user(),
      tenantSelectionRequired: true,
      tenantSelection: {
        continuation: 'selection-proof', expiresAt: 10, tenants: [tenant()],
      },
    })).toMatchObject({ tenantSelectionRequired: true });

    expect(parseAuthCompletionResult({
      user: user(),
      tenantOnboardingRequired: true,
      onboarding: {
        reason: 'no_active_tenant_membership',
        continuation: 'onboarding-proof',
        expiresAt: 10,
        tenantCreation: {
          allowed: true, continuation: 'creation-proof', expiresAt: 10,
        },
      },
    })).toMatchObject({ tenantOnboardingRequired: true });

    expect(parseAuthCompletionResult({
      user: user(), passwordUpdated: true, signInRequired: true,
    })).toMatchObject({ passwordUpdated: true });

    expect(parseAuthCompletionResult({
      user: {
        ...user(), emailVerifiedAt: null, emailVerificationRequired: true,
      },
    })).toMatchObject({
      user: { emailVerifiedAt: null, emailVerificationRequired: true },
    });
  });

  test('strictly covers registration, refresh, tenant-list, and current-user seams', () => {
    expect(parseAuthRegistrationResult({
      user: user(),
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      tenant: { ...tenant(), membershipId: 'membership-1' },
    })).toMatchObject({
      tenant: { tenantId: 'tenant-1', membershipId: 'membership-1' },
    });
    expect(parseAuthRefreshResponse({
      accessToken: 'next-access',
      refreshToken: 'next-refresh',
      activeTenant: tenant(),
      user: user(),
    })).toMatchObject({ activeTenant: { slug: 'acme--east' } });
    expect(parseAuthTenantListResult({
      activeTenantId: 'tenant-1',
      tenants: [tenant()],
    })).toMatchObject({ activeTenantId: 'tenant-1' });
    expect(parseAuthUser(user())).toMatchObject({ userId: 'user-1' });
    expect(parseAuthMfaCompletionResult({
      user: user(),
      accessToken: 'mfa-access',
      refreshToken: 'mfa-refresh',
      method: mfaMethod(),
    })).toMatchObject({ accessToken: 'mfa-access' });

    expect(() => parseAuthRefreshResponse({
      accessToken: 'next-access', refreshToken: 'next-refresh', authority: 'admin',
    })).toThrow('invalid authentication completion response');
    expect(() => parseAuthTenantListResult({
      activeTenantId: 'tenant-missing', tenants: [tenant()],
    })).toThrow('invalid authentication completion response');
    expect(() => parseAuthUser({ ...user(), status: 'root' }))
      .toThrow('invalid authentication completion response');
    expect(() => parseAuthMfaCompletionResult({
      user: user(), accessToken: 'a', refreshToken: 'r',
    })).toThrow('invalid authentication completion response');
  });
});

function tenant() {
  return {
    tenantId: 'tenant-1',
    kind: 'organization',
    slug: 'acme--east',
    name: 'Acme East',
    role: 'owner',
  };
}

function user() {
  return {
    userId: 'user-1',
    username: 'owner',
    email: 'owner@example.test',
    firstName: 'Acme',
    lastName: 'Owner',
    role: 'user',
    status: 'active',
    passwordChangeRequired: false,
    emailVerifiedAt: 1,
    emailVerificationRequired: false,
    mfaRequired: false,
    properties: { department: 'care' },
    createdAt: 1,
    updatedAt: null,
  };
}

function mfaMethod() {
  return {
    methodId: 'method-1',
    type: 'totp',
    label: 'Authenticator',
    status: 'active',
    isPrimary: true,
    createdAt: 1,
    verifiedAt: 2,
    lastUsedAt: null,
  };
}
