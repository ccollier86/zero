/**
 * data-query.plugin.ts
 *
 * Owns the managed-table HTTP query endpoint used by frontend lazy collections.
 * This file validates query parameters, builds safe SQLite reads, and enforces
 * sync read policy; it does not own table schemas, mutation behavior, or UI
 * loading state.
 */

import { Elysia, t } from 'elysia';
import { authContextAuthorityFingerprint } from '../auth/auth-context-authority';
import { getPublicAuthErrorMessage } from '../auth/auth-error-response';
import { createAuthMiddleware } from '../auth/auth.middleware';
import type { AuthRequestCredentialResolver } from '../auth/auth-api-key-types';
import type { RequestAuthorizationAccess } from '../auth/authorization-access';
import type { TokenService } from '../auth/token-service';
import { AuthError, type AuthContext, type AuthTenancyMode } from '../auth/types';
import type { UserStore } from '../auth/user-store';
import type { AuthorizationKernel } from '../auth/authorization-kernel';
import type { AuthorizationRoleAssignmentResolver } from '../auth/authorization-access';
import type { DatabaseErrorCode } from '../databases/database-error';
import type { DatabaseManager } from '../databases/database-manager';
import {
  isDatabaseTableName,
  type DatabaseFindRows,
} from '../databases/database-operations';
import { OBS_CODES } from '../observability/codes';
import { emitPlatformCode, emitPlatformCodeTo } from '../observability/sink';
import type { PlatformObservabilityRuntime } from '../observability/types';
import {
  buildResourceListQueryPlan,
  createResourcePolicyAuthorization,
  createResourcePolicyUser,
  evaluateResourcePolicy,
  projectResourceRows,
  type ResourceDataConstraint,
  type ResourcePolicyAuthConfig,
  type ResourceRegistry,
} from '../resources';
import {
  requiresAuthenticatedUser,
  resourcePolicyAdmitsCredential,
} from '../resources/resource-policy-inspection';
import {
  buildResourceListFindPlan,
  RESOURCE_QUERY_LIMITS,
} from '../resources/resource-query';
import {
  resolveResourceRealm,
  resourceRealmConstraint,
  type ResourceTenantScope,
} from '../resources/resource-realm';
import { DataQueryDatabaseAdapter } from './data-query-database-adapter';
import { getSyncDB } from './sync.plugin';
import type { ReactiveDB } from './reactive-db';
import { allowAllSyncPolicy, evaluateSyncReadPolicy } from './sync-policy';
import type { SyncPolicy } from './sync-policy';

// ─── Configuration ───────────────────────────────────────────────────────────

export interface DataQueryConfig {
  /** Legacy/loading allow-list. Explicit resource HTTP exposure can also opt in. */
  queryableTables: Set<string>;
  /** Column definitions per table for validation */
  tableColumns: Map<string, string[]>;
  /** Optional sync read policy reused for lazy HTTP reads. */
  policy?: SyncPolicy;
  /** Optional auth token service provider used to resolve HTTP auth context. */
  getTokenService?: () => TokenService | null;
  /** Guardian request resolver used only by resource policies which opt API keys in. */
  getRequestCredentialResolver?: () => AuthRequestCredentialResolver | null;
  /** Optional auth user store provider used to hydrate resource metadata policy. */
  getUserStore?: () => UserStore | null;
  /** App-local authorization kernel used by authorizationPolicy(). */
  getAuthorizationKernel?: () => AuthorizationKernel | null;
  /** Live advanced role assignments used by authorizationPolicy(). */
  getRoleAssignments?: () => AuthorizationRoleAssignmentResolver | null;
  /** App-local database provider. Legacy standalone callers may omit it. */
  getDB?: () => ReactiveDB | null;
  /** App-local actor database owner. It is never projected to request input. */
  getDatabaseManager?: () => DatabaseManager | null;
  /** Optional registered resource registry for resource-protected lazy reads. */
  resourceRegistry?: ResourceRegistry;
  /** Multi mode denies managed app tables without an explicit resource realm. */
  tenancyMode?: AuthTenancyMode;
  /** App-owned tables subject to realm classification (framework tables are separate). */
  managedTables?: ReadonlySet<string>;
  /** Auth config used to evaluate resource metadata policy. */
  resourceAuthConfig?: ResourcePolicyAuthConfig;
  /** Default number of rows returned when limit is omitted. */
  defaultLimit?: number;
  /** Maximum number of rows a single request may return. */
  maxLimit?: number;
  /** App-local observability runtime. Standalone callers may use the ambient fallback. */
  observability?: PlatformObservabilityRuntime | null;
}

