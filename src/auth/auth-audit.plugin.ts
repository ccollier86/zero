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
      const { service } = await requirePlatformAudit(config, request);
      return service.listPlatform(query);
    }, {
      query: t.Object({
        ...filterSchema,
        limit: t.Optional(t.Numeric({ minimum: 1, maximum: 100 })),
      }, { additionalProperties: false }),
    })
    .get('/platform/export', async ({ request, query, set }) => {
      applyAuthPrivateNoStore(set);
      const { service, auth } = await requirePlatformAudit(
        config, request, 'audit.exported',
      );
      const exported = service.exportPlatform(query);
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
      const { service, auth } = await requirePlatformAudit(
        config, request, 'audit.retention-pruned',
      );
      return service.pruneBacklogAudited({
        actor: authAuditActorFromContext(auth),
        request: authAuditRequestFromRequest(request),
      });
    })
    .get('/tenant/events', async ({ request, query, set }) => {
      applyAuthPrivateNoStore(set);
      const { service, tenantId } = await requireTenantAudit(config, request);
      return service.listTenant(tenantId, query);
    }, {
      query: t.Object({
        ...filterSchema,
        limit: t.Optional(t.Numeric({ minimum: 1, maximum: 100 })),
      }, { additionalProperties: false }),
    })
    .get('/tenant/export', async ({ request, query, set }) => {
      applyAuthPrivateNoStore(set);
      const { service, tenantId, auth } = await requireTenantAudit(
        config, request, 'audit.exported',
      );
      const exported = service.exportTenant(tenantId, query);
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
) {
  const runtime = await requireBase(config, request);
  if (runtime.auth.role !== 'admin') {
    if (deniedAction) recordDenied(runtime.service, runtime.auth, request, deniedAction);
    throw forbidden();
  }
  return runtime;
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
    return { ...runtime, tenantId: scope.tenantId };
  } catch (error) {
    if (deniedAction) recordDenied(runtime.service, runtime.auth, request, deniedAction);
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
  return { service, store, auth };
}

function forbidden(): AuthError {
  return new AuthError('Forbidden', 'FORBIDDEN', 403);
}

function recordDenied(
  service: AuthAuditService,
  auth: Awaited<ReturnType<typeof requireBase>>['auth'],
  request: Request,
  action: string,
): void {
  const tenantId = auth.tenantId;
  service.append({
    action,
    outcome: 'denied',
    reason: 'authorization-denied',
    scope: tenantId
      ? { kind: 'tenant', tenantId }
      : { kind: 'application' },
    actor: authAuditActorFromContext(auth),
    request: authAuditRequestFromRequest(request),
    target: { type: 'audit-events' },
  });
}
