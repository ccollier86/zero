/** Current-user API-key management routes. */

import { Elysia, t } from 'elysia';
import { withAuthCommitAdmission } from './auth-commit-admission';
import {
  captureAuthApiKeyMutationAuthority,
  requireAuthApiKeyRouteActor,
  type AuthApiKeyPluginConfig,
} from './auth-api-key-plugin-dependencies';
import {
  authApiKeyIdSchema,
  authApiKeyIssueBodySchema,
  authApiKeyListQuerySchema,
} from './auth-api-key-route-schemas';
import { applyAuthPrivateNoStore } from './auth-response-cache';

export function createAuthApiKeySelfPlugin(config: AuthApiKeyPluginConfig) {
  return new Elysia({ name: 'auth-api-key-self' })
    .get('/api-keys', async ({ request, query, set }) => {
      applyAuthPrivateNoStore(set);
      const actor = await requireAuthApiKeyRouteActor(config, request);
      const authority = captureAuthApiKeyMutationAuthority(actor, request);
      const response = actor.service.listSelf(actor.auth, query);
      authority.assertCurrent();
      return response;
    }, { query: authApiKeyListQuerySchema })
    .post('/api-keys', async ({ request, body, set }) => {
      applyAuthPrivateNoStore(set);
      const actor = await requireAuthApiKeyRouteActor(config, request);
      const authority = captureAuthApiKeyMutationAuthority(actor, request);
      return withAuthCommitAdmission(actor.store, () => actor.service.issueSelf(
        authority,
        body,
      ), request.signal);
    }, { body: authApiKeyIssueBodySchema })
    .post('/api-keys/:keyId/rotate', async ({ request, params, body, set }) => {
      applyAuthPrivateNoStore(set);
      const actor = await requireAuthApiKeyRouteActor(config, request);
      const authority = captureAuthApiKeyMutationAuthority(actor, request);
      return withAuthCommitAdmission(actor.store, () => actor.service.rotateSelf(
        authority,
        params.keyId,
        body,
      ), request.signal);
    }, {
      params: t.Object({ keyId: authApiKeyIdSchema }, { additionalProperties: false }),
      body: authApiKeyIssueBodySchema,
    })
    .delete('/api-keys/:keyId', async ({ request, params, set }) => {
      applyAuthPrivateNoStore(set);
      const actor = await requireAuthApiKeyRouteActor(config, request);
      const authority = captureAuthApiKeyMutationAuthority(actor, request);
      return withAuthCommitAdmission(actor.store, () => actor.service.revokeSelf(
        authority,
        params.keyId,
      ), request.signal);
    }, {
      params: t.Object({ keyId: authApiKeyIdSchema }, { additionalProperties: false }),
    });
}
