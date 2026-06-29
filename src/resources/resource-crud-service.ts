/**
 * resource-crud-service.ts
 *
 * Owns framework-neutral generated CRUD behavior for registered resources.
 * This file coordinates policy evaluation, SQL read planning, input
 * sanitization, and ReactiveDB writes; it does not mount HTTP routes or load
 * app-owned resource modules.
 */

import type { AuthContext } from '../auth/types';
import type { UserStore } from '../auth/user-store';
import { OBS_CODES } from '../observability/codes';
import { errorPlatform } from '../observability/sink';
import type { ReactiveDB, Row, TableSchema } from '../sync';
import { createResourcePolicyUser } from './resource-auth';
import {
  isResourceInputError,
  sanitizeResourceCreateInput,
  sanitizeResourceUpdateInput,
} from './resource-input';
import { evaluateResourcePolicy } from './resource-policy-evaluator';
import type { ResourceAction, ResourcePolicyAuthConfig } from './resource-policy-types';
import {
  buildResourceListQueryPlan,
  type ResourceListQueryInput,
} from './resource-query';
import type { RegisteredResourceDefinition, ResourceRegistry } from './resource-registry';
import { getResourceTableColumns } from './resource-schema';

/** Request context accepted by resource CRUD service methods. */
export interface ResourceCrudRequestContext {
  authContext?: AuthContext | null;
}

/** Configuration for generated resource CRUD behavior. */
export interface ResourceCrudServiceOptions {
  db: ReactiveDB;
  registry: ResourceRegistry;
  tables: Record<string, TableSchema>;
  authConfig: ResourcePolicyAuthConfig;
  userStore?: UserStore | null;
  defaultLimit?: number;
  maxLimit?: number;
}

/** Successful resource service result. */
export interface ResourceCrudSuccess<TBody = unknown> {
  ok: true;
  status: number;
  body: TBody;
}

/** Failed resource service result. */
export interface ResourceCrudFailure {
  ok: false;
  status: number;
  body: {
    error: string;
    code?: string;
  };
}

/** Resource service method result. */
export type ResourceCrudResult<TBody = unknown> =
  | ResourceCrudSuccess<TBody>
  | ResourceCrudFailure;

/** Service that implements generated CRUD for registered resources. */
export class ResourceCrudService {
  constructor(private readonly options: ResourceCrudServiceOptions) {}

  /** List rows for a resource, applying list policy constraints and query parameters. */
  async list(
    resourceName: string,
    query: ResourceListQueryInput,
    context: ResourceCrudRequestContext = {}
  ): Promise<ResourceCrudResult> {
    const resource = this.getResourceForAction(resourceName, 'list');
    if ('ok' in resource) return resource;

    const user = createResourcePolicyUser(context.authContext, this.options.userStore);
    const decision = await evaluateResourcePolicy(resource.policy.list!, {
      action: 'list',
      user,
      resource,
      authConfig: this.options.authConfig,
    });
    if (!decision.allowed) return policyFailure(decision.status, decision.message, decision.reason);

    const columns = this.getColumns(resource);
    const plan = buildResourceListQueryPlan({
      table: resource.table,
      columns,
      constraints: decision.constraints,
      query,
      defaultLimit: this.options.defaultLimit,
      maxLimit: this.options.maxLimit,
    });
    if ('error' in plan) return failure(plan.status, plan.error);

    const params = [...plan.params, plan.limit + 1, plan.offset];
    let rows: Row[];
    try {
      rows = this.options.db.prepare(plan.sql).all(...(params as any[])) as Row[];
    } catch (error) {
      return this.handleQueryError(error, resource, 'list');
    }
    const hasMore = rows.length > plan.limit;
    const visibleRows = hasMore ? rows.slice(0, plan.limit) : rows;

    return success(200, {
      rows: visibleRows,
      page: {
        limit: plan.limit,
        offset: plan.offset,
        count: visibleRows.length,
        hasMore,
        nextOffset: hasMore ? plan.offset + plan.limit : null,
      },
    });
  }

  /** Get one row by resource primary key after row-level policy evaluation. */
  async get(
    resourceName: string,
    id: string,
    context: ResourceCrudRequestContext = {}
  ): Promise<ResourceCrudResult> {
    const resource = this.getResourceForAction(resourceName, 'get');
    if ('ok' in resource) return resource;

    const row = this.options.db.get(resource.table, id);
    if (!row) return failure(404, 'Resource row not found', 'not-found');

    const decision = await this.evaluateRowPolicy(resource, 'get', row, context);
    if (!decision.allowed) return policyFailure(decision.status, decision.message, decision.reason);

    return success(200, { row });
  }

  /** Create one row through ReactiveDB after create policy and input stamping. */
  async create(
    resourceName: string,
    input: unknown,
    context: ResourceCrudRequestContext = {}
  ): Promise<ResourceCrudResult> {
    const resource = this.getResourceForAction(resourceName, 'create');
    if ('ok' in resource) return resource;

    const user = createResourcePolicyUser(context.authContext, this.options.userStore);
    const rawInput = normalizeInputObject(input);
    if (isResourceInputError(rawInput)) return failure(rawInput.status, rawInput.error);

    const decision = await evaluateResourcePolicy(resource.policy.create!, {
      action: 'create',
      user,
      resource,
      input: rawInput,
      authConfig: this.options.authConfig,
    });
    if (!decision.allowed) return policyFailure(decision.status, decision.message, decision.reason);

    const mergedInput = { ...rawInput, ...(decision.stampedInput ?? {}) };
    const sanitized = sanitizeResourceCreateInput(
      mergedInput,
      this.getColumns(resource),
      resource.table
    );
    if (isResourceInputError(sanitized)) return failure(sanitized.status, sanitized.error);

    try {
      const change = this.options.db.create(resource.table, sanitized);
      return success(201, { row: change.row });
    } catch (error) {
      return this.handleMutationError(error, resource, 'create');
    }
  }

