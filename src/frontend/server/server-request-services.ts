/**
 * Request-bound server service facades.
 *
 * Setup callbacks receive the raw process/app-local service context. Route
 * handlers receive this wrapper instead: framework-owned data services close
 * over the live application/tenant boundary and cannot accept a caller-picked
 * tenant as authority. The raw context remains available through `unsafe` for
 * deliberately privileged application code.
 */

import { readAuthBearerToken } from '../../auth/auth-bearer-token';
import { authContextAuthorityFingerprint } from '../../auth/auth-context-authority';
import { effectiveServiceDataRoles } from '../../auth/service-data-authority';
import type { RequestAuthorizationAccess } from '../../auth/authorization-access';
import {
  applicationServiceDataScope,
  requireRequestServiceDataScope,
  serviceDataScopeMatchesTenant,
  type ServiceDataScope,
} from '../../auth/service-data-scope';
import { AuthError, type AuthContext } from '../../auth/types';
import type { NotificationService } from '../../notifications/notification-service';
import {
  canManageNotificationScope,
  notificationAudienceRoles,
} from '../../notifications/notification-access';
import type {
  ServerAuthServices,
  ServerObservabilityServices,
  ServerRouteServices,
} from './server-services';
import { ZeroPdfStorageWriter } from '../../pdf/pdf-storage-writer';
import type { PdfService } from '../../pdf/pdf-service';
import type { RoomService } from '../../rooms/room-service';
import { canManageRoomScope } from '../../rooms/room-access';
import {
  StorageError,
  type StorageActorRoles,
  type StorageService,
} from '../../storage/storage-service';
import type {
  DriveRecord,
  PermissionLevel,
  PermissionRecord,
} from '../../storage/types';
import type { WorkflowService } from '../../workflows/workflow-service';
import { canManageWorkflowScope } from '../../workflows/workflow-access';

const REQUEST_SERVICES = Symbol('zero.request-server-services');

