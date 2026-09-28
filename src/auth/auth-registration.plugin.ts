/** Self-service registration HTTP route and request validation. */

import { Elysia, t } from 'elysia';
import { canonicalEmailSchema } from './auth-email-schema';
import {
  authDisplayNameSchema,
  authNativeContinuationSchema,
  authNewPasswordSchema,
  authTokenSchema,
  authUsernameSchema,
} from './auth-request-schema';
import { registerUser } from './auth-registration-service';
import { admitAuthRequest } from './auth-request-admission';
import {
  requireSessionTokenService,
  type AuthSessionPluginConfig,
} from './auth-session-dependencies';
import { syncPageSessionCookie } from './page-session';
import { authAuditRequestFromRequest } from './auth-audit-service';

export function createAuthRegistrationPlugin(config: AuthSessionPluginConfig) {
  return new Elysia({ name: 'auth-registration' }).post(
    '/register',
    async ({ body, request, set, server }) => {
      admitAuthRequest({
        service: config.getRequestAdmissionService?.() ?? null,
        request,
        peerAddress: server?.requestIP(request)?.address,
        flow: config.getUserStore()?.isBootstrapRequired()
          ? 'bootstrap'
          : 'registration',
        subject: body.email,
      });
      const response = await registerUser(
        config,
        body,
        authAuditRequestFromRequest(request),
      );
      await syncPageSessionCookie(
        set, request, requireSessionTokenService(config), response,
        { clearWhenMissing: true }
      );
      return response;
    },
    {
      body: t.Object({
        username: authUsernameSchema,
        email: canonicalEmailSchema,
        password: authNewPasswordSchema,
        firstName: t.Optional(authDisplayNameSchema),
        lastName: t.Optional(authDisplayNameSchema),
        mfaEnrollment: t.Optional(t.Boolean()),
        nativeContinuation: t.Optional(authNativeContinuationSchema),
        bootstrapSecret: t.Optional(authTokenSchema),
        organizationName: t.Optional(t.String({ minLength: 1, maxLength: 120 })),
        organizationSlug: t.Optional(t.String({
          minLength: 1,
          maxLength: 63,
          pattern: '^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$',
        })),
      }),
    }
  );
}
