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

/** Exact Guardian surface admitted into trusted machine/workflow projections. */
const AUTHORITY_SCOPED_AUTH_SERVICES = new Set<PropertyKey>([
  'authorization',
  'authorizationKernel',
  'getAuthorizationKernel',
]);

/** Exact observability surface admitted into trusted machine/workflow projections. */
const AUTHORITY_SCOPED_OBSERVABILITY_SERVICES = new Set<PropertyKey>([
  'emitCode',
  'emitEvent',
  'error',
  'info',
  'warn',
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

/** Fence every authorization read/decision exposed to durable or machine work. */
export function createAuthorityScopedAuthorizationAccess(
  access: RequestAuthorizationAccess,
  assertCurrentAuthority: () => void,
): RequestAuthorizationAccess {
  return Object.freeze({
    get context() {
      assertCurrentAuthority();
      return access.context;
    },
    get authorization() {
      assertCurrentAuthority();
      return access.authorization;
    },
    get applicationAuthorization() {
      assertCurrentAuthority();
      return access.applicationAuthorization;
    },
    authorize(requirement: Parameters<RequestAuthorizationAccess['authorize']>[0]) {
      assertCurrentAuthority();
      return access.authorize(requirement);
    },
    requireUser() {
      assertCurrentAuthority();
      return access.requireUser();
    },
    requirePlatformAdmin() {
      assertCurrentAuthority();
      return access.requirePlatformAdmin();
    },
    requireAuthorizationScope() {
      assertCurrentAuthority();
      return access.requireAuthorizationScope();
    },
    requireApplicationAuthorization() {
      assertCurrentAuthority();
      return access.requireApplicationAuthorization();
    },
    requireTenant() {
      assertCurrentAuthority();
      return access.requireTenant();
    },
    hasPermission(permission: Parameters<RequestAuthorizationAccess['hasPermission']>[0]) {
      assertCurrentAuthority();
      return access.hasPermission(permission);
    },
    requirePermission(permission: Parameters<RequestAuthorizationAccess['requirePermission']>[0]) {
      assertCurrentAuthority();
      return access.requirePermission(permission);
    },
    requireAnyPermission(
      permissions: Parameters<RequestAuthorizationAccess['requireAnyPermission']>[0],
    ) {
      assertCurrentAuthority();
      return access.requireAnyPermission(permissions);
    },
  });
}

export function createRequestAuthServices(
  services: ServerAuthServices,
  exact = false,
): ServerAuthServices {
  return new Proxy(services, {
    get(target, property, receiver) {
      if (exact && !AUTHORITY_SCOPED_AUTH_SERVICES.has(property)) {
        throw unsafeService(`auth.${String(property)}`);
      }
      if (MULTI_TENANT_UNSAFE_AUTH_SERVICES.has(property)) {
        throw unsafeService(`auth.${String(property)}`);
      }
      return Reflect.get(target, property, receiver);
    },
    has(target, property) {
      return (!exact || AUTHORITY_SCOPED_AUTH_SERVICES.has(property))
        && !MULTI_TENANT_UNSAFE_AUTH_SERVICES.has(property)
        && Reflect.has(target, property);
    },
    ownKeys(target) {
      return Reflect.ownKeys(target).filter(
        (property) => (!exact || AUTHORITY_SCOPED_AUTH_SERVICES.has(property))
          && !MULTI_TENANT_UNSAFE_AUTH_SERVICES.has(property),
      );
    },
    getOwnPropertyDescriptor(target, property) {
      if ((exact && !AUTHORITY_SCOPED_AUTH_SERVICES.has(property))
        || MULTI_TENANT_UNSAFE_AUTH_SERVICES.has(property)) return undefined;
      return Reflect.getOwnPropertyDescriptor(target, property);
    },
  });
}

export function createRequestObservabilityServices(
  services: ServerObservabilityServices,
  scope: ServiceDataScope | null,
  access: RequestAuthorizationAccess,
  request: Request | null,
  assertCurrentAuthority: () => void = () => {},
  exact = false,
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
    emitCode: (definition, options = {}) => {
      assertCurrentAuthority();
      return services.emitCode(definition, bindOptions(options));
    },
    emitEvent: (input) => {
      assertCurrentAuthority();
      return services.emitEvent(bindOptions(input));
    },
    error: (definition, options = {}) => {
      assertCurrentAuthority();
      return services.error(definition, bindOptions(options));
    },
    info: (definition, options = {}) => {
      assertCurrentAuthority();
      return services.info(definition, bindOptions(options));
    },
    warn: (definition, options = {}) => {
      assertCurrentAuthority();
      return services.warn(definition, bindOptions(options));
    },
  };

  return new Proxy(services, {
    get(target, property, receiver) {
      if (exact && !AUTHORITY_SCOPED_OBSERVABILITY_SERVICES.has(property)) {
        throw unsafeService(`observability.${String(property)}`);
      }
      if (Object.hasOwn(emitters, property)) return Reflect.get(emitters, property);
      if (MULTI_TENANT_UNSAFE_OBSERVABILITY_SERVICES.has(property)) {
        throw unsafeService(`observability.${String(property)}`);
      }
      return Reflect.get(target, property, receiver);
    },
    has(target, property) {
      if (exact && !AUTHORITY_SCOPED_OBSERVABILITY_SERVICES.has(property)) return false;
      if (Object.hasOwn(emitters, property)) return true;
      return !MULTI_TENANT_UNSAFE_OBSERVABILITY_SERVICES.has(property)
        && Reflect.has(target, property);
    },
    ownKeys(target) {
      return [...new Set([
        ...Reflect.ownKeys(target),
        ...Reflect.ownKeys(emitters),
      ])].filter((property) => (
        (!exact || AUTHORITY_SCOPED_OBSERVABILITY_SERVICES.has(property))
          && !MULTI_TENANT_UNSAFE_OBSERVABILITY_SERVICES.has(property)
      ));
    },
    getOwnPropertyDescriptor(target, property) {
      if ((exact && !AUTHORITY_SCOPED_OBSERVABILITY_SERVICES.has(property))
        || MULTI_TENANT_UNSAFE_OBSERVABILITY_SERVICES.has(property)) return undefined;
      if (Object.hasOwn(emitters, property)) {
        return {
          configurable: true,
          enumerable: true,
          writable: false,
          value: Reflect.get(emitters, property),
        };
      }
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
