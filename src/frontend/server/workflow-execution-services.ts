/**
 * Managed `StepContext.zero` provider.
 *
 * Durable workflows run outside an HTTP request, but actor-owned steps should
 * see the same tenant/actor-safe service projection as request code. This
 * adapter reconstructs that projection only from a MAC-verified, live-
 * revalidated workflow authority. Raw app-global services and `zero.unsafe`
 * are deliberately unavailable.
 */

import type {
  RequestAuthorizationAccess,
  TenantAuthorizationScope,
} from '../../auth/authorization-access';
import type {
  AuthorizationKernel,
  AuthorizationScopeSnapshot,
  AuthorizationSubjectSnapshot,
} from '../../auth/authorization-kernel';
import type { ServiceDataScope } from '../../auth/service-data-scope';
import { AuthError, type PermissionKey } from '../../auth/types';
import type { AsyncDatabaseClient } from '../../databases/database-operations';
import type { NotificationService } from '../../notifications/notification-service';
import type { ServerObservabilityServices } from './server-services';
import type { PdfService } from '../../pdf/pdf-service';
import type { RoomService } from '../../rooms/room-service';
import type { StorageService } from '../../storage/storage-service';
import { WorkflowError } from '../../workflows/workflow-error';
import type {
  WorkflowExecutionServiceProvider,
  WorkflowResolvedExecutionAuthority,
} from '../../workflows/workflow-execution-authority';
import type { ZeroAppRuntime } from '../../runtime/zero-app-runtime';
import {
  createAuthorityScopedServerServices,
  type ScopedWorkflowService,
} from './server-request-services';
import {
  createLazyServerRouteServices,
  type ServerAuthServices,
  type ServerRouteServices,
} from './server-services';

/** Auth capabilities safe to expose inside a sealed workflow step. */
export type WorkflowExecutionAuthServices = Pick<
  ServerAuthServices,
  'authorization' | 'authorizationKernel' | 'getAuthorizationKernel'
>;

/** Observability emitters automatically attributed to the execution scope. */
export type WorkflowExecutionObservabilityServices = Pick<
  ServerObservabilityServices,
  'emitCode' | 'emitEvent' | 'error' | 'info' | 'warn'
>;

/**
 * Supported managed workflow facade. Capabilities without a scope-safe
 * projection are intentionally absent until Zero provides one.
 */
export interface WorkflowExecutionServerServices {
  readonly access: RequestAuthorizationAccess;
  readonly scope: ServiceDataScope;
  readonly data: AsyncDatabaseClient | null;
  readonly auth: WorkflowExecutionAuthServices;
  readonly storage: StorageService | null;
  readonly notifications: NotificationService | null;
  readonly rooms: RoomService | null;
  readonly workflows: ScopedWorkflowService | null;
  readonly pdf: PdfService | null;
  readonly observability: WorkflowExecutionObservabilityServices;
}

export interface CreateWorkflowExecutionServiceProviderOptions {
  /** App-local runtime used by managed createApp() composition. */
  runtime?: ZeroAppRuntime;
  /** Test/embedding override; defaults to the lazy app-local service context. */
  services?: ServerRouteServices;
}

/** Install the production scope-closed `ctx.zero` facade for workflow steps. */
export function createWorkflowExecutionServiceProvider(
  options: CreateWorkflowExecutionServiceProviderOptions,
): WorkflowExecutionServiceProvider<WorkflowExecutionServerServices> {
  const services = options.services
    ?? createLazyServerRouteServices(options.runtime);

  const provider: WorkflowExecutionServiceProvider<WorkflowExecutionServerServices> = {
    createServices(input) {
      const { authority, assertCurrentAuthority } = input;
      const kernel = requireKernel(services);
      const access = authority.identity.kind === 'actor'
        ? createActorExecutionAccess(authority, kernel)
        : createSystemExecutionAccess(kernel);
      const projected = createAuthorityScopedServerServices({
        access,
        services,
        scope: authority.scope,
        assertCurrentAuthority: async () => { assertCurrentAuthority(); },
        assertCurrentAuthoritySync: assertCurrentAuthority,
        strict: true,
        privilegedSystem: authority.identity.kind === 'system',
        userProperties: authority.userProperties,
      });
      return projected as unknown as WorkflowExecutionServerServices;
    },
  };
  return Object.freeze(provider);
}

