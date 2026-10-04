import { describe, expect, test } from 'bun:test';

import type { DatabaseAutomationSourceRecord } from '../../database-automations/automation-source-catalog-contract';
import type { ClaimedDatabaseAutomationDelivery } from '../../database-automations/automation-outbox-contracts';
import type {
  WorkflowSystemEventDeliveryMutation,
  WorkflowSystemEventDeliveryOptions,
} from '../../workflows/workflow-system-event-delivery-contract';
import {
  createDatabaseAutomationExecutionServiceProvider,
} from './database-automation-execution-services';
import type { ServerRouteServices } from './server-services';

describe('database automation execution services', () => {
  test('projects a source-bound scope and exact idempotent Torrent delivery', async () => {
    const calls: Array<{
      instanceId: string;
      eventName: string;
      payload: unknown;
      options: WorkflowSystemEventDeliveryOptions;
      mutation: WorkflowSystemEventDeliveryMutation;
    }> = [];
    let authorityChecks = 0;
    const provider = createDatabaseAutomationExecutionServiceProvider({
      source: source('tenant'),
      assertCurrentAuthority: () => {
        authorityChecks += 1;
      },
      services: serviceFixture(async (
        instanceId,
        eventName,
        payload,
        options,
        mutation = {},
      ) => {
        calls.push({ instanceId, eventName, payload, options, mutation });
        mutation.assertCurrentAuthority?.();
        return {
          eventId: 'event-one',
          instanceId,
          eventName,
          createdAt: '2026-10-03T00:00:00.000Z',
        };
      }),
    });
    const controller = new AbortController();
    const lease = await provider.create(delivery(), controller.signal);

    expect(lease.zero.scope).toMatchObject({
      scopeKind: 'tenant',
      scopeId: 'tenant-one',
      tenantId: 'tenant-one',
    });
    expect('torrent' in lease.zero).toBe(true);
    const first = await lease.zero.torrent.deliverEvent(
      'workflow-one',
      'webhook.completed',
      { status: 'ok' },
      { key: 'resume' },
    );
    const replay = await lease.zero.torrent.deliverEvent(
      'workflow-one',
      'webhook.completed',
      { status: 'ok' },
      { key: 'resume' },
    );

    expect(first).toEqual(replay);
    expect(calls).toHaveLength(2);
    expect(calls[0]!.options).toMatchObject({
      principal: 'reactivedb-automation',
      scope: {
        scopeKind: 'tenant',
        tenantId: 'tenant-one',
      },
    });
    expect(calls[0]!.options.idempotencyKey).toMatch(/^dba:[a-f0-9]{64}$/);
    expect(calls[0]!.mutation.assertCurrentAuthority).toBeFunction();
    expect(calls[1]!.options.idempotencyKey)
      .toBe(calls[0]!.options.idempotencyKey);
    expect(authorityChecks).toBeGreaterThanOrEqual(5);
    await lease.close();
    expect(() => lease.assertCurrentAuthority()).toThrow(expect.objectContaining({
      code: 'DATABASE_AUTHORITY_CHANGED',
    }));
    await expect(lease.zero.torrent.deliverEvent(
      'workflow-one',
      'webhook.completed',
    )).rejects.toMatchObject({ code: 'DATABASE_AUTHORITY_CHANGED' });
    expect(calls).toHaveLength(2);
  });

  test('derives separate bounded keys and rejects invalid discriminators', async () => {
    const keys: string[] = [];
    const lease = await createDatabaseAutomationExecutionServiceProvider({
      source: source('application'),
      assertCurrentAuthority: () => undefined,
      services: serviceFixture(async (instanceId, eventName, _payload, options) => {
        keys.push(options.idempotencyKey);
        return {
          eventId: `event-${keys.length}`,
          instanceId,
          eventName,
          createdAt: '2026-10-03T00:00:00.000Z',
        };
      }),
    }).create(delivery(), new AbortController().signal);

    await lease.zero.torrent.deliverEvent('one', 'resume', null);
    await lease.zero.torrent.deliverEvent('one', 'resume', null, { key: 'second' });
    expect(keys[0]).not.toBe(keys[1]);
    await expect(lease.zero.torrent.deliverEvent(
      'one',
      'resume',
      null,
      { key: 'not valid whitespace' },
    )).rejects.toMatchObject({ code: 'DATABASE_PAYLOAD_INVALID' });
  });

  test('fences calls when execution aborts and reports an unavailable Torrent', async () => {
    const controller = new AbortController();
    const lease = await createDatabaseAutomationExecutionServiceProvider({
      source: source('application'),
      assertCurrentAuthority: () => undefined,
      services: serviceFixture(null),
    }).create(delivery(), controller.signal);

    await expect(lease.zero.torrent.deliverEvent('one', 'resume'))
      .rejects.toMatchObject({ code: 'DATABASE_OPERATION_UNSUPPORTED' });
    controller.abort();
    await expect(lease.zero.torrent.deliverEvent('one', 'resume'))
      .rejects.toMatchObject({ code: 'DATABASE_AUTHORITY_CHANGED' });
  });
});

