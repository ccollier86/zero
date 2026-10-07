import { describe, expect, test } from 'bun:test';
import { normalizeAuthUserProfileCompletion } from './auth-config-user-profile-completion';
import { normalizeAuthUserProfile } from './auth-config-user-profile';
import { captureProfileCompletionInput, profileCompletionToken } from './auth-user-profile-completion-request';

describe('closed first-use completion policy and requests', () => {
  test('defaults do not enroll existing accounts or enable completion implicitly', () => {
    expect(normalizeAuthUserProfileCompletion()).toEqual({ enabled: false, onSignup: true,
      onInvitation: true, existingUsers: 'none', ttl: '10m', ttlMs: 600000 });
    expect(Object.isFrozen(normalizeAuthUserProfileCompletion())).toBe(true);
    for (const config of [{ enabled: 'true' }, { existingUsers: 'all' }, { ttl: '0m' }, { ttl: '31m' }, { unknown: true }]) {
      expect(() => normalizeAuthUserProfileCompletion(config as never)).toThrow();
    }
    expect(() => normalizeAuthUserProfile({ fields: { firstName: { required: true, editable: false } },
      completion: { enabled: true } })).toThrow();
    expect(() => normalizeAuthUserProfile({ completion: { requiredAvatar: true } as never })).toThrow();
  });
  test('proof commands reject coercion, targets, symbols and accessors without evaluating them', () => {
    const token = `zct_${'a'.repeat(64)}`;
    expect(profileCompletionToken(token)).toBe(token);
    expect(captureProfileCompletionInput({ continuation: token }, ['continuation'])).toEqual({ continuation: token });
    let called = 0;
    const accessor = { get continuation() { called += 1; return token; } };
    for (const value of [accessor, { continuation: token, userId: 'other' }, { continuation: token, [Symbol('x')]: 1 }, []]) {
      expect(() => captureProfileCompletionInput(value, ['continuation'])).toThrow();
    }
    expect(called).toBe(0);
    for (const value of [null, 7, 'zct_short', token + '\u0000', `zct_${'x'.repeat(201)}`]) {
      expect(() => profileCompletionToken(value)).toThrow();
    }
  });
});
