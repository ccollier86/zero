import { afterEach, describe, expect, test } from 'bun:test';

import {
  applicationServiceDataScope,
  trustedSystemServiceDataScope,
} from '../auth/service-data-scope';
import { MemoryEventStore } from '../observability/memory-event-store';
import { OBS_CODES } from '../observability/codes';
import { ZERO_OBSERVABILITY_RUNTIME } from '../runtime/service-keys';
import { ZeroAppRuntime } from '../runtime/zero-app-runtime';
import { createReactiveDB, type ReactiveDB } from '../sync/reactive-db';
import { createWorkflowObservability } from './workflow-observability';
import { validateWorkflowGraphEventState } from './workflow-event-persisted-state';
import { WorkflowError } from './workflow-error';
import { WorkflowRegistry } from './workflow-registry';
import { defineWorkflowTables } from './workflow-schema';
import { WorkflowService } from './workflow-service';

const databases: ReactiveDB[] = [];
const services: WorkflowService[] = [];

afterEach(async () => {
  await Promise.allSettled(services.splice(0).map((service) => service.dispose()));
  for (const db of databases.splice(0)) db.dispose();
});

describe('idempotent Torrent system event delivery', () => {
  test('commits one event and returns its exact receipt across concurrent replays', async () => {
    const { db, service, events } = fixture();
    const instanceId = await service.start('system-event-wait');
    const options = systemOptions('delivery:concurrent');
    const deliveries = await Promise.all(Array.from({ length: 40 }, () =>
      service.deliverEventAsSystem(
        instanceId,
        'continue',
        { z: 2, a: { y: true, x: 1 } },
        options,
      )));

    expect(new Set(deliveries.map((entry) => JSON.stringify(entry))).size).toBe(1);
    const reordered = await service.deliverEventAsSystem(
      instanceId,
      'continue',
      { a: { x: 1, y: true }, z: 2 },
      options,
    );
    expect(reordered).toEqual(deliveries[0]);
    expect(service.get(instanceId)?.status).toBe('completed');
    expect(count(db, 'workflow_events', instanceId)).toBe(1);
    expect(count(db, '_workflow_event_delivery', instanceId)).toBe(1);
    expect(count(db, '_workflow_system_event_receipts', instanceId)).toBe(1);
    expect(count(db, '_workflow_event_authorities', null)).toBe(1);
    expect(db.prepare(`SELECT total_count, queued_count
      FROM _workflow_event_usage WHERE instance_id = ?`).get(instanceId)).toEqual({
      total_count: 1,
      queued_count: 0,
    });
    expect(events.query({ code: OBS_CODES.WORKFLOW_SYSTEM_EVENT_DELIVERED.code }).count)
      .toBe(1);
    expect(events.query({ code: OBS_CODES.WORKFLOW_SYSTEM_EVENT_REPLAYED.code }).count)
      .toBe(40);
  });

  test('rejects changed commands deterministically without disclosing key or payload', async () => {
    const { db, service, events } = fixture();
    const instanceId = await service.start('system-event-wait');
    const options = systemOptions('delivery:conflict');
    await service.deliverEventAsSystem(instanceId, 'continue', { value: 1 }, options);

    await expect(service.deliverEventAsSystem(
      instanceId,
      'continue',
      { value: 2 },
      options,
    )).rejects.toMatchObject({
      code: 'WORKFLOW_EVENT_IDEMPOTENCY_CONFLICT',
      status: 409,
      retryable: false,
    });
    await expect(service.deliverEventAsSystem(
      instanceId,
      'continue',
      { value: 1 },
      { ...options, reason: 'A changed privileged reason' },
    )).rejects.toMatchObject({ code: 'WORKFLOW_EVENT_IDEMPOTENCY_CONFLICT' });

    expect(count(db, 'workflow_events', instanceId)).toBe(1);
    expect(count(db, '_workflow_system_event_receipts', instanceId)).toBe(1);
    const conflicts = events.query({
      code: OBS_CODES.WORKFLOW_SYSTEM_EVENT_CONFLICT.code,
    }).events;
    expect(conflicts).toHaveLength(2);
    expect(JSON.stringify(conflicts)).not.toContain(options.idempotencyKey);
    expect(JSON.stringify(conflicts)).not.toContain('"value":2');
  });

  test('rolls back event, authority, capacity, and receipt when receipt commit fails', async () => {
    const { db, service, events } = fixture();
    const instanceId = await service.start('system-event-wait');
    db.exec(`CREATE TRIGGER reject_system_event_receipt
      BEFORE INSERT ON _workflow_system_event_receipts
      BEGIN SELECT RAISE(ABORT, 'forced receipt failure'); END`);

    await expect(service.deliverEventAsSystem(
      instanceId,
      'continue',
      { durable: false },
      systemOptions('delivery:rollback'),
    )).rejects.toMatchObject({
      code: 'WORKFLOW_INTERNAL_ERROR',
      status: 500,
    });

    expect(count(db, 'workflow_events', instanceId)).toBe(0);
    expect(count(db, '_workflow_event_delivery', instanceId)).toBe(0);
    expect(count(db, '_workflow_event_authorities', null)).toBe(0);
    expect(count(db, '_workflow_system_event_receipts', instanceId)).toBe(0);
    expect(db.prepare(`SELECT total_count, total_bytes, queued_count, queued_bytes,
      revision FROM _workflow_event_usage WHERE instance_id = ?`).get(instanceId)).toEqual({
      total_count: 0,
      total_bytes: 0,
      queued_count: 0,
      queued_bytes: 0,
      revision: 0,
    });
    expect(events.query({ code: OBS_CODES.WORKFLOW_SYSTEM_EVENT_DELIVERED.code }).count)
      .toBe(0);
    expect(events.query({
      code: OBS_CODES.WORKFLOW_SYSTEM_EVENT_DELIVERY_FAILED.code,
    }).count).toBe(1);
  });

  test('runs the final authority fence inside the atomic delivery commit', async () => {
    const { db, service } = fixture();
    const instanceId = await service.start('system-event-wait');
    let checks = 0;

    await expect(service.deliverEventAsSystem(
      instanceId,
      'continue',
      { forbidden: true },
      systemOptions('delivery:authority-race'),
      {
        assertCurrentAuthority() {
          checks += 1;
          throw new WorkflowError(
            'Authority changed before commit',
            'WORKFLOW_AUTHORITY_CHANGED',
            409,
          );
        },
      },
    )).rejects.toMatchObject({
      code: 'WORKFLOW_AUTHORITY_CHANGED',
      status: 409,
    });

    expect(checks).toBe(1);
    expect(count(db, 'workflow_events', instanceId)).toBe(0);
    expect(count(db, '_workflow_event_delivery', instanceId)).toBe(0);
    expect(count(db, '_workflow_event_authorities', null)).toBe(0);
    expect(count(db, '_workflow_system_event_receipts', instanceId)).toBe(0);
  });

  test('re-kicks a committed event when its first post-commit dispatch was interrupted', async () => {
    const { db, service, calls } = fixture();
    const instanceId = await service.start('system-event-wait');
    const hooks = systemDeliveryHooks(service);
    const advance = hooks.advance;
    const interrupted = new Error('simulated dispatch interruption');
    hooks.advance = async () => {
      throw interrupted;
    };

    const first = service.deliverEventAsSystem(
      instanceId,
      'continue',
      { recovered: true },
      systemOptions('delivery:re-kick'),
    );
    await expect(first).rejects.toBe(interrupted);
    expect(count(db, 'workflow_events', instanceId)).toBe(1);
    expect(count(db, '_workflow_system_event_receipts', instanceId)).toBe(1);
    expect(service.getSteps(instanceId)[0]?.status).toBe('waiting');
    expect(calls.value).toBe(0);

    hooks.advance = advance;
    const replay = await service.deliverEventAsSystem(
      instanceId,
      'continue',
      { recovered: true },
      systemOptions('delivery:re-kick'),
    );
    expect(replay.instanceId).toBe(instanceId);
    expect(service.get(instanceId)?.status).toBe('completed');
    expect(calls.value).toBe(1);
    expect(count(db, 'workflow_events', instanceId)).toBe(1);
  });

  test('replays the same durable acknowledgement after service replacement', async () => {
    const { db, service, registry, observability } = fixture();
    const instanceId = await service.start('system-event-wait');
    service.pause(instanceId);
    const options = systemOptions('delivery:restart');
    const first = await service.deliverEventAsSystem(
      instanceId,
      'continue',
      { restart: true },
      options,
    );
    await service.dispose();

    const replacement = new WorkflowService(db, registry, {
      wakeTimer: false,
      observability,
    });
    services.push(replacement);
    const replay = await replacement.deliverEventAsSystem(
      instanceId,
      'continue',
      { restart: true },
      options,
    );
    expect(replay).toEqual(first);
    expect(count(db, 'workflow_events', instanceId)).toBe(1);
    expect(count(db, '_workflow_system_event_receipts', instanceId)).toBe(1);
    await replacement.resume(instanceId);
    expect(replacement.get(instanceId)?.status).toBe('completed');
  });

  test('isolates receipt namespaces and replay authority by exact tenant scope', async () => {
    const { db, service } = fixture('multi');
    const tenantA = trustedSystemServiceDataScope({
      scopeKind: 'tenant', tenantId: 'tenant-a',
    });
    const tenantB = trustedSystemServiceDataScope({
      scopeKind: 'tenant', tenantId: 'tenant-b',
    });
    const runA = await service.start('system-event-wait', {}, undefined, tenantA);
    const runB = await service.start('system-event-wait', {}, undefined, tenantB);
    service.pause(runA, tenantA);
    service.pause(runB, tenantB);
    const shared = {
      principal: 'tenant-event-bridge',
      reason: 'Test tenant-scoped durable event delivery',
      idempotencyKey: 'delivery:same-logical-key',
    } as const;

    const resultA = await service.deliverEventAsSystem(
      runA, 'continue', { tenant: 'a' }, { ...shared, scope: tenantA },
    );
    const resultB = await service.deliverEventAsSystem(
      runB, 'continue', { tenant: 'b' }, { ...shared, scope: tenantB },
    );
    expect(resultA.eventId).not.toBe(resultB.eventId);
    expect(db.prepare(`SELECT tenant_id FROM _workflow_system_event_receipts
      ORDER BY tenant_id`).all()).toEqual([
      { tenant_id: 'tenant-a' },
      { tenant_id: 'tenant-b' },
    ]);
    await expect(service.deliverEventAsSystem(
      runA, 'continue', { tenant: 'a' }, { ...shared, scope: tenantB },
    )).rejects.toMatchObject({ code: 'WORKFLOW_NOT_FOUND', status: 404 });
    expect(count(db, 'workflow_events', null)).toBe(2);
  });

  test('requires a bounded portable idempotency key before any mutation', async () => {
    const { db, service } = fixture();
    const instanceId = await service.start('system-event-wait');
    for (const idempotencyKey of ['', ' leading', 'unsafe/key', 'x'.repeat(129)]) {
      await expect(service.deliverEventAsSystem(
        instanceId,
        'continue',
        null,
        { ...systemOptions('valid'), idempotencyKey },
      )).rejects.toMatchObject({
        code: 'WORKFLOW_EVENT_IDEMPOTENCY_INVALID',
        status: 422,
      });
    }
    expect(count(db, 'workflow_events', instanceId)).toBe(0);
    expect(count(db, '_workflow_system_event_receipts', instanceId)).toBe(0);
  });

  test('keeps receipts immutable and fails recovery on a corrupted command binding', async () => {
    const { db, service } = fixture();
    const instanceId = await service.start('system-event-wait');
    service.pause(instanceId);
    await service.deliverEventAsSystem(
      instanceId,
      'continue',
      { valid: true },
      systemOptions('delivery:integrity'),
    );

    expect(() => db.prepare(`UPDATE _workflow_system_event_receipts
      SET command_fingerprint = ? WHERE instance_id = ?`)
      .run('0'.repeat(64), instanceId)).toThrow(/receipt is immutable/u);
    expect(() => db.prepare(`DELETE FROM _workflow_system_event_receipts
      WHERE instance_id = ?`).run(instanceId)).toThrow(/receipt is immutable/u);
    db.exec('DROP TRIGGER trg_workflow_system_event_receipt_immutable');
    db.prepare(`UPDATE _workflow_system_event_receipts
      SET command_fingerprint = ? WHERE instance_id = ?`)
      .run('0'.repeat(64), instanceId);

    expect(() => validateWorkflowGraphEventState(db, instanceId)).toThrow(
      expect.objectContaining({ code: 'WORKFLOW_STATE_INVALID', status: 500 }),
    );
  });
});

