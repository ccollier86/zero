/** Authorized HTTP query/export surface for durable control-plane audit events. */

import { Elysia, t } from 'elysia';
import { createRequestAuthorizationAccess } from './authorization-access';
import { extractAuthContext } from './auth-context';
import {
  authAuditActorFromContext,
  authAuditRequestFromRequest,
  type AuthAuditService,
} from './auth-audit-service';
import type { AuthorizationKernel } from './authorization-kernel';
import type { AuthorizationRoleService } from './authorization-role-service';
import type { TokenService } from './token-service';
import { AuthError } from './types';
import type { UserStore } from './user-store';
import { applyAuthPrivateNoStore } from './auth-response-cache';
import { captureAuthAdminMutationAuthority } from './auth-admin-mutation-authority';
import { captureAuthTenantMutationAuthority } from './auth-tenant-mutation-authority';

export interface AuthAuditPluginConfig {
  getService: () => AuthAuditService | null;
  getUserStore: () => UserStore | null;
  getTokenService: () => TokenService | null;
  getAuthorizationKernel: () => AuthorizationKernel;
  getAuthorizationRoleService: () => AuthorizationRoleService | null;
}

const outcomeSchema = t.Union([
  t.Literal('succeeded'),
  t.Literal('denied'),
  t.Literal('failed'),
]);

const filterSchema = {
  cursor: t.Optional(t.String({ minLength: 1, maxLength: 512 })),
  action: t.Optional(t.String({ minLength: 1, maxLength: 100 })),
  outcome: t.Optional(outcomeSchema),
  from: t.Optional(t.Numeric({ minimum: 0 })),
  to: t.Optional(t.Numeric({ minimum: 0 })),
  targetType: t.Optional(t.String({ minLength: 1, maxLength: 64 })),
};

export function createAuthAuditPlugin(config: AuthAuditPluginConfig) {
  return new Elysia({ name: 'auth-control-plane-audit', prefix: '/audit' })
    .get('/platform/events', async ({ request, query, set }) => {
      applyAuthPrivateNoStore(set);
      const { service, assertCurrentAuthority } = await requirePlatformAudit(config, request);
      const page = service.listPlatform(query);
      assertCurrentAuthority();
      return page;
    }, {
      query: t.Object({
        ...filterSchema,
        limit: t.Optional(t.Numeric({ minimum: 1, maximum: 100 })),
      }, { additionalProperties: false }),
    })
    .get('/platform/export', async ({ request, query, set }) => {
      applyAuthPrivateNoStore(set);
      const { service, auth, assertCurrentAuthority } = await requirePlatformAudit(
        config, request, 'audit.exported',
      );
      const exported = service.exportPlatform(query);
      assertCurrentAuthority();
      service.append({
        action: 'audit.exported',
        outcome: 'succeeded',
        scope: { kind: 'application' },
        actor: authAuditActorFromContext(auth),
        request: authAuditRequestFromRequest(request),
        target: { type: 'audit-events' },
        metadata: { count: exported.count, 'has-more': exported.hasMore },
      });
      return exported;
    }, {
      query: t.Object({
        ...filterSchema,
        limit: t.Optional(t.Numeric({ minimum: 1, maximum: 1_000 })),
      }, { additionalProperties: false }),
    })
    .post('/platform/prune', async ({ request }) => {
      const { service, auth, assertCurrentAuthority } = await requirePlatformAudit(
        config, request, 'audit.retention-pruned', 'manage',
      );
      return service.pruneBacklogAudited({
        actor: authAuditActorFromContext(auth),
        request: authAuditRequestFromRequest(request),
        assertCurrentAuthority,
      });
    })
    .get('/tenant/events', async ({ request, query, set }) => {
      applyAuthPrivateNoStore(set);
      const { service, tenantId, assertCurrentAuthority } = await requireTenantAudit(
        config,
        request,
      );
      const page = service.listTenant(tenantId, query);
      assertCurrentAuthority(['tenant.audit:read']);
      return page;
    }, {
      query: t.Object({
        ...filterSchema,
        limit: t.Optional(t.Numeric({ minimum: 1, maximum: 100 })),
      }, { additionalProperties: false }),
    })
    .get('/tenant/export', async ({ request, query, set }) => {
      applyAuthPrivateNoStore(set);
      const {
        service,
        tenantId,
        auth,
        assertCurrentAuthority,
      } = await requireTenantAudit(
        config, request, 'audit.exported',
      );
      const exported = service.exportTenant(tenantId, query);
      assertCurrentAuthority(['tenant.audit:read']);
      service.append({
        action: 'audit.exported',
        outcome: 'succeeded',
        scope: { kind: 'tenant', tenantId },
        actor: authAuditActorFromContext(auth),
        request: authAuditRequestFromRequest(request),
        target: { type: 'audit-events' },
        metadata: { count: exported.count, 'has-more': exported.hasMore },
      });
      return exported;
    }, {
      query: t.Object({
        ...filterSchema,
        limit: t.Optional(t.Numeric({ minimum: 1, maximum: 1_000 })),
      }, { additionalProperties: false }),
    });
}

