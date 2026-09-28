/** Elysia composition root for Zero native OpenID Connect endpoints. */

import { Elysia } from 'elysia';
import { buildNativeDiscovery } from './native-discovery';
import { oauthJson } from './native-http';
import type { NativeAuthHttpConfig } from './native-plugin-types';
import { createNativeAuthorizePlugin } from './native-authorize.plugin';
import { createNativeTokenPlugin } from './native-token.plugin';
import { createNativeUserInfoPlugin } from './native-userinfo.plugin';
import { createNativeTenantPlugin } from './native-tenant.plugin';

export function createNativeAuthPlugin(config: NativeAuthHttpConfig) {
  return new Elysia({ name: 'auth-native-oidc' })
    .get('/.well-known/openid-configuration', () =>
      oauthJson(buildNativeDiscovery(config.issuer)))
    .use(createNativeAuthorizePlugin(config))
    .use(createNativeTokenPlugin(config))
    .use(createNativeTenantPlugin(config))
    .use(createNativeUserInfoPlugin(config));
}
