/** Thin web-session transport. Requests cannot choose tenant, native filter or provider credentials. */
import { Elysia, t } from 'elysia';
import { createAuthMiddleware, type AuthMiddlewareAuthorizationOptions } from '../auth/auth.middleware';
import { createRequestAuthorizationAccess } from '../auth/authorization-access';
import { requireRequestServiceDataScope, serviceDataScopeKey } from '../auth/service-data-scope';
import type { TokenService } from '../auth/token-service';
import { AuthError } from '../auth/types';
import { applyAuthPrivateNoStore } from '../auth/auth-response-cache';
import { getPublicAuthErrorMessage } from '../auth/auth-error-response';
import type { ManagedVectorVisualization } from './visualization-managed';
import type { ResolvedVectorVisualizationConfig } from './visualization-config';
import { VectorError } from './vector-error';

export interface VectorVisualizationPluginConfig {
  config: ResolvedVectorVisualizationConfig;
  getService(): ManagedVectorVisualization | null;
  getTokenService(): TokenService | null;
  authorization: AuthMiddlewareAuthorizationOptions;
}
export function createVectorVisualizationPlugin(options: VectorVisualizationPluginConfig) {
  const indexSchema = t.Optional(t.String({ minLength: 1, maxLength: 128 }));
  const operationId = t.Optional(t.String({ minLength: 1, maxLength: 128, pattern: '^[a-zA-Z0-9_.:-]+$' }));
  return new Elysia({ name: 'zero-vector-visualization', prefix: '/api/vector-visualizations' })
    .use(createAuthMiddleware(options.getTokenService, options.authorization))
    .onError(({ error, set }) => {
      if (error instanceof AuthError) { applyAuthPrivateNoStore(set); set.status = error.status; return { error: error.code, message: getPublicAuthErrorMessage(error) }; }
      if (error instanceof VectorError) { applyAuthPrivateNoStore(set); set.status = error.code === 'VECTOR_SCOPE_CONFLICT' ? 409 : error.code === 'VECTOR_CONFIG_INVALID' ? 503 : error.code === 'VECTOR_BACKPRESSURE' ? 429 : 422;
        return { error: error.code, message: 'Vector visualization could not complete this request.' }; }
    })
    .post('/search', async ({ access, body, set, request }) => {
      exactQuery(request, []); applyAuthPrivateNoStore(set);
      const current = capture(access.requireUser(), body.index, 'search');
      const abort = new AbortController();
      let release;
      try { release = current.owner.reserveStart(current.service, abort); } catch (error) { await current.service.dispose(); throw error; }
      let accepted;
      try { accepted = await current.service.startSearch(body, { signal: abort.signal }); } catch (error) { await current.service.dispose(); throw error; } finally { release(); }
      current.owner.retain(accepted.snapshot.id, current.service, accepted.completion, abort); current.assertCurrent(); set.status = 202; return accepted.snapshot;
    }, { body: t.Object({ index: indexSchema, operationId, text: t.String({ minLength: 1, maxLength: 8192 }),
      retrieval: t.Optional(t.Union([t.Literal('vector'), t.Literal('hybrid')])), rerank: t.Optional(t.Boolean()),
      topK: t.Optional(t.Integer({ minimum: 1, maximum: 100 })), candidateCount: t.Optional(t.Integer({ minimum: 1, maximum: 100 })),
    }, { additionalProperties: false }) })
    .post('/ingest', async ({ access, body, set, request }) => {
      exactQuery(request, []); applyAuthPrivateNoStore(set);
      const current = capture(access.requireUser(), body.index, 'ingestion');
      const abort = new AbortController();
      let release;
      try { release = current.owner.reserveStart(current.service, abort); } catch (error) { await current.service.dispose(); throw error; }
      let accepted;
      try { accepted = await current.service.startIngest(body, { signal: abort.signal }); } catch (error) { await current.service.dispose(); throw error; } finally { release(); }
      current.owner.retain(accepted.snapshot.id, current.service, accepted.completion, abort); current.assertCurrent(); set.status = 202; return accepted.snapshot;
    }, { body: t.Object({ index: indexSchema, operationId, sourceRevision: t.Optional(t.String({ minLength: 1, maxLength: 128 })),
      document: t.Object({ id: t.String({ minLength: 1, maxLength: 128 }), title: t.String({ minLength: 1, maxLength: 256 }),
        text: t.String({ minLength: 1, maxLength: 48000 }), clusterId: t.Optional(t.String({ maxLength: 64 })),
        source: t.Optional(t.Object({ id: t.Optional(t.String({ maxLength: 64 })), label: t.String({ maxLength: 128 }), abbreviation: t.Optional(t.String({ maxLength: 8 })) }, { additionalProperties: false })),
      }, { additionalProperties: false }),
    }, { additionalProperties: false }) })
    .get('/map', async ({ access, query, set, request }) => {
      exactQuery(request, ['index']); applyAuthPrivateNoStore(set); const current = capture(access.requireUser(), query.index, 'search');
      try { const map = await current.service.map(); current.assertCurrent(); return map; } finally { await current.service.dispose(); }
    }, { query: t.Object({ index: indexSchema }, { additionalProperties: false }) })
    .get('/:id', async ({ access, params, query, set, request }) => {
      exactQuery(request, ['index']); applyAuthPrivateNoStore(set); const current = capture(access.requireUser(), query.index, 'read');
      try { const snapshot = await current.service.get(params.id); current.assertSnapshot(snapshot); return snapshot; } finally { await current.service.dispose(); }
    }, { query: t.Object({ index: indexSchema }, { additionalProperties: false }) })
    .post('/:id/cancel', async ({ access, params, query, set, request }) => {
      exactQuery(request, ['index']); applyAuthPrivateNoStore(set); const current = capture(access.requireUser(), query.index, 'read');
      try { const before = await current.service.get(params.id); current.assertSnapshot(before);
        const snapshot = await current.service.cancel(params.id); current.assertSnapshot(snapshot);
        if (snapshot?.status === 'cancelled') current.owner.abortAccepted(params.id); return snapshot;
      } finally { await current.service.dispose(); }
    }, { query: t.Object({ index: indexSchema }, { additionalProperties: false }) });

  function capture(auth: Parameters<TokenService['captureAuthContextAuthority']>[0], requestedIndex: string | undefined, action: 'search' | 'ingestion' | 'read') {
    if (auth.credentialKind === 'api-key' || auth.sessionKind !== 'web') throw denied();
    const tokens = options.getTokenService(), owner = options.getService();
    if (!tokens || !owner) throw new AuthError('Vector visualization is not ready', 'VECTOR_VISUALIZATION_NOT_READY', 503);
    const index = requestedIndex ?? options.config.defaultIndex, policy = options.config.indexes[index];
    if (!policy) throw denied();
    const reference = tokens.captureAuthContextAuthority(auth); if (!reference) throw denied();
    const getKernel = options.authorization.getAuthorizationKernel ?? (() => null);
    const makeAccess = (current: typeof auth) => createRequestAuthorizationAccess({ authContext: current, kernel: getKernel(),
      roleAssignments: options.authorization.getRoleAssignments?.() ?? null, propertyStore: options.authorization.getPropertyStore?.() ?? null,
      assertCurrentProfile: () => tokens.assertCurrentProfile() });
    const scope = requireRequestServiceDataScope(makeAccess(auth), getKernel);
    let required = action === 'ingestion' ? policy.ingestPermission : action === 'search' ? policy.searchPermission : undefined;
    let includesCorpus = action === 'ingestion';
    const assertCurrent = () => {
      const current = tokens.resolveAuthContextAuthority(reference);
      if (!current || current.userId !== auth.userId || current.sessionKind !== 'web') throw denied();
      const access = makeAccess(current), nextScope = requireRequestServiceDataScope(access, getKernel);
      if (serviceDataScopeKey(nextScope) !== serviceDataScopeKey(scope)) throw denied();
      if (required) access.requirePermission(required);
      else if (action !== 'read' || !access.hasPermission(policy.searchPermission) && !(policy.ingestPermission && access.hasPermission(policy.ingestPermission))) throw denied();
      if (includesCorpus) access.requirePermission(policy.searchPermission);
    };
    assertCurrent();
    return { owner, service: owner.scoped(index, scope, auth.userId, assertCurrent), assertCurrent,
      assertSnapshot(snapshot: { kind: string; index: string } | null) {
        if (snapshot && snapshot.index !== index) throw denied();
        required = snapshot?.kind === 'ingestion' ? policy.ingestPermission : policy.searchPermission;
        includesCorpus = snapshot?.kind === 'ingestion';
        if (!required) throw denied(); assertCurrent();
      } };
  }
}
function denied() { return new AuthError('A current authorized corpus session is required', 'VECTOR_VISUALIZATION_FORBIDDEN', 403); }
function exactQuery(request: Request, allowed: readonly string[]) {
  const query = new URL(request.url).searchParams;
  for (const key of query.keys()) if (!allowed.includes(key) || query.getAll(key).length !== 1) throw new AuthError('Invalid visualization input', 'VECTOR_VISUALIZATION_INVALID_INPUT', 422);
}
