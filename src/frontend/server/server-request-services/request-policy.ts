import type { RequestAuthorizationAccess } from '../../../auth/authorization-access';
import type { ServiceDataScope } from '../../../auth/service-data-scope';
import type {
  ServerAuthServices,
  ServerObservabilityServices,
  ServerRouteServices,
} from '../server-services';

export const REQUEST_SERVICES = Symbol('zero.request-server-services');

export const MULTI_TENANT_UNSCOPED_SERVICES = new Set<PropertyKey>([
  'db',
  'syncDB',
  'databases',
  'sql',
  'sqlite',
  'system',
  'tokens',
  'kv',
  'counter',
  'limiter',
  'vector',
  'vectors',
  'emailRuntime',
  'scheduler',
  'workflowRegistry',
]);

/**
 * Background handlers never receive the privileged setup escape hatch. Keep
 * capabilities which do not yet have a tenant/actor-safe facade unavailable
 * instead of silently exposing their raw app-global service.
 */
export const WORKFLOW_UNSCOPED_SERVICES = new Set<PropertyKey>([
  ...MULTI_TENANT_UNSCOPED_SERVICES,
  'unsafe',
  'ai',
  'email',
  'resources',
]);

const MULTI_TENANT_UNSAFE_AUTH_SERVICES = new Set<PropertyKey>([
  'roles',
  'roleService',
  'store',
  'userStore',
  'tokens',
  'tokenService',
  'requestCredentialResolver',
  'getStore',
  'getUserStore',
  'getTokenService',
  'getRequestCredentialResolver',
  'getRoleService',
]);

const MULTI_TENANT_UNSAFE_OBSERVABILITY_SERVICES = new Set<PropertyKey>([
  'runtime',
  'sink',
  'store',
  'getRuntime',
  'getSink',
  'getStore',
]);

/** Raised when multi-tenant request code reaches for an unscoped raw service. */
export class UnsafeServerServiceAccessError extends Error {
  readonly code = 'ZERO_UNSAFE_SERVICE_REQUIRED';

  constructor(readonly servicePath: string) {
    super(
      `[server-services] ${servicePath} is unscoped in multi-tenant request code. `
      + `Use zero.unsafe.${servicePath.slice('zero.'.length)} only for deliberate privileged operations.`,
    );
    this.name = 'UnsafeServerServiceAccessError';
  }
}

export function isMultiTenantRequest(
  access: RequestAuthorizationAccess,
  services: ServerRouteServices,
): boolean {
  return services.auth.authorizationKernel?.tenancy.mode === 'multi'
    || access.context?.sessionScopeKind === 'tenant'
    || access.context?.tenantId !== undefined
    || access.context?.membershipId !== undefined;
}

export function createRequestAuthServices(
  services: ServerAuthServices,
): ServerAuthServices {
  return new Proxy(services, {
    get(target, property, receiver) {
      if (MULTI_TENANT_UNSAFE_AUTH_SERVICES.has(property)) {
        throw unsafeService(`auth.${String(property)}`);
      }
      return Reflect.get(target, property, receiver);
    },
    has(target, property) {
      return !MULTI_TENANT_UNSAFE_AUTH_SERVICES.has(property)
        && Reflect.has(target, property);
    },
    ownKeys(target) {
      return Reflect.ownKeys(target).filter(
        (property) => !MULTI_TENANT_UNSAFE_AUTH_SERVICES.has(property),
      );
    },
    getOwnPropertyDescriptor(target, property) {
      if (MULTI_TENANT_UNSAFE_AUTH_SERVICES.has(property)) return undefined;
      return Reflect.getOwnPropertyDescriptor(target, property);
    },
  });
}

export function createRequestObservabilityServices(
  services: ServerObservabilityServices,
  scope: ServiceDataScope | null,
  access: RequestAuthorizationAccess,
  request: Request | null,
): ServerObservabilityServices {
  const authorityMetadata = Object.freeze({
    zeroScopeKind: scope?.scopeKind ?? 'identity',
    ...(scope?.tenantId ? { zeroTenantId: scope.tenantId } : {}),
    ...(access.context?.membershipId
      ? { zeroMembershipId: access.context.membershipId }
      : {}),
  });
  const requestId = request?.headers.get('x-request-id') ?? undefined;
  const userId = access.context?.userId;
  const bindOptions = <T extends {
    metadata?: Record<string, unknown>;
    requestId?: string;
    userId?: string;
  }>(input: T): T => ({
    ...input,
    metadata: { ...(input.metadata ?? {}), ...authorityMetadata },
    ...(requestId ? { requestId } : {}),
    ...(userId ? { userId } : {}),
  });
  const emitters: Partial<ServerObservabilityServices> = {
    emitCode: (definition, options = {}) => services.emitCode(
      definition,
      bindOptions(options),
    ),
    emitEvent: (input) => services.emitEvent(bindOptions(input)),
    error: (definition, options = {}) => services.error(
      definition,
      bindOptions(options),
    ),
    info: (definition, options = {}) => services.info(
      definition,
      bindOptions(options),
    ),
    warn: (definition, options = {}) => services.warn(
      definition,
      bindOptions(options),
    ),
  };

  return new Proxy(services, {
    get(target, property, receiver) {
      if (Reflect.has(emitters, property)) return Reflect.get(emitters, property);
      if (MULTI_TENANT_UNSAFE_OBSERVABILITY_SERVICES.has(property)) {
        throw unsafeService(`observability.${String(property)}`);
      }
      return Reflect.get(target, property, receiver);
    },
    has(target, property) {
      return !MULTI_TENANT_UNSAFE_OBSERVABILITY_SERVICES.has(property)
        && Reflect.has(target, property);
    },
    ownKeys(target) {
      return Reflect.ownKeys(target).filter(
        (property) => !MULTI_TENANT_UNSAFE_OBSERVABILITY_SERVICES.has(property),
      );
    },
    getOwnPropertyDescriptor(target, property) {
      if (MULTI_TENANT_UNSAFE_OBSERVABILITY_SERVICES.has(property)) return undefined;
      return Reflect.getOwnPropertyDescriptor(target, property);
    },
  });
}

export function unsafeService(
  property: PropertyKey | string,
): UnsafeServerServiceAccessError {
  const suffix = String(property);
  return new UnsafeServerServiceAccessError(
    suffix.startsWith('zero.') ? suffix : `zero.${suffix}`,
  );
}