function fixture(tenancyMode: 'single' | 'multi' = 'single'): {
  db: ReactiveDB;
  service: WorkflowService;
  events: MemoryEventStore;
  calls: { value: number };
  registry: WorkflowRegistry;
  observability: ReturnType<typeof createWorkflowObservability>;
} {
  const db = createReactiveDB({ mode: 'memory' });
  databases.push(db);
  defineWorkflowTables(db);
  const registry = new WorkflowRegistry();
  const calls = { value: 0 };
  registry.registerHandler('system-event-handler', async () => {
    calls.value += 1;
    return { handled: calls.value };
  });
  registry.create({
    name: 'system-event-wait',
    steps: [{
      name: 'Wait for system event',
      handler: 'system-event-handler',
      waitFor: 'continue',
    }],
  });
  const events = new MemoryEventStore();
  const runtime = new ZeroAppRuntime('workflow-system-event-test');
  runtime.set(ZERO_OBSERVABILITY_RUNTIME, {
    sink: events,
    store: events,
    config: { console: false, store: events },
  });
  const observability = createWorkflowObservability(db, runtime);
  const service = new WorkflowService(db, registry, {
    tenancyMode,
    wakeTimer: false,
    observability,
  });
  services.push(service);
  return { db, service, events, calls, registry, observability };
}

function systemOptions(idempotencyKey: string) {
  return {
    principal: 'system-event-test',
    reason: 'Exercise idempotent privileged event delivery',
    scope: applicationServiceDataScope(),
    idempotencyKey,
  } as const;
}

function systemDeliveryHooks(service: WorkflowService): {
  advance(instanceId: string): Promise<void>;
} {
  return (service as unknown as {
    systemEventDeliveries: {
      hooks: { advance(instanceId: string): Promise<void> };
    };
  }).systemEventDeliveries.hooks;
}

function count(db: ReactiveDB, table: string, instanceId: string | null): number {
  const query = instanceId === null
    ? `SELECT COUNT(*) AS count FROM ${table}`
    : `SELECT COUNT(*) AS count FROM ${table} WHERE instance_id = ?`;
  const row = instanceId === null
    ? db.prepare(query).get()
    : db.prepare(query).get(instanceId);
  return Number((row as { count: number }).count);
}