function createActorExecutionAccess(
  authority: WorkflowResolvedExecutionAuthority,
  kernel: AuthorizationKernel,
): RequestAuthorizationAccess {
  if (authority.identity.kind !== 'actor' || !authority.authContext) {
    throw workflowAuthorityRequired('Actor execution is missing its live auth context');
  }
  const context = authority.authContext;
  const scope = actorScope(authority, kernel);
  const subject: AuthorizationSubjectSnapshot = Object.freeze({
    platformRole: authority.identity.platformRole,
    credentialKind: context.credentialKind ?? 'session',
    properties: Object.freeze({ ...authority.userProperties }),
    authorization: scope,
    applicationAuthorization: scope.scopeKind === 'application' ? scope : null,
  });

  const access: RequestAuthorizationAccess = {
    context,
    authorization: scope,
    applicationAuthorization: scope.scopeKind === 'application' ? scope : null,
    authorize(requirement) {
      return kernel.authorize(requirement, subject);
    },
    requireUser() {
      return context;
    },
    requirePlatformAdmin() {
      if (context.role !== 'admin') throw forbidden();
      return context;
    },
    requireAuthorizationScope() {
      return scope;
    },
    requireApplicationAuthorization() {
      if (scope.scopeKind !== 'application') throw forbidden();
      return scope as AuthorizationScopeSnapshot & { readonly scopeKind: 'application' };
    },
    requireTenant() {
      if (scope.scopeKind !== 'tenant' || !scope.tenantId || !scope.membershipId) {
        throw forbidden();
      }
      return scope as TenantAuthorizationScope;
    },
    hasPermission(permission) {
      return kernel.evaluate(actorPermissionRequirement(context, permission), subject).allowed;
    },
    requirePermission(permission) {
      return kernel.authorize(actorPermissionRequirement(context, permission), subject)!;
    },
    requireAnyPermission(permissions) {
      return kernel.authorize(actorPermissionRequirement(
        context,
        undefined,
        permissions,
      ), subject)!;
    },
  };
  return Object.freeze(access);
}

function actorPermissionRequirement(
  context: NonNullable<WorkflowResolvedExecutionAuthority['authContext']>,
  permission?: PermissionKey,
  anyPermissions?: readonly PermissionKey[],
) {
  return {
    ...(context.credentialKind === 'api-key'
      ? { credentials: ['api-key'] as const }
      : {}),
    ...(permission ? { permission } : {}),
    ...(anyPermissions ? { anyPermissions } : {}),
  };
}

function actorScope(
  authority: WorkflowResolvedExecutionAuthority,
  kernel: AuthorizationKernel,
): AuthorizationScopeSnapshot {
  if (authority.identity.kind !== 'actor') {
    throw workflowAuthorityRequired('Actor scope was requested for a system execution');
  }
  const identity = authority.identity;
  const scope: AuthorizationScopeSnapshot = Object.freeze({
    tenancy: kernel.tenancy.mode,
    mode: kernel.authorization.mode,
    scopeKind: identity.scopeKind,
    scopeId: identity.scopeId,
    roles: Object.freeze([...identity.roles]),
    permissions: Object.freeze([...identity.permissions]) as readonly PermissionKey[],
    ...(identity.allPermissions ? { allPermissions: true } : {}),
    revision: identity.authorizationRevision,
    ...(identity.scopeKind === 'tenant' ? {
      tenantId: identity.tenantId!,
      membershipId: identity.membershipId!,
    } : {}),
  });
  if (!kernel.isValidScopeSnapshot(scope)
    || scope.scopeKind !== authority.scope.scopeKind
    || scope.scopeId !== authority.scope.scopeId
    || (scope.tenantId ?? null) !== authority.scope.tenantId) {
    throw workflowAuthorityRequired('Sealed actor scope is incompatible with the app runtime');
  }
  return scope;
}

/**
 * System execution is explicitly privileged by runAsSystem(), but it is not
 * represented as a user. Service facades use the sealed scope and the
 * privilegedSystem flag; user-specific access helpers continue to fail.
 */
function createSystemExecutionAccess(
  kernel: AuthorizationKernel,
): RequestAuthorizationAccess {
  const access: RequestAuthorizationAccess = {
    context: null,
    authorization: null,
    applicationAuthorization: null,
    authorize(requirement) {
      return kernel.authorize(requirement, null);
    },
    requireUser() { throw unauthorizedSystem(); },
    requirePlatformAdmin() { throw unauthorizedSystem(); },
    requireAuthorizationScope() { throw unauthorizedSystem(); },
    requireApplicationAuthorization() { throw unauthorizedSystem(); },
    requireTenant() { throw unauthorizedSystem(); },
    hasPermission() { return false; },
    requirePermission() { throw unauthorizedSystem(); },
    requireAnyPermission() { throw unauthorizedSystem(); },
  };
  return Object.freeze(access);
}

function requireKernel(services: ServerRouteServices): AuthorizationKernel {
  const kernel = services.auth.authorizationKernel;
  if (!kernel) {
    throw new WorkflowError(
      'Workflow authorization services are unavailable',
      'WORKFLOW_CONFIG_INVALID',
      500,
    );
  }
  return kernel;
}

function workflowAuthorityRequired(message: string): WorkflowError {
  return new WorkflowError(message, 'WORKFLOW_AUTHORITY_REQUIRED', 500);
}

function forbidden(): AuthError {
  return new AuthError('Forbidden', 'FORBIDDEN', 403);
}

function unauthorizedSystem(): AuthError {
  return new AuthError(
    'System workflow execution is not an authenticated user',
    'UNAUTHORIZED',
    401,
  );
}
