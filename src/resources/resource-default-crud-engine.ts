/**
 * resource-default-crud-engine.ts
 *
 * Implements generated CRUD for the default SQLite plane, including global
 * and shared-row tenant Resources. It owns synchronous ReactiveDB operations
 * and keeps each mutation atomically coupled to its durable receipt; it does
 * not resolve resource names, HTTP exposure, or physical tenant databases.
 */

import type { ReactiveDB, Row, TableSchema } from '../sync';
import type {
  ResourceCrudRequestContext,
  ResourceCrudResult,
} from './resource-crud-contracts';
import type { ResourceCrudFailureMapper } from './resource-crud-failures';
import type { ResourceCrudPolicyService } from './resource-crud-policy';
import {
  ResourceMutationReceiptError,
  getResourceDefaultReceiptStore,
} from './resource-default-receipt-store';
import { isResourceInputError, sanitizeResourceCreateInput, sanitizeResourceUpdateInput } from './resource-input';
import {
  defaultResourceMutationEffect,
  createDefaultResourceReceiptIdentity,
  mutationReceiptResourceId,
} from './resource-mutation-receipt';
import {
  type ResourcePolicyAuthorityService,
} from './resource-policy-authority';
import { evaluateResourcePolicy } from './resource-policy-evaluator';
import type { ResourcePolicyAuthConfig } from './resource-policy-types';
import {
  buildResourceListQueryPlan,
  type ResourceListQueryInput,
} from './resource-query';
import type { RegisteredResourceDefinition } from './resource-registry';
import {
  isResourceTenantRowScope,
  rejectResourceRealmUpdate,
  resourceRealmConstraint,
  stampResourceCreateRealm,
  type ResourceTenantScope,
} from './resource-realm';
import { getResourceTableColumns } from './resource-schema';
import {
  projectResourceRow,
  projectResourceRows,
  validateResourceClientWriteFields,
} from './resource-field-access';
import { normalizeResourceInput, resourceRowsMatch } from './resource-crud-rows';
import {
  resourceAuthorityChangedFailure,
  resourceFailure,
  resourcePolicyFailure,
  resourceRowChangedFailure,
  resourceSuccess,
} from './resource-crud-results';

/** Dependencies used only by the default/shared-row storage plane. */
export interface ResourceDefaultCrudEngineOptions {
  readonly db: ReactiveDB;
  readonly tables: Record<string, TableSchema>;
  readonly authConfig: ResourcePolicyAuthConfig;
  readonly defaultLimit?: number;
  readonly maxLimit?: number;
}

/** Default-plane generated CRUD with atomic mutation receipt ownership. */
export class ResourceDefaultCrudEngine {
  private readonly receiptStore;

  constructor(
    private readonly options: ResourceDefaultCrudEngineOptions,
    private readonly authority: ResourcePolicyAuthorityService,
    private readonly policy: ResourceCrudPolicyService,
    private readonly failures: ResourceCrudFailureMapper,
  ) {
    this.receiptStore = getResourceDefaultReceiptStore(options.db);
  }

  /** List authorized global/shared-row rows through a fenced transaction. */
  async list(
    resource: RegisteredResourceDefinition,
    scope: ResourceTenantScope | null,
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

    const plan = buildResourceListQueryPlan({
      table: resource.table,
      columns: this.getColumns(resource),
      selectColumns: resource.fields?.read,
      filterColumns: resource.fields?.filter,
      sortColumns: resource.fields?.sort,
      constraints: [
        ...resourceRealmConstraint(scope),
        ...(decision.constraints ?? []),
      ],
      query,
      defaultLimit: this.options.defaultLimit,
      maxLimit: this.options.maxLimit,
    });
    if ('error' in plan) return resourceFailure(plan.status, plan.error);

    const params = [...plan.params, plan.limit + 1, plan.offset];
    let rows: Row[] | null;
    try {
      rows = this.options.db.transaction(() => {
        if (!this.authority.isCurrentAtCommit(context, captured)) return null;
        const statement = this.options.db.prepare(plan.sql);
        try {
          return statement.all(...(params as any[])) as Row[];
        } finally {
          statement.finalize();
        }
      });
    } catch {
      return this.failures.query(resource, 'list');
    }
    if (!rows) return resourceAuthorityChangedFailure();
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
  }

