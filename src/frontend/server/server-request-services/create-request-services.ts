import type { ServerRouteServices } from '../server-services';
import { createRequestDatabaseClient } from '../request-database-client';
import type {
  AuthorityScopedServerServices,
  CreateAuthorityScopedServerServicesOptions,
  CreateServerRequestServicesOptions,
  ServerRequestServices,
} from './contracts';
import {
  createAuthorityRevalidators,
  resolveRequestScope,
} from './request-authority';
import { createRequestPdfService } from './request-pdf-service';
import {
  MULTI_TENANT_UNSCOPED_SERVICES,
  REQUEST_SERVICES,
  WORKFLOW_UNSCOPED_SERVICES,
  createAuthorityScopedAuthorizationAccess,
  createRequestAuthServices,
  createRequestObservabilityServices,
  isMultiTenantRequest,
  unsafeService,
} from './request-policy';
import { createScopedNotificationService } from './scoped-notification-service';
import { createScopedRoomService } from './scoped-room-service';
import { createScopedStorageService } from './scoped-storage-service';
import { createScopedWorkflowService } from './scoped-workflow-service';

/** Create (or preserve) the authorized service view for one HTTP request. */
export function createServerRequestServices(
  options: CreateServerRequestServicesOptions,
): ServerRequestServices {
  if (isServerRequestServices(options.services)) return options.services;

  const { request, access, services } = options;
  const scope = resolveRequestScope(access, services);
  if (!scope) {
    return createUncommittedRequestServices(request, access, services);
  }
  const authority = createAuthorityRevalidators(request, access, services);
  return createInternalAuthorityScopedServerServices({
    request,
    access,
    services,
    scope,
    assertCurrentAuthority: authority.asynchronous,
    assertCurrentAuthoritySync: authority.synchronous,
    allowUnsafe: true,
    strict: false,
    privilegedSystem: false,
    auditProvenance: 'authenticated-request',
  }) as unknown as ServerRequestServices;
}

/**
 * Defer authority-scoped service projection until route authorization has run.
 * API-key contexts are deliberately hidden by RequestAuthorizationAccess until
 * an explicit credential declaration admits them, so eagerly projecting here
 * would either leak the key identity or permanently cache an anonymous facade.
 */
export function createDeferredServerRequestServices(
  options: CreateServerRequestServicesOptions,
): ServerRequestServices {
  let initialized = false;
  let admittedContext = options.access.context;
  let current: ServerRequestServices;
  const resolve = (): ServerRequestServices => {
    const nextContext = options.access.context;
    if (!initialized || nextContext !== admittedContext) {
      admittedContext = nextContext;
      current = createServerRequestServices(options);
      initialized = true;
    }
    return current!;
  };

  return new Proxy(options.services as ServerRequestServices, {
    get(_target, property) {
      const services = resolve();
      return Reflect.get(services, property, services);
    },
    has(_target, property) {
      return Reflect.has(resolve(), property);
    },
    ownKeys() {
      return Reflect.ownKeys(resolve());
    },
    getOwnPropertyDescriptor(_target, property) {
      return Reflect.getOwnPropertyDescriptor(resolve(), property);
    },
  });
}

/**
 * Build one scope-closed service facade from already validated authority.
 * Callers own authority capture/revalidation; this function owns capability
 * projection and authority fencing at each scoped operation.
 */
export function createAuthorityScopedServerServices(
  options: CreateAuthorityScopedServerServicesOptions,
): AuthorityScopedServerServices {
  return createInternalAuthorityScopedServerServices({
    ...options,
    allowUnsafe: false,
    strict: true,
    privilegedSystem: false,
    auditProvenance: 'authenticated-request',
  });
}

interface CreateInternalAuthorityScopedServerServicesOptions
  extends CreateAuthorityScopedServerServicesOptions {
  readonly allowUnsafe: boolean;
  readonly strict: boolean;
  readonly privilegedSystem: boolean;
  readonly auditProvenance: 'authenticated-request' | 'system';
}

