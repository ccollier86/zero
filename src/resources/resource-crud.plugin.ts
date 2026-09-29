/**
 * resource-crud.plugin.ts
 *
 * Mounts generated HTTP CRUD routes for registered Zero resources. This file
 * owns Elysia route composition and validation only; policy evaluation and
 * persistence behavior live in ResourceCrudService.
 */

import { createHash, randomUUID } from 'node:crypto';

import { Elysia, t } from 'elysia';
import { readAuthBearerToken } from '../auth/auth-bearer-token';
import { createAuthMiddleware } from '../auth/auth.middleware';
import type { TokenService } from '../auth/token-service';
import type { AuthContext, AuthTenancyMode } from '../auth/types';
import type { AuthorizationKernel } from '../auth/authorization-kernel';
import type { AuthorizationRoleAssignmentResolver } from '../auth/authorization-access';
import type { UserStore } from '../auth/user-store';
import type {
  PlatformCodeDefinition,
  PlatformCodeEmitOptions,
  PlatformEvent,
  PlatformObservabilityRuntime,
} from '../observability/types';
import type { ReactiveDB, TableSchema } from '../sync';
import { getSyncDB } from '../sync';
import {
  ResourceCrudService,
  type ResourceCrudRequestContext,
  type ResourceCrudResult,
  type ResourceTenantDatabaseClientProvider,
} from './resource-crud-service';
import type { ResourcePolicyAuthConfig } from './resource-policy-types';
import { RESOURCE_QUERY_LIMITS } from './resource-query';
import type { ResourceRegistry } from './resource-registry';

/** Options for generated resource CRUD route behavior. */
export interface ResourceCrudRoutesConfig {
  /** Base path for generated routes. Default: `/api/resources`. */
  prefix?: string;
  /** Default list page size when `limit` is omitted. Default: 100. */
  defaultLimit?: number;
  /** Maximum list page size accepted from `limit`. Default: 1000. */
  maxLimit?: number;
}

/** Dependencies required by the resource CRUD Elysia plugin. */
export interface ResourceCrudPluginConfig extends ResourceCrudRoutesConfig {
  registry: ResourceRegistry;
  tables: Record<string, TableSchema>;
  authConfig: ResourcePolicyAuthConfig;
  /** Multi mode requires a durable session authority at the SQL boundary. */
  tenancyMode?: AuthTenancyMode;
  getTokenService?: () => TokenService | null;
  getUserStore?: () => UserStore | null;
  /** App-local kernel used by authorizationPolicy(). */
  getAuthorizationKernel?: () => AuthorizationKernel | null;
  /** Live advanced role assignments used by authorizationPolicy(). */
  getRoleAssignments?: () => AuthorizationRoleAssignmentResolver | null;
  /** App-local database provider. Legacy standalone callers may omit it. */
  getDB?: () => ReactiveDB | null;
  /** @internal Verified-realm actor capability; never a request selector. */
  getTenantDatabaseClient?: ResourceTenantDatabaseClientProvider;
  /** App-local observability runtime. Standalone plugins may omit it. */
  observability?: PlatformObservabilityRuntime | null;
  /** App-local observability emitter retained for standalone composition. */
  emitCode?: (
    definition: PlatformCodeDefinition,
    options?: PlatformCodeEmitOptions,
  ) => PlatformEvent;
}

const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;

const resourceParamsSchema = t.Object({
  resource: t.String({ minLength: 1 }),
});

const resourceIdParamsSchema = t.Object({
  resource: t.String({ minLength: 1 }),
  id: t.String({ minLength: 1 }),
});

const resourceQueryFilterSchema = t.String({
  maxLength: RESOURCE_QUERY_LIMITS.filterExpressionLength,
});

