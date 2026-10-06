/** Scoped-adapter tests; durable atomic receipt behavior is tested in Torrent. */

import { describe, expect, test } from 'bun:test';
import { trustedSystemServiceDataScope } from '../../auth/service-data-scope';
import type { ClaimedDatabaseAutomationDelivery } from '../../database-automations/automation-outbox-contracts';
import { DatabaseError } from '../../databases/database-error';
import type { WorkflowStartOptions } from '../../workflows/workflow-start-options';
import type {
  WorkflowSystemStartMutation,
  WorkflowSystemStartOptions,
} from '../../workflows/workflow-system-start-contract';
import { createDatabaseAutomationTorrentService } from './database-automation-torrent-services';
import type { ServerRouteServices } from './server-services';

describe('delivery-bound Torrent start adapter', () => {
  test('forwards exact input/options, source scope and a stable final commit fence', async () => {
    const calls: Array<{
      name: string;
      input: unknown;
      system: WorkflowSystemStartOptions;
      options: WorkflowStartOptions;
    }> = [];
    let authorityChecks = 0;
    let commitFenceChecks = 0;
    const { torrent } = fixture({
      assertAuthority: () => { authorityChecks += 1; },
      start: async (name, input, system, options, mutation) => {
        mutation.assertCurrentAuthority?.();
        commitFenceChecks += 1;
        calls.push({ name, input, system, options });
        return acknowledgement;
      },
    });
    const input = { orderId: 'order-one', parameters: { recipient: 'synthetic' } };
    const options = {
      key: 'fulfillment', version: 3,
      initialMemory: { orderId: 'order-one' },
      memoryLimits: { maxEntries: 20 },
    };
    expect(await torrent.start('orders.fulfill', input, options)).toEqual(acknowledgement);
    expect(await torrent.start('orders.fulfill', input, options)).toEqual(acknowledgement);
    expect(calls).toHaveLength(2);
    expect(calls[0]).toMatchObject({
      name: 'orders.fulfill', input,
      options: { version: 3, initialMemory: options.initialMemory, memoryLimits: options.memoryLimits },
      system: {
        principal: 'reactivedb-automation',
        scope: { scopeKind: 'tenant', tenantId: 'organization-one' },
      },
    });
    expect(calls[0]!.options).not.toHaveProperty('key');
    expect(calls[0]!.system.idempotencyKey).toMatch(/^dba:[a-f0-9]{64}$/u);
    expect(calls[1]!.system.idempotencyKey).toBe(calls[0]!.system.idempotencyKey);
    expect(commitFenceChecks).toBe(2);
    expect(authorityChecks).toBe(6);
  });

  test('separates different intended starts and different outbox deliveries', async () => {
    const keys: string[] = [];
    const start: Start = async (_name, _input, system) => {
      keys.push(system.idempotencyKey);
      return acknowledgement;
    };
    const one = fixture({ deliveryId: 'delivery-one', start }).torrent;
    const retry = fixture({ deliveryId: 'delivery-one', start }).torrent;
    const other = fixture({ deliveryId: 'delivery-two', start }).torrent;
    await one.start('orders.fulfill');
    await retry.start('orders.fulfill');
    await one.start('orders.fulfill', null, { key: 'second' });
    await other.start('orders.fulfill');
    expect(keys[0]).toBe(keys[1]);
    expect(new Set(keys).size).toBe(3);
    await expect(one.start('orders.fulfill', null, { key: 'invalid key' }))
      .rejects.toMatchObject({ code: 'DATABASE_PAYLOAD_INVALID' });
    await expect(one.start('orders.fulfill', null, { key: 'a'.repeat(65) }))
      .rejects.toMatchObject({ code: 'DATABASE_PAYLOAD_INVALID' });
    expect(keys).toHaveLength(4);
  });

  test('rejects a retired execution before admission, at commit and after await', async () => {
    let valid = true;
    let calls = 0;
    const assertAuthority = (): void => {
      if (!valid) throw new DatabaseError('DATABASE_AUTHORITY_CHANGED', 'Retired execution');
    };
    const before = fixture({ assertAuthority, start: async () => {
      calls += 1;
      return acknowledgement;
    } }).torrent;
    valid = false;
    await expect(before.start('orders.fulfill'))
      .rejects.toMatchObject({ code: 'DATABASE_AUTHORITY_CHANGED' });
    expect(calls).toBe(0);

    valid = true;
    const commit = fixture({ assertAuthority, start: async (_name, _input, _system, _options, mutation) => {
      valid = false;
      mutation.assertCurrentAuthority?.();
      return acknowledgement;
    } }).torrent;
    await expect(commit.start('orders.fulfill'))
      .rejects.toMatchObject({ code: 'WORKFLOW_AUTHORITY_CHANGED', status: 409 });

    valid = true;
    const completion = fixture({ assertAuthority, start: async () => {
      valid = false;
      return acknowledgement;
    } }).torrent;
    await expect(completion.start('orders.fulfill'))
      .rejects.toMatchObject({ code: 'DATABASE_AUTHORITY_CHANGED' });
  });

  test('uses the normal retryable unavailable service error', async () => {
    const { torrent } = fixture({ unavailable: true });
    await expect(torrent.start('orders.fulfill'))
      .rejects.toMatchObject({
        code: 'DATABASE_OPERATION_UNSUPPORTED', retryable: true, outcome: 'not-started',
      });
  });
});

const acknowledgement = Object.freeze({
  instanceId: 'workflow-one', name: 'orders.fulfill',
  createdAt: '2026-10-06T00:00:00.000Z', definitionVersion: 3,
});

type Start = (
  name: string,
  input: unknown,
  system: WorkflowSystemStartOptions,
  options: WorkflowStartOptions,
  mutation: WorkflowSystemStartMutation,
) => Promise<typeof acknowledgement>;

function fixture(options: {
  deliveryId?: string;
  start?: Start;
  assertAuthority?: () => void;
  unavailable?: boolean;
} = {}) {
  const services = {
    workflows: options.unavailable ? null : {
      startAsSystemOnce: options.start ?? (async () => acknowledgement),
    },
  } as unknown as ServerRouteServices;
  return {
    torrent: createDatabaseAutomationTorrentService(
      services,
      trustedSystemServiceDataScope({ scopeKind: 'tenant', tenantId: 'organization-one' }),
      { deliveryId: options.deliveryId ?? 'delivery-one' } as ClaimedDatabaseAutomationDelivery,
      options.assertAuthority ?? (() => undefined),
    ),
  };
}
