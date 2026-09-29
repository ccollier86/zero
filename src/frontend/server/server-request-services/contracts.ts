import type { RequestAuthorizationAccess } from '../../../auth/authorization-access';
import type { ServiceDataScope } from '../../../auth/service-data-scope';
import type { AsyncDatabaseClient } from '../../../databases/database-operations';
import type { ServerRouteServices } from '../server-services';

/** App services projected into one request's immutable authorization scope. */
export interface ServerRequestServices extends ServerRouteServices {
  /** The same live authorization facade exposed on the Elysia request. */
  readonly access: RequestAuthorizationAccess;
  /** Validated data boundary, or null for a multi-tenant selection/anonymous session. */
  readonly scope: ServiceDataScope | null;
  /** Tenant-file data client, or null outside tenant-database isolation. */
  readonly data: AsyncDatabaseClient | null;
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
  /** Tenant-file data client, or null outside tenant-database isolation. */
  readonly data: AsyncDatabaseClient | null;
}
