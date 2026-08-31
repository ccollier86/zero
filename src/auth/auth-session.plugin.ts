/** Composition root for core auth session and identity routes. */

import { Elysia } from 'elysia';
import { createAuthChangePasswordPlugin } from './auth-change-password.plugin';
import { createAuthCurrentUserPlugin } from './auth-current-user.plugin';
import { createAuthLoginPlugin } from './auth-login.plugin';
import { createAuthRegistrationPlugin } from './auth-registration.plugin';
import { createAuthSessionConfigPlugin } from './auth-session-config.plugin';
import type { AuthSessionPluginConfig } from './auth-session-dependencies';
import { createAuthSessionTokenPlugin } from './auth-session-token.plugin';

export type { AuthSessionPluginConfig } from './auth-session-dependencies';

export function createAuthSessionPlugin(config: AuthSessionPluginConfig) {
  return new Elysia({ name: 'auth-session' })
    .use(createAuthSessionConfigPlugin(config))
    .use(createAuthRegistrationPlugin(config))
    .use(createAuthLoginPlugin(config))
    .use(createAuthSessionTokenPlugin(config))
    .use(createAuthChangePasswordPlugin(config))
    .use(createAuthCurrentUserPlugin(config));
}
