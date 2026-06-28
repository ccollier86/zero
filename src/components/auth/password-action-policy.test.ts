import { describe, expect, test } from 'bun:test';
import type { AuthActionTokenInfo } from '../../frontend/client/auth-client';
import {
  inferPasswordActionFromToken,
  isPasswordActionModeMismatch,
  resolvePasswordAction,
} from './password-action-policy';

describe('password action policy', () => {
  test('infers setup from account setup tokens', () => {
    const token = makeToken({ type: 'account_setup' });

    expect(inferPasswordActionFromToken(token)).toBe('setup');
    expect(resolvePasswordAction('auto', token)).toBe('setup');
    expect(resolvePasswordAction('setup', token)).toBe('setup');
  });

  test('infers reset from user and admin reset tokens', () => {
    expect(resolvePasswordAction('auto', makeToken({ type: 'password_reset' }))).toBe('reset');
    expect(resolvePasswordAction('auto', makeToken({ type: 'admin_password_reset' }))).toBe('reset');
  });

  test('blocks invalid, missing, or unsupported token actions', () => {
    expect(resolvePasswordAction('reset', null)).toBeNull();
    expect(resolvePasswordAction('reset', makeToken({ valid: false }))).toBeNull();
    expect(resolvePasswordAction('auto', makeToken({ type: 'email_verification' }))).toBeNull();
  });

  test('blocks explicit mode mismatches', () => {
    const setupToken = makeToken({ type: 'account_setup' });
    const resetToken = makeToken({ type: 'password_reset' });

    expect(resolvePasswordAction('reset', setupToken)).toBeNull();
    expect(resolvePasswordAction('setup', resetToken)).toBeNull();
    expect(isPasswordActionModeMismatch('reset', setupToken)).toBe(true);
    expect(isPasswordActionModeMismatch('setup', resetToken)).toBe(true);
  });
});

function makeToken(
  partial: Partial<AuthActionTokenInfo> = {},
): AuthActionTokenInfo {
  return {
    valid: true,
    type: 'password_reset',
    expiresAt: Date.now() + 60_000,
    user: {
      userId: 'u_1',
      username: 'ada',
      email: 'ada@example.com',
    },
    ...partial,
  };
}