/** Internal projection seam for HTTP setup and sealed system workflow work. */
export function createInternalAuthorityScopedServerServices(
  options: CreateInternalAuthorityScopedServerServicesOptions,
): AuthorityScopedServerServices {
  if (typeof options.assertCurrentAuthority !== 'function'
    || typeof options.assertCurrentAuthoritySync !== 'function') {
    throw new TypeError(
      'Authority-scoped server services require live asynchronous and synchronous authority fences.',
    );
  }
  const databaseAuthoritySync = options.assertCurrentAuthoritySync;
  const {
    access,
    services,
    scope,
    request,
    assertCurrentAuthority,
    assertCurrentAuthoritySync,
    allowUnsafe,
    strict,
    privilegedSystem,
    auditProvenance,
    userProperties,
  } = options;
  // Public machine/background projections must reject already-stale authority
  // before exposing any capability. HTTP request projections have already
  // passed route admission and may be backed by a legacy session verifier that
  // supports only asynchronous revalidation; their synchronous mutations
  // continue to fail closed at the individual commit boundary instead of
  // turning every read-only route into a 409.
  if (strict) assertCurrentAuthoritySync();
  const projectedAccess = strict
    ? createAuthorityScopedAuthorizationAccess(access, assertCurrentAuthoritySync)
    : access;
  const authorityProperties = userProperties
    ? Object.freeze({ ...userProperties })
    : null;
  const multiTenant = isMultiTenantRequest(access, services);
  const storage = services.storage
    ? createScopedStorageService(
        services.storage,
        scope,
        access,
        () => authorityProperties
          ? { ...authorityProperties }
          : services.auth.store?.getProperties(access.context?.userId ?? '') ?? {},
        assertCurrentAuthority,
        assertCurrentAuthoritySync,
        privilegedSystem,
        auditProvenance,
      )
    : null;
  const notifications = services.notifications
    ? createScopedNotificationService(
        services.notifications,
        scope,
        access,
        assertCurrentAuthoritySync,
        privilegedSystem,
      )
    : null;
  const rooms = services.rooms
    ? createScopedRoomService(
        services.rooms,
        scope,
        access,
        assertCurrentAuthoritySync,
        privilegedSystem,
      )
    : null;
  const workflows = services.workflows
    ? createScopedWorkflowService(
        services.workflows,
        scope,
        access,
        assertCurrentAuthority,
        assertCurrentAuthoritySync,
      )
    : null;
  const pdf = services.pdf
    ? createRequestPdfService(
        services.pdf,
        storage,
        access.context?.userId ?? null,
        assertCurrentAuthority,
        assertCurrentAuthoritySync,
      )
    : null;
  const auth = multiTenant || strict
    ? createRequestAuthServices(services.auth, strict)
    : services.auth;
  const observability = multiTenant || strict
    ? createRequestObservabilityServices(
        services.observability,
        scope,
        access,
        request ?? null,
        assertCurrentAuthoritySync,
        strict,
      )
    : services.observability;
  // Tenant-file operations require an explicit durable synchronous fence.
  // The no-op compatibility default used by older scoped service adapters is
  // not sufficient authority to mint a database capability.
  const requestData = databaseAuthoritySync
    ? createRequestDatabaseClient({
        manager: services.databases,
        scope,
        assertCurrentAuthoritySync: databaseAuthoritySync,
      })
    : null;

  const overrides: Record<PropertyKey, unknown> = {
    [REQUEST_SERVICES]: true,
    access: projectedAccess,
    scope,
    data: requestData,
    auth,
    observability,
    storage,
    notifications,
    rooms,
    workflows,
    pdf,
  };
  if (allowUnsafe) overrides.unsafe = services;

  const projection = new Proxy(services, {
    get(target, property, receiver) {
      if (Object.hasOwn(overrides, property)) return Reflect.get(overrides, property);
      if (strict) throw unsafeService(property);
      if (isHiddenRequestService(property, { strict, multiTenant })) {
        throw unsafeService(property);
      }
      return Reflect.get(target, property, receiver);
    },
    has(target, property) {
      if (Object.hasOwn(overrides, property)) return true;
      if (strict) return false;
      if (isHiddenRequestService(property, { strict, multiTenant })) return false;
      return Reflect.has(target, property);
    },
    ownKeys(target) {
      return requestServiceOwnKeys(target, overrides, { strict, multiTenant });
    },
    getOwnPropertyDescriptor(target, property) {
      if (Object.hasOwn(overrides, property)) {
        return requestServiceOverrideDescriptor(overrides, property);
      }
      if (strict) return undefined;
      if (isHiddenRequestService(property, { strict, multiTenant })) return undefined;
      return Reflect.getOwnPropertyDescriptor(target, property);
    },
  });
  // The proxy deliberately narrows raw ServerRouteServices at runtime. Its
  // exact public shape is covered by own-key/runtime traps and compile-time
  // negative assertions; the source object itself must remain the raw target.
  return projection as unknown as AuthorityScopedServerServices;
}

