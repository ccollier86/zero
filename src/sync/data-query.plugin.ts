/**
 * data-query.plugin.ts
 *
 * Owns the managed-table HTTP query endpoint used by frontend lazy collections.
 * This file validates query parameters, builds safe SQLite reads, and enforces
 * sync read policy; it does not own table schemas, mutation behavior, or UI
 * loading state.
 */

import { Elysia, t } from 'elysia';
import { readAuthBearerToken } from '../auth/auth-bearer-token';
import { authContextAuthorityFingerprint } from '../auth/auth-context-authority';
import { createAuthMiddleware } from '../auth/auth.middleware';
import type { TokenService } from '../auth/token-service';
import type { AuthContext } from '../auth/types';
import type { AuthTenancyMode } from '../auth/types';
import type { UserStore } from '../auth/user-store';
import type { AuthorizationKernel } from '../auth/authorization-kernel';
import type { AuthorizationRoleAssignmentResolver } from '../auth/authorization-access';
import { OBS_CODES } from '../observability/codes';
import { errorPlatform } from '../observability/sink';
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
  resolveResourceRealm,
  resourceRealmConstraint,
} from '../resources/resource-realm';
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
  /** Optional auth user store provider used to hydrate resource metadata policy. */
  getUserStore?: () => UserStore | null;
  /** App-local authorization kernel used by authorizationPolicy(). */
  getAuthorizationKernel?: () => AuthorizationKernel | null;
  /** Live advanced role assignments used by authorizationPolicy(). */
  getRoleAssignments?: () => AuthorizationRoleAssignmentResolver | null;
  /** App-local database provider. Legacy standalone callers may omit it. */
  getDB?: () => ReactiveDB | null;
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
}

// ─── Constants ───────────────────────────────────────────────────────────────

/** Maximum number of rows returned per request. */
const MAX_LIMIT = 1000;

/** Default limit when none specified. */
const DEFAULT_LIMIT = 500;

/** Pattern for valid SQL table identifiers. */
const SAFE_IDENTIFIER = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

// ─── Plugin ──────────────────────────────────────────────────────────────────

