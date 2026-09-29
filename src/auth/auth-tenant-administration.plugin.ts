/** Active-tenant member and role administration routes. */

import { Elysia, t } from 'elysia';
import { createRequestAuthorizationAccess } from './authorization-access';
import type { AuthorizationKernel, AuthorizationScopeSnapshot } from './authorization-kernel';
import type { AuthorizationRoleService } from './authorization-role-service';
import { extractAuthContext } from './auth-context';
import { EMAIL_MAX_LENGTH, EMAIL_PATTERN_SOURCE } from './auth-email-identity';
import type { AuthTenantAdministrationService } from './auth-tenant-administration-service';
import {
  captureAuthTenantMutationAuthority,
  type AssertAuthTenantMutationAuthority,
} from './auth-tenant-mutation-authority';
import type { TokenService } from './token-service';
import type { UserStore } from './user-store';
import type { TenancyService } from './tenancy/tenancy-service';
import { AuthError, type AuthContext } from './types';
import { authAuditRequestFromRequest } from './auth-audit-service';
import { applyAuthPrivateNoStore } from './auth-response-cache';

const membershipIdSchema = t.String({
  minLength: 1,
  maxLength: 200,
  pattern: '^[A-Za-z0-9_-]+$',
});
const roleKeySchema = t.String({
  minLength: 1,
  maxLength: 64,
  pattern: '^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$',
});
const rolesSchema = t.Array(roleKeySchema, {
  maxItems: 32,
  uniqueItems: true,
});

export interface AuthTenantAdministrationPluginConfig {
  getUserStore: () => UserStore | null;
  getTokenService: () => TokenService | null;
  getTenancyService: () => TenancyService | null;
  getAuthorizationKernel: () => AuthorizationKernel;
  getAuthorizationRoleService: () => AuthorizationRoleService | null;
  getTenantAdministrationService: () => AuthTenantAdministrationService | null;
}

interface TenantActor {
  auth: AuthContext;
  scope: AuthorizationScopeSnapshot & {
    scopeKind: 'tenant';
    tenantId: string;
    membershipId: string;
  };
  access: ReturnType<typeof createRequestAuthorizationAccess>;
  service: AuthTenantAdministrationService;
  assertCurrentAuthority: AssertAuthTenantMutationAuthority;
}

/**
 * Mount below `/auth`; every target tenant comes only from the resolved bearer
 * scope. No route schema contains a tenant id.
 */
