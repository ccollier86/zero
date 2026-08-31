/** OpenID Connect UserInfo mapped from the same live Zero user principal. */

import { Elysia } from 'elysia';
import { extractAuthContext } from '../auth-context';
import { oauthJson } from './native-http';
import type { NativeAuthHttpConfig } from './native-plugin-types';

export function createNativeUserInfoPlugin(config: NativeAuthHttpConfig) {
  return new Elysia({ name: 'auth-native-userinfo' })
    .get('/oauth/userinfo', ({ request }) => userInfo(config, request))
    .post('/oauth/userinfo', ({ request }) => userInfo(config, request));
}

async function userInfo(config: NativeAuthHttpConfig, request: Request): Promise<Response> {
  const tokens = config.getTokenService();
  const store = config.getUserStore();
  if (!tokens || !store) return invalidToken();
  const auth = await extractAuthContext(request, tokens);
  if (!auth || auth.sessionKind !== 'native' || !auth.scope?.includes('openid')) {
    return invalidToken();
  }
  const user = store.getUserById(auth.userId);
  if (!user) return invalidToken();
  const profile = auth.scope.includes('profile');
  const email = auth.scope.includes('email');
  const name = [user.firstName, user.lastName].filter(Boolean).join(' ');
  return oauthJson({
    sub: user.userId,
    preferred_username: profile ? user.username : undefined,
    name: profile ? name || undefined : undefined,
    given_name: profile ? user.firstName ?? undefined : undefined,
    family_name: profile ? user.lastName ?? undefined : undefined,
    email: email ? user.email : undefined,
    email_verified: email ? Boolean(user.emailVerifiedAt) : undefined,
  });
}

function invalidToken(): Response {
  return new Response(JSON.stringify({ error: 'invalid_token' }), {
    status: 401,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      Pragma: 'no-cache',
      'WWW-Authenticate': 'Bearer error="invalid_token"',
    },
  });
}
