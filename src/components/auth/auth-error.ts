/**
 * auth-error.ts
 *
 * Normalizes auth UI errors from the frontend SDK. This file owns display
 * mapping and observability reporting only; it does not render components or
 * perform auth mutations.
 */

import { AuthClientError } from '../../frontend/client/auth-client';
import { reportAuthClientActionFailure } from '../../frontend/client/auth-action-observability';

/** Return the backend auth error code carried by an SDK error, if present. */
export function getAuthErrorCode(error: unknown): string | null {
  if (error instanceof AuthClientError) return error.code;
  if (error && typeof error === 'object' && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    return typeof code === 'string' ? code : null;
  }
  return null;
}

/** Return a user-facing auth error message with lifecycle-specific wording. */
export function getAuthDisplayMessage(error: unknown, fallback: string): string {
  const code = getAuthErrorCode(error);
  if (code === 'PASSWORD_CHANGE_REQUIRED') {
    return 'This account requires a password reset. Use the emailed reset link or request a new one.';
  }
  if (code === 'ACCOUNT_SUSPENDED') {
    return 'This account is suspended. Contact an administrator.';
  }
  if (code === 'REGISTRATION_DISABLED') {
    return 'Public registration is closed for this app.';
  }
  if (code === 'BOOTSTRAP_AUTHORIZATION_FAILED') {
    return 'The operator setup key is invalid.';
  }
  if (code === 'BOOTSTRAP_UNAVAILABLE') {
    return 'First-administrator setup has not been enabled by the deployment operator.';
  }
  if (code === 'BOOTSTRAP_NOT_REQUIRED') {
    return 'First-administrator setup is already complete.';
  }
  if (code === 'PASSWORD_RESET_DISABLED') {
    return 'Password reset email is not enabled for this app.';
  }
  if (code === 'EMAIL_NOT_CONFIGURED' || code === 'EMAIL_PUBLIC_URL_REQUIRED') {
    return 'Password reset email is not configured yet.';
  }
  if (code === 'ACTION_TOKEN_EXPIRED') {
    return 'This link has expired. Request a new one.';
  }
  if (code === 'ACTION_TOKEN_CONSUMED') {
    return 'This link has already been used.';
  }
  if (code === 'ACTION_TOKEN_INVALID') {
    return 'This link is invalid.';
  }
  if (error instanceof Error) return error.message;
  return fallback;
}

/** Emit an auth UI failure through Zero's frontend observability boundary. */
export function reportAuthUiError(action: string, error: unknown): void {
  reportAuthClientActionFailure(action, error);
}
