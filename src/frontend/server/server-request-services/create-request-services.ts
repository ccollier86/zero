import type { ServerRouteServices } from '../server-services';
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

  const overrides: Record<PropertyKey, unknown> = {
    [REQUEST_SERVICES]: true,
    access,
    scope,
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
      if (Reflect.has(overrides, property)) return Reflect.get(overrides, property);
      if (strict && WORKFLOW_UNSCOPED_SERVICES.has(property)) {
        throw unsafeService(property);
      }
      if (multiTenant && MULTI_TENANT_UNSCOPED_SERVICES.has(property)) {
        throw unsafeService(property);
      }
      return Reflect.get(target, property, receiver);
    },
    has(target, property) {
      if (strict && WORKFLOW_UNSCOPED_SERVICES.has(property)) return false;
      return Reflect.has(overrides, property) || Reflect.has(target, property);
    },
    ownKeys(target) {
      return Reflect.ownKeys(target).filter(
        (property) => !strict || !WORKFLOW_UNSCOPED_SERVICES.has(property),
      );
    },
    getOwnPropertyDescriptor(target, property) {
      if (strict && WORKFLOW_UNSCOPED_SERVICES.has(property)) return undefined;
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
      if (Reflect.has(overrides, property)) return Reflect.get(overrides, property);
      if (MULTI_TENANT_UNSCOPED_SERVICES.has(property)) throw unsafeService(property);
      return Reflect.get(target, property, receiver);
    },
    has(target, property) {
      return Reflect.has(overrides, property) || Reflect.has(target, property);
    },
  }) as ServerRequestServices;
}