const MULTI_TENANT_UNSCOPED_SERVICES = new Set<PropertyKey>([
  'db',
  'syncDB',
  'sql',
  'sqlite',
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
const WORKFLOW_UNSCOPED_SERVICES = new Set<PropertyKey>([
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
  'getStore',
  'getUserStore',
  'getTokenService',
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

/** App services projected into one request's immutable authorization scope. */
export interface ServerRequestServices extends ServerRouteServices {
  /** The same live authorization facade exposed on the Elysia request. */
  readonly access: RequestAuthorizationAccess;
  /** Validated data boundary, or null for a multi-tenant selection/anonymous session. */
  readonly scope: ServiceDataScope | null;
  /**
   * Explicit raw/setup surface. Calls through this object bypass request data
   * scoping and are trusted application code.
   */
  readonly unsafe: ServerRouteServices;
}

export interface CreateServerRequestServicesOptions {
  request: Request;
  access: RequestAuthorizationAccess;
  services: ServerRouteServices;
}

/** Internal transport-neutral projection used by authenticated background work. */
export interface CreateAuthorityScopedServerServicesOptions {
  access: RequestAuthorizationAccess;
  services: ServerRouteServices;
  scope: ServiceDataScope;
  /** Async fence used around operations which can yield. */
  assertCurrentAuthority: () => Promise<void>;
  /** Synchronous fence run immediately before every synchronous mutation. */
  assertCurrentAuthoritySync?: () => void;
  /** Optional request metadata; background execution deliberately omits it. */
  request?: Request;
  /** Only HTTP request handlers may opt into the explicit raw setup escape. */
  allowUnsafe?: boolean;
  /** Deny every service without an audited scope-safe projection. */
  strict?: boolean;
  /** Explicit runAsSystem() authority may bypass per-user ACLs within its scope. */
  privilegedSystem?: boolean;
  /** Frozen policy properties captured with background actor authority. */
  userProperties?: Readonly<Record<string, string>>;
}

/** Scope-closed service projection shared by HTTP and durable background work. */
export interface AuthorityScopedServerServices extends ServerRouteServices {
  readonly access: RequestAuthorizationAccess;
  readonly scope: ServiceDataScope;
}

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
  const auth = multiTenant
    || strict
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

function createUncommittedRequestServices(
  request: Request,
  access: RequestAuthorizationAccess,
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

function isMultiTenantRequest(
  access: RequestAuthorizationAccess,
  services: ServerRouteServices,
): boolean {
  return services.auth.authorizationKernel?.tenancy.mode === 'multi'
    || access.context?.sessionScopeKind === 'tenant'
    || access.context?.tenantId !== undefined
    || access.context?.membershipId !== undefined;
}

function createRequestAuthServices(services: ServerAuthServices): ServerAuthServices {
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

function createRequestObservabilityServices(
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

function unsafeService(property: PropertyKey | string): UnsafeServerServiceAccessError {
  const suffix = String(property);
  return new UnsafeServerServiceAccessError(
    suffix.startsWith('zero.') ? suffix : `zero.${suffix}`,
  );
}

export function isServerRequestServices(
  services: ServerRouteServices,
): services is ServerRequestServices {
  return Reflect.get(services, REQUEST_SERVICES) === true;
}

function resolveRequestScope(
  access: RequestAuthorizationAccess,
  services: ServerRouteServices,
): ServiceDataScope | null {
  const kernel = services.auth.authorizationKernel;
  const tenantShaped = kernel?.tenancy.mode === 'multi'
    || access.context?.sessionScopeKind === 'tenant'
    || access.context?.tenantId !== undefined
    || access.context?.membershipId !== undefined;

  if (!tenantShaped) {
    // Retain historical single-tenant backend behavior, including public
    // action-token/webhook routes whose own proof is not an auth session.
    return applicationServiceDataScope();
  }

  try {
    return requireRequestServiceDataScope(
      access,
      () => services.auth.authorizationKernel,
    );
  } catch {
    return null;
  }
}

function createAuthorityRevalidators(
  request: Request,
  access: RequestAuthorizationAccess,
  services: ServerRouteServices,
): {
  synchronous: () => void;
  asynchronous: () => Promise<void>;
} {
  const captured = authContextAuthorityFingerprint(
    access.context,
    access.context
      ? services.auth.store?.getProperties(access.context.userId) ?? {}
      : {},
  );
  const bearer = readAuthBearerToken(request);
  const tokens = services.auth.tokens;
  // Standalone/compatibility token-service adapters may implement only
  // `resolveAuthContext()`. They can still support asynchronous revalidation,
  // while synchronous mutations must continue to fail closed without the
  // durable capture/resolve pair.
  const reference = access.context
    && tokens
    && typeof tokens.captureAuthContextAuthority === 'function'
    && typeof tokens.resolveAuthContextAuthority === 'function'
    ? tokens.captureAuthContextAuthority(access.context)
    : null;

  const validateResolved = (current: AuthContext | null): void => {
    const properties = current
      ? services.auth.store?.getProperties(current.userId) ?? {}
      : {};
    if (authContextAuthorityFingerprint(current, properties) !== captured) {
      throw authorityChanged();
    }
  };

  const synchronous = (): void => {
    // Anonymous single-tenant server routes retain their explicit trusted
    // route semantics; there is no auth authority to revalidate.
    if (!access.context) return;
    if (!tokens || !reference) throw authorityChanged();
    let current: AuthContext | null = null;
    try {
      current = tokens.resolveAuthContextAuthority(reference);
    } catch {
      throw authorityChanged();
    }
    validateResolved(current);
  };

  const asynchronous = async (): Promise<void> => {
    if (!access.context) return;
    if (reference) {
      synchronous();
      return;
    }
    // Upgrade compatibility for an already-admitted legacy bearer which has
    // no durable parent reference. Synchronous mutations fail closed above.
    if (!bearer || !tokens) throw authorityChanged();

    let current: AuthContext | null = null;
    try {
      current = await tokens.resolveAuthContext(bearer);
    } catch {
      throw authorityChanged();
    }
    validateResolved(current);
  };

  return { synchronous, asynchronous };
}

function authorityChanged(): AuthError {
  return new AuthError(
    'Authorization changed during the request; retry with the current session',
    'AUTH_STATE_CHANGED',
    409,
  );
}

function createScopedStorageService(
  service: StorageService,
  scope: ServiceDataScope,
  access: RequestAuthorizationAccess,
  getProperties: () => Record<string, string>,
  assertCurrentAuthority: () => Promise<void>,
  assertCurrentAuthoritySync: () => void,
  privilegedSystem: boolean,
): StorageService {
  const auth = access.context;

  const actorRoles = (): StorageActorRoles => {
    if (!auth) return null;
    return effectiveServiceDataRoles(access, scope);
  };

  const canAccess = (
    driveId: string,
    level: PermissionLevel,
    path: string | null = null,
  ): boolean => {
    if (privilegedSystem) return true;
    if (!auth) return scope.scopeKind === 'application';
    const properties = getProperties();
    return service.checkAccess(
      driveId,
      path,
      auth.userId,
      actorRoles(),
      properties,
      level,
      scope,
    );
  };

  const requireDrive = (
    driveId: string,
    level: PermissionLevel,
    path: string | null = null,
  ): DriveRecord => {
    const drive = service.getDriveForScope(driveId, scope);
    if (!drive) throw new StorageError(404, 'Drive not found');
    if (!canAccess(driveId, level, path)) throw new StorageError(403, 'Forbidden');
    return drive;
  };

  const requireActor = (userId: string | null): void => {
    if (auth && userId !== null && userId !== auth.userId) {
      throw new StorageError(403, 'Storage actor must match the authenticated user');
    }
  };

  const listVisibleDrives = (): DriveRecord[] => service.listDrives()
    .filter((drive) => serviceDataScopeMatchesTenant(scope, drive.tenant_id))
    .filter((drive) => canAccess(drive.drive_id, 'read'));

  const methods: Record<string, (...args: any[]) => unknown> = {
    createDrive(ownerId, params) {
      requireActor(ownerId);
      assertCurrentAuthoritySync();
      return service.createDrive(ownerId, params, scope);
    },
    getDrive(driveId) {
      const drive = service.getDriveForScope(driveId, scope);
      return drive && canAccess(driveId, 'read') ? drive : null;
    },
    getDriveForScope(driveId) {
      const drive = service.getDriveForScope(driveId, scope);
      return drive && canAccess(driveId, 'read') ? drive : null;
    },
    updateDrive(driveId, updates) {
      requireDrive(driveId, 'admin');
      assertCurrentAuthoritySync();
      return service.updateDrive(driveId, updates);
    },
    listDrives() {
      return listVisibleDrives();
    },
    listDrivesForUser(userId) {
      requireActor(userId);
      return listVisibleDrives();
    },
    deleteDrive(driveId) {
      requireDrive(driveId, 'admin');
      assertCurrentAuthoritySync();
      return service.deleteDrive(driveId);
    },
    getDriveUsage(driveId) {
      requireDrive(driveId, 'read');
      return service.getDriveUsage(driveId);
    },
    async upload(driveId, path, data, fileName, userId, options) {
      requireActor(userId);
      requireDrive(driveId, 'write', path);
      await assertCurrentAuthority();
      const result = await service.upload(
        driveId,
        path,
        data,
        fileName,
        userId,
        options,
        scope,
        assertCurrentAuthority,
      );
      await assertCurrentAuthority();
      return result;
    },
    async createUploadGrant(driveId, params) {
      requireDrive(driveId, 'write', params.path);
      await assertCurrentAuthority();
      const result = await service.createUploadGrant(driveId, params);
      await assertCurrentAuthority();
      return result;
    },
    async download(driveId, path) {
      requireDrive(driveId, 'read', path);
      await assertCurrentAuthority();
      const result = await service.download(driveId, path);
      await assertCurrentAuthority();
      return result;
    },
    async downloadRange(driveId, path, start, end) {
      requireDrive(driveId, 'read', path);
      await assertCurrentAuthority();
      const result = await service.downloadRange(driveId, path, start, end);
      await assertCurrentAuthority();
      return result;
    },
    getFileInfo(driveId, path) {
      requireDrive(driveId, 'read', path);
      return service.getFileInfo(driveId, path);
    },
    listFolder(driveId, parentPath, options) {
      requireDrive(driveId, 'read', parentPath ?? null);
      return service.listFolder(driveId, parentPath, options);
    },
    async moveObject(driveId, fromPath, toPath) {
      requireDrive(driveId, 'write', fromPath);
      await assertCurrentAuthority();
      const result = await service.moveObject(driveId, fromPath, toPath);
      await assertCurrentAuthority();
      return result;
    },
    async copyObject(driveId, fromPath, toPath) {
      requireDrive(driveId, 'write', fromPath);
      await assertCurrentAuthority();
      const result = await service.copyObject(driveId, fromPath, toPath);
      await assertCurrentAuthority();
      return result;
    },
    async deleteObject(driveId, path) {
      requireDrive(driveId, 'write', path);
      await assertCurrentAuthority();
      const result = await service.deleteObject(driveId, path);
      await assertCurrentAuthority();
      return result;
    },
    createFolder(driveId, path, userId, isPublic) {
      requireActor(userId);
      requireDrive(driveId, 'write', path);
      assertCurrentAuthoritySync();
      return service.createFolder(driveId, path, userId, isPublic);
    },
    setVisibility(driveId, path, isPublic) {
      requireDrive(driveId, 'admin', path);
      assertCurrentAuthoritySync();
      return service.setVisibility(driveId, path, isPublic);
    },
    setDriveVisibility(driveId, isPublic) {
      requireDrive(driveId, 'admin');
      assertCurrentAuthoritySync();
      return service.setDriveVisibility(driveId, isPublic);
    },
    grantPermission(driveId, params) {
      requireDrive(driveId, 'admin', params.objectPath ?? null);
      assertCurrentAuthoritySync();
      return service.grantPermission(driveId, params);
    },
    listPermissions(driveId, options) {
      requireDrive(driveId, 'admin', options?.objectPath ?? null);
      return service.listPermissions(driveId, options);
    },
    getPermission(permissionId) {
      const permission = service.getPermission(permissionId) as PermissionRecord | null;
      if (!permission || !serviceDataScopeMatchesTenant(scope, permission.tenant_id)) return null;
      requireDrive(permission.drive_id, 'admin');
      return permission;
    },
    revokePermission(permissionId) {
      const permission = methods.getPermission(permissionId) as PermissionRecord | null;
      if (!permission) return false;
      assertCurrentAuthoritySync();
      return service.revokePermission(permissionId);
    },
    checkAccess(driveId, path, _userId, _userRole, _properties, level) {
      return canAccess(driveId, level, path);
    },
  };

  const drives = {
    create: methods.createDrive,
    get: methods.getDrive,
    update: methods.updateDrive,
    list: methods.listDrives,
    listForUser: methods.listDrivesForUser,
    delete: methods.deleteDrive,
    usage: methods.getDriveUsage,
    setVisibility: methods.setDriveVisibility,
  };
  const objects = {
    upload: methods.upload,
    download: methods.download,
    downloadRange: methods.downloadRange,
    get: methods.getFileInfo,
    list: methods.listFolder,
    move: methods.moveObject,
    copy: methods.copyObject,
    delete: methods.deleteObject,
    createFolder: methods.createFolder,
    setVisibility: methods.setVisibility,
  };
  const permissions = {
    grant: methods.grantPermission,
    list: methods.listPermissions,
    get: methods.getPermission,
    revoke: methods.revokePermission,
    checkAccess: methods.checkAccess,
  };
  const uploads = { create: methods.createUploadGrant };

  return new Proxy(service, {
    get(target, property) {
      if (property === 'drives') return drives;
      if (property === 'objects') return objects;
      if (property === 'permissions') return permissions;
      if (property === 'uploads') return uploads;
      if (typeof property === 'string' && Object.hasOwn(methods, property)) {
        return methods[property];
      }
      if (typeof property === 'string') {
        throw new Error(
          `[server-services] Storage member "${property}" is not available through the request-scoped facade; use zero.unsafe.storage for deliberate privileged access.`,
        );
      }
      return Reflect.get(target, property, target);
    },
    has(_target, property) {
      return typeof property === 'string'
        && (Object.hasOwn(methods, property)
          || property === 'drives'
          || property === 'objects'
          || property === 'permissions'
          || property === 'uploads');
    },
    ownKeys() {
      return ['drives', 'objects', 'permissions', 'uploads', ...Object.keys(methods)];
    },
    getOwnPropertyDescriptor(_target, property) {
      if (typeof property !== 'string') return undefined;
      const visible = Object.hasOwn(methods, property)
        || property === 'drives'
        || property === 'objects'
        || property === 'permissions'
        || property === 'uploads';
      return visible ? { configurable: true, enumerable: true } : undefined;
    },
  }) as StorageService;
}

function createScopedNotificationService(
  service: NotificationService,
  scope: ServiceDataScope,
  access: RequestAuthorizationAccess,
  assertCurrentAuthoritySync: () => void,
  privilegedSystem: boolean,
): NotificationService {
  const auth = access.context;
  const roles = notificationAudienceRoles(access, scope);
  const canManage = canManageNotificationScope(access, scope, privilegedSystem);
  const requireActor = (userId: string): void => {
    if (privilegedSystem) return;
    if (!auth || userId !== auth.userId) throw forbidden('Notification user mismatch');
  };
  const actorNotification = (id: string) => {
    if (!auth) return service.getById(id, scope);
    return service.getByIdForUser(id, auth.userId, roles, scope);
  };
  const listForActor = () => {
    if (!auth) return [];
    return service.getForUser(auth.userId, roles, scope);
  };
  const requireVisible = (id: string) => {
    const notification = actorNotification(id);
    if (!notification) throw notFound('Notification not found');
    return notification;
  };
  const requireManager = (id: string) => {
    if (!canManage) throw forbidden('Notification management is not permitted');
    const notification = service.getById(id, scope);
    if (!notification) throw notFound('Notification not found');
    return notification;
  };
  const requireCreateAuthority = (): void => {
    if (!canManage) throw forbidden('Notification management is not permitted');
  };
  const methods: Record<string, (...args: any[]) => unknown> = {
    create(params, senderId) {
      requireCreateAuthority();
      if (senderId) requireActor(senderId);
      assertCurrentAuthoritySync();
      return service.create(params, senderId ?? auth?.userId, scope);
    },
    broadcast(params, senderId) {
      requireCreateAuthority();
      if (senderId) requireActor(senderId);
      assertCurrentAuthoritySync();
      return service.broadcast(params, senderId ?? auth?.userId, scope);
    },
    notify(userId, params, senderId) {
      requireCreateAuthority();
      if (senderId) requireActor(senderId);
      assertCurrentAuthoritySync();
      return service.notify(userId, params, senderId ?? auth?.userId, scope);
    },
    notifyUsers(userIds, params, senderId) {
      requireCreateAuthority();
      if (senderId) requireActor(senderId);
      assertCurrentAuthoritySync();
      return service.notifyUsers(userIds, params, senderId ?? auth?.userId, scope);
    },
    notifyRole(role, params, senderId) {
      requireCreateAuthority();
      if (senderId) requireActor(senderId);
      assertCurrentAuthoritySync();
      return service.notifyRole(role, params, senderId ?? auth?.userId, scope);
    },
    getById: actorNotification,
    getByIdForUser(id, userId) {
      requireActor(userId);
      return actorNotification(id);
    },
    get: actorNotification,
    getForUser(userId) {
      requireActor(userId);
      return listForActor();
    },
    list(userId) {
      requireActor(userId);
      return listForActor();
    },
    getUnreadCount(userId) {
      requireActor(userId);
      return listForActor().filter((notification) => !notification.receipt?.read_at
        && !notification.receipt?.dismissed_at).length;
    },
    getReceipts(id) {
      requireManager(id);
      return service.getReceipts(id, scope);
    },
    markSeen(id, userId) {
      requireActor(userId);
      requireVisible(id);
      assertCurrentAuthoritySync();
      return service.markSeen(id, userId, scope);
    },
    markRead(id, userId) {
      requireActor(userId);
      requireVisible(id);
      assertCurrentAuthoritySync();
      return service.markRead(id, userId, scope);
    },
    dismiss(id, userId) {
      requireActor(userId);
      requireVisible(id);
      assertCurrentAuthoritySync();
      return service.dismiss(id, userId, scope);
    },
    markAllRead(userId) {
      requireActor(userId);
      assertCurrentAuthoritySync();
      return service.markAllRead(userId, roles, scope);
    },
    markAllSeen(userId) {
      requireActor(userId);
      assertCurrentAuthoritySync();
      return service.markAllSeen(userId, roles, scope);
    },
    deleteNotification(id) {
      requireManager(id);
      assertCurrentAuthoritySync();
      return service.deleteNotification(id, scope);
    },
    delete(id) {
      requireManager(id);
      assertCurrentAuthoritySync();
      return service.delete(id, scope);
    },
  };
  return restrictedServiceProxy(service, methods, new Set(['deleteExpired']), 'Notification');
}

function createScopedRoomService(
  service: RoomService,
  scope: ServiceDataScope,
  access: RequestAuthorizationAccess,
  assertCurrentAuthoritySync: () => void,
  privilegedSystem: boolean,
): RoomService {
  const auth = access.context;
  const canManage = canManageRoomScope(access, scope, privilegedSystem);
  const requireActor = (userId: string): void => {
    if (privilegedSystem) return;
    if (!auth || userId !== auth.userId) throw forbidden('Room user mismatch');
  };
  const requireReadable = (roomId: string) => {
    const room = service.getRoom(roomId, scope);
    if (!room
      || (!privilegedSystem && (!auth || !service.isMember(roomId, auth.userId, scope)))) {
      throw notFound('Room not found');
    }
    return room;
  };
  const methods: Record<string, (...args: any[]) => unknown> = {
    create(createdBy, params) {
      requireActor(createdBy);
      assertCurrentAuthoritySync();
      return service.create(createdBy, params, scope);
    },
    join(roomId, userId, role) {
      requireActor(userId);
      if (privilegedSystem) {
        assertCurrentAuthoritySync();
        return service.join(roomId, userId, role, scope);
      }
      requireReadable(roomId);
      return service.getMember(roomId, userId, scope)!;
    },
    leave(roomId, userId) {
      requireActor(userId);
      assertCurrentAuthoritySync();
      return service.leave(roomId, userId, scope);
    },
    getRoom(roomId) {
      try { return requireReadable(roomId); } catch { return null; }
    },
    getMembers(roomId) {
      requireReadable(roomId);
      return service.getMembers(roomId, scope);
    },
    getMember(roomId, userId) {
      requireReadable(roomId);
      return service.getMember(roomId, userId, scope);
    },
    getRoomsForUser(userId) {
      requireActor(userId);
      return service.getRoomsForUser(userId, scope);
    },
    isMember(roomId, userId) {
      requireReadable(roomId);
      return service.isMember(roomId, userId, scope);
    },
    delete(roomId) {
      const room = service.getRoom(roomId, scope);
      if (!room
        || (!canManage && (!auth || room.created_by !== auth.userId))) {
        throw notFound('Room not found');
      }
      assertCurrentAuthoritySync();
      return service.delete(roomId, scope);
    },
  };
  return restrictedServiceProxy(service, methods, new Set(), 'Room');
}

function createScopedWorkflowService(
  service: WorkflowService,
  scope: ServiceDataScope,
  access: RequestAuthorizationAccess,
  assertCurrentAuthority: () => Promise<void>,
  assertCurrentAuthoritySync: () => void,
): WorkflowService {
  const auth = access.context;
  const manageAll = auth ? canManageWorkflowScope(access, scope) : true;
  const requireActor = (userId: string | undefined): void => {
    if (auth && userId !== undefined && userId !== auth.userId) {
      throw forbidden('Workflow actor mismatch');
    }
  };
  const requireOwned = (instanceId: string) => {
    const instance = service.getInstance(instanceId, scope);
    if (!instance
      || (auth && !manageAll && instance.started_by !== auth.userId)) {
      throw notFound('Workflow not found');
    }
    return instance;
  };
  const methods: Record<string, (...args: any[]) => unknown> = {
    async start(name, input, startedBy) {
      requireActor(startedBy);
      const actor = access.requireUser();
      await assertCurrentAuthority();
      const result = await service.runAsActor(name, input, actor);
      await assertCurrentAuthority();
      return result;
    },
    async run(name, input, startedBy) {
      requireActor(startedBy);
      const actor = access.requireUser();
      await assertCurrentAuthority();
      const result = await service.runAsActor(name, input, actor);
      await assertCurrentAuthority();
      return result;
    },
    async advance(instanceId) {
      requireOwned(instanceId);
      await assertCurrentAuthority();
      const result = await service.advance(instanceId, scope);
      await assertCurrentAuthority();
      return result;
    },
    async sendEvent(instanceId, eventName, payload, sentBy) {
      requireActor(sentBy);
      requireOwned(instanceId);
      await assertCurrentAuthority();
      const result = await service.sendEvent(
        instanceId,
        eventName,
        payload,
        sentBy ?? auth?.userId,
        scope,
      );
      await assertCurrentAuthority();
      return result;
    },
    cancel(id) {
      requireOwned(id);
      assertCurrentAuthoritySync();
      return service.cancel(id, scope);
    },
    stop(id) {
      requireOwned(id);
      assertCurrentAuthoritySync();
      return service.stop(id, scope);
    },
    pause(id) {
      requireOwned(id);
      assertCurrentAuthoritySync();
      return service.pause(id, scope);
    },
    async resume(id) {
      requireOwned(id);
      await assertCurrentAuthority();
      const result = await service.resume(id, scope);
      await assertCurrentAuthority();
      return result;
    },
    getInstance(id) {
      try { return requireOwned(id); } catch { return null; }
    },
    get(id) {
      try { return requireOwned(id); } catch { return null; }
    },
    getSteps(id) { requireOwned(id); return service.getSteps(id, scope); },
    getEvents(id) { requireOwned(id); return service.getEvents(id, scope); },
    listInstances(filter) {
      return service.listInstances({
        ...(filter ?? {}),
        ...(manageAll ? {} : { startedBy: auth?.userId }),
        scope,
      });
    },
    list(filter) {
      return service.list({
        ...(filter ?? {}),
        ...(manageAll ? {} : { startedBy: auth?.userId }),
        scope,
      });
    },
  };
  return restrictedServiceProxy(
    service,
    methods,
    new Set(['pollRetries', 'pollTimeouts', 'recoverInFlight']),
    'Workflow',
  );
}

function forbidden(message: string): AuthError {
  return new AuthError(message, 'FORBIDDEN', 403);
}

function notFound(message: string): AuthError {
  return new AuthError(message, 'NOT_FOUND', 404);
}

function createRequestPdfService(
  service: PdfService,
  storage: StorageService | null,
  actorUserId: string | null,
  assertCurrentAuthority: () => Promise<void>,
): PdfService {
  const writer = storage ? new ZeroPdfStorageWriter(() => storage) : null;
  const methods: Record<string, (...args: any[]) => unknown> = {
    render: (input) => service.render(input),
    async renderToStorage(input, target) {
      if (!writer) {
        throw new AuthError(
          'A committed application or tenant scope is required for PDF storage',
          'FORBIDDEN',
          403,
        );
      }
      await assertCurrentAuthority();
      const result = await service.renderToStorage(input, {
        ...target,
        createdBy: target.createdBy ?? actorUserId,
      }, writer);
      await assertCurrentAuthority();
      return result;
    },
    status: () => service.status(),
  };
  return restrictedServiceProxy(service, methods, new Set(['close']), 'PDF');
}

function restrictedServiceProxy<T extends object>(
  service: T,
  methods: Record<string, (...args: any[]) => unknown>,
  denied: ReadonlySet<string>,
  label: string,
): T {
  return new Proxy(service, {
    get(target, property) {
      if (typeof property === 'string' && Object.hasOwn(methods, property)) {
        return methods[property];
      }
      if (typeof property === 'string') {
        const kind = denied.has(property) ? 'method' : 'member';
        throw new Error(
          `[server-services] ${label} ${kind} "${property}" is not available through the request-scoped facade; use zero.unsafe for deliberate privileged access.`,
        );
      }
      return Reflect.get(target, property, target);
    },
    has(_target, property) {
      return typeof property === 'string' && Object.hasOwn(methods, property);
    },
    ownKeys() {
      return Object.keys(methods);
    },
    getOwnPropertyDescriptor(_target, property) {
      return typeof property === 'string' && Object.hasOwn(methods, property)
        ? { configurable: true, enumerable: true }
        : undefined;
    },
  });
}
