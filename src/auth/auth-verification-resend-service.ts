/** Public email-verification resend policy and delivery. */

import { OBS_CODES } from '../observability/codes';
import { emitPlatformCode } from '../observability/sink';
import {
  requireAuthEmailOutbox,
  type AuthAccountPluginConfig,
} from './auth-account-dependencies';
import { AuthError } from './types';

export function resendEmailVerification(
  config: AuthAccountPluginConfig,
  input: { email: string; nativeContinuation?: string }
): { ok: true } {
  const authConfig = config.getAuthConfig();
  if (!authConfig.account.requireEmailVerification) {
    throw new AuthError(
      'Email verification is disabled', 'EMAIL_VERIFICATION_DISABLED', 403
    );
  }
  const accountEmail = config.getAccountEmailService();
  if (!accountEmail) throw new AuthError('Auth not initialized', 'AUTH_NOT_READY', 503);
  accountEmail.assertReady();
  try {
    requireAuthEmailOutbox(config).enqueue({
      kind: 'email_verification', recipient: input.email,
      nativeContinuation: input.nativeContinuation,
    });
  } catch {
    emitPlatformCode(OBS_CODES.AUTH_EMAIL_OUTBOX_DEAD, {
      metadata: { kind: 'email_verification', code: 'EMAIL_OUTBOX_ENQUEUE_FAILED' },
    });
  }
  return { ok: true };
}