// ─── Constants ───────────────────────────────────────────────────────────────

/** Maximum number of rows returned per request. */
const MAX_LIMIT = 1000;

/** Default limit when none specified. */
const DEFAULT_LIMIT = 500;

const dataQueryFilterSchema = t.String({
  maxLength: RESOURCE_QUERY_LIMITS.filterExpressionLength,
});
const dataQuerySearchFieldSchema = t.String({
  minLength: 1,
  maxLength: RESOURCE_QUERY_LIMITS.identifierLength,
});
const dataQuerySortSchema = t.String({
  minLength: 3,
  maxLength: RESOURCE_QUERY_LIMITS.sortExpressionLength,
});

const dataQuerySchema = t.Object({
  table: t.String({
    minLength: 1,
    maxLength: RESOURCE_QUERY_LIMITS.identifierLength,
  }),
  filter: t.Optional(t.Union([
    dataQueryFilterSchema,
    t.Array(dataQueryFilterSchema, { maxItems: RESOURCE_QUERY_LIMITS.filterCount }),
  ])),
  search: t.Optional(t.String({ maxLength: RESOURCE_QUERY_LIMITS.searchLength })),
  searchField: t.Optional(t.Union([
    dataQuerySearchFieldSchema,
    t.Array(dataQuerySearchFieldSchema, {
      maxItems: RESOURCE_QUERY_LIMITS.searchFieldCount,
    }),
  ])),
  sort: t.Optional(t.Union([
    dataQuerySortSchema,
    t.Array(dataQuerySortSchema, { maxItems: RESOURCE_QUERY_LIMITS.sortCount }),
  ])),
  order: t.Optional(t.String({ maxLength: RESOURCE_QUERY_LIMITS.identifierLength })),
  dir: t.Optional(t.String({ maxLength: RESOURCE_QUERY_LIMITS.directionLength })),
  limit: t.Optional(t.Numeric()),
  offset: t.Optional(t.Numeric()),
});

// ─── Plugin ──────────────────────────────────────────────────────────────────

/**
 * Create the data query Elysia plugin.
 *
 * Registers `GET /api/data` — a generic query endpoint for lazy-synced tables.
 * Accepts query params:
 * - `table` (required) — which table to query
 * - `filter` (repeatable) — format `field:value`, applied as AND conditions
 * - `search` + repeatable `searchField` — bounded OR text search
 * - `sort` (repeatable) — `field:asc|desc` multi-column ordering
 * - `order`/`dir` (optional) — legacy single-column ordering
 * - `limit` (optional) — max rows, capped at MAX_LIMIT
 *
 * Security:
 * - Table name validated against explicit resource HTTP exposure or the
 *   legacy/loading allow-list (config.queryableTables)
 * - Column names in filter/order validated against known columns (config.tableColumns)
 * - Filter values passed as parameterized query params (never interpolated into SQL)
 * - Limit validated as positive integer
 */
