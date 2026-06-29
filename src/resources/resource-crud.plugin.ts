/**
 * resource-crud.plugin.ts
 *
 * Mounts generated HTTP CRUD routes for registered Zero resources. This file
 * owns Elysia route composition and validation only; policy evaluation and
 * persistence behavior live in ResourceCrudService.
 */

import { Elysia, t } from 'elysia';
import { createAuthMiddleware } from '../auth/auth.middleware';
import type { TokenService } from '../auth/token-service';
import type { UserStore } from '../auth/user-store';
import type { TableSchema } from '../sync';
import { getSyncDB } from '../sync';
import { ResourceCrudService, type ResourceCrudResult } from './resource-crud-service';
import type { ResourcePolicyAuthConfig } from './resource-policy-types';
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
  getTokenService?: () => TokenService | null;
  getUserStore?: () => UserStore | null;
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
    .use(createAuthMiddleware(getTokenService))
    .get(`${prefix}/:resource`, async ({ params, query, set, authContext }) => {
      const service = createService(config, getUserStore);
      if (!service) return respond(set, serviceUnavailable());

      return respond(
        set,
        await service.list(params.resource, query, { authContext })
      );
    }, {
      params: resourceParamsSchema,
      query: listQuerySchema,
    })
    .get(`${prefix}/:resource/:id`, async ({ params, set, authContext }) => {
      const service = createService(config, getUserStore);
      if (!service) return respond(set, serviceUnavailable());

      return respond(
        set,
        await service.get(params.resource, params.id, { authContext })
      );
    }, {
      params: resourceIdParamsSchema,
    })
    .post(`${prefix}/:resource`, async ({ params, body, set, authContext }) => {
      const service = createService(config, getUserStore);
      if (!service) return respond(set, serviceUnavailable());

      return respond(
        set,
        await service.create(params.resource, body, { authContext })
      );
    }, {
      params: resourceParamsSchema,
      body: bodySchema,
    })
    .patch(`${prefix}/:resource/:id`, async ({ params, body, set, authContext }) => {
      const service = createService(config, getUserStore);
      if (!service) return respond(set, serviceUnavailable());

      return respond(
        set,
        await service.update(params.resource, params.id, body, { authContext })
      );
    }, {
      params: resourceIdParamsSchema,
      body: bodySchema,
    })
    .delete(`${prefix}/:resource/:id`, async ({ params, set, authContext }) => {
      const service = createService(config, getUserStore);
      if (!service) return respond(set, serviceUnavailable());

      return respond(
        set,
        await service.delete(params.resource, params.id, { authContext })
      );
    }, {
      params: resourceIdParamsSchema,
    });
}

function createService(
  config: ResourceCrudPluginConfig,
  getUserStore: () => UserStore | null
): ResourceCrudService | null {
  const db = getSyncDB();
  if (!db) return null;

  return new ResourceCrudService({
    db,
    registry: config.registry,
    tables: config.tables,
    authConfig: config.authConfig,
    userStore: getUserStore(),
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
