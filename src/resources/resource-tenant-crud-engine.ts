/**
 * resource-tenant-crud-engine.ts
 *
 * Implements generated CRUD against an already-authorized physical tenant
 * database. It owns one request lease across receipt lookup, policy work, and
 * commit, while actor trusted writes keep each receipt atomic with mutation.
 * It does not resolve resource names, HTTP exposure, or tenant file paths.
 */

import type { DatabaseOperationRow } from '../databases/database-operations';
import type { Row, TableSchema } from '../sync';
import type {
  ResourceCrudRequestContext,
  ResourceCrudResult,
} from './resource-crud-contracts';
import type { ResourceCrudFailureMapper } from './resource-crud-failures';
import type { ResourceCrudPolicyService } from './resource-crud-policy';
import { normalizeResourceInput, resourceRowsMatch } from './resource-crud-rows';
import {
  resourceAuthorityChangedFailure,
  resourceFailure,
  resourcePolicyFailure,
  resourceRowChangedFailure,
  resourceSuccess,
} from './resource-crud-results';
import {
  projectResourceRow,
  projectResourceRows,
  validateResourceClientWriteFields,
} from './resource-field-access';
import {
  isResourceInputError,
  sanitizeResourceCreateInput,
  sanitizeResourceUpdateInput,
} from './resource-input';
import {
  mutationReceiptResourceId,
  resourceLogicalReceiptFingerprint,
  resourceMutationEffect,
  resourceMutationIdempotencyKey,
} from './resource-mutation-receipt';
import type {
  ResourcePolicyAuthorityService,
  ResourcePolicyAuthoritySnapshot,
} from './resource-policy-authority';
import { evaluateResourcePolicy } from './resource-policy-evaluator';
import type { ResourcePolicyAuthConfig } from './resource-policy-types';
import {
  buildResourceListFindPlan,
  type ResourceListQueryInput,
} from './resource-query';
import type { RegisteredResourceDefinition } from './resource-registry';
import type { ResourceTenantDatabaseScope } from './resource-realm';
import { getResourceTableColumns } from './resource-schema';
import type { ResourceTenantDatabaseAccessResolver } from './resource-tenant-database-access';

/** Dependencies used only by the physical tenant storage plane. */
export interface ResourceTenantCrudEngineOptions {
  readonly tables: Record<string, TableSchema>;
  readonly authConfig: ResourcePolicyAuthConfig;
  readonly defaultLimit?: number;
  readonly maxLimit?: number;
}

/** Physical-tenant generated CRUD over actor-backed database capabilities. */
export class ResourceTenantCrudEngine {
  constructor(
    private readonly options: ResourceTenantCrudEngineOptions,
    private readonly authority: ResourcePolicyAuthorityService,
    private readonly policy: ResourceCrudPolicyService,
    private readonly access: ResourceTenantDatabaseAccessResolver,
    private readonly failures: ResourceCrudFailureMapper,
  ) {}

  /** List authorized rows from one verified physical tenant database. */
  async list(
    resource: RegisteredResourceDefinition,
    scope: ResourceTenantDatabaseScope,
    query: ResourceListQueryInput,
    context: ResourceCrudRequestContext,
  ): Promise<ResourceCrudResult> {
    const captured = this.authority.capture(context);
    const decision = await evaluateResourcePolicy(resource.policy.list!, {
      action: 'list',
      user: captured.user,
      authorization: captured.authorization,
      resource,
      authConfig: this.options.authConfig,
    });
    if (!decision.allowed) {
      return resourcePolicyFailure(decision.status, decision.message, decision.reason);
    }
    if (!await this.authority.isCurrent(context, captured)) {
      return resourceAuthorityChangedFailure();
    }

    const plan = buildResourceListFindPlan({
      table: resource.table,
      columns: this.getColumns(resource),
      selectColumns: resource.fields?.read,
      filterColumns: resource.fields?.filter,
      sortColumns: resource.fields?.sort,
      constraints: decision.constraints ?? [],
      query,
      defaultLimit: this.options.defaultLimit,
      maxLimit: this.options.maxLimit,
    });
    if ('error' in plan) return resourceFailure(plan.status, plan.error);

    const resolved = await this.access.resolve(
      resource,
      scope,
      context,
      captured,
      'list',
      'read',
    );
    if ('failure' in resolved) return resolved.failure;
    try {
      const result = await resolved.client.find(resource.table, plan.input, {
        consistency: { mode: 'strong' },
      });
      if (!this.isCurrent(context, captured)) {
        return resourceAuthorityChangedFailure();
      }
      const rows = result.value as readonly Row[];
      const hasMore = rows.length > plan.limit;
      const authorizedRows = hasMore ? rows.slice(0, plan.limit) : rows;
      const visibleRows = projectResourceRows(authorizedRows, resource.fields);
      return resourceSuccess(200, {
        rows: visibleRows,
        page: {
          limit: plan.limit,
          offset: plan.offset,
          count: visibleRows.length,
          hasMore,
          nextOffset: hasMore ? plan.offset + plan.limit : null,
        },
      });
    } catch (error) {
      return this.failures.tenantDatabase(error, resource, 'list', 'read');
    } finally {
      resolved.release();
    }
  }