export function createDataQueryPlugin(config: DataQueryConfig) {
  assertMultiTenantDataQueryClassification(config);
  const policy = config.policy ?? allowAllSyncPolicy;
  const defaultLimit = config.defaultLimit ?? DEFAULT_LIMIT;
  const maxLimit = config.maxLimit ?? MAX_LIMIT;
  const database = new DataQueryDatabaseAdapter({
    tenancyMode: config.tenancyMode,
    getTokenService: config.getTokenService,
    getRequestCredentialResolver: config.getRequestCredentialResolver,
    getDatabaseManager: config.getDatabaseManager,
    authorityFingerprint: (authContext) => (
      resolveDataPolicyAuthority(config, authContext).fingerprint
    ),
  });
  const emitDataQueryFailure = (input: Readonly<{
    table: string;
    databaseCode?: DatabaseErrorCode;
  }>): void => {
    // Table has already passed bounded identifier validation. The caught error, SQL, bind
    // values, tenant identity, and caller identity never cross this boundary.
    const options = {
      metadata: {
        table: input.table,
        ...(input.databaseCode ? { databaseCode: input.databaseCode } : {}),
      },
    };
    if (config.observability) {
      emitPlatformCodeTo(config.observability, OBS_CODES.DATA_QUERY_FAILED, options);
      return;
    }
    emitPlatformCode(OBS_CODES.DATA_QUERY_FAILED, options);
  };

  return new Elysia({ name: 'data-query' })
    .use(createAuthMiddleware(config.getTokenService ?? (() => null), {
      getRequestCredentialResolver: config.getRequestCredentialResolver,
    }))
    .onError(({ code, error, set }) => {
      if (error instanceof AuthError) {
        set.status = error.status;
        return { error: getPublicAuthErrorMessage(error), code: error.code };
      }
      if (code === 'VALIDATION') {
        set.status = 400;
        return { error: 'Invalid data query', code: 'invalid-data-query' };
      }
    })
    .get('/api/data', async ({ query, set, access, request }) => {
      // An explicit app-local provider owns this dependency even while it is
      // unavailable. Never fall through to another live app's compatibility
      // provider in that case.
      const db = config.getDB ? config.getDB() : getSyncDB();

      const { table } = query;

      // ─── Validate table ──────────────────────────────────
      if (!table) {
        set.status = 400;
        return {
          error: 'Missing required query parameter: table',
          code: 'invalid-data-query',
        };
      }

      if (!isDatabaseTableName(table)) {
        set.status = 400;
        return { error: 'Invalid table name', code: 'invalid-data-query' };
      }

      const exposure = evaluateDataExposure(config, table);
      if (!exposure.ok) {
        set.status = 404;
        return { error: exposure.error, code: exposure.code };
      }

      const resource = config.resourceRegistry?.getByTable(table) ?? null;
      const usesTenantDatabase = resource?.storage.kind === 'tenant'
        && resource.storage.isolation === 'tenant-database';
      if (!usesTenantDatabase && db && !db.hasTable(table)) {
        set.status = 400;
        return { error: `Unknown table: ${table}`, code: 'invalid-data-query' };
      }

      const admittedAuthContext = admitDataQueryCredential(config, table, access);

      const readDecision = evaluateSyncReadPolicy(
        policy,
        { table, authContext: admittedAuthContext },
        config.observability,
      );
      if (!readDecision.ok) {
        set.status = 403;
        return { error: readDecision.reason ?? `Not allowed: ${table}` };
      }

      // Get the allowed columns for this table
      const allowedColumns = config.tableColumns.get(table);
      if (!allowedColumns || allowedColumns.length === 0) {
        set.status = 400;
        return {
          error: `No column metadata for table: ${table}`,
          code: 'invalid-data-query',
        };
      }

      const commitAuthority = database.captureCommitAuthority(admittedAuthContext);
      const resourceDecision = await evaluateDataResourcePolicy(
        config,
        table,
        admittedAuthContext,
      );
      if (!resourceDecision.ok) {
        set.status = resourceDecision.status;
        return { error: resourceDecision.error, code: resourceDecision.code };
      }
      if (resourceDecision.authorityFingerprint) {
        const current = await database.isRequestAuthorityCurrent(
          request,
          resourceDecision.authorityFingerprint,
          commitAuthority,
        );
        if (!current) {
          set.status = 403;
          return {
            error: 'Resource authorization changed during the request',
            code: 'resource-authority-changed',
          };
        }
      }

      const planOptions = {
        table,
        columns: allowedColumns,
        selectColumns: resource?.fields?.read,
        filterColumns: resource?.fields?.filter,
        sortColumns: resource?.fields?.sort,
        constraints: resourceDecision.constraints,
        query,
        defaultLimit,
        maxLimit,
      } as const;

      let resultRows: DatabaseFindRows | any[];
      let page: { limit: number; offset: number };
      if (usesTenantDatabase) {
        const findPlan = buildResourceListFindPlan(planOptions);
        if ('error' in findPlan) {
          set.status = findPlan.status;
          if (findPlan.status >= 500) {
            emitDataQueryFailure({ table });
            return { error: 'Data query failed', code: 'data-query-failed' };
          }
          return { error: findPlan.error, code: 'invalid-data-query' };
        }
        try {
          resultRows = await database.findTenant({
            scope: resourceDecision.scope,
            authority: commitAuthority,
            authorityFingerprint: resourceDecision.authorityFingerprint,
            table,
            clientInput: findPlan.input,
          });
        } catch (error) {
          const response = database.classifyFailure(error);
          // Validation, authority, and optimistic conflicts are expected HTTP
          // outcomes. Only an unavailable/indeterminate database is an ERROR.
          if (response.status >= 500) {
            emitDataQueryFailure({
              table,
              databaseCode: response.databaseCode,
            });
          }
          set.status = response.status;
          return { error: response.error, code: response.code };
        }
        // The actor client fences authority immediately after its read, but
        // returning through that async boundary yields once more before this
        // route can expose the rows. Recheck synchronously at the delivery
        // boundary so a revocation queued by the read cannot leak one final
        // response from the former tenant scope.
        if (resourceDecision.authorityFingerprint
          && !database.isAuthorityCurrentAtCommit(
            commitAuthority,
            resourceDecision.authorityFingerprint,
          )) {
          set.status = 403;
          return {
            error: 'Resource authorization changed during the request',
            code: 'resource-authority-changed',
          };
        }
        page = findPlan;
      } else {
        if (!db) {
          set.status = 503;
          return { error: 'Database not ready', code: 'database-unavailable' };
        }
        const sqlPlan = buildResourceListQueryPlan(planOptions);
        if ('error' in sqlPlan) {
          set.status = sqlPlan.status;
          if (sqlPlan.status >= 500) {
            emitDataQueryFailure({ table });
            return { error: 'Data query failed', code: 'data-query-failed' };
          }
          return { error: sqlPlan.error, code: 'invalid-data-query' };
        }

        const params = [...sqlPlan.params, sqlPlan.limit + 1, sqlPlan.offset];
        let authorityChangedAtCommit = false;
        try {
          resultRows = db.transaction(() => {
            if (resourceDecision.authorityFingerprint
              && !database.isAuthorityCurrentAtCommit(
                commitAuthority,
                resourceDecision.authorityFingerprint,
              )) {
              authorityChangedAtCommit = true;
              return [];
            }
            const statement = db.prepare(sqlPlan.sql);
            try {
              return statement.all(...(params as any[]));
            } finally {
              statement.finalize();
            }
          });
        } catch {
          emitDataQueryFailure({ table });
          set.status = 500;
          return { error: 'Data query failed', code: 'data-query-failed' };
        }
        if (authorityChangedAtCommit) {
          set.status = 403;
          return {
            error: 'Resource authorization changed during the request',
            code: 'resource-authority-changed',
          };
        }
        page = sqlPlan;
      }

      const hasMore = resultRows.length > page.limit;
      const authorizedRows = hasMore ? resultRows.slice(0, page.limit) : resultRows;
      const rows = projectResourceRows(
        authorizedRows,
        resource?.fields,
      );

      return {
        rows,
        page: {
          limit: page.limit,
          offset: page.offset,
          count: rows.length,
          hasMore,
          nextOffset: hasMore ? page.offset + page.limit : null,
        },
      };
    }, {
      query: dataQuerySchema,
    });
}

