/** Tenant selection, live tenant listing, and refresh-family session switching. */

import { Elysia, t } from 'elysia';
import {
  requireSessionServices,
  type AuthSessionPluginConfig,
} from './auth-session-dependencies';
import { authTokenSchema } from './auth-request-schema';
import { toAuthUserResponse } from './auth-user-response';
import { syncPageSessionCookie } from './page-session';
import { authAuditRequestFromRequest } from './auth-audit-service';

const tenantIdSchema = t.String({
  minLength: 1,
  maxLength: 128,
  pattern: '^[A-Za-z0-9_-]+$',
});

export function createAuthTenantSessionPlugin(config: AuthSessionPluginConfig) {
  return new Elysia({ name: 'auth-tenant-session', prefix: '/tenants' })
    .post(
      '/create',
      async ({ body, request, set }) => {
        const { tenantSessions, tokenService } = requireSessionServices(config);
        const created = await tenantSessions.createTenant({
          name: body.name,
          slug: body.slug,
          continuation: body.continuation,
          refreshToken: body.refreshToken,
          auditRequest: authAuditRequestFromRequest(request),
        });
        const response = {
          user: toAuthUserResponse(created.user),
          accessToken: created.tokens.accessToken,
          refreshToken: created.tokens.refreshToken,
          activeTenant: created.tenant,
        };
        await syncPageSessionCookie(set, request, tokenService, response, {
          clearWhenMissing: true,
        });
        return response;
      },
      {
        body: t.Object({
          name: t.String({ minLength: 1, maxLength: 120 }),
          slug: t.Optional(t.String({
            minLength: 1,
            maxLength: 63,
            pattern: '^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$',
          })),
          continuation: t.Optional(authTokenSchema),
          refreshToken: t.Optional(authTokenSchema),
        }),
      },
    )
    .post(
      '/select',
      async ({ body, request, set }) => {
        const { tenantSessions, tokenService } = requireSessionServices(config);
        const selected = await tenantSessions.selectTenant(
          body.continuation,
          body.tenantId,
          authAuditRequestFromRequest(request),
        );
        const response = {
          user: toAuthUserResponse(selected.user),
          accessToken: selected.completion.tokens.accessToken,
          refreshToken: selected.completion.tokens.refreshToken,
          activeTenant: selected.completion.tenant,
        };
        await syncPageSessionCookie(set, request, tokenService, response, {
          clearWhenMissing: true,
        });
        return response;
      },
      {
        body: t.Object({
          continuation: authTokenSchema,
          tenantId: tenantIdSchema,
        }),
      },
    )
    .post(
      '/list',
      ({ body }) => {
        const { tenantSessions } = requireSessionServices(config);
        return tenantSessions.resolveTenantList(body.refreshToken);
      },
      { body: t.Object({ refreshToken: authTokenSchema }) },
    )
    .post(
      '/switch',
      async ({ body, request, set }) => {
        const { tenantSessions, tokenService } = requireSessionServices(config);
        const switched = await tenantSessions.switchTenant(
          body.refreshToken,
          body.tenantId,
          authAuditRequestFromRequest(request),
        );
        const response = {
          user: toAuthUserResponse(switched.user),
          accessToken: switched.tokens.accessToken,
          refreshToken: switched.tokens.refreshToken,
          activeTenant: switched.tenant,
        };
        await syncPageSessionCookie(set, request, tokenService, response);
        return response;
      },
      {
        body: t.Object({
          refreshToken: authTokenSchema,
          tenantId: tenantIdSchema,
        }),
      },
    );
}
