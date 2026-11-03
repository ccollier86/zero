/** Client-only password-link recovery policy. Never treats an inspection failure as proof that a write failed. */
import type { AuthActionTokenInfo, AuthCompletionResult, AuthPasswordUpdatedResult } from '../../frontend/client/auth-types';
import { getAuthErrorCode } from './auth-error';
import { AuthClientError } from '../../frontend/client/auth-errors';

export interface PasswordActionProblem {
  kind: 'missing' | 'invalid' | 'expired' | 'used' | 'mismatch' | 'unavailable' | 'rejected' | 'unknown' | 'suspended';
  title: string;
  description: string;
  retry: boolean;
}

/** Inspect responses must contain the safe account projection before the form can display or submit anything. */
export function isPasswordActionInspection(value: unknown): value is AuthActionTokenInfo {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const info = value as Partial<AuthActionTokenInfo>;
  return info.valid === true && typeof info.type === 'string' && Number.isSafeInteger(info.expiresAt)
    && Number(info.expiresAt) > 0 && Boolean(info.user)
    && typeof info.user?.userId === 'string' && info.user.userId.length > 0
    && typeof info.user?.username === 'string' && info.user.username.length > 0
    && typeof info.user?.email === 'string' && info.user.email.length > 0;
}

/** Static, secret-free copy for links; a network error never asks the user for a bearer token. */
export function passwordActionProblem(kind: PasswordActionProblem['kind']): PasswordActionProblem {
  const messages = {
    missing: ['Open the link in your email', 'Use the full password link from your email to continue.'],
    invalid: ['This password link is no longer valid', 'Open your most recent email link, or request a new one.'],
    expired: ['This password link has expired', 'Request a new link to securely choose a password.'],
    used: ['This password link has already been used', 'If you already updated your password, sign in with it. Otherwise, request a new link.'],
    mismatch: ['This is a different kind of link', 'Open the correct password email for this page.'],
    unavailable: ['We couldn’t check this link', 'There may be a temporary connection or service problem. Try checking the link again.'],
    rejected: ['The password update was not applied', 'The server could not accept this attempt before making the change. Check the link again before trying another save.'],
    unknown: ['We couldn’t confirm the password update', 'Your password may have changed. Try signing in with the new password before requesting another reset. We will not automatically submit it again.'],
    suspended: ['This account is suspended', 'Contact an administrator for help with your account.'],
  } as const;
  const [title, description] = messages[kind];
  return { kind, title, description, retry: kind === 'unavailable' || kind === 'rejected' };
}

/** Classify only known server codes. Unknown write results are never presented as safe to replay. */
export function passwordActionFailure(error: unknown, stage: 'inspection' | 'submission'): PasswordActionProblem {
  const code = getAuthErrorCode(error);
  if (code === 'ACTION_TOKEN_CONSUMED') return passwordActionProblem('used');
  if (code === 'ACTION_TOKEN_EXPIRED') return passwordActionProblem('expired');
  if (code === 'ACTION_TOKEN_INVALID') return passwordActionProblem('invalid');
  if (code === 'ACCOUNT_SUSPENDED') return passwordActionProblem('suspended');
  // This exact native response is emitted only for a verified not-committed
  // database conflict. A generic retryable flag never establishes that fact.
  if (stage === 'submission' && error instanceof AuthClientError && error.status === 409
    && code === 'AUTH_COMMIT_CONFLICT' && error.retryable) return passwordActionProblem('rejected');
  return passwordActionProblem(stage === 'inspection' ? 'unavailable' : 'unknown');
}

/** A null, unrelated or malformed completion must never produce a password-success message. */
export function isConfirmedPasswordUpdate(
  result: AuthCompletionResult | null,
  info: AuthActionTokenInfo,
): result is AuthPasswordUpdatedResult {
  return Boolean(result && typeof result === 'object' && !Array.isArray(result) && 'passwordUpdated' in result && result.passwordUpdated === true
    && result.signInRequired === true && result.user?.userId === info.user.userId);
}
