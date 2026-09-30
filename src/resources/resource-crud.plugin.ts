/**
 * resource-crud.plugin.ts
 *
 * Mounts generated HTTP CRUD routes for registered Zero resources. This file
 * owns Elysia route composition and validation only; policy evaluation and
 * persistence behavior live in ResourceCrudService.
 */

import { Elysia, t } from 'elysia';
import { readAuthBearerToken } from '../auth/auth-bearer-token';
import { createAuthMiddleware } from '../auth/auth.middleware';
import type { AuthRequestCredentialResolver } from '../auth/auth-api-key-types';
import type { TokenService } from '../auth/token-service';
import type { AuthContext, AuthTenancyMode } from '../auth/types';
import type { AuthorizationKernel } from '../auth/authorization-kernel';
import type {
  AuthorizationRoleAssignmentResolver,
  RequestAuthorizationAccess,
} from '../auth/authorization-access';
import type { UserStore } from '../auth/user-store';
import type { ReactiveDB, TableSchema } from '../sync';
import { getSyncDB } from '../sync';
import { ResourceCrudService, type ResourceCrudResult } from './resource-crud-service';
import type { ResourcePolicyAuthConfig } from './resource-policy-types';
import type { ResourceRegistry } from './resource-registry';
import type { ResourceAction } from './resource-policy-types';
import { resourcePolicyAdmitsCredential } from './resource-policy-inspection';
import type {
  PlatformCodeDefinition,
  PlatformCodeEmitOptions,
  PlatformEvent,
} from '../observability/types';

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
  /** Guardian request resolver used by resource policies which opt API keys in. */
  getRequestCredentialResolver?: () => AuthRequestCredentialResolver | null;
  getUserStore?: () => UserStore | null;
  /** App-local kernel used by authorizationPolicy(). */
  getAuthorizationKernel?: () => AuthorizationKernel | null;
  /** Live advanced role assignments used by authorizationPolicy(). */
  getRoleAssignments?: () => AuthorizationRoleAssignmentResolver | null;
  /** App-local database provider. Legacy standalone callers may omit it. */
  getDB?: () => ReactiveDB | null;
  /** App-local observability emitter. Standalone composition may omit it. */
  emitCode?: (
    definition: PlatformCodeDefinition,
    options?: PlatformCodeEmitOptions,
  ) => PlatformEvent;
}

const resourceParamsSchema = t.Object({
  resource: t.String({ minLength: 1 }),
});

const resourceIdParamsSchema = t.Object({
  resource: t.String({ minLength: 1 }),
  id: t.String({ minLength: 1 }),
});