export function createAuthTenantAdministrationPlugin(
  config: AuthTenantAdministrationPluginConfig,
) {
  return new Elysia({ name: 'auth-tenant-administration', prefix: '/tenant' })
    .get('/config', async ({ request, set }) => {
      applyAuthPrivateNoStore(set);
      const actor = await requireTenantActor(config, request);
      return actor.service.getConfig({
        tenantId: actor.scope.tenantId,
        membershipId: actor.scope.membershipId,
        scope: actor.scope,
        applicationScope: actor.access.applicationAuthorization,
        assertCurrentAuthority: actor.assertCurrentAuthority,
      });
    })
    .get('/members', async ({ request, query, set }) => {
      applyAuthPrivateNoStore(set);
      const actor = await requireTenantActor(config, request);
      actor.access.requirePermission('tenant.members:read');
      return actor.service.listMembers(actor.scope.tenantId, {
        limit: query.limit,
        cursor: query.cursor,
        search: query.search,
        status: query.status,
      }, actor.assertCurrentAuthority);
    }, {
      query: t.Object({
        limit: t.Optional(t.Numeric({ minimum: 1, maximum: 100 })),
        cursor: t.Optional(t.String({ minLength: 1, maxLength: 512 })),
        search: t.Optional(t.String({ maxLength: 120 })),
        status: t.Optional(t.Union([
          t.Literal('active'),
          t.Literal('suspended'),
          t.Literal('removed'),
        ])),
      }, { additionalProperties: false }),
    })
    .post('/members', async ({ request, body }) => {
      const actor = await requireTenantActor(config, request);
      actor.access.requirePermission('tenant.members:manage');
      const roles = body.roles ?? ['member'];
      if (!isDefaultMemberRole(roles)) {
        actor.access.requirePermission('tenant.roles:manage');
      }
      return actor.service.addMember({
        tenantId: actor.scope.tenantId,
        email: body.email,
        roleKeys: roles,
        assertCurrentAuthority: actor.assertCurrentAuthority,
        auditRequest: authAuditRequestFromRequest(request),
      });
    }, {
      body: t.Object({
        email: t.String({
          minLength: 1,
          maxLength: EMAIL_MAX_LENGTH,
          pattern: `^${EMAIL_PATTERN_SOURCE}$`,
        }),
        roles: t.Optional(rolesSchema),
      }, { additionalProperties: false }),
    })
    .patch('/members/:membershipId', async ({ request, params, body }) => {
      const actor = await requireTenantActor(config, request);
      actor.access.requirePermission('tenant.members:manage');
      if (body.status === undefined && body.roles === undefined) {
        throw new AuthError(
          'Provide a membership status or role change',
          'TENANT_MEMBER_UPDATE_EMPTY',
          422,
        );
      }
      if (body.roles !== undefined) {
        actor.access.requirePermission('tenant.roles:manage');
      }
      return actor.service.updateMember({
        tenantId: actor.scope.tenantId,
        membershipId: params.membershipId,
        status: body.status,
        roleKeys: body.roles,
        expectedRoleRevision: body.expectedRoleRevision,
        assertCurrentAuthority: actor.assertCurrentAuthority,
        auditRequest: authAuditRequestFromRequest(request),
      });
    }, {
      params: t.Object({ membershipId: membershipIdSchema }, {
        additionalProperties: false,
      }),
      body: t.Object({
        status: t.Optional(t.Union([t.Literal('active'), t.Literal('suspended')])),
        roles: t.Optional(rolesSchema),
        expectedRoleRevision: t.Optional(t.String({ minLength: 1, maxLength: 512 })),
      }, { additionalProperties: false }),
    })
    .delete('/members/:membershipId', async ({ request, params }) => {
      const actor = await requireTenantActor(config, request);
      actor.access.requirePermission('tenant.members:manage');
      return actor.service.removeMember({
        tenantId: actor.scope.tenantId,
        membershipId: params.membershipId,
        assertCurrentAuthority: actor.assertCurrentAuthority,
        auditRequest: authAuditRequestFromRequest(request),
      });
    }, {
      params: t.Object({ membershipId: membershipIdSchema }, {
        additionalProperties: false,
      }),
    })
    .post('/ownership/transfer', async ({ request, body }) => {
      const actor = await requireTenantActor(config, request);
      // Permission alone cannot manufacture ownership: the domain service also
      // requires the live actor membership itself to carry the owner marker.
      actor.access.requirePermission('tenant.roles:manage');
      return actor.service.transferOwnership({
        tenantId: actor.scope.tenantId,
        targetMembershipId: body.membershipId,
        assertCurrentAuthority: actor.assertCurrentAuthority,
        auditRequest: authAuditRequestFromRequest(request),
      });
    }, {
      body: t.Object({ membershipId: membershipIdSchema }, {
        additionalProperties: false,
      }),
    });
}

async function requireTenantActor(
  config: AuthTenantAdministrationPluginConfig,
  request: Request,
): Promise<TenantActor> {
  const store = config.getUserStore();
  const tokenService = config.getTokenService();
  const tenancy = config.getTenancyService();
  const service = config.getTenantAdministrationService();
  const kernel = config.getAuthorizationKernel();
  if (kernel.tenancy.mode !== 'multi') {
    throw new AuthError(
      'Tenant administration is unavailable in single-tenant mode',
      'TENANT_ADMINISTRATION_UNAVAILABLE',
      404,
    );
  }
  if (!store || !tokenService || !tenancy || !service) {
    throw new AuthError('Auth not initialized', 'AUTH_NOT_READY', 503);
  }
  const auth = await extractAuthContext(request, tokenService);
  if (!auth) throw new AuthError('Unauthorized', 'UNAUTHORIZED', 401);
  const access = createRequestAuthorizationAccess({
    authContext: auth,
    kernel,
    propertyStore: store,
    roleAssignments: config.getAuthorizationRoleService(),
  });
  const scope = access.requireTenant();
  const assertCurrentAuthority = captureAuthTenantMutationAuthority({
    auth,
    tokenService,
    kernel,
    store,
    roles: config.getAuthorizationRoleService(),
  });
  return { auth, access, scope, service, assertCurrentAuthority };
}

function isDefaultMemberRole(roles: readonly string[]): boolean {
  return roles.length === 1 && roles[0] === 'member';
}
