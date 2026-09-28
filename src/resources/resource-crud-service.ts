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
import type { AuthorizationKernel } from '../auth/authorization-kernel';
import type { AuthorizationRoleAssignmentResolver } from '../auth/authorization-access';
import { OBS_CODES } from '../observability/codes';
import { errorPlatform } from '../observability/sink';
import type { ReactiveDB, Row, TableSchema } from '../sync';
import {
  createResourcePolicyAuthorization,
  createResourcePolicyUser,
} from './resource-auth';
import {
  isResourceInputError,
  sanitizeResourceCreateInput,
  sanitizeResourceUpdateInput,
} from './resource-input';
import {
  projectResourceRow,
  projectResourceRows,
  validateResourceClientWriteFields,
} from './resource-field-access';
import { evaluateResourcePolicy } from './resource-policy-evaluator';
import type { ResourceAction, ResourcePolicyAuthConfig } from './resource-policy-types';
import {
  buildResourceListQueryPlan,
  type ResourceListQueryInput,
} from './resource-query';
import type { RegisteredResourceDefinition, ResourceRegistry } from './resource-registry';
import { getResourceTableColumns } from './resource-schema';
import {
  rejectResourceRealmUpdate,
  resolveResourceRealm,
  resourceRealmConstraint,
  stampResourceCreateRealm,
  type ResourceTenantScope,
} from './resource-realm';

/** Request context accepted by resource CRUD service methods. */
export interface ResourceCrudRequestContext {
  authContext?: AuthContext | null;
  /**
   * Resolve the same bearer again after asynchronous policy work. Generated
   * HTTP routes provide this automatically so a revoked session, membership,
   * role, or trusted property cannot authorize one final read/write.
   */
  revalidateAuthContext?: () => Promise<AuthContext | null>;
  /**
   * Synchronously resolve the captured durable authority at the SQLite commit
   * boundary. Generated routes provide this for session-bound Zero tokens.
   */
  resolveAuthContextAtCommit?: () => AuthContext | null;
}

interface ResourcePolicyAuthoritySnapshot {
  readonly authContext: AuthContext | null;
  readonly user: ReturnType<typeof createResourcePolicyUser>;
  readonly authorization: ReturnType<typeof createResourcePolicyAuthorization>;
  readonly fingerprint: string;
}

/** Configuration for generated resource CRUD behavior. */
export interface ResourceCrudServiceOptions {
  db: ReactiveDB;
  registry: ResourceRegistry;
  tables: Record<string, TableSchema>;
  authConfig: ResourcePolicyAuthConfig;
  userStore?: UserStore | null;
  authorizationKernel?: AuthorizationKernel | null;
  roleAssignments?: AuthorizationRoleAssignmentResolver | null;
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
    const realm = resolveResourceRealm(resource, context.authContext);
    if (!realm.ok) return failure(realm.status, realm.message, realm.code);

    const authority = this.capturePolicyAuthority(context);
    const decision = await evaluateResourcePolicy(resource.policy.list!, {
      action: 'list',
      user: authority.user,
      authorization: authority.authorization,
      resource,
      authConfig: this.options.authConfig,
    });
    if (!decision.allowed) return policyFailure(decision.status, decision.message, decision.reason);
    if (!await this.isPolicyAuthorityCurrent(context, authority)) {
      return authorityChangedFailure();
    }

    const columns = this.getColumns(resource);
    const plan = buildResourceListQueryPlan({
      table: resource.table,
      columns,
      selectColumns: resource.fields?.read,
      filterColumns: resource.fields?.filter,
      sortColumns: resource.fields?.sort,
      constraints: [
        ...resourceRealmConstraint(realm.scope),
        ...(decision.constraints ?? []),
      ],
      query,
      defaultLimit: this.options.defaultLimit,
      maxLimit: this.options.maxLimit,
    });
    if ('error' in plan) return failure(plan.status, plan.error);

    const params = [...plan.params, plan.limit + 1, plan.offset];
    let rows: Row[] | null;
    try {
      rows = this.options.db.transaction(() => {
        if (!this.isPolicyAuthorityCurrentAtCommit(context, authority)) return null;
        return this.options.db.prepare(plan.sql).all(...(params as any[])) as Row[];
      });
    } catch (error) {
      return this.handleQueryError(error, resource, 'list');
    }
    if (!rows) return authorityChangedFailure();
    const hasMore = rows.length > plan.limit;
    const authorizedRows = hasMore ? rows.slice(0, plan.limit) : rows;
    const visibleRows = projectResourceRows(authorizedRows, resource.fields);

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
    const realm = resolveResourceRealm(resource, context.authContext);
    if (!realm.ok) return failure(realm.status, realm.message, realm.code);

