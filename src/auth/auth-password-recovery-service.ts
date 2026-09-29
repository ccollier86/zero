/** Public password-reset request policy and delivery. */

import { OBS_CODES } from '../observability/codes';
import {
  getAuthAccountEmitter,
  requireAuthEmailOutbox,
  type AuthAccountPluginConfig,
} from './auth-account-dependencies';
import { AuthError } from './types';

export function requestPasswordReset(
  config: AuthAccountPluginConfig,
  input: { email: string; nativeContinuation?: string }
): { ok: true } {
  const accountEmail = config.getAccountEmailService();
  if (!config.getAuthConfig().accountEmails.passwordReset) {
    throw new AuthError(
      'Password reset email is disabled', 'PASSWORD_RESET_DISABLED', 403
    );
  }
  if (!accountEmail) throw new AuthError('Auth not initialized', 'AUTH_NOT_READY', 503);
  accountEmail.assertReady();
  try {
    requireAuthEmailOutbox(config).enqueue({
      kind: 'password_reset', recipient: input.email,
      nativeContinuation: input.nativeContinuation,
    });
  } catch {
    getAuthAccountEmitter(config)(OBS_CODES.AUTH_EMAIL_OUTBOX_DEAD, {
      metadata: { kind: 'password_reset', code: 'EMAIL_OUTBOX_ENQUEUE_FAILED' },
    });
  }
  return { ok: true };
}
