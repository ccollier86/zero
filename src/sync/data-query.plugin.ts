/**
 * data-query.plugin.ts
 *
 * Owns the lazy-table HTTP query endpoint used by frontend lazy collections.
 * This file validates query parameters, builds safe SQLite reads, and enforces
 * sync read policy; it does not own table schemas, mutation behavior, or UI
 * loading state.
 */

import { Elysia, t } from 'elysia';
import { createAuthMiddleware } from '../auth/auth.middleware';
import type { TokenService } from '../auth/token-service';
import type { AuthContext } from '../auth/types';
import type { UserStore } from '../auth/user-store';
import { OBS_CODES } from '../observability/codes';
import { errorPlatform } from '../observability/sink';
import {
  buildResourceListQueryPlan,
  createResourcePolicyUser,
  evaluateResourcePolicy,
  type ResourceDataConstraint,
  type ResourcePolicyAuthConfig,
  type ResourceRegistry,
} from '../resources';
import { getSyncDB } from './sync.plugin';
import { allowAllSyncPolicy, evaluateSyncReadPolicy } from './sync-policy';
import type { SyncPolicy } from './sync-policy';

// ─── Configuration ───────────────────────────────────────────────────────────

export interface DataQueryConfig {
  /** Set of table names that can be queried via /api/data */
  queryableTables: Set<string>;
  /** Column definitions per table for validation */
  tableColumns: Map<string, string[]>;
  /** Optional sync read policy reused for lazy HTTP reads. */
  policy?: SyncPolicy;
  /** Optional auth token service provider used to resolve HTTP auth context. */
  getTokenService?: () => TokenService | null;
  /** Optional auth user store provider used to hydrate resource metadata policy. */
  getUserStore?: () => UserStore | null;
  /** Optional registered resource registry for resource-protected lazy reads. */
  resourceRegistry?: ResourceRegistry;
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
 * - Table name validated against the allowed set (config.queryableTables)
 * - Column names in filter/order validated against known columns (config.tableColumns)
 * - Filter values passed as parameterized query params (never interpolated into SQL)
 * - Limit validated as positive integer
 */
export function createDataQueryPlugin(config: DataQueryConfig) {
  const policy = config.policy ?? allowAllSyncPolicy;
  const defaultLimit = config.defaultLimit ?? DEFAULT_LIMIT;
  const maxLimit = config.maxLimit ?? MAX_LIMIT;

  return new Elysia({ name: 'data-query' })
    .use(createAuthMiddleware(config.getTokenService ?? (() => null)))
    .get('/api/data', async ({ query, set, authContext }) => {
      const db = getSyncDB();
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

      if (!db.hasTable(table)) {
        set.status = 400;
        return { error: `Unknown table: ${table}` };
      }

      if (!config.queryableTables.has(table)) {
        set.status = 403;
        return { error: `Table '${table}' is not queryable` };
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

      const resourceDecision = await evaluateDataResourcePolicy(config, table, authContext);
      if (!resourceDecision.ok) {
        set.status = resourceDecision.status;
        return { error: resourceDecision.error, code: resourceDecision.code };
      }

      const plan = buildResourceListQueryPlan({
        table,
        columns: allowedColumns,
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
      try {
        resultRows = db.prepare(plan.sql).all(...(params as any[]));
      } catch (error) {
        errorPlatform(OBS_CODES.DATA_QUERY_FAILED, {
          error,
          metadata: { table },
          userId: authContext?.userId,
        });
        set.status = 500;
        return { error: 'Data query failed', code: 'data-query-failed' };
      }

      const hasMore = resultRows.length > plan.limit;
      const rows = hasMore ? resultRows.slice(0, plan.limit) : resultRows;

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

type DataResourcePolicyResult =
  | { ok: true; constraints?: readonly ResourceDataConstraint[] }
  | { ok: false; status: number; error: string; code?: string };

async function evaluateDataResourcePolicy(
  config: DataQueryConfig,
  table: string,
  authContext: AuthContext | null
): Promise<DataResourcePolicyResult> {
  const resource = config.resourceRegistry?.getByTable(table);
  if (!resource) return { ok: true };

  if (!resource.actions.includes('list') || !resource.policy.list) {
    return {
      ok: false,
      status: 403,
      error: `Resource '${resource.name}' does not allow list reads`,
      code: 'resource-list-not-allowed',
    };
  }

  const decision = await evaluateResourcePolicy(resource.policy.list, {
    action: 'list',
    user: createResourcePolicyUser(authContext, config.getUserStore?.() ?? null),
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
    constraints: decision.constraints,
  };
}
