/** Current-user API-key management routes. */

import { Elysia, t } from 'elysia';
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
      return actor.service.issueSelf(
        captureAuthApiKeyMutationAuthority(actor, request),
        body,
      );
    }, { body: authApiKeyIssueBodySchema })
    .post('/api-keys/:keyId/rotate', async ({ request, params, body, set }) => {
      applyAuthPrivateNoStore(set);
      const actor = await requireAuthApiKeyRouteActor(config, request);
      return actor.service.rotateSelf(
        captureAuthApiKeyMutationAuthority(actor, request),
        params.keyId,
        body,
      );
    }, {
      params: t.Object({ keyId: authApiKeyIdSchema }, { additionalProperties: false }),
      body: authApiKeyIssueBodySchema,
    })
    .delete('/api-keys/:keyId', async ({ request, params, set }) => {
      applyAuthPrivateNoStore(set);
      const actor = await requireAuthApiKeyRouteActor(config, request);
      return actor.service.revokeSelf(
        captureAuthApiKeyMutationAuthority(actor, request),
        params.keyId,
      );
    }, {
      params: t.Object({ keyId: authApiKeyIdSchema }, { additionalProperties: false }),
    });
}
