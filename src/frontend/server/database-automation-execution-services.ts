/** Scope-fenced managed services for durable ReactiveDB functions. */

import type { RequestAuthorizationAccess } from '../../auth/authorization-access';
import { trustedSystemServiceDataScope, type ServiceDataScope } from '../../auth/service-data-scope';
import { AuthError } from '../../auth/types';
import type { DatabaseAutomationSourceRecord } from '../../database-automations/automation-source-catalog-contract';
import type {
  DatabaseAutomationExecutionServiceProvider,
} from '../../database-automations/database-automation-delivery-contracts';
import { DatabaseError } from '../../databases/database-error';
import type { ZeroAppRuntime } from '../../runtime/zero-app-runtime';
import {
  createDatabaseAutomationTorrentService,
  type DatabaseAutomationTorrentService,
} from './database-automation-torrent-services';
import type { AuthorityScopedServerServices } from './server-request-services';
import { createInternalAuthorityScopedServerServices } from './server-request-services/create-request-services';
import {
  createLazyServerRouteServices,
  type ServerRouteServices,
} from './server-services';

export type { DatabaseAutomationTorrentService } from './database-automation-torrent-services';

/** Managed `ctx.zero` projection supplied to durable database functions. */
export interface DatabaseAutomationExecutionServerServices
  extends AuthorityScopedServerServices {
  readonly torrent: DatabaseAutomationTorrentService;
}

export interface CreateDatabaseAutomationExecutionServiceProviderOptions {
  readonly source: DatabaseAutomationSourceRecord;
  /** Revalidate catalog state and tenant eligibility from trusted server data. */
  readonly assertCurrentAuthority: () => void;
  readonly runtime?: ZeroAppRuntime;
  readonly services?: ServerRouteServices;
}

/** Create one source-bound provider; handlers can never select another scope. */
export function createDatabaseAutomationExecutionServiceProvider(
  options: CreateDatabaseAutomationExecutionServiceProviderOptions,
): DatabaseAutomationExecutionServiceProvider<
  DatabaseAutomationExecutionServerServices
> {
  const services = options.services
    ?? createLazyServerRouteServices(options.runtime);
  const scope = sourceScope(options.source);

  const provider: DatabaseAutomationExecutionServiceProvider<
    DatabaseAutomationExecutionServerServices
  > = {
    create(delivery, signal) {
      let closed = false;
      const assertCurrentAuthority = (): void => {
        if (closed || signal.aborted) throw authorityChanged();
        options.assertCurrentAuthority();
      };
      assertCurrentAuthority();
      const projected = createInternalAuthorityScopedServerServices({
        access: systemAccess(),
        services,
        scope,
        assertCurrentAuthority: async () => assertCurrentAuthority(),
        assertCurrentAuthoritySync: assertCurrentAuthority,
        allowUnsafe: false,
        strict: true,
        privilegedSystem: true,
        auditProvenance: 'system',
      });
      const torrent = createDatabaseAutomationTorrentService(
        services,
        scope,
        delivery,
        assertCurrentAuthority,
      );
      return Object.freeze({
        zero: withTorrent(projected, torrent),
        assertCurrentAuthority,
        close(): void {
          closed = true;
        },
      });
    },
  };
  return Object.freeze(provider);
}

function withTorrent(
  services: AuthorityScopedServerServices,
  torrent: DatabaseAutomationTorrentService,
): DatabaseAutomationExecutionServerServices {
  return new Proxy(services as DatabaseAutomationExecutionServerServices, {
    get(target, property, receiver) {
      if (property === 'torrent') return torrent;
      return Reflect.get(target, property, receiver);
    },
    has(target, property) {
      return property === 'torrent' || Reflect.has(target, property);
    },
    ownKeys(target) {
      return [...new Set([...Reflect.ownKeys(target), 'torrent'])];
    },
    getOwnPropertyDescriptor(target, property) {
      if (property === 'torrent') {
        return {
          configurable: true,
          enumerable: true,
          writable: false,
          value: torrent,
        };
      }
      return Reflect.getOwnPropertyDescriptor(target, property);
    },
  });
}

function sourceScope(source: DatabaseAutomationSourceRecord): ServiceDataScope {
  if (source.status !== 'active') throw authorityChanged();
  return source.authority.scopeKind === 'tenant'
    ? trustedSystemServiceDataScope({
        scopeKind: 'tenant',
        tenantId: source.authority.tenantId,
      })
    : trustedSystemServiceDataScope({ scopeKind: 'application' });
}

function systemAccess(): RequestAuthorizationAccess {
  const unavailable = (): never => {
    throw new AuthError(
      'System database automation is not an authenticated user',
      'UNAUTHORIZED',
      401,
    );
  };
  return Object.freeze({
    context: null,
    authorization: null,
    applicationAuthorization: null,
    authorize: unavailable,
    requireUser: unavailable,
    requirePlatformAdmin: unavailable,
    requireAuthorizationScope: unavailable,
    requireApplicationAuthorization: unavailable,
    requireTenant: unavailable,
    hasPermission: () => false,
    requirePermission: unavailable,
    requireAnyPermission: unavailable,
  });
}

function authorityChanged(): DatabaseError {
  return new DatabaseError(
    'DATABASE_AUTHORITY_CHANGED',
    'Database automation source authority changed during execution.',
    { retryable: false, outcome: 'not-started' },
  );
}