  /** Read and recheck one authorized global/shared-row row. */
  async get(
    resource: RegisteredResourceDefinition,
    scope: ResourceTenantScope | null,
    id: string,
    context: ResourceCrudRequestContext,
  ): Promise<ResourceCrudResult> {
    const row = this.getRow(resource, id, scope);
    if (!row) return resourceFailure(404, 'Resource row not found', 'not-found');

    const captured = this.authority.capture(context);
    const decision = await this.policy.evaluateRow(resource, 'get', row, captured);
    if (!decision.allowed) {
      return resourcePolicyFailure(decision.status, decision.message, decision.reason);
    }
    if (!await this.authority.isCurrent(context, captured)) {
      return resourceAuthorityChangedFailure();
    }

    const committed = this.options.db.transaction(() => {
      if (!this.authority.isCurrentAtCommit(context, captured)) {
        return { state: 'authority' as const };
      }
      const current = this.getRow(resource, id, scope);
      if (!current) return { state: 'missing' as const };
      if (!resourceRowsMatch(this.getColumns(resource), current, row)) {
        return { state: 'changed' as const };
      }
      return { state: 'ok' as const, row: current };
    });
    if (committed.state === 'authority') return resourceAuthorityChangedFailure();
    if (committed.state === 'missing') {
      return resourceFailure(404, 'Resource row not found', 'not-found');
    }
    if (committed.state === 'changed') return resourceRowChangedFailure();
    return resourceSuccess(200, { row: projectResourceRow(committed.row, resource.fields) });
  }

  /** Create one default-plane row and receipt in the same transaction. */
  async create(
    resource: RegisteredResourceDefinition,
    scope: ResourceTenantScope | null,
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
    const realmInput = stampResourceCreateRealm(rawInput, scope);
    if (!realmInput.ok) {
      return resourceFailure(realmInput.status, realmInput.message, realmInput.code);
    }

    const receiptIdentity = createDefaultResourceReceiptIdentity({
      resource,
      action: 'create',
      id: mutationReceiptResourceId(resource, rawInput),
      mutationInput: rawInput,
      requestKey: context.idempotencyKey,
      principalFingerprint: captured.receiptPrincipalFingerprint,
      scope,
    });
    try {
      const receipt = this.receiptStore.find(receiptIdentity);
      if (receipt.status === 'hit') {
        const verified = await this.policy.reauthorizeMutationReceipt(
          resource,
          'create',
          receipt.effect,
          realmInput.input,
          captured,
          context,
        );
        if ('failure' in verified) return verified.failure;
        return resourceSuccess(201, {
          row: projectResourceRow(verified.row!, resource.fields),
        });
      }
    } catch (error) {
      return this.failures.defaultReceipt(error, resource, 'create');
    }

    const decision = await evaluateResourcePolicy(resource.policy.create!, {
      action: 'create',
      user: captured.user,
      authorization: captured.authorization,
      resource,
      input: realmInput.input,
      authConfig: this.options.authConfig,
    });
    if (!decision.allowed) {
      return resourcePolicyFailure(decision.status, decision.message, decision.reason);
    }
    if (!await this.authority.isCurrent(context, captured)) {
      return resourceAuthorityChangedFailure();
    }

    const mergedInput = { ...realmInput.input, ...(decision.stampedInput ?? {}) };
    const finalRealmInput = stampResourceCreateRealm(mergedInput, scope);
    if (!finalRealmInput.ok) {
      return resourceFailure(
        finalRealmInput.status,
        finalRealmInput.message,
        finalRealmInput.code,
      );
    }
    const sanitized = sanitizeResourceCreateInput(
      finalRealmInput.input,
      this.getColumns(resource),
      resource.table,
    );
    if (isResourceInputError(sanitized)) return resourceFailure(sanitized.status, sanitized.error);

    try {
      // ResourceDefaultReceiptStore wraps this callback and its receipt insert
      // in one ReactiveDB transaction. Do not split this boundary.
      const execution = this.receiptStore.execute(receiptIdentity, () => {
        if (!this.authority.isCurrentAtCommit(context, captured)) {
          throw new DefaultResourceAuthorityChangedError();
        }
        const change = isResourceTenantRowScope(scope)
          ? this.options.db.createScoped(resource.table, sanitized, toDBScope(scope))
          : this.options.db.createStrict(resource.table, sanitized);
        return defaultResourceMutationEffect(change, 'create');
      });
      this.failures.defaultReceiptCompaction(execution.compaction, resource, 'create');
      if (execution.replayed) {
        const verified = await this.policy.reauthorizeMutationReceipt(
          resource,
          'create',
          execution.effect,
          realmInput.input,
          captured,
          context,
        );
        if ('failure' in verified) return verified.failure;
        return resourceSuccess(201, {
          row: projectResourceRow(verified.row!, resource.fields),
        });
      }
      return resourceSuccess(201, {
        row: projectResourceRow(execution.effect.row!, resource.fields),
      });
    } catch (error) {
      if (error instanceof DefaultResourceAuthorityChangedError) {
        return resourceAuthorityChangedFailure();
      }
      if (error instanceof ResourceMutationReceiptError) {
        return this.failures.defaultReceipt(error, resource, 'create');
      }
      return this.failures.mutation(error, resource, 'create');
    }
  }