  /** Update one row through ReactiveDB after row-level policy evaluation. */
  async update(
    resourceName: string,
    id: string,
    input: unknown,
    context: ResourceCrudRequestContext = {}
  ): Promise<ResourceCrudResult> {
    const resource = this.getResourceForAction(resourceName, 'update');
    if ('ok' in resource) return resource;

    const row = this.options.db.get(resource.table, id);
    if (!row) return failure(404, 'Resource row not found', 'not-found');

    const rawInput = normalizeInputObject(input);
    if (isResourceInputError(rawInput)) return failure(rawInput.status, rawInput.error);

    const decision = await this.evaluateRowPolicy(resource, 'update', row, context, rawInput);
    if (!decision.allowed) return policyFailure(decision.status, decision.message, decision.reason);

    const mergedInput = { ...rawInput, ...(decision.stampedInput ?? {}) };
    const sanitized = sanitizeResourceUpdateInput(
      mergedInput,
      this.getColumns(resource),
      resource.table,
      resource.primaryKey
    );
    if (isResourceInputError(sanitized)) return failure(sanitized.status, sanitized.error);

    try {
      const change = this.options.db.update(resource.table, id, sanitized);
      if (!change) return failure(404, 'Resource row not found', 'not-found');
      return success(200, { row: change.row });
    } catch (error) {
      return this.handleMutationError(error, resource, 'update');
    }
  }

  /** Delete one row through ReactiveDB after row-level policy evaluation. */
  async delete(
    resourceName: string,
    id: string,
    context: ResourceCrudRequestContext = {}
  ): Promise<ResourceCrudResult> {
    const resource = this.getResourceForAction(resourceName, 'delete');
    if ('ok' in resource) return resource;

    const row = this.options.db.get(resource.table, id);
    if (!row) return failure(404, 'Resource row not found', 'not-found');

    const decision = await this.evaluateRowPolicy(resource, 'delete', row, context);
    if (!decision.allowed) return policyFailure(decision.status, decision.message, decision.reason);

    try {
      const change = this.options.db.delete(resource.table, id);
      if (!change) return failure(404, 'Resource row not found', 'not-found');
      return success(200, { deleted: true, id });
    } catch (error) {
      return this.handleMutationError(error, resource, 'delete');
    }
  }

  private async evaluateRowPolicy(
    resource: RegisteredResourceDefinition,
    action: ResourceAction,
    row: Row,
    context: ResourceCrudRequestContext,
    input?: Record<string, unknown>
  ) {
    const user = createResourcePolicyUser(context.authContext, this.options.userStore);

    return evaluateResourcePolicy(resource.policy[action]!, {
      action,
      user,
      resource,
      row,
      input,
      authConfig: this.options.authConfig,
    });
  }

  private getResourceForAction(
    resourceName: string,
    action: ResourceAction
  ): RegisteredResourceDefinition | ResourceCrudFailure {
    const resource = this.options.registry.get(resourceName);
    if (!resource) return failure(404, `Unknown resource: ${resourceName}`, 'resource-not-found');
    if (!resource.actions.includes(action)) {
      return failure(405, `Resource '${resource.name}' does not support ${action}`, 'action-not-allowed');
    }
    if (!resource.policy[action]) {
      return failure(500, `Resource '${resource.name}' is missing ${action} policy`, 'policy-missing');
    }
    return resource;
  }

  private getColumns(resource: RegisteredResourceDefinition): string[] {
    return getResourceTableColumns(this.options.tables[resource.table]);
  }

  private handleMutationError(
    error: unknown,
    resource: RegisteredResourceDefinition,
    action: ResourceAction
  ): ResourceCrudFailure {
    errorPlatform(OBS_CODES.RESOURCE_CRUD_FAILED, {
      error,
      metadata: {
        resource: resource.name,
        table: resource.table,
        action,
      },
    });

    const message = error instanceof Error ? error.message : 'Resource mutation failed';
    const status = isLikelyClientMutationError(message) ? 400 : 500;
    return failure(status, message, status === 400 ? 'invalid-resource-input' : 'resource-mutation-failed');
  }

  private handleQueryError(
    error: unknown,
    resource: RegisteredResourceDefinition,
    action: ResourceAction
  ): ResourceCrudFailure {
    errorPlatform(OBS_CODES.RESOURCE_CRUD_FAILED, {
      error,
      metadata: {
        resource: resource.name,
        table: resource.table,
        action,
      },
    });

    return failure(500, 'Resource query failed', 'resource-query-failed');
  }
}

function normalizeInputObject(input: unknown): Record<string, unknown> | { status: number; error: string } {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { status: 400, error: 'Request body must be a JSON object' };
  }

  return input as Record<string, unknown>;
}

function success<TBody>(status: number, body: TBody): ResourceCrudSuccess<TBody> {
  return { ok: true, status, body };
}

function failure(status: number, error: string, code?: string): ResourceCrudFailure {
  return {
    ok: false,
    status,
    body: { error, code },
  };
}

function policyFailure(
  status = 403,
  message = 'Forbidden',
  reason?: string
): ResourceCrudFailure {
  return failure(status, message, reason);
}

function isLikelyClientMutationError(message: string): boolean {
  return message.includes('missing primary key') ||
    message.includes('identity') ||
    message.includes('UNIQUE constraint') ||
    message.includes('NOT NULL constraint') ||
    message.includes('CHECK constraint') ||
    message.includes('FOREIGN KEY constraint');
}
