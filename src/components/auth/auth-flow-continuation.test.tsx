import { describe, expect, test } from 'bun:test';

import type { AuthTenantOnboardingRequiredResult } from '../../frontend/client/auth-types';
import {
  authFlowContinuationKey,
  tenantOnboardingOptions,
} from './auth-flow-continuation';

describe('AuthFlowContinuation tenant onboarding options', () => {
  test('keeps creation visible while adding verified-company access', () => {
    expect(tenantOnboardingOptions(onboarding(true), true)).toEqual({
      create: true,
      verifiedDomain: true,
    });
  });

  test('supports each capability independently and fails closed without proof', () => {
    expect(tenantOnboardingOptions(onboarding(true), false)).toEqual({
      create: true,
      verifiedDomain: false,
    });
    expect(tenantOnboardingOptions(onboarding(false), true)).toEqual({
      create: false,
      verifiedDomain: true,
    });
    expect(tenantOnboardingOptions({
      ...onboarding(false),
      onboarding: {
        ...onboarding(false).onboarding,
        continuation: '',
      },
    }, true)).toEqual({
      create: false,
      verifiedDomain: false,
    });
  });
});

describe('AuthFlowContinuation reset boundary', () => {
  test('changes synchronously when a single-use continuation changes', () => {
    const initial = onboarding(true);
    const replacement = {
      ...initial,
      onboarding: {
        ...initial.onboarding,
        continuation: 'replacement-continuation',
      },
    };

    expect(authFlowContinuationKey(initial)).not.toBe(
      authFlowContinuationKey(replacement),
    );
  });
});

function onboarding(canCreate: boolean): AuthTenantOnboardingRequiredResult {
  return {
    user: {
      userId: 'user-1',
      username: 'person',
      email: 'person@company.com',
      firstName: null,
      lastName: null,
      role: 'user',
      status: 'active',
      passwordChangeRequired: false,
      emailVerifiedAt: 1,
      emailVerificationRequired: false,
      mfaRequired: false,
      createdAt: 1,
      updatedAt: null,
      properties: {},
    },
    tenantOnboardingRequired: true,
    onboarding: {
      reason: 'no_active_tenant_membership',
      continuation: 'identity-continuation',
      expiresAt: 10_000,
      tenantCreation: canCreate
        ? {
            allowed: true,
            continuation: 'identity-continuation',
            expiresAt: 10_000,
          }
        : { allowed: false },
    },
  };
}
