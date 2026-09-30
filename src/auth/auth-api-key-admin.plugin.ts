/** Single-application administrator API-key management routes. */

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
  authApiKeySubjectIdSchema,
} from './auth-api-key-route-schemas';
import { apiKeysUnavailable } from './auth-api-key-errors';
import { applyAuthPrivateNoStore } from './auth-response-cache';

export function createAuthApiKeyAdminPlugin(config: AuthApiKeyPluginConfig) {
  return new Elysia({ name: 'auth-api-key-admin', prefix: '/admin' })
    .get('/users/:userId/api-keys', async ({ request, params, query, set }) => {
      applyAuthPrivateNoStore(set);
      const actor = await requireSingleActor(config, request);
      const authority = captureAuthApiKeyMutationAuthority(actor, request);
      const response = actor.service.listForAdministrator(
        actor.auth,
        { userId: params.userId },
        query,
      );
      authority.assertCurrent();
      return response;
    }, {
      params: t.Object({ userId: authApiKeySubjectIdSchema }, {
        additionalProperties: false,
      }),
      query: authApiKeyListQuerySchema,
    })
    .post('/users/:userId/api-keys', async ({ request, params, body, set }) => {
      applyAuthPrivateNoStore(set);
      const actor = await requireSingleActor(config, request);
      return actor.service.issueForAdministrator(
        captureAuthApiKeyMutationAuthority(actor, request),
        { userId: params.userId },
        body,
      );
    }, {
      params: t.Object({ userId: authApiKeySubjectIdSchema }, {
        additionalProperties: false,
      }),
      body: authApiKeyIssueBodySchema,
    })
    .post('/api-keys/:keyId/rotate', async ({ request, params, body, set }) => {
      applyAuthPrivateNoStore(set);
      const actor = await requireSingleActor(config, request);
      return actor.service.rotateForAdministrator(
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
      const actor = await requireSingleActor(config, request);
      return actor.service.revokeForAdministrator(
        captureAuthApiKeyMutationAuthority(actor, request),
        params.keyId,
      );
    }, {
      params: t.Object({ keyId: authApiKeyIdSchema }, { additionalProperties: false }),
    });
}

async function requireSingleActor(
  config: AuthApiKeyPluginConfig,
  request: Request,
) {
  const actor = await requireAuthApiKeyRouteActor(config, request);
  if (actor.kernel.tenancy.mode !== 'single') {
    throw apiKeysUnavailable(
      'Application API key administration is unavailable in multi-tenant mode',
    );
  }
  return actor;
}