/**
 * Create the data query Elysia plugin.
 *
 * Registers `GET /api/data` — a generic query endpoint for lazy-synced tables.
 * Accepts query params:
 * - `table` (required) — which table to query
 * - `filter` (repeatable) — format `field:value`, applied as AND conditions
 * - `order` (optional) — column name, always DESC
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

  return new Elysia({ name: 'data-query' })
    .use(createAuthMiddleware(config.getTokenService ?? (() => null)))
    .get('/api/data', async ({ query, set, authContext, request }) => {
      // An explicit app-local provider owns this dependency even while it is
      // unavailable. Never fall through to another live app's compatibility
      // provider in that case.
      const db = config.getDB ? config.getDB() : getSyncDB();
      if (!db) {
        set.status = 503;
        return { error: 'Database not ready' };
      }

      const { table } = query;

      // ─── Validate table ──────────────────────────────────
      if (!table) {
        set.status = 400;
        return { error: 'Missing required query parameter: table' };
      }

      if (!SAFE_IDENTIFIER.test(table)) {
        set.status = 400;
        return { error: `Invalid table name: ${table}` };
      }

      const exposure = evaluateDataExposure(config, table);
      if (!exposure.ok) {
        set.status = 404;
        return { error: exposure.error, code: exposure.code };
      }

      if (!db.hasTable(table)) {
        set.status = 400;
        return { error: `Unknown table: ${table}` };
      }

      const readDecision = evaluateSyncReadPolicy(policy, { table, authContext });
      if (!readDecision.ok) {
        set.status = 403;
        return { error: readDecision.reason ?? `Not allowed: ${table}` };
      }

      // Get the allowed columns for this table
      const allowedColumns = config.tableColumns.get(table);
      if (!allowedColumns || allowedColumns.length === 0) {
        set.status = 400;
        return { error: `No column metadata for table: ${table}` };
      }

      const commitAuthority = captureDataCommitAuthority(config, authContext);
      const resourceDecision = await evaluateDataResourcePolicy(config, table, authContext);
      if (!resourceDecision.ok) {
        set.status = resourceDecision.status;
        return { error: resourceDecision.error, code: resourceDecision.code };
      }
      if (resourceDecision.authorityFingerprint) {
        const current = await resolveCurrentDataAuthority(
          config,
          request,
          resourceDecision.authorityFingerprint,
        );
        if (!current) {
          set.status = 403;
          return {
            error: 'Resource authorization changed during the request',
            code: 'resource-authority-changed',
          };
        }
      }

      const plan = buildResourceListQueryPlan({
        table,
        columns: allowedColumns,
        selectColumns: config.resourceRegistry?.getByTable(table)?.fields?.read,
        filterColumns: config.resourceRegistry?.getByTable(table)?.fields?.filter,
        sortColumns: config.resourceRegistry?.getByTable(table)?.fields?.sort,
        constraints: resourceDecision.constraints,
        query,
        defaultLimit,
        maxLimit,
      });
      if ('error' in plan) {
        set.status = plan.status;
        return { error: plan.error };
      }

      const params = [...plan.params, plan.limit + 1, plan.offset];
      let resultRows: any[];
      let authorityChangedAtCommit = false;
      try {
        resultRows = db.transaction(() => {
          if (resourceDecision.authorityFingerprint
            && !isDataAuthorityCurrentAtCommit(
              config,
              commitAuthority,
              resourceDecision.authorityFingerprint,
            )) {
            authorityChangedAtCommit = true;
            return [];
          }
          return db.prepare(plan.sql).all(...(params as any[]));
        });
      } catch (error) {
        errorPlatform(OBS_CODES.DATA_QUERY_FAILED, {
          error,
          metadata: { table },
          userId: authContext?.userId,
        });
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

      const hasMore = resultRows.length > plan.limit;
      const authorizedRows = hasMore ? resultRows.slice(0, plan.limit) : resultRows;
      const rows = projectResourceRows(
        authorizedRows,
        config.resourceRegistry?.getByTable(table)?.fields,
      );

      return {
        rows,
        page: {
          limit: plan.limit,
          offset: plan.offset,
          count: rows.length,
          hasMore,
          nextOffset: hasMore ? plan.offset + plan.limit : null,
        },
      };
    }, {
      query: t.Object({
        table: t.String({ minLength: 1 }),
        filter: t.Optional(t.Union([t.String(), t.Array(t.String())])),
        order: t.Optional(t.String()),
        dir: t.Optional(t.String()),
        limit: t.Optional(t.Numeric()),
        offset: t.Optional(t.Numeric()),
      }),
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
  };
}

async function resolveCurrentDataAuthority(
  config: DataQueryConfig,
  request: Request,
  expectedFingerprint: string,
): Promise<boolean> {
  const bearer = readAuthBearerToken(request);
  const tokens = config.getTokenService?.() ?? null;
  let current: AuthContext | null = null;
  try {
    if (bearer && tokens) {
      if (typeof tokens.resolveAuthContext === 'function') {
        current = await tokens.resolveAuthContext(bearer);
      } else {
        const payload = await tokens.verifyAccessToken(bearer);
        current = payload
          && typeof payload.email === 'string'
          && typeof payload.role === 'string'
          ? {
              userId: payload.sub,
              email: payload.email,
              role: payload.role,
            }
          : null;
      }
    }
  } catch {
    current = null;
  }
  return resolveDataPolicyAuthority(config, current).fingerprint === expectedFingerprint;
}

interface DataCommitAuthority {
  resolve(): AuthContext | null;
}

function captureDataCommitAuthority(
  config: DataQueryConfig,
  authContext: AuthContext | null,
): DataCommitAuthority | undefined {
  if (!authContext) return undefined;
  // Legacy standalone verifiers do not expose the durable synchronous
  // authority contract. Preserve that compatibility in single mode only.
  // Multi mode returns a deliberately unavailable resolver so the SQL
  // boundary fails closed instead of accepting a stale request-time context.
  const unavailable = (): DataCommitAuthority | undefined =>
    config.tenancyMode === 'multi' ? { resolve: () => null } : undefined;
  if (!authContext.sessionKind) return unavailable();
  const tokens = config.getTokenService?.() ?? null;
  if (!tokens
    || typeof tokens.captureAuthContextAuthority !== 'function'
    || typeof tokens.resolveAuthContextAuthority !== 'function') return unavailable();

  const reference = tokens.captureAuthContextAuthority(authContext);
  return {
    resolve: () => reference
      ? tokens.resolveAuthContextAuthority(reference)
      : null,
  };
}

function isDataAuthorityCurrentAtCommit(
  config: DataQueryConfig,
  authority: DataCommitAuthority | undefined,
  expectedFingerprint: string,
): boolean {
  if (!authority) return true;
  try {
    const current = authority.resolve();
    return resolveDataPolicyAuthority(config, current).fingerprint === expectedFingerprint;
  } catch {
    return false;
  }
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
