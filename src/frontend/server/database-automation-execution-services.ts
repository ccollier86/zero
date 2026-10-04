/** Scope-fenced managed services for durable ReactiveDB functions. */

import type { RequestAuthorizationAccess } from '../../auth/authorization-access';
import {
  trustedSystemServiceDataScope,
  type ServiceDataScope,
} from '../../auth/service-data-scope';
import { AuthError } from '../../auth/types';
import type { DatabaseAutomationSourceRecord } from '../../database-automations/automation-source-catalog-contract';
import type {
  ClaimedDatabaseAutomationDelivery,
} from '../../database-automations/automation-outbox-contracts';
import type {
  DatabaseAutomationExecutionServiceProvider,
} from '../../database-automations/database-automation-delivery-contracts';
import { DatabaseError } from '../../databases/database-error';
import type { ZeroAppRuntime } from '../../runtime/zero-app-runtime';
import type {
  WorkflowSystemEventDeliveryResult,
} from '../../workflows/workflow-system-event-delivery-contract';
import { WorkflowError } from '../../workflows/workflow-error';
import type { AuthorityScopedServerServices } from './server-request-services';
import { createInternalAuthorityScopedServerServices } from './server-request-services/create-request-services';
import {
  createLazyServerRouteServices,
  type ServerRouteServices,
} from './server-services';

const TORRENT_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/u;

export interface DatabaseAutomationTorrentService {
  /**
   * Deliver an exact Torrent event. Zero derives permanent idempotency from
   * the outbox delivery plus the optional per-handler discriminator.
   */
  deliverEvent(
    instanceId: string,
    eventName: string,
    payload?: unknown,
    options?: Readonly<{ key?: string }>,
  ): Promise<WorkflowSystemEventDeliveryResult>;
}

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
      const torrent = createTorrentService(
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

function createTorrentService(
  services: ServerRouteServices,
  scope: ServiceDataScope,
  delivery: ClaimedDatabaseAutomationDelivery,
  assertCurrentAuthority: () => void,
): DatabaseAutomationTorrentService {
  const torrent: DatabaseAutomationTorrentService = {
    async deliverEvent(instanceId, eventName, payload, options = {}) {
      assertCurrentAuthority();
      const workflows = services.workflows;
      if (!workflows) {
        throw new DatabaseError(
          'DATABASE_OPERATION_UNSUPPORTED',
          'Torrent is unavailable to this database automation.',
          { retryable: true, outcome: 'not-started' },
        );
      }
      const key = normalizeTorrentKey(options.key);
      const assertWorkflowAuthority = (): void => {
        try {
          assertCurrentAuthority();
        } catch {
          throw new WorkflowError(
            'Database automation authority changed before Torrent event commit',
            'WORKFLOW_AUTHORITY_CHANGED',
            409,
          );
        }
      };
      const result = await workflows.deliverEventAsSystem(
        instanceId,
        eventName,
        payload,
        {
          principal: 'reactivedb-automation',
          reason: 'ReactiveDB durable function event delivery',
          scope,
          idempotencyKey: torrentIdempotencyKey(delivery.deliveryId, key),
        },
        { assertCurrentAuthority: assertWorkflowAuthority },
      );
      assertCurrentAuthority();
      return result;
    },
  };
  return Object.freeze(torrent);
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

function normalizeTorrentKey(value: unknown): string {
  if (value === undefined) return 'default';
  if (typeof value !== 'string' || !TORRENT_KEY_PATTERN.test(value)) {
    throw new DatabaseError(
      'DATABASE_PAYLOAD_INVALID',
      'Database automation Torrent key is invalid.',
      { retryable: false, outcome: 'not-started' },
    );
  }
  return value;
}

function torrentIdempotencyKey(deliveryId: string, key: string): string {
  return `dba:${new Bun.CryptoHasher('sha256')
    .update('zero.database-automation.torrent.v1\0')
    .update(deliveryId)
    .update('\0')
    .update(key)
    .digest('hex')}`;
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