export function isServerRequestServices(
  services: object,
): services is ServerRequestServices {
  return Reflect.get(services, REQUEST_SERVICES) === true;
}

function createUncommittedRequestServices(
  request: Request,
  access: CreateServerRequestServicesOptions['access'],
  services: ServerRouteServices,
): ServerRequestServices {
  const authority = createAuthorityRevalidators(request, access, services);
  const overrides: Record<PropertyKey, unknown> = {
    [REQUEST_SERVICES]: true,
    access,
    scope: null,
    data: null,
    unsafe: services,
    auth: createRequestAuthServices(services.auth),
    observability: createRequestObservabilityServices(
      services.observability,
      null,
      access,
      request,
      authority.synchronous,
    ),
    storage: null,
    notifications: null,
    rooms: null,
    workflows: null,
    pdf: services.pdf
      ? createRequestPdfService(
          services.pdf,
          null,
          access.context?.userId ?? null,
          authority.asynchronous,
          authority.synchronous,
        )
      : null,
  };

  return new Proxy(services, {
    get(target, property, receiver) {
      if (Object.hasOwn(overrides, property)) return Reflect.get(overrides, property);
      if (MULTI_TENANT_UNSCOPED_SERVICES.has(property)) throw unsafeService(property);
      return Reflect.get(target, property, receiver);
    },
    has(target, property) {
      if (MULTI_TENANT_UNSCOPED_SERVICES.has(property)) return false;
      return Object.hasOwn(overrides, property) || Reflect.has(target, property);
    },
    ownKeys(target) {
      return requestServiceOwnKeys(target, overrides, {
        strict: false,
        multiTenant: true,
      });
    },
    getOwnPropertyDescriptor(target, property) {
      if (MULTI_TENANT_UNSCOPED_SERVICES.has(property)) return undefined;
      if (Object.hasOwn(overrides, property)) {
        return requestServiceOverrideDescriptor(overrides, property);
      }
      return Reflect.getOwnPropertyDescriptor(target, property);
    },
  }) as unknown as ServerRequestServices;
}

function isHiddenRequestService(
  property: PropertyKey,
  mode: { readonly strict: boolean; readonly multiTenant: boolean },
): boolean {
  return (mode.strict && WORKFLOW_UNSCOPED_SERVICES.has(property))
    || (mode.multiTenant && MULTI_TENANT_UNSCOPED_SERVICES.has(property));
}

function requestServiceOwnKeys(
  target: ServerRouteServices,
  overrides: Record<PropertyKey, unknown>,
  mode: { readonly strict: boolean; readonly multiTenant: boolean },
): Array<string | symbol> {
  if (mode.strict) {
    return Reflect.ownKeys(overrides).filter(
      (property) => property !== REQUEST_SERVICES,
    );
  }
  return [...new Set([
    ...Reflect.ownKeys(target),
    ...Reflect.ownKeys(overrides),
  ])].filter((property) => property !== REQUEST_SERVICES
    && !isHiddenRequestService(property, mode));
}

function requestServiceOverrideDescriptor(
  overrides: Record<PropertyKey, unknown>,
  property: PropertyKey,
): PropertyDescriptor {
  return {
    configurable: true,
    enumerable: typeof property === 'string',
    writable: false,
    value: Reflect.get(overrides, property),
  };
}
