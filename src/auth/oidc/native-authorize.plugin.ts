/** External-browser authorization and same-origin confirmation routes. */

import { Elysia } from 'elysia';
import { authorizeNativeGet } from './native-authorize-get';
import { authorizeNativePost } from './native-authorize-post';
import type { NativeAuthHttpConfig } from './native-plugin-types';

export function createNativeAuthorizePlugin(config: NativeAuthHttpConfig) {
  return new Elysia({ name: 'auth-native-authorize' })
    .get('/oauth/authorize', ({ request, server }) => authorizeNativeGet(
      config, request, server?.requestIP(request)?.address,
    ))
    .post('/oauth/authorize', ({ request }) => authorizeNativePost(config, request));
}