const listQuerySchema = t.Object({
  filter: t.Optional(t.Union([
    resourceQueryFilterSchema,
    t.Array(resourceQueryFilterSchema, { maxItems: RESOURCE_QUERY_LIMITS.filterCount }),
  ])),
  order: t.Optional(t.String({ maxLength: RESOURCE_QUERY_LIMITS.identifierLength })),
  dir: t.Optional(t.String({ maxLength: RESOURCE_QUERY_LIMITS.directionLength })),
  limit: t.Optional(t.Numeric()),
  offset: t.Optional(t.Numeric()),
});

const bodySchema = t.Record(t.String(), t.Unknown());

/**
 * Create generated resource CRUD routes.
 *
 * Routes are mounted under `/api/resources` by default:
 * - `GET /:resource`
 * - `GET /:resource/:id`
 * - `POST /:resource`
 * - `PATCH /:resource/:id`
 * - `DELETE /:resource/:id`
 */
export function createResourceCrudPlugin(config: ResourceCrudPluginConfig) {
  const prefix = normalizePrefix(config.prefix ?? '/api/resources');
  const getTokenService = config.getTokenService ?? (() => null);
  const getUserStore = config.getUserStore ?? (() => null);

  return new Elysia({ name: 'resource-crud' })
    .use(createAuthMiddleware(getTokenService))
    .onError(({ code, request, set }) => {
      if (code !== 'VALIDATION') return;
      const read = request.method === 'GET';
      set.status = 400;
      return {
        error: read ? 'Invalid resource query' : 'Invalid resource input',
        code: read ? 'invalid-resource-query' : 'invalid-resource-input',
      };
    })
    .get(`${prefix}/:resource`, async ({ params, query, set, authContext, request }) => {
      const service = createService(config, getUserStore);
      if (!service) return respond(set, serviceUnavailable());

      return respond(
        set,
        await service.list(
          params.resource,
          query,
          resourceRequestContext(
            request,
            authContext,
            getTokenService,
            config.tenancyMode === 'multi',
          ),
        )
      );
    }, {
      params: resourceParamsSchema,
      query: listQuerySchema,
    })
    .get(`${prefix}/:resource/:id`, async ({ params, set, authContext, request }) => {
      const service = createService(config, getUserStore);
      if (!service) return respond(set, serviceUnavailable());

      return respond(
        set,
        await service.get(
          params.resource,
          params.id,
          resourceRequestContext(
            request,
            authContext,
            getTokenService,
            config.tenancyMode === 'multi',
          ),
        )
      );
    }, {
      params: resourceIdParamsSchema,
    })
    .post(`${prefix}/:resource`, async ({ params, body, set, authContext, request }) => {
      const requestContext = resourceRequestContext(
        request,
        authContext,
        getTokenService,
        config.tenancyMode === 'multi',
        true,
      );
      set.headers['Idempotency-Key'] = requestContext.idempotencyKey!;
      const service = createService(config, getUserStore);
      if (!service) return respond(set, serviceUnavailable());

      return respond(
        set,
        await service.create(
          params.resource,
          body,
          requestContext,
        )
      );
    }, {
      params: resourceParamsSchema,
      body: bodySchema,
    })
    .patch(`${prefix}/:resource/:id`, async ({
      params, body, set, authContext, request,
    }) => {
      const requestContext = resourceRequestContext(
        request,
        authContext,
        getTokenService,
        config.tenancyMode === 'multi',
        true,
      );
      set.headers['Idempotency-Key'] = requestContext.idempotencyKey!;
      const service = createService(config, getUserStore);
      if (!service) return respond(set, serviceUnavailable());

      return respond(
        set,
        await service.update(
          params.resource,
          params.id,
          body,
          requestContext,
        )
      );
    }, {
      params: resourceIdParamsSchema,
      body: bodySchema,
    })
    .delete(`${prefix}/:resource/:id`, async ({ params, set, authContext, request }) => {
      const requestContext = resourceRequestContext(
        request,
        authContext,
        getTokenService,
        config.tenancyMode === 'multi',
        true,
      );
      set.headers['Idempotency-Key'] = requestContext.idempotencyKey!;
      const service = createService(config, getUserStore);
      if (!service) return respond(set, serviceUnavailable());

      return respond(
        set,
        await service.delete(
          params.resource,
          params.id,
          requestContext,
        )
      );
    }, {
      params: resourceIdParamsSchema,
    });
}