function source(
  kind: 'application' | 'tenant',
): DatabaseAutomationSourceRecord {
  return Object.freeze({
    sourceRef: 'a'.repeat(64),
    sourceKind: kind,
    logicalSourceId: kind === 'tenant' ? 'tenant-one' : 'application',
    authority: kind === 'tenant'
      ? {
          scopeKind: 'tenant' as const,
          scopeId: 'tenant-one',
          tenantId: 'tenant-one',
        }
      : {
          scopeKind: 'application' as const,
          scopeId: 'application' as const,
          tenantId: null,
        },
    status: 'active',
    revision: 1,
    ordinal: 1,
    registeredAt: 1,
    updatedAt: 1,
  });
}

function delivery(): ClaimedDatabaseAutomationDelivery {
  return Object.freeze({
    deliveryId: 'delivery-one',
    invocationId: 'invocation-one',
    triggerIdentity: 'trigger:orders.changed@1',
    functionIdentity: 'function:orders.resume@1',
    manifestFingerprint: `sha256:${'a'.repeat(64)}`,
    realmName: 'application',
    realmFingerprint: `sha256:${'a'.repeat(64)}`,
    sourceSequence: 1,
    sourceTable: 'orders',
    sourceOperation: 'update',
    sourceRowId: 'order-one',
    input: null,
    status: 'processing',
    attemptCount: 1,
    maxAttempts: 20,
    availableAt: 1,
    createdAt: 1,
    updatedAt: 1,
    completedAt: null,
    lastErrorCode: null,
    insertionOrdinal: 1,
    leaseOwner: 'worker-one',
    leaseToken: 'lease-one',
    leaseExpiresAt: 2_000,
  });
}

function serviceFixture(
  deliver: null | ((
    instanceId: string,
    eventName: string,
    payload: unknown,
    options: WorkflowSystemEventDeliveryOptions,
    mutation?: WorkflowSystemEventDeliveryMutation,
  ) => Promise<{
    eventId: string;
    instanceId: string;
    eventName: string;
    createdAt: string;
  }>),
): ServerRouteServices {
  const unavailable = (): never => {
    throw new Error('not used');
  };
  return {
    databases: null,
    auth: {
      authorization: null,
      authorizationKernel: null,
      roles: null,
      roleService: null,
      store: null,
      userStore: null,
      tokens: null,
      tokenService: null,
      requestCredentialResolver: null,
      getStore: () => null,
      getUserStore: () => null,
      getTokenService: () => null,
      getRequestCredentialResolver: () => null,
      getAuthorizationKernel: () => null,
      getRoleService: () => null,
    },
    storage: null,
    notifications: null,
    rooms: null,
    pdf: null,
    workflows: deliver
      ? ({ deliverEventAsSystem: deliver } as ServerRouteServices['workflows'])
      : null,
    observability: {
      runtime: {} as never,
      sink: {} as never,
      store: null,
      getRuntime: unavailable,
      getSink: unavailable,
      getStore: () => null,
      emitCode: (() => undefined) as never,
      emitEvent: (() => undefined) as never,
      error: (() => undefined) as never,
      info: (() => undefined) as never,
      warn: (() => undefined) as never,
    },
  } as unknown as ServerRouteServices;
}