function evaluateDataExposure(
  config: DataQueryConfig,
  table: string,
): { ok: true } | { ok: false; error: string; code: string } {
  const resource = config.resourceRegistry?.getByTable(table);
  if (resource) {
    return resource.exposure.http
      ? { ok: true }
      : {
          ok: false,
          error: 'Table not found',
          code: 'table-not-queryable',
        };
  }

  return config.queryableTables.has(table)
    ? { ok: true }
    : {
        ok: false,
        error: 'Table not found',
        code: 'table-not-queryable',
      };
}

function assertMultiTenantDataQueryClassification(config: DataQueryConfig): void {
  if (config.tenancyMode !== 'multi') return;
  for (const table of config.queryableTables) {
    const realm = config.resourceRegistry?.getByTable(table)?.realm?.kind;
    if (realm === 'global' || realm === 'tenant') continue;
    throw new Error(
      `[data-query] Multi-tenant queryable table "${table}" must have an explicit global or tenant resource realm before /api/data starts.`,
    );
  }
}

type DataResourcePolicyResult =
  | {
    ok: true;
    constraints?: readonly ResourceDataConstraint[];
    authorityFingerprint?: string;
    scope?: ResourceTenantScope | null;
  }
  | { ok: false; status: number; error: string; code?: string };

async function evaluateDataResourcePolicy(
  config: DataQueryConfig,
  table: string,
  authContext: AuthContext | null
): Promise<DataResourcePolicyResult> {
  const resource = config.resourceRegistry?.getByTable(table);
  if (!resource) {
    if (config.tenancyMode === 'multi'
      && (config.managedTables?.has(table) ?? config.queryableTables.has(table))) {
      return {
        ok: false,
        status: 403,
        error: `Managed table '${table}' has no data realm`,
        code: 'resource-realm-unclassified',
      };
    }
    return { ok: true };
  }

  const realm = resolveResourceRealm(resource, authContext);
  if (!realm.ok) {
    return {
      ok: false,
      status: realm.status,
      error: realm.message,
      code: realm.code,
    };
  }

  if (!resource.actions.includes('list') || !resource.policy.list) {
    return {
      ok: false,
      status: 403,
      error: `Resource '${resource.name}' does not allow list reads`,
      code: 'resource-list-not-allowed',
    };
  }

  const authority = resolveDataPolicyAuthority(config, authContext);
  const decision = await evaluateResourcePolicy(resource.policy.list, {
    action: 'list',
    user: authority.user,
    authorization: authority.authorization,
    resource,
    authConfig: config.resourceAuthConfig ?? { userProperties: {} },
  });

  if (!decision.allowed) {
    return {
      ok: false,
      status: decision.status ?? 403,
      error: decision.message ?? 'Forbidden',
      code: decision.reason,
    };
  }

  return {
    ok: true,
    constraints: [
      ...resourceRealmConstraint(realm.scope),
      ...(decision.constraints ?? []),
    ],
    authorityFingerprint: authority.fingerprint,
    scope: realm.scope,
  };
}