function resourceRequestContext(
  request: Request,
  authContext: AuthContext | null,
  getTokenService: () => TokenService | null,
  requireDurableAuthority: boolean,
  includeIdempotencyKey = false,
): ResourceCrudRequestContext {
  const token = readAuthBearerToken(request);
  const tokenService = getTokenService();
  // Bound web/native sessions have a synchronous, secret-free authority
  // reference. Resolve it inside the resource database transaction so a
  // revocation cannot land between the last asynchronous check and commit.
  const supportsCommitAuthority = Boolean(
    authContext?.sessionKind
    && tokenService
    && typeof tokenService.captureAuthContextAuthority === 'function'
    && typeof tokenService.resolveAuthContextAuthority === 'function',
  );
  const authorityReference = supportsCommitAuthority
    ? tokenService!.captureAuthContextAuthority(authContext!)
    : null;
  // A custom/standalone verifier may hydrate an AuthContext without exposing
  // Zero's synchronous authority-reference contract. That remains compatible
  // in single mode, but multi mode must not turn it into a fail-open window
  // between the final async policy check and the SQLite read/write boundary.
  const mustResolveAtCommit = Boolean(authContext) && requireDurableAuthority;
  return {
    authContext,
    ...(includeIdempotencyKey
      ? { idempotencyKey: normalizeRequestIdempotencyKey(request) }
      : {}),
    revalidateAuthContext: async () => {
      const service = getTokenService();
      return token && service ? service.resolveAuthContext(token) : null;
    },
    ...(supportsCommitAuthority || mustResolveAtCommit ? {
      resolveAuthContextAtCommit: () => authorityReference
        ? tokenService!.resolveAuthContextAuthority(authorityReference)
        : null,
    } : {}),
  };
}

function createService(
  config: ResourceCrudPluginConfig,
  getUserStore: () => UserStore | null
): ResourceCrudService | null {
  // An explicit app-local provider owns this dependency even while it is
  // unavailable. Never fall through to another live app's compatibility
  // provider in that case.
  const db = config.getDB ? config.getDB() : getSyncDB();
  if (!db) return null;

  return new ResourceCrudService({
    db,
    registry: config.registry,
    tables: config.tables,
    authConfig: config.authConfig,
    userStore: getUserStore(),
    authorizationKernel: config.getAuthorizationKernel?.() ?? null,
    roleAssignments: config.getRoleAssignments?.() ?? null,
    getTenantDatabaseClient: config.getTenantDatabaseClient,
    observability: config.observability,
    emitCode: config.emitCode,
    defaultLimit: config.defaultLimit,
    maxLimit: config.maxLimit,
  });
}

function normalizeRequestIdempotencyKey(request: Request): string {
  const supplied = request.headers.get('Idempotency-Key')?.trim();
  if (!supplied) return `r_${randomUUID()}`;
  if (IDEMPOTENCY_KEY_PATTERN.test(supplied)) return supplied;
  return `h_${createHash('sha256').update(supplied, 'utf8').digest('hex')}`;
}

function respond(
  set: { status?: number | string },
  result: ResourceCrudResult
): unknown {
  set.status = result.status;
  return result.body;
}

function serviceUnavailable(): ResourceCrudResult {
  return {
    ok: false,
    status: 503,
    body: {
      error: 'Database not ready',
      code: 'database-not-ready',
    },
  };
}

function normalizePrefix(prefix: string): string {
  const trimmed = prefix.trim();
  if (!trimmed || trimmed === '/') return '';
  return trimmed.startsWith('/') ? trimmed.replace(/\/+$/, '') : `/${trimmed.replace(/\/+$/, '')}`;
}
