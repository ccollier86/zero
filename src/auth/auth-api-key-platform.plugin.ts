/** Administration-organization API-key review and customer-tenant controls. */

import { Elysia, t } from 'elysia';
import {
  captureAuthApiKeyMutationAuthority,
  requireAuthApiKeyRouteActor,
  type AuthApiKeyPluginConfig,
} from './auth-api-key-plugin-dependencies';
import {
  authApiKeyIdSchema,
  authApiKeyIssueBodySchema,
  authApiKeySubjectIdSchema,
} from './auth-api-key-route-schemas';
import { apiKeysUnavailable } from './auth-api-key-errors';
import { applyAuthPrivateNoStore } from './auth-response-cache';

const platformListQuerySchema = t.Object({
  limit: t.Optional(t.Numeric({ minimum: 1, maximum: 100 })),
  cursor: t.Optional(t.String({ minLength: 1, maxLength: 512 })),
  tenantId: t.Optional(authApiKeySubjectIdSchema),
}, { additionalProperties: false });

const targetParamsSchema = t.Object({
  tenantId: authApiKeySubjectIdSchema,
  membershipId: authApiKeySubjectIdSchema,
}, { additionalProperties: false });

export function createAuthApiKeyPlatformPlugin(config: AuthApiKeyPluginConfig) {
  return new Elysia({ name: 'auth-api-key-platform', prefix: '/platform' })
    .get('/api-keys', async ({ request, query, set }) => {
      applyAuthPrivateNoStore(set);
      const actor = await requirePlatformActor(config, request);
      const authority = captureAuthApiKeyMutationAuthority(actor, request);
      const response = actor.service.listPlatform(actor.auth, query, query.tenantId);
      authority.assertCurrent();
      return response;
    }, { query: platformListQuerySchema })
    .get(
      '/tenants/:tenantId/members/:membershipId/api-keys',
      async ({ request, params, query, set }) => {
        applyAuthPrivateNoStore(set);
        const actor = await requirePlatformActor(config, request);
        const authority = captureAuthApiKeyMutationAuthority(actor, request);
        const response = actor.service.listForPlatformTarget(actor.auth, params, query);
        authority.assertCurrent();
        return response;
      },
      {
        params: targetParamsSchema,
        query: t.Object({
          limit: t.Optional(t.Numeric({ minimum: 1, maximum: 100 })),
          cursor: t.Optional(t.String({ minLength: 1, maxLength: 512 })),
        }, { additionalProperties: false }),
      },
    )
    .post(
      '/tenants/:tenantId/members/:membershipId/api-keys',
      async ({ request, params, body, set }) => {
        applyAuthPrivateNoStore(set);
        const actor = await requirePlatformActor(config, request);
        return actor.service.issueForPlatform(
          captureAuthApiKeyMutationAuthority(actor, request),
          params,
          body,
        );
      },
      { params: targetParamsSchema, body: authApiKeyIssueBodySchema },
    )
    .post('/api-keys/:keyId/rotate', async ({ request, params, body, set }) => {
      applyAuthPrivateNoStore(set);
      const actor = await requirePlatformActor(config, request);
      return actor.service.rotateForPlatform(
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
      const actor = await requirePlatformActor(config, request);
      return actor.service.revokeForPlatform(
        captureAuthApiKeyMutationAuthority(actor, request),
        params.keyId,
      );
    }, {
      params: t.Object({ keyId: authApiKeyIdSchema }, { additionalProperties: false }),
    });
}

async function requirePlatformActor(
  config: AuthApiKeyPluginConfig,
  request: Request,
) {
  const actor = await requireAuthApiKeyRouteActor(config, request);
  if (actor.kernel.tenancy.mode !== 'multi') {
    throw apiKeysUnavailable(
      'Platform API key administration is unavailable in single-tenant mode',
    );
  }
  return actor;
}
