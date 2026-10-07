/** Thin private Elysia transport; domain service owns storage, credentials and mutation receipts. */
import { Elysia, t } from 'elysia';
import type { AuthUserAvatarService } from './auth-user-avatar-service';
import type { TokenService } from './token-service';
import { extractAuthContext } from './auth-context';
import { AuthError } from './types';
import { applyAuthPrivateNoStore } from './auth-response-cache';
import { getPublicAuthErrorMessage } from './auth-error-response';

export interface AuthUserAvatarPluginConfig {
  getService(): AuthUserAvatarService | null;
  getTokenService(): TokenService | null;
}
const revision = t.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER - 1 });
const proof = t.Object({ receipt: t.String({ pattern: '^[a-f0-9]{64}$' }) }, { additionalProperties: false });
const stageParams = t.Object({ stageId: t.String({ pattern: '^avs_[a-f0-9-]{36}$' }) });
export function createAuthUserAvatarPlugin(config: AuthUserAvatarPluginConfig) {
  const actor = async (request: Request) => {
    const service = config.getService(), tokens = config.getTokenService();
    if (!tokens || !service) throw new AuthError('Avatar services are unavailable', 'AUTH_AVATAR_NOT_READY', 503);
    const auth = await extractAuthContext(request, tokens);
    if (!auth) throw new AuthError('Unauthorized', 'UNAUTHORIZED', 401);
    return { service, auth };
  };
  return new Elysia({ name: 'guardian-user-avatar', prefix: '/auth/profile/avatar' })
    .onRequest(({ set }) => { applyAuthPrivateNoStore(set); })
    .onError(({ error, code, set }) => {
      if (code === 'VALIDATION' || code === 'PARSE') {
        set.status = code === 'VALIDATION' ? 422 : 400;
        return { error: 'Invalid avatar request', code: 'AUTH_AVATAR_VALIDATION_FAILED' };
      }
      if (!(error instanceof AuthError)) return;
      applyAuthPrivateNoStore(set); set.status = error.status;
      return { error: getPublicAuthErrorMessage(error), code: error.code };
    })
    .get('', async ({ request, set }) => { applyAuthPrivateNoStore(set); const { service, auth } = await actor(request); return service.read(auth); })
    .get('/users/:userId', async ({ request, params, set }) => {
      applyAuthPrivateNoStore(set); const { service, auth } = await actor(request); return service.directory(auth, params.userId);
    }, { params: t.Object({ userId: t.String({ minLength: 1, maxLength: 256 }) }) })
    .get('/assets/:assetId', async ({ request, params }) => {
      const { service, auth } = await actor(request), delivered = await service.download(auth, params.assetId);
      return new Response(delivered.stream, { headers: { 'Content-Type': 'image/webp', 'Content-Length': String(delivered.size),
        'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Cross-Origin-Resource-Policy': 'same-origin' } });
    }, { params: t.Object({ assetId: t.String({ pattern: '^ava_[a-f0-9-]{36}$' }) }) })
    .post('/stages', async ({ request, body, set }) => { applyAuthPrivateNoStore(set); const { service, auth } = await actor(request); return service.stage(auth, body.expectedRevision); },
      { body: t.Object({ expectedRevision: revision }, { additionalProperties: false }) })
    .post('/stages/:stageId/finalize', async ({ request, params, body, set }) => {
      applyAuthPrivateNoStore(set); const { service, auth } = await actor(request); return service.finalize(auth, params.stageId, body.receipt);
    }, { params: stageParams, body: proof })
    .delete('/stages/:stageId', async ({ request, params, body, set }) => {
      applyAuthPrivateNoStore(set); const { service, auth } = await actor(request); service.cancel(auth, params.stageId, body.receipt); return { cancelled: true };
    }, { params: stageParams, body: proof })
    .delete('', async ({ request, body, set }) => { applyAuthPrivateNoStore(set); const { service, auth } = await actor(request); return service.remove(auth, body.expectedRevision); },
      { body: t.Object({ expectedRevision: revision }, { additionalProperties: false }) });
}
