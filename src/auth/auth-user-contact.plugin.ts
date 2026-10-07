/** Thin Elysia own-contact routes; writes and proofs remain service-owned. */
import { Elysia, t } from 'elysia';
import { extractAuthContext } from './auth-context';
import { admitAuthRequest } from './auth-request-admission';
import { applyAuthPrivateNoStore } from './auth-response-cache';
import type { AuthRequestAdmissionService } from './auth-request-admission-service';
import type { AuthUserContactService } from './auth-user-contact-service';
import type { TokenService } from './token-service';
import { AuthError } from './types';

interface UserContactPluginConfig {
  getTokenService(): TokenService | null;
  getUserContactService(): AuthUserContactService | null;
  getRequestAdmissionService(): AuthRequestAdmissionService | null;
}
const revision = t.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER - 1 });
const revisionBody = t.Object({ expectedRevision: revision }, { additionalProperties: false });
const challengeId = t.String({ pattern: '^acc_[a-f0-9-]{36}$', maxLength: 64 });

export function createAuthUserContactPlugin(config: UserContactPluginConfig) {
  const service = () => {
    const value = config.getUserContactService();
    if (!value) throw new AuthError('Auth not initialized', 'AUTH_NOT_READY', 503);
    return value;
  };
  const actor = async (request: Request) => {
    const tokens = config.getTokenService();
    if (!tokens) throw new AuthError('Auth not initialized', 'AUTH_NOT_READY', 503);
    const auth = await extractAuthContext(request, tokens);
    if (!auth) throw new AuthError('Unauthorized', 'UNAUTHORIZED', 401);
    return auth;
  };
  const admit = (request: Request, subject: string, peerAddress?: string | null) => admitAuthRequest({
    service: config.getRequestAdmissionService(), request, subject, peerAddress, flow: 'login' });
  return new Elysia({ name: 'auth-user-contacts', prefix: '/profile/contacts' })
    .get('', async ({ request, set }) => { applyAuthPrivateNoStore(set); return service().read(await actor(request)); })
    .patch('/phone', async ({ request, set, body, server }) => {
      applyAuthPrivateNoStore(set); const auth = await actor(request);
      admit(request, `contact:${auth.userId}`, server?.requestIP(request)?.address);
      return service().setPhone(auth, body);
    }, { body: t.Object({ expectedRevision: revision, phone: t.Union([t.String({ maxLength: 16 }), t.Null()]) }, { additionalProperties: false }) })
    .post('/email/verify', async ({ request, set, body, server }) => {
      applyAuthPrivateNoStore(set); const auth = await actor(request);
      admit(request, `contact:${auth.userId}`, server?.requestIP(request)?.address);
      return service().requestEmailVerification(auth, body);
    }, { body: revisionBody })
    .post('/email/change', async ({ request, set, body, server }) => {
      applyAuthPrivateNoStore(set); const auth = await actor(request);
      admit(request, `contact:${auth.userId}`, server?.requestIP(request)?.address);
      return service().requestEmailChange(auth, body);
    }, { body: t.Object({ expectedRevision: revision, email: t.String({ minLength: 1, maxLength: 254 }),
      currentPassword: t.String({ minLength: 1, maxLength: 1024 }) }, { additionalProperties: false }) })
    .post('/email/complete', ({ request, set, body, server }) => {
      applyAuthPrivateNoStore(set); admit(request, body.token, server?.requestIP(request)?.address);
      return service().completeEmail(body);
    }, { body: t.Object({ token: t.String({ minLength: 1, maxLength: 512 }) }, { additionalProperties: false }) })
    .post('/phone/verify', async ({ request, set, body, server }) => {
      applyAuthPrivateNoStore(set); const auth = await actor(request);
      admit(request, `contact:${auth.userId}`, server?.requestIP(request)?.address);
      return service().requestPhoneVerification(auth, body);
    }, { body: revisionBody })
    .post('/phone/complete', async ({ request, set, body, server }) => {
      applyAuthPrivateNoStore(set); const auth = await actor(request);
      admit(request, `contact:${auth.userId}`, server?.requestIP(request)?.address);
      return service().completePhone(auth, body);
    }, { body: t.Object({ expectedRevision: revision, challengeId,
      code: t.String({ minLength: 1, maxLength: 32 }) }, { additionalProperties: false }) })
    .delete('/challenge', async ({ request, set, body }) => {
      applyAuthPrivateNoStore(set); return service().cancel(await actor(request), body);
    }, { body: t.Object({ expectedRevision: revision, challengeId }, { additionalProperties: false }) });
}
