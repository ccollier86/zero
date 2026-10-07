/** Thin session-only Guardian presence HTTP transport with exact live app/org authority. */
import { Elysia, t } from 'elysia';
import { createAuthMiddleware, type AuthMiddlewareAuthorizationOptions } from '../auth/auth.middleware';
import { createRequestAuthorizationAccess } from '../auth/authorization-access';
import { requireRequestServiceDataScope, serviceDataScopeKey } from '../auth/service-data-scope';
import type { TokenService } from '../auth/token-service';
import { AuthError } from '../auth/types';
import { applyAuthPrivateNoStore } from '../auth/auth-response-cache';
import { getPublicAuthErrorMessage } from '../auth/auth-error-response';
import type { PresenceService } from './presence-service';
import type { AuthPresenceCapabilities } from '../auth/auth-presence-types';
import { presenceRowId } from './presence-publication';

export interface PresencePluginConfig {
  getService(): PresenceService | null;
  getTokenService(): TokenService | null;
  authorization: AuthMiddlewareAuthorizationOptions;
}

/** API keys never become presence identity or availability-write authority. */
export function createPresencePlugin(config: PresencePluginConfig) {
  return new Elysia({ name: 'guardian-presence', prefix: '/auth/presence' })
    .use(createAuthMiddleware(config.getTokenService, config.authorization))
    .onError(({ error, set }) => {
      if (error instanceof AuthError) {
        set.status = error.status; return { error: error.code, message: getPublicAuthErrorMessage(error) };
      }
    })
    .get('/config', async ({ access, set, request }) => {
      assertQuery(request, []);
      applyAuthPrivateNoStore(set); const current = capture(access.requireUser(), false);
      if (current.service.config.enabled) {
        try { await current.service.ensureScope(current.scope); } catch { /* Report actual installation readiness without inventing a delivery receipt. */ }
      }
      current.assertCurrent(); return forCaller(current.service.capabilities(current.scope), current.canWrite);
    })
    .get('/me', async ({ access, set, request }) => {
      assertQuery(request, []);
      applyAuthPrivateNoStore(set); const current = capture(access.requireUser(), false);
      await current.service.ensureScope(current.scope);
      const result = current.service.self(current.scope, current.userId, current.assertCurrent);
      return { ...result, capabilities: forCaller(result.capabilities, current.canWrite) };
    })
    .patch('/me', async ({ access, set, body, request }) => {
      assertQuery(request, []);
      applyAuthPrivateNoStore(set); const current = capture(access.requireUser(), true);
      await current.service.ensureScope(current.scope);
      const result = current.service.updateIntent(current.scope, current.userId, body, current.assertCurrent);
      return { ...result, capabilities: forCaller(result.capabilities, current.canWrite) };
    }, { body: t.Object({ status: t.String({ minLength: 1, maxLength: 48 }),
      expectedRevision: t.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER - 1 }),
      expiresAfterMs: t.Optional(t.Union([t.Integer({ minimum: 1000, maximum: 604800000 }), t.Null()])),
    }, { additionalProperties: false }) })
    .get('', async ({ access, set, query, request }) => {
      assertQuery(request, ['limit', 'after']);
      applyAuthPrivateNoStore(set); const current = capture(access.requireUser(), false);
      await current.service.ensureScope(current.scope);
      const limit = query.limit === undefined ? 100 : Number(query.limit), after = query.after ?? '';
      const ordered = current.service.list(current.scope, current.userId, current.assertCurrent, { limit: limit + 1, ...(after ? { after } : {}) })
        .map(item => ({ item, id: presenceRowId(current.scope.scopeKind, current.scope.scopeId, item.userId) }));
      const page = ordered.slice(0, limit);
      return { items: page.map(row => row.item), nextCursor: ordered.length > limit ? page.at(-1)!.id : null };
    }, { query: t.Object({ limit: t.Optional(t.Numeric({ minimum: 1, maximum: 500, multipleOf: 1 })),
      after: t.Optional(t.String({ pattern: '^gp_[0-9a-f]{64}$' })),
    }, { additionalProperties: false }) });

  function capture(auth: Parameters<TokenService['captureAuthContextAuthority']>[0], write: boolean) {
    if (auth.credentialKind === 'api-key' || auth.sessionKind !== 'web' && auth.sessionKind !== 'native') throw forbidden();
    if (auth.sessionKind === 'native' && (!auth.scope?.includes('profile') || write && !auth.scope.includes('profile:write'))) throw forbidden();
    const tokens = config.getTokenService(), service = config.getService();
    if (!tokens || !service) throw new AuthError('Presence is not ready', 'AUTH_PRESENCE_NOT_READY', 503);
    const reference = tokens.captureAuthContextAuthority(auth); if (!reference) throw forbidden();
    const getKernel = config.authorization.getAuthorizationKernel ?? (() => null);
    const makeAccess = (current: typeof auth) => createRequestAuthorizationAccess({ authContext: current, kernel: getKernel(),
      roleAssignments: config.authorization.getRoleAssignments?.() ?? null,
      propertyStore: config.authorization.getPropertyStore?.() ?? null,
      assertCurrentProfile: () => tokens.assertCurrentProfile() });
    const scope = requireRequestServiceDataScope(makeAccess(auth), getKernel);
    const assertCurrent = () => {
      const current = tokens.resolveAuthContextAuthority(reference);
      if (!current || current.userId !== auth.userId) throw forbidden();
      const currentScope = requireRequestServiceDataScope(makeAccess(current), getKernel);
      if (serviceDataScopeKey(currentScope) !== serviceDataScopeKey(scope)
        || current.sessionKind === 'native' && (!current.scope?.includes('profile') || write && !current.scope.includes('profile:write'))) throw forbidden();
    };
    assertCurrent(); return { service, scope, userId: auth.userId, assertCurrent,
      canWrite: auth.sessionKind === 'web' || Boolean(auth.scope?.includes('profile:write')) };
  }
}
function forbidden() { return new AuthError('A current account session and authorization scope are required', 'AUTH_PRESENCE_FORBIDDEN', 403); }
function forCaller(capabilities: AuthPresenceCapabilities, canWrite: boolean): AuthPresenceCapabilities {
  const writable = capabilities.state === 'ready' && canWrite;
  return { ...capabilities, canReportActivity: writable, canSetIntent: writable,
    statuses: capabilities.statuses.map(status => ({ ...status, selectable: status.selectable && writable })) };
}
/** Validate raw query keys before Elysia's normalized query projection can discard forged targets. */
function assertQuery(request: Request, allowed: readonly string[]): void {
  const query = new URL(request.url).searchParams;
  for (const key of query.keys()) if (!allowed.includes(key) || query.getAll(key).length !== 1) {
    throw new AuthError('Presence input is invalid', 'AUTH_PRESENCE_INVALID_INPUT', 422);
  }
}
