/** Thin session-only Elysia transport for Guardian's global own-profile service. */

import { Elysia, t } from 'elysia';
import { extractAuthContext } from './auth-context';
import type { AuthUserProfileService } from './auth-user-profile-service';
import type { TokenService } from './token-service';
import { AuthError } from './types';
import { authUsernameSchema } from './auth-request-schema';
import { applyAuthPrivateNoStore } from './auth-response-cache';

export interface AuthUserProfilePluginConfig {
  getTokenService(): TokenService | null;
  getUserProfileService(): AuthUserProfileService | null;
}

const nullableText = (maxLength: number) => t.Union([t.String({ maxLength }), t.Null()]);
export const userProfileChangesSchema = t.Object({
  firstName: t.Optional(nullableText(120)), lastName: t.Optional(nullableText(120)),
  username: t.Optional(authUsernameSchema), preferredName: t.Optional(nullableText(120)),
  bio: t.Optional(nullableText(2000)), website: t.Optional(nullableText(2048)),
  socialLinks: t.Optional(t.Array(t.Object({ label: t.String({ minLength: 1, maxLength: 80 }),
    url: t.String({ minLength: 1, maxLength: 2048 }) }, { additionalProperties: true }), { maxItems: 12 })),
  regional: t.Optional(t.Object({
    locale: t.Optional(nullableText(80)), timeZone: t.Optional(nullableText(100)),
    timeFormat: t.Optional(t.Union([t.Literal('12h'), t.Literal('24h'), t.Null()])),
    weekStartsOn: t.Optional(t.Union([t.Literal(0), t.Literal(1), t.Literal(2),
      t.Literal(3), t.Literal(4), t.Literal(5), t.Literal(6), t.Null()])),
  }, { additionalProperties: true })),
// Preserve unexpected keys for the owning closed, descriptor-safe domain
// validator. Parent plugin normalization must not turn an invalid command into
// a different valid command by dropping its unknown/security fields.
}, { additionalProperties: true, minProperties: 1 });

/** Mount under the owning `/auth` plugin; app APIs/keys are not account-edit authority. */
export function createAuthUserProfilePlugin(config: AuthUserProfilePluginConfig) {
  const actor = async (request: Request) => {
    const tokens = config.getTokenService();
    const profiles = config.getUserProfileService();
    if (!tokens || !profiles) throw new AuthError('Auth not initialized', 'AUTH_NOT_READY', 503);
    const auth = await extractAuthContext(request, tokens);
    if (!auth) throw new AuthError('Unauthorized', 'UNAUTHORIZED', 401);
    return { profiles, auth };
  };
  return new Elysia({ name: 'auth-user-profile', prefix: '/profile' })
    .get('', async ({ request, set }) => {
      applyAuthPrivateNoStore(set);
      const { profiles, auth } = await actor(request);
      return profiles.read(auth);
    })
    .patch('', async ({ request, set, body }) => {
      applyAuthPrivateNoStore(set);
      const { profiles, auth } = await actor(request);
      return profiles.update(auth, body);
    }, { body: t.Object({ expectedRevision: t.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER - 1 }),
      changes: userProfileChangesSchema }, { additionalProperties: true }) });
}
