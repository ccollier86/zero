/** Recovery copy/policy never weakens server proofs or invents successful credential writes. */
import { expect, test } from 'bun:test';
import { AuthClientError } from '../../frontend/client/auth-errors';
import type { AuthActionTokenInfo, AuthCompletionResult } from '../../frontend/client/auth-types';
import { isConfirmedPasswordUpdate, isPasswordActionInspection, passwordActionFailure, passwordActionProblem } from './password-action-recovery';

for (const [code, kind] of [['ACTION_TOKEN_CONSUMED', 'used'], ['ACTION_TOKEN_EXPIRED', 'expired'],
  ['ACTION_TOKEN_INVALID', 'invalid'], ['ACCOUNT_SUSPENDED', 'suspended']] as const) {
  test(`${code} receives a specific secret-free explanation`, () => {
    for (const stage of ['inspection', 'submission'] as const) {
      const result = passwordActionFailure(new AuthClientError('PRIVATE_PROOF_AND_PASSWORD', 400, code, null), stage);
      expect(result.kind).toBe(kind); expect(result.retry).toBe(false);
      expect(JSON.stringify(result)).not.toContain('PRIVATE');
      expect(JSON.stringify(result)).not.toMatch(/paste|email token/i);
    }
  });
}
test('transient inspection failures offer only read retry; ambiguous writes never offer mutation replay', () => {
  for (const cause of [new TypeError('PRIVATE_NETWORK_URL'), new AuthClientError('PRIVATE_RESPONSE', 503, 'AUTH_NOT_READY', null), null]) {
    expect(passwordActionFailure(cause, 'inspection')).toMatchObject({ kind: 'unavailable', retry: true });
    expect(passwordActionFailure(cause, 'submission')).toMatchObject({ kind: 'unknown', retry: false });
  }
  expect(passwordActionFailure({ code: 'LOGGING_OUTCOME_UNKNOWN', retryable: true }, 'submission').kind).toBe('unknown');
});
test('missing links provide instructions, not a token prompt or invented delivery', () => {
  const result = passwordActionProblem('missing');
  expect(result.title).toBe('Open the link in your email'); expect(result.retry).toBe(false);
  expect(JSON.stringify(result)).not.toMatch(/paste|sent|email token/i);
});
test('success requires confirmed password replacement for the exact inspected account', () => {
  const info = { valid: true, type: 'password_reset', expiresAt: 1, user: { userId: 'expected', username: 'fixture', email: 'fixture@example.test' } } as AuthActionTokenInfo;
  const confirmed = { passwordUpdated: true, signInRequired: true, user: { userId: 'expected' } } as AuthCompletionResult;
  expect(isConfirmedPasswordUpdate(confirmed, info)).toBe(true);
  for (const result of [null, {}, true, 1, 'malformed', { user: { userId: 'expected' } }, { ...confirmed, passwordUpdated: false },
    { ...confirmed, signInRequired: false }, { ...confirmed, user: { userId: 'different' } }]) {
    expect(isConfirmedPasswordUpdate(result as AuthCompletionResult | null, info)).toBe(false);
  }
});
test('malformed or incomplete inspection cannot render an account or unlock password submission', () => {
  const user = { userId: 'expected', username: 'fixture', email: 'fixture@example.test' };
  const info = { valid: true, type: 'password_reset', expiresAt: Date.now() + 1000, user };
  expect(isPasswordActionInspection(info)).toBe(true);
  for (const value of [null, {}, false, 'malformed', { ...info, user: null }, { ...info, valid: false },
    { ...info, expiresAt: Infinity }, { ...info, user: { ...user, userId: '' } }]) expect(isPasswordActionInspection(value)).toBe(false);
});
test('only the exact native verified-rollback conflict permits explicit read-only recovery after a failed submit', () => {
  expect(passwordActionFailure(new AuthClientError('Conflict', 409, 'AUTH_COMMIT_CONFLICT', { retryable: true }), 'submission'))
    .toMatchObject({ kind: 'rejected', retry: true });
  for (const cause of [new AuthClientError('Unknown', 503, 'AUTH_COMMIT_CONFLICT', { retryable: true }),
    new AuthClientError('Unknown', 409, 'LOGGING_OUTCOME_UNKNOWN', { retryable: true }),
    new AuthClientError('Unqualified', 409, 'AUTH_COMMIT_CONFLICT', null), { code: 'AUTH_COMMIT_CONFLICT', retryable: true }]) {
    expect(passwordActionFailure(cause, 'submission')).toMatchObject({ kind: 'unknown', retry: false });
  }
});
