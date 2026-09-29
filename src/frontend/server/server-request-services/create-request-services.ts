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
  return createAuthorityScopedServerServices({
    request,
    access,
    services,
    scope,
    assertCurrentAuthority: authority.asynchronous,
    assertCurrentAuthoritySync: authority.synchronous,
    allowUnsafe: true,
  }) as ServerRequestServices;
}

/**
 * Build one scope-closed service facade from already validated authority.
 * Callers own authority capture/revalidation; this function owns capability
 * projection and mutation fencing.
 */
export function createAuthorityScopedServerServices(
  options: CreateAuthorityScopedServerServicesOptions,
): AuthorityScopedServerServices {
  const databaseAuthoritySync = options.assertCurrentAuthoritySync;
  const {
    access,
    services,
    scope,
    request,
    assertCurrentAuthority,
    assertCurrentAuthoritySync = () => {},
    allowUnsafe = false,
    strict = false,
    privilegedSystem = false,
    userProperties,
  } = options;
  const multiTenant = isMultiTenantRequest(access, services);
  const storage = services.storage
    ? createScopedStorageService(
        services.storage,
        scope,
        access,
        () => userProperties
          ? { ...userProperties }
          : services.auth.store?.getProperties(access.context?.userId ?? '') ?? {},
        assertCurrentAuthority,
        assertCurrentAuthoritySync,
        privilegedSystem,
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
      )
    : null;
  const auth = multiTenant || strict
    ? createRequestAuthServices(services.auth)
    : services.auth;
  const observability = multiTenant || strict
    ? createRequestObservabilityServices(
        services.observability,
        scope,
        access,
        request ?? null,
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
    access,
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

  return new Proxy(services, {
    get(target, property, receiver) {
      if (Object.hasOwn(overrides, property)) return Reflect.get(overrides, property);
      if (isHiddenRequestService(property, { strict, multiTenant })) {
        throw unsafeService(property);
      }
      return Reflect.get(target, property, receiver);
    },
    has(target, property) {
      if (isHiddenRequestService(property, { strict, multiTenant })) return false;
      return Object.hasOwn(overrides, property) || Reflect.has(target, property);
    },
    ownKeys(target) {
      return requestServiceOwnKeys(target, overrides, { strict, multiTenant });
    },
    getOwnPropertyDescriptor(target, property) {
      if (isHiddenRequestService(property, { strict, multiTenant })) return undefined;
      if (Object.hasOwn(overrides, property)) {
        return requestServiceOverrideDescriptor(overrides, property);
      }
      return Reflect.getOwnPropertyDescriptor(target, property);
    },
  }) as AuthorityScopedServerServices;
}

export function isServerRequestServices(
  services: ServerRouteServices,
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
  }) as ServerRequestServices;
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
