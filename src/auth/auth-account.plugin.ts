/** Composition root for public account-lifecycle routes. */

import { Elysia } from 'elysia';
import { createAuthActionTokenPlugin } from './auth-action-token.plugin';
import type { AuthAccountPluginConfig } from './auth-account-dependencies';
import { createAuthEmailVerificationPlugin } from './auth-email-verification.plugin';
import { createAuthPasswordActionPlugin } from './auth-password-action.plugin';
import { createAuthPasswordRecoveryPlugin } from './auth-password-recovery.plugin';
import { createAuthVerificationResendPlugin } from './auth-verification-resend.plugin';

export type { AuthAccountPluginConfig } from './auth-account-dependencies';

export function createAuthAccountPlugin(config: AuthAccountPluginConfig) {
  return new Elysia({ name: 'auth-account' })
    .use(createAuthPasswordRecoveryPlugin(config))
    .use(createAuthVerificationResendPlugin(config))
    .use(createAuthActionTokenPlugin(config))
    .use(createAuthEmailVerificationPlugin(config))
    .use(createAuthPasswordActionPlugin(config));
}
