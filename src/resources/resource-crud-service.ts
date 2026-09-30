/**
 * resource-crud-service.ts
 *
 * Dispatches generated Resource CRUD after registry, exposure, action, and
 * realm resolution. Storage-plane mutation, receipt, policy-fencing, failure,
 * and observability behavior live in focused collaborators; this facade does
 * not directly execute SQL or acquire tenant database actors.
 */

import type {
  ResourceCrudFailure,
  ResourceCrudRequestContext,
  ResourceCrudResult,
  ResourceCrudServiceOptions,
  ResourceIdentityAnchorReadinessBarrier,
} from './resource-crud-contracts';
import type {
  PlatformCodeDefinition,
  PlatformCodeEmitOptions,
  PlatformEvent,
  PlatformObservabilityRuntime,
} from '../observability/types';
import { ResourceCrudFailureMapper } from './resource-crud-failures';
import { ResourceCrudPolicyService } from './resource-crud-policy';
import { ResourceDefaultCrudEngine } from './resource-default-crud-engine';
import { canonicalizeResourceReceiptPayload } from './resource-mutation-receipt';
import { ResourcePolicyAuthorityService } from './resource-policy-authority';
import type { ResourceAction } from './resource-policy-types';
import type { ResourceListQueryInput } from './resource-query';
import type { RegisteredResourceDefinition } from './resource-registry';
import {
  isResourceTenantDatabaseScope,
  resolveResourceRealm,
  type ResourceTenantScope,
} from './resource-realm';
import { ResourceTenantCrudEngine } from './resource-tenant-crud-engine';
import { ResourceTenantDatabaseAccessResolver } from './resource-tenant-database-access';
import { resourceFailure } from './resource-crud-results';

export { canonicalizeResourceReceiptPayload };
export type {
  ResourceCrudFailure,
  ResourceCrudRequestContext,
  ResourceCrudResult,
  ResourceCrudServiceOptions,
  ResourceIdentityAnchorReadinessBarrier,
  ResourceCrudSuccess,
  ResourceTenantDatabaseAccess,
  ResourceTenantDatabaseClientProvider,
} from './resource-crud-contracts';

/** Service facade used by generated HTTP routes for registered Resources. */
export class ResourceCrudService {
  private readonly defaultEngine: ResourceDefaultCrudEngine;
  private readonly tenantEngine: ResourceTenantCrudEngine;

  constructor(private readonly options: ResourceCrudServiceOptions) {
    const failures = new ResourceCrudFailureMapper(
      resolveResourceObservability(options),
    );
    const authority = new ResourcePolicyAuthorityService({
      userStore: options.userStore,
      authorizationKernel: options.authorizationKernel,
      roleAssignments: options.roleAssignments,
    });
    const policy = new ResourceCrudPolicyService(
      options.authConfig,
      authority,
      failures,
    );
    const tenantAccess = new ResourceTenantDatabaseAccessResolver(
      options.getTenantDatabaseClient,
      authority,
      failures,
    );
    const planeOptions = {
      tables: options.tables,
      authConfig: options.authConfig,
      ensureIdentityAnchors: options.ensureIdentityAnchors,
      defaultLimit: options.defaultLimit,
      maxLimit: options.maxLimit,
    };
    this.defaultEngine = new ResourceDefaultCrudEngine(
      { ...planeOptions, db: options.db },
      authority,
      policy,
      failures,
    );
    this.tenantEngine = new ResourceTenantCrudEngine(
      planeOptions,
      authority,
      policy,
      tenantAccess,
      failures,
    );
  }

  /** List rows after resolving registry exposure and the authoritative plane. */
  async list(
    resourceName: string,
    query: ResourceListQueryInput,
    context: ResourceCrudRequestContext = {},
  ): Promise<ResourceCrudResult> {
    const resolved = this.resolve(resourceName, 'list', context);
    if ('failure' in resolved) return resolved.failure;
    return isResourceTenantDatabaseScope(resolved.scope)
      ? await this.tenantEngine.list(resolved.resource, resolved.scope, query, context)
      : await this.defaultEngine.list(resolved.resource, resolved.scope, query, context);
  }

  /** Get one row after resolving registry exposure and the authoritative plane. */
  async get(
    resourceName: string,
    id: string,
    context: ResourceCrudRequestContext = {},
  ): Promise<ResourceCrudResult> {
    const resolved = this.resolve(resourceName, 'get', context);
    if ('failure' in resolved) return resolved.failure;
    return isResourceTenantDatabaseScope(resolved.scope)
      ? await this.tenantEngine.get(resolved.resource, resolved.scope, id, context)
      : await this.defaultEngine.get(resolved.resource, resolved.scope, id, context);
  }