  /** Read, authorize, and strongly re-read one physical tenant row. */
  async get(
    resource: RegisteredResourceDefinition,
    scope: ResourceTenantDatabaseScope,
    id: string,
    context: ResourceCrudRequestContext,
  ): Promise<ResourceCrudResult> {
    const captured = this.authority.capture(context);
    const resolved = await this.access.resolve(
      resource,
      scope,
      context,
      captured,
      'get',
      'read',
    );
    if ('failure' in resolved) return resolved.failure;
    try {
      const initial = await resolved.client.get(resource.table, id, {
        consistency: { mode: 'strong' },
      });
      if (!this.isCurrent(context, captured)) {
        return resourceAuthorityChangedFailure();
      }
      const row = initial.value as Row | null;
      if (!row) return resourceFailure(404, 'Resource row not found', 'not-found');

      const decision = await this.policy.evaluateRow(resource, 'get', row, captured);
      if (!decision.allowed) {
        return resourcePolicyFailure(decision.status, decision.message, decision.reason);
      }
      if (!await this.authority.isCurrent(context, captured)) {
        return resourceAuthorityChangedFailure();
      }

      const finalRead = await resolved.client.get(resource.table, id, {
        consistency: { mode: 'strong' },
      });
      if (!this.isCurrent(context, captured)) {
        return resourceAuthorityChangedFailure();
      }
      const current = finalRead.value as Row | null;
      if (!current) return resourceFailure(404, 'Resource row not found', 'not-found');
      if (!resourceRowsMatch(this.getColumns(resource), current, row)) {
        return resourceRowChangedFailure();
      }
      return resourceSuccess(200, { row: projectResourceRow(current, resource.fields) });
    } catch (error) {
      return this.failures.tenantDatabase(error, resource, 'get', 'read');
    } finally {
      resolved.release();
    }
  }

  /** Create one physical tenant row with its actor-owned durable receipt. */
  async create(
    resource: RegisteredResourceDefinition,
    scope: ResourceTenantDatabaseScope,
    input: unknown,
    context: ResourceCrudRequestContext,
  ): Promise<ResourceCrudResult> {
    const captured = this.authority.capture(context);
    const rawInput = normalizeResourceInput(input);
    if (isResourceInputError(rawInput)) return resourceFailure(rawInput.status, rawInput.error);
    const fieldWrite = validateResourceClientWriteFields(
      rawInput,
      resource.fields,
      'create',
      resource.table,
      [resource.primaryKey],
    );
    if (fieldWrite) return resourceFailure(fieldWrite.status, fieldWrite.error, fieldWrite.code);

    const decision = await evaluateResourcePolicy(resource.policy.create!, {
      action: 'create',
      user: captured.user,
      authorization: captured.authorization,
      resource,
      input: rawInput,
      authConfig: this.options.authConfig,
    });
    if (!decision.allowed) {
      return resourcePolicyFailure(decision.status, decision.message, decision.reason);
    }
    if (!await this.authority.isCurrent(context, captured)) {
      return resourceAuthorityChangedFailure();
    }

    const sanitized = sanitizeResourceCreateInput(
      { ...rawInput, ...(decision.stampedInput ?? {}) },
      this.getColumns(resource),
      resource.table,
    );
    if (isResourceInputError(sanitized)) return resourceFailure(sanitized.status, sanitized.error);

    const resolved = await this.access.resolve(
      resource,
      scope,
      context,
      captured,
      'create',
      'write',
    );
    if ('failure' in resolved) return resolved.failure;

    const idempotencyKey = resourceMutationIdempotencyKey(
      context.idempotencyKey,
      captured.receiptPrincipalFingerprint,
      scope.tenantId,
    );
    const logicalReceiptFingerprint = resourceLogicalReceiptFingerprint(
      resource,
      'create',
      mutationReceiptResourceId(resource, rawInput),
      rawInput,
    );
    try {
      // The trusted actor writer persists the receipt in the same SQLite
      // transaction as this mutation; never replace it with public client IO.
      const committed = await resolved.trustedWriter.executeWrite({
        type: 'mutate',
        idempotencyKey,
        mutation: {
          type: 'create',
          table: resource.table,
          row: sanitized as DatabaseOperationRow,
        },
      }, { logicalReceiptFingerprint });
      const effect = resourceMutationEffect(committed, resource, 'create');
      if (!effect?.row) return this.failures.committedReadback(resource, 'create');
      const verified = await this.policy.reauthorizeMutationReceipt(
        resource,
        'create',
        effect,
        rawInput,
        captured,
        context,
      );
      if ('failure' in verified) return verified.failure;
      if (!this.isCurrent(context, captured)) {
        return resourceAuthorityChangedFailure();
      }
      return resourceSuccess(201, {
        row: projectResourceRow(verified.row!, resource.fields),
      });
    } catch (error) {
      return this.failures.tenantDatabase(error, resource, 'create', 'write');
    } finally {
      resolved.release();
    }
  }