  /** Update one default-plane row and receipt through the same CAS transaction. */
  async update(
    resource: RegisteredResourceDefinition,
    scope: ResourceTenantScope | null,
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
    const realmUpdate = rejectResourceRealmUpdate(rawInput, scope);
    if (!realmUpdate.ok) {
      return resourceFailure(realmUpdate.status, realmUpdate.message, realmUpdate.code);
    }
    const logicalInput = sanitizeResourceUpdateInput(
      rawInput,
      this.getColumns(resource),
      resource.table,
      resource.primaryKey,
    );
    if (isResourceInputError(logicalInput)) {
      return resourceFailure(logicalInput.status, logicalInput.error);
    }

    const receiptIdentity = createDefaultResourceReceiptIdentity({
      resource,
      action: 'update',
      id,
      mutationInput: logicalInput,
      requestKey: context.idempotencyKey,
      principalFingerprint: captured.receiptPrincipalFingerprint,
      scope,
    });
    try {
      const receipt = this.receiptStore.find(receiptIdentity);
      if (receipt.status === 'hit') {
        const verified = await this.policy.reauthorizeMutationReceipt(
          resource,
          'update',
          receipt.effect,
          rawInput,
          captured,
          context,
        );
        if ('failure' in verified) return verified.failure;
        return resourceSuccess(200, {
          row: projectResourceRow(verified.row!, resource.fields),
        });
      }
    } catch (error) {
      return this.failures.defaultReceipt(error, resource, 'update');
    }

    const row = this.getRow(resource, id, scope);
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

    const mergedInput = { ...rawInput, ...(decision.stampedInput ?? {}) };
    const finalRealmUpdate = rejectResourceRealmUpdate(mergedInput, scope);
    if (!finalRealmUpdate.ok) {
      return resourceFailure(
        finalRealmUpdate.status,
        finalRealmUpdate.message,
        finalRealmUpdate.code,
      );
    }
    const sanitized = sanitizeResourceUpdateInput(
      mergedInput,
      this.getColumns(resource),
      resource.table,
      resource.primaryKey,
    );
    if (isResourceInputError(sanitized)) return resourceFailure(sanitized.status, sanitized.error);

    try {
      // The conditional mutation and receipt remain one transaction owned by
      // the receipt store, including the authority commit fence.
      const execution = this.receiptStore.execute(receiptIdentity, () => {
        if (!this.authority.isCurrentAtCommit(context, captured)) {
          throw new DefaultResourceAuthorityChangedError();
        }
        const change = isResourceTenantRowScope(scope)
          ? this.options.db.updateScoped(resource.table, id, sanitized, toDBScope(scope), row)
          : this.options.db.updateIfCurrent(resource.table, id, sanitized, row);
        if (!change) throw new DefaultResourceRowMissingError();
        return defaultResourceMutationEffect(change, 'update');
      });
      this.failures.defaultReceiptCompaction(execution.compaction, resource, 'update');
      if (execution.replayed) {
        const verified = await this.policy.reauthorizeMutationReceipt(
          resource,
          'update',
          execution.effect,
          rawInput,
          captured,
          context,
        );
        if ('failure' in verified) return verified.failure;
        return resourceSuccess(200, {
          row: projectResourceRow(verified.row!, resource.fields),
        });
      }
      return resourceSuccess(200, {
        row: projectResourceRow(execution.effect.row!, resource.fields),
      });
    } catch (error) {
      if (error instanceof DefaultResourceAuthorityChangedError) {
        return resourceAuthorityChangedFailure();
      }
      if (error instanceof DefaultResourceRowMissingError) {
        return resourceFailure(404, 'Resource row not found', 'not-found');
      }
      if (error instanceof ResourceMutationReceiptError) {
        return this.failures.defaultReceipt(error, resource, 'update');
      }
      return this.failures.mutation(error, resource, 'update');
    }
  }

