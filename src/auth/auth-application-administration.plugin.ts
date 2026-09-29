/** Single/advanced application-role administration routes. */

import { Elysia, t } from 'elysia';
import { createRequestAuthorizationAccess } from './authorization-access';
import type { AuthorizationKernel } from './authorization-kernel';
import type { AuthorizationRoleService } from './authorization-role-service';
import type { AuthApplicationAdministrationService } from './auth-application-administration-service';
import { extractAuthContext } from './auth-context';
import type { TokenService } from './token-service';
import type { UserStore } from './user-store';
import { AuthError, type AuthContext } from './types';
import { authAuditRequestFromRequest } from './auth-audit-service';
import { applyAuthPrivateNoStore } from './auth-response-cache';
import {
  captureAuthApplicationMutationAuthority,
  type AssertAuthApplicationMutationAuthority,
} from './auth-application-mutation-authority';

const userIdSchema = t.String({
  minLength: 1,
  maxLength: 200,
  pattern: '^[A-Za-z0-9_-]+$',
});
const roleKeySchema = t.String({
  minLength: 1,
  maxLength: 64,
  pattern: '^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$',
});

export interface AuthApplicationAdministrationPluginConfig {
  getUserStore: () => UserStore | null;
  getTokenService: () => TokenService | null;
  getAuthorizationKernel: () => AuthorizationKernel;
  getAuthorizationRoleService: () => AuthorizationRoleService | null;
  getApplicationAdministrationService: () => AuthApplicationAdministrationService | null;
}

interface ApplicationActor {
  auth: AuthContext;
  service: AuthApplicationAdministrationService;
  access: ReturnType<typeof createRequestAuthorizationAccess>;
  kernel: AuthorizationKernel;
  store: UserStore;
  tokenService: TokenService;
  roles: AuthorizationRoleService;
  assertCurrentAuthority: AssertAuthApplicationMutationAuthority;
}

/** Mount below `/auth`; this namespace never accepts tenant scope input. */
export function createAuthApplicationAdministrationPlugin(
  config: AuthApplicationAdministrationPluginConfig,
) {
  return new Elysia({ name: 'auth-application-administration', prefix: '/application' })
    .get('/config', async ({ request, set }) => {
      applyAuthPrivateNoStore(set);
      const actor = await requireApplicationActor(config, request);
      actor.access.requirePermission('application.roles:read');
      const response = actor.service.getConfig(actor.auth.userId);
      actor.assertCurrentAuthority(['application.roles:read']);
      return response;
    })
    .get('/users', async ({ request, query, set }) => {
      applyAuthPrivateNoStore(set);
      const actor = await requireApplicationActor(config, request);
      actor.access.requirePermission('application.roles:read');
      const response = actor.service.listUsers(actor.auth.userId, {
        limit: query.limit,
        cursor: query.cursor,
        search: query.search,
        status: query.status,
      });
      actor.assertCurrentAuthority(['application.roles:read']);
      return response;
    }, {
      query: t.Object({
        limit: t.Optional(t.Numeric({ minimum: 1, maximum: 100 })),
        cursor: t.Optional(t.String({ minLength: 1, maxLength: 512 })),
        search: t.Optional(t.String({ maxLength: 120 })),
        status: t.Optional(t.Union([t.Literal('active'), t.Literal('suspended')])),
      }, { additionalProperties: false }),
    })
    .patch('/users/:userId/roles', async ({ request, params, body, set }) => {
      applyAuthPrivateNoStore(set);
      const actor = await requireApplicationActor(config, request);
      actor.access.requirePermission('application.roles:manage');
      return actor.service.replaceUserRoles({
        actorUserId: actor.auth.userId,
        assertCurrentAuthority: captureAuthApplicationMutationAuthority({
          auth: actor.auth,
          tokenService: actor.tokenService,
          kernel: actor.kernel,
          store: actor.store,
          roles: actor.roles,
        }),
        auditRequest: authAuditRequestFromRequest(request),
        userId: params.userId,
        roleKeys: body.roles,
        expectedRevision: body.expectedRevision,
      });
    }, {
      params: t.Object({ userId: userIdSchema }, { additionalProperties: false }),
      body: t.Object({
        roles: t.Array(roleKeySchema, { maxItems: 128, uniqueItems: true }),
        expectedRevision: t.String({ minLength: 1, maxLength: 256 }),
      }, { additionalProperties: false }),
    })
    .post('/ownership/transfer', async ({ request, body, set }) => {
      applyAuthPrivateNoStore(set);
      const actor = await requireApplicationActor(config, request);
      actor.access.requirePermission('application.roles:manage');
      return actor.service.transferOwnership({
        actorUserId: actor.auth.userId,
        assertCurrentAuthority: captureAuthApplicationMutationAuthority({
          auth: actor.auth,
          tokenService: actor.tokenService,
          kernel: actor.kernel,
          store: actor.store,
          roles: actor.roles,
        }),
        auditRequest: authAuditRequestFromRequest(request),
        targetUserId: body.userId,
      });
    }, {
      body: t.Object({ userId: userIdSchema }, { additionalProperties: false }),
    });
}

async function requireApplicationActor(
  config: AuthApplicationAdministrationPluginConfig,
  request: Request,
): Promise<ApplicationActor> {
  const kernel = config.getAuthorizationKernel();
  if (kernel.tenancy.mode !== 'single' || kernel.authorization.mode !== 'advanced') {
    throw new AuthError(
      'Application access administration is unavailable for this auth profile',
      'APPLICATION_ADMINISTRATION_UNAVAILABLE',
      404,
    );
  }
  const store = config.getUserStore();
  const tokenService = config.getTokenService();
  const service = config.getApplicationAdministrationService();
  const roleAssignments = config.getAuthorizationRoleService();
  if (!store || !tokenService || !service || !roleAssignments) {
    throw new AuthError('Auth not initialized', 'AUTH_NOT_READY', 503);
  }
  const auth = await extractAuthContext(request, tokenService);
  if (!auth) throw new AuthError('Unauthorized', 'UNAUTHORIZED', 401);
  const access = createRequestAuthorizationAccess({
    authContext: auth,
    kernel,
    propertyStore: store,
    roleAssignments,
  });
  const scope = access.requireAuthorizationScope();
  if (scope.scopeKind !== 'application') {
    throw new AuthError('Forbidden', 'FORBIDDEN', 403);
  }
  return {
    auth,
    service,
    access,
    kernel,
    store,
    tokenService,
    roles: roleAssignments,
    assertCurrentAuthority: captureAuthApplicationMutationAuthority({
      auth,
      tokenService,
      kernel,
      store,
      roles: roleAssignments,
    }),
  };
}