  /** Conditionally update one tenant row with an atomically coupled receipt. */
  async update(
    resource: RegisteredResourceDefinition,
    scope: ResourceTenantDatabaseScope,
    id: string,
    input: unknown,
    context: ResourceCrudRequestContext,
  ): Promise<ResourceCrudResult> {
    const captured = this.authority.capture(context);
    const rawInput = normalizeResourceInput(input);
    if (isResourceInputError(rawInput)) return resourceFailure(rawInput.status, rawInput.error);
    const fieldWrite = validateResourceClientWriteFields(
      rawInput,
      resource.fields,
      'update',
      resource.table,
    );
    if (fieldWrite) return resourceFailure(fieldWrite.status, fieldWrite.error, fieldWrite.code);
    const logicalInput = sanitizeResourceUpdateInput(
      rawInput,
      this.getColumns(resource),
      resource.table,
      resource.primaryKey,
    );
    if (isResourceInputError(logicalInput)) {
      return resourceFailure(logicalInput.status, logicalInput.error);
    }

    const idempotencyKey = resourceMutationIdempotencyKey(
      context.idempotencyKey,
      captured.receiptPrincipalFingerprint,
      scope.tenantId,
    );
    const logicalReceiptFingerprint = resourceLogicalReceiptFingerprint(
      resource,
      'update',
      id,
      logicalInput,
    );
    const resolved = await this.access.resolve(
      resource,
      scope,
      context,
      captured,
      'update',
      'write',
    );
    if ('failure' in resolved) return resolved.failure;

    try {
      const receipt = await resolved.trustedWriter.findReceipt(
        idempotencyKey,
        logicalReceiptFingerprint,
      );
      if (receipt.status === 'hit') {
        const effect = resourceMutationEffect(receipt.result, resource, 'update', id);
        if (!effect?.row || !effect.previousRow) {
          return this.failures.committedReadback(resource, 'update');
        }
        const verified = await this.policy.reauthorizeMutationReceipt(
          resource,
          'update',
          effect,
          rawInput,
          captured,
          context,
        );
        if ('failure' in verified) return verified.failure;
        if (!this.isCurrent(context, captured)) {
          return resourceAuthorityChangedFailure();
        }
        return resourceSuccess(200, {
          row: projectResourceRow(verified.row!, resource.fields),
        });
      }

      const initial = await resolved.client.get(resource.table, id, {
        consistency: { mode: 'strong' },
      });
      if (!this.isCurrent(context, captured)) {
        return resourceAuthorityChangedFailure();
      }
      const row = initial.value as Row | null;
      if (!row) return resourceFailure(404, 'Resource row not found', 'not-found');
      const decision = await this.policy.evaluateRow(
        resource,
        'update',
        row,
        captured,
        rawInput,
      );
      if (!decision.allowed) {
        return resourcePolicyFailure(decision.status, decision.message, decision.reason);
      }
      if (!await this.authority.isCurrent(context, captured)) {
        return resourceAuthorityChangedFailure();
      }

      const sanitized = sanitizeResourceUpdateInput(
        { ...rawInput, ...(decision.stampedInput ?? {}) },
        this.getColumns(resource),
        resource.table,
        resource.primaryKey,
      );
      if (isResourceInputError(sanitized)) return resourceFailure(sanitized.status, sanitized.error);

      const committed = await resolved.trustedWriter.executeWrite({
        type: 'batch',
        idempotencyKey,
        assertions: [{
          type: 'row-equals',
          table: resource.table,
          id,
          row: row as DatabaseOperationRow,
        }],
        mutations: [{
          type: 'update',
          table: resource.table,
          id,
          patch: sanitized as DatabaseOperationRow,
        }],
      }, { logicalReceiptFingerprint });
      const effect = resourceMutationEffect(committed, resource, 'update', id);
      if (!effect?.row || !effect.previousRow) {
        return this.failures.committedReadback(resource, 'update');
      }
      const verified = await this.policy.reauthorizeMutationReceipt(
        resource,
        'update',
        effect,
        rawInput,
        captured,
        context,
      );
      if ('failure' in verified) return verified.failure;
      if (!this.isCurrent(context, captured)) {
        return resourceAuthorityChangedFailure();
      }
      return resourceSuccess(200, {
        row: projectResourceRow(verified.row!, resource.fields),
      });
    } catch (error) {
      return this.failures.tenantDatabase(error, resource, 'update', 'write');
    } finally {
      resolved.release();
    }
  }