  /** Delete one default-plane row and commit its replay receipt atomically. */
  async delete(
    resource: RegisteredResourceDefinition,
    scope: ResourceTenantScope | null,
    id: string,
    context: ResourceCrudRequestContext,
  ): Promise<ResourceCrudResult> {
    const captured = this.authority.capture(context);
    const receiptIdentity = createDefaultResourceReceiptIdentity({
      resource,
      action: 'delete',
      id,
      mutationInput: null,
      requestKey: context.idempotencyKey,
      principalFingerprint: captured.receiptPrincipalFingerprint,
      scope,
    });
    try {
      const receipt = this.receiptStore.find(receiptIdentity);
      if (receipt.status === 'hit') {
        const verified = await this.policy.reauthorizeMutationReceipt(
          resource,
          'delete',
          receipt.effect,
          undefined,
          captured,
          context,
        );
        if ('failure' in verified) return verified.failure;
        return resourceSuccess(200, { deleted: true, id });
      }
    } catch (error) {
      return this.failures.defaultReceipt(error, resource, 'delete');
    }

    const row = this.getRow(resource, id, scope);
    if (!row) return resourceFailure(404, 'Resource row not found', 'not-found');
    const decision = await this.policy.evaluateRow(resource, 'delete', row, captured);
    if (!decision.allowed) {
      return resourcePolicyFailure(decision.status, decision.message, decision.reason);
    }
    if (!await this.authority.isCurrent(context, captured)) {
      return resourceAuthorityChangedFailure();
    }

    try {
      const execution = this.receiptStore.execute(receiptIdentity, () => {
        if (!this.authority.isCurrentAtCommit(context, captured)) {
          throw new DefaultResourceAuthorityChangedError();
        }
        const change = isResourceTenantRowScope(scope)
          ? this.options.db.deleteScoped(resource.table, id, toDBScope(scope), row)
          : this.options.db.deleteIfCurrent(resource.table, id, row);
        if (!change) throw new DefaultResourceRowMissingError();
        return defaultResourceMutationEffect(change, 'delete');
      });
      this.failures.defaultReceiptCompaction(execution.compaction, resource, 'delete');
      if (execution.replayed) {
        const verified = await this.policy.reauthorizeMutationReceipt(
          resource,
          'delete',
          execution.effect,
          undefined,
          captured,
          context,
        );
        if ('failure' in verified) return verified.failure;
      }
      return resourceSuccess(200, { deleted: true, id });
    } catch (error) {
      if (error instanceof DefaultResourceAuthorityChangedError) {
        return resourceAuthorityChangedFailure();
      }
      if (error instanceof DefaultResourceRowMissingError) {
        return resourceFailure(404, 'Resource row not found', 'not-found');
      }
      if (error instanceof ResourceMutationReceiptError) {
        return this.failures.defaultReceipt(error, resource, 'delete');
      }
      return this.failures.mutation(error, resource, 'delete');
    }
  }

  private getColumns(resource: RegisteredResourceDefinition): string[] {
    return getResourceTableColumns(this.options.tables[resource.table]);
  }

  private getRow(
    resource: RegisteredResourceDefinition,
    id: string,
    scope: ResourceTenantScope | null,
  ): Row | null {
    return isResourceTenantRowScope(scope)
      ? this.options.db.getScoped(resource.table, id, toDBScope(scope))
      : this.options.db.get(resource.table, id);
  }
}

class DefaultResourceAuthorityChangedError extends Error {
  constructor() {
    super('Resource authority changed at the default database commit boundary');
    this.name = 'DefaultResourceAuthorityChangedError';
  }
}

class DefaultResourceRowMissingError extends Error {
  constructor() {
    super('Resource row was missing at the default database commit boundary');
    this.name = 'DefaultResourceRowMissingError';
  }
}

function toDBScope(
  scope: Extract<ResourceTenantScope, { isolation: 'shared-row' }>,
): { field: string; value: string } {
  return { field: scope.field, value: scope.tenantId };
}