  /** Create one row through the plane selected only by verified realm state. */
  async create(
    resourceName: string,
    input: unknown,
    context: ResourceCrudRequestContext = {},
  ): Promise<ResourceCrudResult> {
    const resolved = this.resolve(resourceName, 'create', context);
    if ('failure' in resolved) return resolved.failure;
    return isResourceTenantDatabaseScope(resolved.scope)
      ? await this.tenantEngine.create(resolved.resource, resolved.scope, input, context)
      : await this.defaultEngine.create(resolved.resource, resolved.scope, input, context);
  }

  /** Update one row through the plane selected only by verified realm state. */
  async update(
    resourceName: string,
    id: string,
    input: unknown,
    context: ResourceCrudRequestContext = {},
  ): Promise<ResourceCrudResult> {
    const resolved = this.resolve(resourceName, 'update', context);
    if ('failure' in resolved) return resolved.failure;
    return isResourceTenantDatabaseScope(resolved.scope)
      ? await this.tenantEngine.update(resolved.resource, resolved.scope, id, input, context)
      : await this.defaultEngine.update(resolved.resource, resolved.scope, id, input, context);
  }

  /** Delete one row through the plane selected only by verified realm state. */
  async delete(
    resourceName: string,
    id: string,
    context: ResourceCrudRequestContext = {},
  ): Promise<ResourceCrudResult> {
    const resolved = this.resolve(resourceName, 'delete', context);
    if ('failure' in resolved) return resolved.failure;
    return isResourceTenantDatabaseScope(resolved.scope)
      ? await this.tenantEngine.delete(resolved.resource, resolved.scope, id, context)
      : await this.defaultEngine.delete(resolved.resource, resolved.scope, id, context);
  }

  private resolve(
    resourceName: string,
    action: ResourceAction,
    context: ResourceCrudRequestContext,
  ):
    | { readonly failure: ResourceCrudFailure }
    | {
        readonly resource: RegisteredResourceDefinition;
        readonly scope: ResourceTenantScope | null;
      } {
    const resource = this.getResourceForAction(resourceName, action);
    if ('ok' in resource) return { failure: resource } as const;
    const realm = resolveResourceRealm(resource, context.authContext);
    if (!realm.ok) {
      return {
        failure: resourceFailure(realm.status, realm.message, realm.code),
      } as const;
    }
    return { resource, scope: realm.scope } as const;
  }

  private getResourceForAction(
    resourceName: string,
    action: ResourceAction,
  ): RegisteredResourceDefinition | ReturnType<typeof resourceFailure> {
    const resource = this.options.registry.get(resourceName);
    if (!resource) {
      return resourceFailure(404, `Unknown resource: ${resourceName}`, 'resource-not-found');
    }
    if (!resource.exposure.http) {
      return resourceFailure(
        404,
        `Unknown resource: ${resourceName}`,
        'resource-http-not-exposed',
      );
    }
    if (!resource.actions.includes(action)) {
      return resourceFailure(
        405,
        `Resource '${resource.name}' does not support ${action}`,
        'action-not-allowed',
      );
    }
    if (!resource.policy[action]) {
      return resourceFailure(
        500,
        `Resource '${resource.name}' is missing ${action} policy`,
        'policy-missing',
      );
    }
    return resource;
  }
}

function resolveResourceObservability(
  options: ResourceCrudServiceOptions,
): PlatformObservabilityRuntime | null | undefined {
  if (options.observability) return options.observability;
  if (!options.emitCode) return options.observability;

  const emitCode = options.emitCode;
  return {
    sink: {
      emit(event) {
        emitCode(platformDefinitionFromEvent(event), platformOptionsFromEvent(event));
      },
    },
    store: null,
    config: {
      enabled: true,
      console: false,
      store: false,
      endpoint: false,
    },
  };
}

function platformDefinitionFromEvent(event: PlatformEvent): PlatformCodeDefinition {
  return {
    code: event.code,
    prefix: event.prefix,
    category: event.category,
    level: event.level,
    message: event.message,
  };
}

function platformOptionsFromEvent(event: PlatformEvent): PlatformCodeEmitOptions {
  return {
    source: event.source,
    level: event.level,
    category: event.category,
    message: event.message,
    ...(event.metadata ? { metadata: event.metadata } : {}),
    ...(event.error === undefined ? {} : { error: event.error }),
    ...(event.requestId ? { requestId: event.requestId } : {}),
    ...(event.userId ? { userId: event.userId } : {}),
    ...(event.traceId ? { traceId: event.traceId } : {}),
  };
}
