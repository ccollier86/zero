/**
 * auth-admin.plugin.ts
 *
 * Composition root for administrator auth controllers. Domain policy,
 * persistence, validation, and route groups live in focused modules.
 */

import { Elysia } from 'elysia';
import type { AuthAdminPluginConfig } from './auth-admin-dependencies';
import { createAuthAdminEmailVerificationPlugin } from './auth-admin-email-verification.plugin';
import { createAuthAdminMfaPlugin } from './auth-admin-mfa.plugin';
import { createAuthAdminPasswordPlugin } from './auth-admin-password.plugin';
import { createAuthAdminPropertiesPlugin } from './auth-admin-properties.plugin';
import { createAuthAdminQueryPlugin } from './auth-admin-query.plugin';
import { createAuthAdminStatusPlugin } from './auth-admin-status.plugin';
import { createAuthAdminUserCreatePlugin } from './auth-admin-user-create.plugin';
import { createAuthAdminUserUpdatePlugin } from './auth-admin-user-update.plugin';

export type { AuthAdminPluginConfig } from './auth-admin-dependencies';

/** Compose administrator routes mounted under `/auth/admin`. */
export function createAuthAdminPlugin(config: AuthAdminPluginConfig) {
  return new Elysia({ name: 'auth-admin', prefix: '/admin' })
    .use(createAuthAdminQueryPlugin(config))
    .use(createAuthAdminUserCreatePlugin(config))
    .use(createAuthAdminUserUpdatePlugin(config))
    .use(createAuthAdminPropertiesPlugin(config))
    .use(createAuthAdminPasswordPlugin(config))
    .use(createAuthAdminStatusPlugin(config))
    .use(createAuthAdminMfaPlugin(config))
    .use(createAuthAdminEmailVerificationPlugin(config));
}
