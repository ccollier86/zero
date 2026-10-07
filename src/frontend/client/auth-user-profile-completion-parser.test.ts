/** Restricted first-use protocol cannot be confused with a full session or malformed readiness. */
import { describe, expect, test } from 'bun:test';
import { parseAuthCompletionResult, parseAuthRegistrationResult, parseAuthMfaCompletionResult } from './auth-completion-parser';
import { parseUserProfileCompletion } from './auth-user-profile-completion-parser';
import { profileCompletionResult } from './auth-user-profile-completion.test-fixtures';

describe('restricted profile completion response admission', () => {
  test('detaches and freezes the actual profile, and preserves registration/MFA envelope routing', () => {
    const source = profileCompletionResult(), parsed = parseAuthCompletionResult(source);
    expect(parsed).toMatchObject({ profileCompletionRequired: true, profileCompletion: { state: 'ready', missingFields: ['firstName'] } });
    expect('accessToken' in parsed).toBe(false);
    source.profileCompletion.profile!.values.firstName = 'Changed by caller';
    expect('profileCompletion' in parsed && parsed.profileCompletion.profile?.values.firstName).toBeNull();
    expect(Object.isFrozen('profileCompletion' in parsed && parsed.profileCompletion.profile?.values)).toBe(true);
    expect(parseAuthRegistrationResult(profileCompletionResult())).toMatchObject({ profileCompletionRequired: true });
    const method = { methodId: 'mfa', type: 'email', label: null, status: 'active', isPrimary: true, createdAt: 1, verifiedAt: 1, lastUsedAt: null };
    expect(parseAuthMfaCompletionResult({ ...profileCompletionResult(), method })).toMatchObject({ profileCompletionRequired: true });
  });
  test('admits genuinely blocked substrate without inventing a profile or ready state', () => {
    const result = profileCompletionResult(); result.profileCompletion = { ...result.profileCompletion, state: 'blocked', profile: null };
    expect(parseAuthCompletionResult(result)).toMatchObject({ profileCompletion: { state: 'blocked', profile: null } });
    expect(() => parseAuthCompletionResult({ ...result, profileCompletion: { ...result.profileCompletion, state: 'ready' } })).toThrow();
  });
  test('rejects full-token mixtures, wrong owners, coerced enums, duplicate/unknown fields and extra proof authority', () => {
    const result = profileCompletionResult();
    const malformed = [
      { ...result, accessToken: 'must-not-adopt', refreshToken: 'must-not-adopt' },
      { ...result, tenantSelectionRequired: true },
      { ...result, profileCompletion: { ...result.profileCompletion, tenantId: 'forged' } },
      { ...result, profileCompletion: { ...result.profileCompletion, profile: { ...result.profileCompletion.profile, userId: 'other' } } },
      { ...result, profileCompletion: { ...result.profileCompletion, state: ['ready'] } },
      { ...result, profileCompletion: { ...result.profileCompletion, missingFields: ['firstName', 'firstName'] } },
      { ...result, profileCompletion: { ...result.profileCompletion, missingFields: ['role'] } },
      { ...result, profileCompletion: { ...result.profileCompletion, continuation: 'Bearer access-token' } },
    ];
    for (const value of malformed) expect(() => parseAuthCompletionResult(value)).toThrow();
    const profile = result.profileCompletion.profile!;
    expect(() => parseUserProfileCompletion({ ...result.profileCompletion, profile: { ...profile,
      capabilities: { ...profile.capabilities, state: ['ready'] } } })).toThrow();
    expect(() => parseUserProfileCompletion({ ...result.profileCompletion, profile: { ...profile,
      capabilities: { ...profile.capabilities, usernameMode: ['email'] } } })).toThrow();
  });
});
