/** Forgot-password HTTP route and canonical email validation. */

import { Elysia, t } from 'elysia';
import type { AuthAccountPluginConfig } from './auth-account-dependencies';
import { canonicalEmailSchema } from './auth-email-schema';
import { requestPasswordReset } from './auth-password-recovery-service';
import { authNativeContinuationSchema } from './auth-request-schema';

export function createAuthPasswordRecoveryPlugin(config: AuthAccountPluginConfig) {
  return new Elysia({ name: 'auth-password-recovery' }).post(
    '/forgot-password',
    ({ body }) => requestPasswordReset(config, body),
    {
      body: t.Object({
        email: canonicalEmailSchema,
        nativeContinuation: t.Optional(authNativeContinuationSchema),
      }),
    }
  );
}
