/** Composition root for standalone Guardian API-key management routes. */

import { Elysia } from 'elysia';
import { createAuthApiKeyAdminPlugin } from './auth-api-key-admin.plugin';
import type { AuthApiKeyPluginConfig } from './auth-api-key-plugin-dependencies';
import { createAuthApiKeyPlatformPlugin } from './auth-api-key-platform.plugin';
import { createAuthApiKeySelfPlugin } from './auth-api-key-self.plugin';
import { createAuthApiKeyTenantPlugin } from './auth-api-key-tenant.plugin';

export type { AuthApiKeyPluginConfig } from './auth-api-key-plugin-dependencies';

export function createAuthApiKeyPlugin(config: AuthApiKeyPluginConfig) {
  return new Elysia({ name: 'auth-api-key-management' })
    .use(createAuthApiKeySelfPlugin(config))
    .use(createAuthApiKeyAdminPlugin(config))
    .use(createAuthApiKeyTenantPlugin(config))
    .use(createAuthApiKeyPlatformPlugin(config));
}