  /** Conditionally delete one tenant row with an atomically coupled receipt. */
  async delete(
    resource: RegisteredResourceDefinition,
    scope: ResourceTenantDatabaseScope,
    id: string,
    context: ResourceCrudRequestContext,
  ): Promise<ResourceCrudResult> {
    const captured = this.authority.capture(context);
    const idempotencyKey = resourceMutationIdempotencyKey(
      context.idempotencyKey,
      captured.receiptPrincipalFingerprint,
      scope.tenantId,
    );
    const logicalReceiptFingerprint = resourceLogicalReceiptFingerprint(
      resource,
      'delete',
      id,
      null,
    );
    const resolved = await this.access.resolve(
      resource,
      scope,
      context,
      captured,
      'delete',
      'write',
    );
    if ('failure' in resolved) return resolved.failure;

    try {
      const receipt = await resolved.trustedWriter.findReceipt(
        idempotencyKey,
        logicalReceiptFingerprint,
      );
      if (receipt.status === 'hit') {
        const effect = resourceMutationEffect(receipt.result, resource, 'delete', id);
        if (!effect?.previousRow || effect.row !== null) {
          return this.failures.committedReadback(resource, 'delete');
        }
        const verified = await this.policy.reauthorizeMutationReceipt(
          resource,
          'delete',
          effect,
          undefined,
          captured,
          context,
        );
        if ('failure' in verified) return verified.failure;
        if (!this.isCurrent(context, captured)) {
          return resourceAuthorityChangedFailure();
        }
        return resourceSuccess(200, { deleted: true, id });
      }

      const initial = await resolved.client.get(resource.table, id, {
        consistency: { mode: 'strong' },
      });
      if (!this.isCurrent(context, captured)) {
        return resourceAuthorityChangedFailure();
      }
      const row = initial.value as Row | null;
      if (!row) return resourceFailure(404, 'Resource row not found', 'not-found');
      const decision = await this.policy.evaluateRow(resource, 'delete', row, captured);
      if (!decision.allowed) {
        return resourcePolicyFailure(decision.status, decision.message, decision.reason);
      }
      if (!await this.authority.isCurrent(context, captured)) {
        return resourceAuthorityChangedFailure();
      }

      const committed = await resolved.trustedWriter.executeWrite({
        type: 'batch',
        idempotencyKey,
        assertions: [{
          type: 'row-equals',
          table: resource.table,
          id,
          row: row as DatabaseOperationRow,
        }],
        mutations: [{ type: 'delete', table: resource.table, id }],
      }, { logicalReceiptFingerprint });
      const effect = resourceMutationEffect(committed, resource, 'delete', id);
      if (!effect?.previousRow || effect.row !== null) {
        return this.failures.committedReadback(resource, 'delete');
      }
      const verified = await this.policy.reauthorizeMutationReceipt(
        resource,
        'delete',
        effect,
        undefined,
        captured,
        context,
      );
      if ('failure' in verified) return verified.failure;
      if (!this.isCurrent(context, captured)) {
        return resourceAuthorityChangedFailure();
      }
      return resourceSuccess(200, { deleted: true, id });
    } catch (error) {
      return this.failures.tenantDatabase(error, resource, 'delete', 'write');
    } finally {
      resolved.release();
    }
  }

  private getColumns(resource: RegisteredResourceDefinition): string[] {
    return getResourceTableColumns(this.options.tables[resource.table]);
  }

  /** Fence final physical-tenant results after their last awaited boundary. */
  private isCurrent(
    context: ResourceCrudRequestContext,
    captured: ResourcePolicyAuthoritySnapshot,
  ): boolean {
    return this.authority.isCurrentForTenantDatabase(context, captured);
  }
}
