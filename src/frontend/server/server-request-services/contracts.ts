import type { RequestAuthorizationAccess } from '../../../auth/authorization-access';
import type { ServiceDataScope } from '../../../auth/service-data-scope';
import type { AsyncDatabaseClient } from '../../../databases/database-operations';
import type {
  ServerAuthServices,
  ServerObservabilityServices,
  ServerRouteServices,
} from '../server-services';
import type { ScopedNotificationService } from './scoped-notification-service';
import type { ScopedPdfService } from './request-pdf-service';
import type { ScopedRoomService } from './scoped-room-service';
import type { ScopedStorageService } from './scoped-storage-service';
import type { ScopedWorkflowService } from './scoped-workflow-service';

/** App services projected into one request's immutable authorization scope. */
export interface ServerRequestServices extends Omit<
  ServerRouteServices,
  | 'auth'
  | 'notifications'
  | 'observability'
  | 'pdf'
  | 'rooms'
  | 'storage'
  | 'workflows'
> {
  /** The same live authorization facade exposed on the Elysia request. */
  readonly access: RequestAuthorizationAccess;
  /** Validated data boundary, or null for a multi-tenant selection/anonymous session. */
  readonly scope: ServiceDataScope | null;
  /** Tenant-file data client, or null outside tenant-database isolation. */
  readonly data: AsyncDatabaseClient | null;
  /** Guardian services; multi-tenant runtime projections hide raw stores. */
  readonly auth: ServerAuthServices;
  /** Scope-closed storage facade; caller-controlled scope/actor selectors are absent. */
  readonly storage: ScopedStorageService | null;
  /** Current-actor notification facade. */
  readonly notifications: ScopedNotificationService | null;
  /** Current-actor room facade. */
  readonly rooms: ScopedRoomService | null;
  /** Scope-closed workflow facade; privileged lifecycle APIs remain under unsafe. */
  readonly workflows: ScopedWorkflowService | null;
  /** Scope-closed PDF facade. */
  readonly pdf: ScopedPdfService | null;
  /** Observability services; multi-tenant runtime projections hide raw sinks. */
  readonly observability: ServerObservabilityServices;
  /**
   * Explicit raw/setup surface. Calls through this object bypass request data
   * scoping and are trusted application code.
   */
  readonly unsafe: ServerRouteServices;
}

export interface CreateServerRequestServicesOptions {
  request: Request;
  access: RequestAuthorizationAccess;
  services: ServerRouteServices | ServerRequestServices;
}

/**
 * Trusted transport-neutral projection for verified machine/background work.
 *
 * The caller must derive `access` and `scope` from server-owned credential
 * bindings and must revalidate both fences against live Guardian authority.
 * Never populate this contract from an untrusted tenant selector.
 */
export interface CreateAuthorityScopedServerServicesOptions {
  access: RequestAuthorizationAccess;
  services: ServerRouteServices;
  scope: ServiceDataScope;
  /** Async fence used around operations which can yield. */
  assertCurrentAuthority: () => Promise<void>;
  /** Mandatory synchronous fence run before every scoped read or mutation. */
  assertCurrentAuthoritySync: () => void;
  /** Optional request metadata; background execution deliberately omits it. */
  request?: Request;
  /** Frozen policy properties captured with background actor authority. */
  userProperties?: Readonly<Record<string, string>>;
}

/** Guardian compiler capabilities safe inside a sealed authority projection. */
export type AuthorityScopedAuthServices = Pick<
  ServerAuthServices,
  'authorization' | 'authorizationKernel' | 'getAuthorizationKernel'
>;

/** Scope-attributed emitters safe inside a sealed authority projection. */
export type AuthorityScopedObservabilityServices = Pick<
  ServerObservabilityServices,
  'emitCode' | 'emitEvent' | 'error' | 'info' | 'warn'
>;

/**
 * Scope-closed service projection shared by verified machines and durable work.
 * Raw persistence, registries, global runtimes, and `unsafe` are deliberately
 * absent from this public contract because strict projections reject them.
 */
export interface AuthorityScopedServerServices {
  readonly access: RequestAuthorizationAccess;
  readonly scope: ServiceDataScope;
  /** Tenant-file data client, or null outside tenant-database isolation. */
  readonly data: AsyncDatabaseClient | null;
  readonly auth: AuthorityScopedAuthServices;
  readonly storage: ScopedStorageService | null;
  readonly notifications: ScopedNotificationService | null;
  readonly rooms: ScopedRoomService | null;
  /** Scope-closed workflow facade shared with managed workflow activities. */
  readonly workflows: ScopedWorkflowService | null;
  readonly pdf: ScopedPdfService | null;
  readonly observability: AuthorityScopedObservabilityServices;
}