    const row = this.getRow(resource, id, realm.scope);
    if (!row) return failure(404, 'Resource row not found', 'not-found');

    const authority = this.capturePolicyAuthority(context);
    const decision = await this.evaluateRowPolicy(resource, 'get', row, authority);
    if (!decision.allowed) return policyFailure(decision.status, decision.message, decision.reason);
    if (!await this.isPolicyAuthorityCurrent(context, authority)) {
      return authorityChangedFailure();
    }

    const committed = this.options.db.transaction(() => {
      if (!this.isPolicyAuthorityCurrentAtCommit(context, authority)) {
        return { state: 'authority' as const };
      }
      const current = this.getRow(resource, id, realm.scope);
      if (!current) return { state: 'missing' as const };
      if (!rowsMatchColumns(this.getColumns(resource), current, row)) {
        return { state: 'changed' as const };
      }
      return { state: 'ok' as const, row: current };
    });
    if (committed.state === 'authority') return authorityChangedFailure();
    if (committed.state === 'missing') {
      return failure(404, 'Resource row not found', 'not-found');
    }
    if (committed.state === 'changed') return resourceRowChangedFailure();
    return success(200, { row: projectResourceRow(committed.row, resource.fields) });
  }

  /** Create one row through ReactiveDB after create policy and input stamping. */
  async create(
    resourceName: string,
    input: unknown,
    context: ResourceCrudRequestContext = {}
  ): Promise<ResourceCrudResult> {
    const resource = this.getResourceForAction(resourceName, 'create');
    if ('ok' in resource) return resource;
    const realm = resolveResourceRealm(resource, context.authContext);
    if (!realm.ok) return failure(realm.status, realm.message, realm.code);

    const authority = this.capturePolicyAuthority(context);
    const rawInput = normalizeInputObject(input);
    if (isResourceInputError(rawInput)) return failure(rawInput.status, rawInput.error);
    const fieldWrite = validateResourceClientWriteFields(
      rawInput,
      resource.fields,
      'create',
      resource.table,
      [resource.primaryKey],
    );
    if (fieldWrite) return failure(fieldWrite.status, fieldWrite.error, fieldWrite.code);
    const realmInput = stampResourceCreateRealm(rawInput, realm.scope);
    if (!realmInput.ok) {
      return failure(realmInput.status, realmInput.message, realmInput.code);
    }

    const decision = await evaluateResourcePolicy(resource.policy.create!, {
      action: 'create',
      user: authority.user,
      authorization: authority.authorization,
      resource,
      input: realmInput.input,
      authConfig: this.options.authConfig,
    });
    if (!decision.allowed) return policyFailure(decision.status, decision.message, decision.reason);
    if (!await this.isPolicyAuthorityCurrent(context, authority)) {
      return authorityChangedFailure();
    }

    const mergedInput = { ...realmInput.input, ...(decision.stampedInput ?? {}) };
    const finalRealmInput = stampResourceCreateRealm(mergedInput, realm.scope);
    if (!finalRealmInput.ok) {
      return failure(finalRealmInput.status, finalRealmInput.message, finalRealmInput.code);
    }
    const sanitized = sanitizeResourceCreateInput(
      finalRealmInput.input,
      this.getColumns(resource),
      resource.table
    );
    if (isResourceInputError(sanitized)) return failure(sanitized.status, sanitized.error);

    try {
      let authorityCurrent = true;
      const change = this.options.db.transaction(() => {
        if (!this.isPolicyAuthorityCurrentAtCommit(context, authority)) {
          authorityCurrent = false;
          return null;
        }
        return realm.scope
          ? this.options.db.createScoped(resource.table, sanitized, toDBScope(realm.scope))
          : this.options.db.createStrict(resource.table, sanitized);
      });
      if (!authorityCurrent || !change) return authorityChangedFailure();
      return success(201, {
        row: projectResourceRow(change.row as Row, resource.fields),
      });
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
    const realm = resolveResourceRealm(resource, context.authContext);
    if (!realm.ok) return failure(realm.status, realm.message, realm.code);

    const row = this.getRow(resource, id, realm.scope);
    if (!row) return failure(404, 'Resource row not found', 'not-found');

    const rawInput = normalizeInputObject(input);
    if (isResourceInputError(rawInput)) return failure(rawInput.status, rawInput.error);
    const fieldWrite = validateResourceClientWriteFields(
      rawInput,
      resource.fields,
      'update',
      resource.table,
    );
    if (fieldWrite) return failure(fieldWrite.status, fieldWrite.error, fieldWrite.code);
    const realmUpdate = rejectResourceRealmUpdate(rawInput, realm.scope);
    if (!realmUpdate.ok) {
      return failure(realmUpdate.status, realmUpdate.message, realmUpdate.code);
    }

    const authority = this.capturePolicyAuthority(context);
    const decision = await this.evaluateRowPolicy(
      resource,
      'update',
      row,
      authority,
      rawInput,
    );
    if (!decision.allowed) return policyFailure(decision.status, decision.message, decision.reason);
    if (!await this.isPolicyAuthorityCurrent(context, authority)) {
      return authorityChangedFailure();
    }

    const mergedInput = { ...rawInput, ...(decision.stampedInput ?? {}) };
    const finalRealmUpdate = rejectResourceRealmUpdate(mergedInput, realm.scope);
    if (!finalRealmUpdate.ok) {
      return failure(
        finalRealmUpdate.status,
        finalRealmUpdate.message,
        finalRealmUpdate.code,
      );
    }
    const sanitized = sanitizeResourceUpdateInput(
      mergedInput,
      this.getColumns(resource),
      resource.table,
      resource.primaryKey
    );
    if (isResourceInputError(sanitized)) return failure(sanitized.status, sanitized.error);

    try {
      let authorityCurrent = true;
      const change = this.options.db.transaction(() => {
        if (!this.isPolicyAuthorityCurrentAtCommit(context, authority)) {
          authorityCurrent = false;
          return null;
        }
        return realm.scope
          ? this.options.db.updateScoped(
              resource.table,
              id,
              sanitized,
              toDBScope(realm.scope),
              row,
            )
          : this.options.db.updateIfCurrent(resource.table, id, sanitized, row);
      });
      if (!authorityCurrent) return authorityChangedFailure();
      if (!change) return failure(404, 'Resource row not found', 'not-found');
      return success(200, {
        row: projectResourceRow(change.row as Row, resource.fields),
      });
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
    const realm = resolveResourceRealm(resource, context.authContext);
    if (!realm.ok) return failure(realm.status, realm.message, realm.code);

    const row = this.getRow(resource, id, realm.scope);
    if (!row) return failure(404, 'Resource row not found', 'not-found');

    const authority = this.capturePolicyAuthority(context);
    const decision = await this.evaluateRowPolicy(resource, 'delete', row, authority);
    if (!decision.allowed) return policyFailure(decision.status, decision.message, decision.reason);
    if (!await this.isPolicyAuthorityCurrent(context, authority)) {
      return authorityChangedFailure();
    }

    try {
      let authorityCurrent = true;
      const change = this.options.db.transaction(() => {
        if (!this.isPolicyAuthorityCurrentAtCommit(context, authority)) {
          authorityCurrent = false;
          return null;
        }
        return realm.scope
          ? this.options.db.deleteScoped(
              resource.table,
              id,
              toDBScope(realm.scope),
              row,
            )
          : this.options.db.deleteIfCurrent(resource.table, id, row);
      });
      if (!authorityCurrent) return authorityChangedFailure();
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
    authority: ResourcePolicyAuthoritySnapshot,
    input?: Record<string, unknown>
  ) {
    return evaluateResourcePolicy(resource.policy[action]!, {
      action,
      user: authority.user,
      authorization: authority.authorization,
      resource,
      row,
      input,
      authConfig: this.options.authConfig,
    });
  }

  private capturePolicyAuthority(
    context: ResourceCrudRequestContext,
  ): ResourcePolicyAuthoritySnapshot {
    const authContext = context.authContext ?? null;
    return this.resolvePolicyAuthority(authContext);
  }

  private async isPolicyAuthorityCurrent(
    context: ResourceCrudRequestContext,
    captured: ResourcePolicyAuthoritySnapshot,
  ): Promise<boolean> {
    if (!context.revalidateAuthContext) return true;
    try {
      const authContext = await context.revalidateAuthContext();
      return this.resolvePolicyAuthority(authContext).fingerprint === captured.fingerprint;
    } catch {
      return false;
    }
  }

  private isPolicyAuthorityCurrentAtCommit(
    context: ResourceCrudRequestContext,
    captured: ResourcePolicyAuthoritySnapshot,
  ): boolean {
    if (!context.resolveAuthContextAtCommit) return true;
    try {
      const authContext = context.resolveAuthContextAtCommit();
      return this.resolvePolicyAuthority(authContext).fingerprint === captured.fingerprint;
    } catch {
      return false;
    }
  }

  private resolvePolicyAuthority(
    authContext: AuthContext | null,
  ): ResourcePolicyAuthoritySnapshot {
    const user = createResourcePolicyUser(authContext, this.options.userStore);
    const authorization = createResourcePolicyAuthorization(
      authContext,
      user,
      this.options.authorizationKernel,
      this.options.roleAssignments,
    );
    return {
      authContext,
      user,
      authorization,
      fingerprint: policyAuthorityFingerprint(authContext, user, authorization),
    };
  }

  private getResourceForAction(
    resourceName: string,
    action: ResourceAction
  ): RegisteredResourceDefinition | ResourceCrudFailure {
    const resource = this.options.registry.get(resourceName);
    if (!resource) return failure(404, `Unknown resource: ${resourceName}`, 'resource-not-found');
    if (!resource.exposure.http) {
      return failure(
        404,
        `Unknown resource: ${resourceName}`,
        'resource-http-not-exposed',
      );
    }
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

  private getRow(
    resource: RegisteredResourceDefinition,
    id: string,
    scope: ResourceTenantScope | null,
  ): Row | null {
    return scope
      ? this.options.db.getScoped(resource.table, id, toDBScope(scope))
      : this.options.db.get(resource.table, id);
  }

  private handleMutationError(
    error: unknown,
    resource: RegisteredResourceDefinition,
    action: ResourceAction
  ): ResourceCrudFailure {
    const message = error instanceof Error ? error.message : 'Resource mutation failed';
    if (message.includes('primary key already exists')) {
      return failure(409, 'Resource row already exists', 'resource-conflict');
    }
    if (message.includes('row changed since authorization')) {
      return resourceRowChangedFailure();
    }

    errorPlatform(OBS_CODES.RESOURCE_CRUD_FAILED, {
      error,
      metadata: {
        resource: resource.name,
        table: resource.table,
        action,
      },
    });

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

function authorityChangedFailure(): ResourceCrudFailure {
  return failure(
    403,
    'Resource authorization changed during the request',
    'resource-authority-changed',
  );
}

function resourceRowChangedFailure(): ResourceCrudFailure {
  return failure(
    409,
    'Resource row changed during authorization; retry the operation',
    'resource-row-changed',
  );
}

function policyAuthorityFingerprint(
  auth: AuthContext | null,
  user: ReturnType<typeof createResourcePolicyUser>,
  authorization: ReturnType<typeof createResourcePolicyAuthorization>,
): string {
  return JSON.stringify({
    auth: auth ? {
      userId: auth.userId,
      email: auth.email,
      role: auth.role,
      clientId: auth.clientId ?? null,
      sessionKind: auth.sessionKind ?? null,
      scope: auth.scope ? [...auth.scope].sort(compareText) : null,
      sessionId: auth.sessionId ?? null,
      sessionGeneration: auth.sessionGeneration ?? null,
      sessionScopeKind: auth.sessionScopeKind ?? null,
      sessionScopeId: auth.sessionScopeId ?? null,
      tenantId: auth.tenantId ?? null,
      membershipId: auth.membershipId ?? null,
      tenantRole: auth.tenantRole ?? null,
      tenantAuthorizationGeneration: auth.tenantAuthorizationGeneration ?? null,
      membershipAuthorizationGeneration:
        auth.membershipAuthorizationGeneration ?? null,
      authorizationAssignmentRevision:
        auth.authorizationAssignmentRevision ?? null,
    } : null,
    user: user ? {
      userId: user.userId,
      email: user.email ?? null,
      role: user.role,
      properties: Object.entries(user.properties).sort(([left], [right]) =>
        compareText(left, right)),
    } : null,
    authorization: authorization?.subject?.authorization ? {
      scopeKind: authorization.subject.authorization.scopeKind,
      scopeId: authorization.subject.authorization.scopeId,
      roles: authorization.subject.authorization.roles,
      permissions: authorization.subject.authorization.permissions,
      allPermissions: authorization.subject.authorization.allPermissions ?? false,
      revision: authorization.subject.authorization.revision,
    } : null,
  });
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isLikelyClientMutationError(message: string): boolean {
  return message.includes('missing primary key') ||
    message.includes('identity') ||
    message.includes('UNIQUE constraint') ||
    message.includes('NOT NULL constraint') ||
    message.includes('CHECK constraint') ||
    message.includes('FOREIGN KEY constraint');
}

function toDBScope(scope: ResourceTenantScope): { field: string; value: string } {
  return { field: scope.field, value: scope.tenantId };
}

function rowsMatchColumns(
  columns: readonly string[],
  current: Row,
  expected: Row,
): boolean {
  return columns.every((column) =>
    sqliteValuesEqual(current[column] ?? null, expected[column] ?? null));
}

function sqliteValuesEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (left instanceof Uint8Array && right instanceof Uint8Array) {
    if (left.byteLength !== right.byteLength) return false;
    for (let index = 0; index < left.byteLength; index += 1) {
      if (left[index] !== right[index]) return false;
    }
    return true;
  }
  return false;
}