async function requirePlatformAudit(
  config: AuthAuditPluginConfig,
  request: Request,
  deniedAction?: string,
  authority: 'read' | 'manage' = 'read',
) {
  const runtime = await requireBase(config, request);
  const kernel = config.getAuthorizationKernel();
  const roles = config.getAuthorizationRoleService();
  const access = createRequestAuthorizationAccess({
    authContext: runtime.auth,
    kernel,
    propertyStore: runtime.store,
    roleAssignments: roles,
  });
  try {
    if (kernel.tenancy.mode === 'single') {
      if (runtime.auth.role !== 'admin') throw forbidden();
    } else {
      access.requireApplicationAuthorization();
      access.requirePermission(authority === 'manage'
        ? 'application.audit:manage'
        : 'application.audit:read');
    }
  } catch (error) {
    if (deniedAction) {
      recordDenied(
        runtime.service,
        runtime.auth,
        request,
        deniedAction,
        { kind: 'application' },
      );
    }
    throw error;
  }
  return {
    ...runtime,
    assertCurrentAuthority: captureAuthAdminMutationAuthority({
      auth: runtime.auth,
      tokenService: runtime.tokens,
      kernel,
      store: runtime.store,
      roles,
      permission: authority === 'manage'
        ? 'application.audit:manage'
        : 'application.audit:read',
    }),
  };
}

async function requireTenantAudit(
  config: AuthAuditPluginConfig,
  request: Request,
  deniedAction?: string,
) {
  const runtime = await requireBase(config, request);
  try {
    const access = createRequestAuthorizationAccess({
      authContext: runtime.auth,
      kernel: config.getAuthorizationKernel(),
      propertyStore: runtime.store,
      roleAssignments: config.getAuthorizationRoleService(),
    });
    const scope = access.requireTenant();
    access.requirePermission('tenant.audit:read');
    return {
      ...runtime,
      tenantId: scope.tenantId,
      assertCurrentAuthority: captureAuthTenantMutationAuthority({
        auth: runtime.auth,
        tokenService: runtime.tokens,
        kernel: config.getAuthorizationKernel(),
        store: runtime.store,
        roles: config.getAuthorizationRoleService(),
      }),
    };
  } catch (error) {
    if (deniedAction) {
      recordDenied(
        runtime.service,
        runtime.auth,
        request,
        deniedAction,
        runtime.auth.tenantId
          ? { kind: 'tenant', tenantId: runtime.auth.tenantId }
          : { kind: 'application' },
      );
    }
    throw error;
  }
}

async function requireBase(config: AuthAuditPluginConfig, request: Request) {
  const service = config.getService();
  const store = config.getUserStore();
  const tokens = config.getTokenService();
  if (!service || !store || !tokens) {
    throw new AuthError('Auth not initialized', 'AUTH_NOT_READY', 503);
  }
  const auth = await extractAuthContext(request, tokens);
  if (!auth) throw new AuthError('Unauthorized', 'UNAUTHORIZED', 401);
  return { service, store, tokens, auth };
}

function forbidden(): AuthError {
  return new AuthError('Forbidden', 'FORBIDDEN', 403);
}

function recordDenied(
  service: AuthAuditService,
  auth: Awaited<ReturnType<typeof requireBase>>['auth'],
  request: Request,
  action: string,
  scope: { kind: 'application' } | { kind: 'tenant'; tenantId: string },
): void {
  service.append({
    action,
    outcome: 'denied',
    reason: 'authorization-denied',
    scope,
    actor: authAuditActorFromContext(auth),
    request: authAuditRequestFromRequest(request),
    target: { type: 'audit-events' },
  });
}