const listQuerySchema = t.Object({
  filter: t.Optional(t.Union([t.String(), t.Array(t.String())])),
  order: t.Optional(t.String()),
  dir: t.Optional(t.String()),
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
    .use(createAuthMiddleware(getTokenService, {
      getRequestCredentialResolver: config.getRequestCredentialResolver,
    }))
    .get(`${prefix}/:resource`, async ({ params, query, set, access, request }) => {
      const service = createService(config, getUserStore);
      if (!service) return respond(set, serviceUnavailable());

      return respond(
        set,
        await service.list(
          params.resource,
          query,
          resourceRequestContext(
            request,
            admitResourceCredential(config, params.resource, 'list', access),
            getTokenService,
            config.getRequestCredentialResolver,
            config.tenancyMode === 'multi',
          ),
        )
      );
    }, {
      params: resourceParamsSchema,
      query: listQuerySchema,
    })
    .get(`${prefix}/:resource/:id`, async ({ params, set, access, request }) => {
      const service = createService(config, getUserStore);
      if (!service) return respond(set, serviceUnavailable());

      return respond(
        set,
        await service.get(
          params.resource,
          params.id,
          resourceRequestContext(
            request,
            admitResourceCredential(config, params.resource, 'get', access),
            getTokenService,
            config.getRequestCredentialResolver,
            config.tenancyMode === 'multi',
          ),
        )
      );
    }, {
      params: resourceIdParamsSchema,
    })
    .post(`${prefix}/:resource`, async ({ params, body, set, access, request }) => {
      const service = createService(config, getUserStore);
      if (!service) return respond(set, serviceUnavailable());

      return respond(
        set,
        await service.create(
          params.resource,
          body,
          resourceRequestContext(
            request,
            admitResourceCredential(config, params.resource, 'create', access),
            getTokenService,
            config.getRequestCredentialResolver,
            config.tenancyMode === 'multi',
          ),
        )
      );
    }, {
      params: resourceParamsSchema,
      body: bodySchema,
    })
    .patch(`${prefix}/:resource/:id`, async ({
      params, body, set, access, request,
    }) => {
      const service = createService(config, getUserStore);
      if (!service) return respond(set, serviceUnavailable());

      return respond(
        set,
        await service.update(
          params.resource,
          params.id,
          body,
          resourceRequestContext(
            request,
            admitResourceCredential(config, params.resource, 'update', access),
            getTokenService,
            config.getRequestCredentialResolver,
            config.tenancyMode === 'multi',
          ),
        )
      );
    }, {
      params: resourceIdParamsSchema,
      body: bodySchema,
    })
    .delete(`${prefix}/:resource/:id`, async ({ params, set, access, request }) => {
      const service = createService(config, getUserStore);
      if (!service) return respond(set, serviceUnavailable());

      return respond(
        set,
        await service.delete(
          params.resource,
          params.id,
          resourceRequestContext(
            request,
            admitResourceCredential(config, params.resource, 'delete', access),
            getTokenService,
            config.getRequestCredentialResolver,
            config.tenancyMode === 'multi',
          ),
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
  getRequestCredentialResolver:
    (() => AuthRequestCredentialResolver | null) | undefined,
  requireDurableAuthority: boolean,
) {
  const token = readAuthBearerToken(request);
  const tokenService = getTokenService();
  const credentials = getRequestCredentialResolver?.() ?? null;
  // Bound web/native sessions have a synchronous, secret-free authority
  // reference. Resolve it inside the resource database transaction so a
  // revocation cannot land between the last asynchronous check and commit.
  const requestAuthorityReference = authContext && credentials
    ? captureRequestAuthority(credentials, authContext)
    : null;
  const sessionAuthorityReference = !credentials
    && authContext?.sessionKind
    && tokenService
    && typeof tokenService.captureAuthContextAuthority === 'function'
    && typeof tokenService.resolveAuthContextAuthority === 'function'
    ? tokenService.captureAuthContextAuthority(authContext)
    : null;
  const supportsCommitAuthority = Boolean(
    requestAuthorityReference || sessionAuthorityReference,
  );
  // A custom/standalone verifier may hydrate an AuthContext without exposing
  // Zero's synchronous authority-reference contract. That remains compatible
  // in single mode, but multi mode must not turn it into a fail-open window
  // between the final async policy check and the SQLite read/write boundary.
  const mustResolveAtCommit = Boolean(authContext) && requireDurableAuthority;
  return {
    authContext,
    revalidateAuthContext: async () => {
      if (credentials) {
        return requestAuthorityReference
          ? credentials.resolveAuthority(requestAuthorityReference)
          : null;
      }
      const service = getTokenService();
      return token && service ? service.resolveAuthContext(token) : null;
    },
    ...(supportsCommitAuthority || mustResolveAtCommit ? {
      resolveAuthContextAtCommit: () => requestAuthorityReference
        ? credentials!.resolveAuthority(requestAuthorityReference)
        : sessionAuthorityReference
          ? tokenService!.resolveAuthContextAuthority(sessionAuthorityReference)
          : null,
    } : {}),
  };
}

function admitResourceCredential(
  config: ResourceCrudPluginConfig,
  resourceName: string,
  action: ResourceAction,
  access: RequestAuthorizationAccess,
): AuthContext | null {
  const policy = config.registry.get(resourceName)?.policy[action];
  const admitsApiKey = policy
    ? resourcePolicyAdmitsCredential(policy, 'api-key')
    : false;
  // Establish visibility for this exact resource action. This also
  // reconceals a key admitted by an earlier middleware on the same request.
  access.authorize({
    user: 'optional',
    credentials: admitsApiKey ? ['session', 'api-key'] : ['session'],
  });
  return access.context;
}

function captureRequestAuthority(
  credentials: AuthRequestCredentialResolver,
  context: AuthContext,
) {
  try {
    return credentials.captureAuthority(context);
  } catch {
    return null;
  }
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
    emitCode: config.emitCode,
    defaultLimit: config.defaultLimit,
    maxLimit: config.maxLimit,
  });
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