function admitDataQueryCredential(
  config: DataQueryConfig,
  table: string,
  access: RequestAuthorizationAccess,
): AuthContext | null {
  const policy = config.resourceRegistry?.getByTable(table)?.policy.list;
  const admitsApiKey = policy
    ? resourcePolicyAdmitsCredential(policy, 'api-key')
    : false;
  const requiresUser = policy
    ? requiresAuthenticatedUser(policy, 'list') === 'yes'
    : false;
  // Resolve credential identity for this exact list policy before applying
  // its admission decision. API keys are never silently downgraded to
  // anonymous callers: the Resource must explicitly admit them.
  access.authorize({
    user: requiresUser ? 'required' : 'optional',
    credentials: ['session', 'api-key'],
  });
  const context = access.context;
  if (context?.credentialKind === 'api-key' && !admitsApiKey) {
    throw new AuthError('Forbidden', 'FORBIDDEN', 403);
  }
  return context;
}

function resourcePolicyAuthorityFingerprint(
  authContext: AuthContext | null,
  user: ReturnType<typeof createResourcePolicyUser>,
  authorization: ReturnType<typeof createResourcePolicyAuthorization>,
): string {
  return JSON.stringify([
    authContextAuthorityFingerprint(authContext, user?.properties ?? {}),
    user ? [user.userId, user.email ?? null, user.role] : null,
    authorization?.subject?.authorization ? [
      authorization.subject.authorization.scopeKind,
      authorization.subject.authorization.scopeId,
      authorization.subject.authorization.roles,
      authorization.subject.authorization.permissions,
      authorization.subject.authorization.allPermissions ?? false,
      authorization.subject.authorization.revision,
    ] : null,
  ]);
}

function resolveDataPolicyAuthority(
  config: DataQueryConfig,
  authContext: AuthContext | null,
) {
  const user = createResourcePolicyUser(
    authContext,
    config.getUserStore?.() ?? null,
  );
  const authorization = createResourcePolicyAuthorization(
    authContext,
    user,
    config.getAuthorizationKernel?.() ?? null,
    config.getRoleAssignments?.() ?? null,
  );
  return {
    user,
    authorization,
    fingerprint: resourcePolicyAuthorityFingerprint(
      authContext,
      user,
      authorization,
    ),
  };
}
