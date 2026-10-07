/** Restricted identity-only profile transport. The continuation is not an app Bearer token. */
import { Elysia, t } from 'elysia';
import type { AuthUserProfileCompletionService } from './auth-user-profile-completion-service';
import type { AuthRequestAdmissionService } from './auth-request-admission-service';
import { userProfileChangesSchema } from './auth-user-profile.plugin';
import { applyAuthPrivateNoStore } from './auth-response-cache';
import { admitAuthRequest } from './auth-request-admission';
import { mapAuthSessionCompletion } from './auth-mfa-response';
import { AuthError } from './types';
import type { TokenService } from './token-service';
import { syncPageSessionCookie } from './page-session';

export function createAuthUserProfileCompletionPlugin(config: {
  getUserProfileCompletionService(): AuthUserProfileCompletionService | null;
  getRequestAdmissionService(): AuthRequestAdmissionService | null;
  getTokenService(): TokenService | null;
}) {
  const service = () => {
    const value = config.getUserProfileCompletionService();
    if (!value) throw new AuthError('Profile completion unavailable', 'AUTH_PROFILE_COMPLETION_NOT_READY', 503);
    return value;
  };
  const token = t.String({ minLength: 40, maxLength: 200 });
  return new Elysia({ name: 'auth-profile-completion', prefix: '/profile/completion' })
    .post('/inspect', ({ request, body, set, server }) => {
      applyAuthPrivateNoStore(set);
      admitAuthRequest({ service: config.getRequestAdmissionService(), request, peerAddress: server?.requestIP(request)?.address,
        flow: 'login', subject: body.continuation });
      return service().read(body);
    }, { body: t.Object({ continuation: token }, { additionalProperties: true }) })
    .post('', async ({ request, body, set, server }) => {
      applyAuthPrivateNoStore(set);
      admitAuthRequest({ service: config.getRequestAdmissionService(), request, peerAddress: server?.requestIP(request)?.address,
        flow: 'login', subject: body.continuation });
      const result = await service().complete(body);
      const response = mapAuthSessionCompletion(result.user, result.completion);
      const tokens = config.getTokenService();
      if (!tokens) throw new AuthError('Auth not initialized', 'AUTH_NOT_READY', 503);
      await syncPageSessionCookie(set, request, tokens, response, { clearWhenMissing: true });
      return response;
    }, { body: t.Object({ continuation: token,
      expectedRevision: t.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER - 1 }),
      changes: userProfileChangesSchema }, { additionalProperties: true }) });
}
