/** Email-verification resend HTTP route. */

import { Elysia, t } from 'elysia';
import type { AuthAccountPluginConfig } from './auth-account-dependencies';
import { canonicalEmailSchema } from './auth-email-schema';
import { authNativeContinuationSchema } from './auth-request-schema';
import { resendEmailVerification } from './auth-verification-resend-service';

export function createAuthVerificationResendPlugin(config: AuthAccountPluginConfig) {
  return new Elysia({ name: 'auth-verification-resend' }).post(
    '/resend-verification',
    ({ body }) => resendEmailVerification(config, body),
    {
      body: t.Object({
        email: canonicalEmailSchema,
        nativeContinuation: t.Optional(authNativeContinuationSchema),
        // Compatibility-only: the durable server-side registration intent wins.
        mfaEnrollment: t.Optional(t.Boolean()),
      }),
    }
  );
}
