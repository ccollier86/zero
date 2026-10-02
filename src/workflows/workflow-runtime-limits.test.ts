/** Resource and identity boundaries for durable workflow execution. */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createReactiveDB, type ReactiveDB } from '../sync/reactive-db';
import { each, flow, step, waitFor } from './workflow-dsl';
import { expr } from './workflow-expression';
import { WorkflowRegistry } from './workflow-registry';
import { MAX_WORKFLOW_INSTANCE_RUNTIME_BYTES } from './workflow-runtime-budget';
import { MAX_WORKFLOW_RUNTIME_JSON_BYTES } from './workflow-runtime-json';
import {
  MAX_WORKFLOW_EVENT_NAME_LENGTH,
  MAX_WORKFLOW_EVENT_QUEUE_BYTES,
  MAX_WORKFLOW_EVENT_TOTAL_COUNT,
} from './workflow-runtime-store';
import { defineWorkflowTables } from './workflow-schema';
import { WorkflowService } from './workflow-service';

let db: ReactiveDB;
let services: WorkflowService[];

beforeEach(() => {
  db = createReactiveDB({ mode: 'memory' });
  defineWorkflowTables(db);
  services = [];
});

afterEach(async () => {
  await Promise.allSettled(services.map((service) => service.dispose()));
  db.dispose();
});

describe('workflow durable resource limits', () => {
  test('enforces the shared JSON boundary for legacy and graph starts and outputs', async () => {
    const exact = exactLimitString();
    const over = `${exact}x`;
    const registry = new WorkflowRegistry();
    registry.registerHandler('legacy-echo', async ({ workflowInput }) => workflowInput);
    registry.registerHandler('legacy-over', async () => over);
    registry.registerActivity({ name: 'graph-echo', handler: async ({ workflowInput }) => workflowInput });
    registry.registerActivity({ name: 'graph-over', handler: async () => over });
    registry.create({ name: 'legacy-limit', steps: [{ name: 'echo', handler: 'legacy-echo' }] });
    registry.create({ name: 'legacy-output-limit', steps: [{ name: 'over', handler: 'legacy-over' }] });
    registry.create({ name: 'graph-limit', flow: flow(step('echo', 'graph-echo')) });
    registry.create({ name: 'graph-output-limit', flow: flow(step('over', 'graph-over')) });
    const service = track(new WorkflowService(db, registry));

    const legacyExact = await service.start('legacy-limit', exact);
    const graphExact = await service.start('graph-limit', exact);
    expect(service.get(legacyExact)?.status).toBe('completed');
    expect(service.get(graphExact)?.status).toBe('completed');

    const before = instanceCount();
    await expect(service.start('legacy-limit', over)).rejects.toMatchObject({
      code: 'WORKFLOW_INPUT_INVALID', status: 413,
    });
    await expect(service.start('graph-limit', over)).rejects.toMatchObject({
      code: 'WORKFLOW_INPUT_INVALID', status: 413,
    });
    expect(instanceCount()).toBe(before);

    const legacyOver = await service.start('legacy-output-limit');
    const graphOver = await service.start('graph-output-limit');
    expect(service.get(legacyOver)).toMatchObject({
      status: 'failed', error: 'Workflow handler output exceeds its byte limit',
    });
    expect(service.get(graphOver)).toMatchObject({ status: 'failed' });
    expect(service.getSteps(graphOver)[0]?.error).toBe(
      'Workflow activity output exceeds its byte limit',
    );
  });

  test('bounds event names and payloads atomically before durable delivery', async () => {
    const registry = waitingRegistry('event-value-limits');
    const service = track(new WorkflowService(db, registry));
    const instanceId = await service.start('event-value-limits');
    service.pause(instanceId);
    const exact = exactLimitString();

    expect(await service.sendEvent(instanceId, 'go', exact)).toBe(false);
    const before = eventCounts(instanceId);
    await expect(service.sendEvent(instanceId, 'go', `${exact}x`)).rejects.toMatchObject({
      code: 'WORKFLOW_EVENT_INVALID', status: 413,
    });
    await service.sendEvent(instanceId, 'x'.repeat(MAX_WORKFLOW_EVENT_NAME_LENGTH), null);
    await expect(service.sendEvent(
      instanceId,
      'x'.repeat(MAX_WORKFLOW_EVENT_NAME_LENGTH + 1),
      null,
    )).rejects.toMatchObject({ code: 'WORKFLOW_EVENT_INVALID', status: 422 });
    expect(eventCounts(instanceId)).toEqual({
      public: before.public + 1,
      private: before.private + 1,
    });
  });

  test('enforces the aggregate queued-byte boundary under concurrent sends and restart', async () => {
    const registry = waitingRegistry('event-queue-budget');
    const first = track(new WorkflowService(db, registry));
    const instanceId = await first.start('event-queue-budget');
    first.pause(instanceId);
    const exact = exactLimitString();
    const exactBytes = Buffer.byteLength(JSON.stringify(exact), 'utf8');
    expect(MAX_WORKFLOW_EVENT_QUEUE_BYTES / exactBytes).toBeInteger();
    const prefill = (MAX_WORKFLOW_EVENT_QUEUE_BYTES / exactBytes) - 1;
    for (let index = 0; index < prefill; index += 1) {
      await first.sendEvent(instanceId, 'unmatched', exact);
    }

    const outcomes = await Promise.allSettled([
      first.sendEvent(instanceId, 'unmatched', exact),
      first.sendEvent(instanceId, 'unmatched', exact),
    ]);
    expect(outcomes.filter((entry) => entry.status === 'fulfilled')).toHaveLength(1);
    const rejected = outcomes.find((entry) => entry.status === 'rejected') as PromiseRejectedResult;
    expect(rejected.reason).toMatchObject({
      code: 'WORKFLOW_EVENT_QUEUE_FULL', status: 429, retryable: true,
    });
    expect(eventCounts(instanceId)).toEqual({
      public: prefill + 1,
      private: prefill + 1,
    });

    await first.dispose();
    const second = track(new WorkflowService(db, registry));
    await expect(second.sendEvent(instanceId, 'unmatched', null)).rejects.toMatchObject({
      code: 'WORKFLOW_EVENT_QUEUE_FULL', status: 429,
    });
    expect(eventCounts(instanceId).public).toBe(prefill + 1);
  });

  test('bounds consumed event audit retention without partial public rows', async () => {
    const registry = waitingRegistry('event-retention-budget');
    const service = track(new WorkflowService(db, registry));
    const instanceId = await service.start('event-retention-budget');
    service.pause(instanceId);
    seedConsumedEvents(instanceId, MAX_WORKFLOW_EVENT_TOTAL_COUNT);
    const before = eventCounts(instanceId);

    await expect(service.sendEvent(instanceId, 'unmatched', null)).rejects.toMatchObject({
      code: 'WORKFLOW_EVENT_LIMIT_EXCEEDED', status: 409,
    });
    expect(eventCounts(instanceId)).toEqual(before);
  });

  test('rejects cross-instance event-delivery tampering before payload routing', async () => {
    const registry = waitingRegistry('event-identity');
    const service = track(new WorkflowService(db, registry));
    const first = await service.start('event-identity');
    const second = await service.start('event-identity');
    service.pause(first);
    service.pause(second);
    await service.sendEvent(first, 'go', { private: 'first' });

    expect(() => db.prepare(`UPDATE _workflow_event_delivery SET instance_id = ?
      WHERE instance_id = ?`).run(second, first)).toThrow(/delivery claim mismatch/);
    db.exec('DROP TRIGGER trg_workflow_event_delivery_identity_update');
    db.prepare(`UPDATE _workflow_event_delivery SET instance_id = ? WHERE instance_id = ?`)
      .run(second, first);
    await service.resume(second);
    expect(service.get(second)).toMatchObject({
      status: 'failed', error: 'Workflow event delivery identity is invalid',
    });
  });

  test('fails restart when a graph audit event loses its private delivery envelope', async () => {
    const registry = waitingRegistry('deleted-event-envelope');
    const first = track(new WorkflowService(db, registry));
    const instanceId = await first.start('deleted-event-envelope');
    first.pause(instanceId);
    await first.sendEvent(instanceId, 'go', { id: 'durable' }, 'owner');
    await first.dispose();

    db.prepare('DELETE FROM _workflow_event_delivery WHERE instance_id = ?').run(instanceId);
    db.prepare(`UPDATE _workflow_event_usage SET total_count = 0, total_bytes = 0,
      queued_count = 0, queued_bytes = 0, revision = 0 WHERE instance_id = ?`).run(instanceId);
    const second = track(new WorkflowService(db, registry));
    await expect(second.recoverInFlight()).rejects.toMatchObject({
      code: 'WORKFLOW_STATE_INVALID', status: 500,
    });
    expect(db.prepare(`SELECT COUNT(*) AS count FROM workflow_events
      WHERE instance_id = ?`).get(instanceId)).toEqual({ count: 1 });
  });

  test('fails restart without recreating a deleted event-usage counter', async () => {
    const registry = waitingRegistry('deleted-event-accounting');
    const first = track(new WorkflowService(db, registry));
    const instanceId = await first.start('deleted-event-accounting');
    await first.dispose();
    db.prepare('DELETE FROM _workflow_event_usage WHERE instance_id = ?').run(instanceId);

    const second = track(new WorkflowService(db, registry));
    await expect(second.recoverInFlight()).rejects.toMatchObject({
      code: 'WORKFLOW_STATE_INVALID', status: 500,
    });
    expect(db.prepare(`SELECT instance_id FROM _workflow_event_usage
      WHERE instance_id = ?`).get(instanceId)).toBeNull();
  });

  test('rejects malformed private event actor snapshots during restart preflight', async () => {
    const registry = waitingRegistry('event-actor-integrity');
    const first = track(new WorkflowService(db, registry));
    const instanceId = await first.start('event-actor-integrity');
    first.pause(instanceId);
    await first.sendEvent(
      instanceId,
      'go',
      { id: 'durable' },
      'owner',
      { actorId: 'owner', roles: ['reviewer'] },
    );
    await first.dispose();
    const actorBytes = Number((db.prepare(`SELECT actor_bytes FROM _workflow_event_delivery
      WHERE instance_id = ? LIMIT 1`).get(instanceId) as { actor_bytes: number }).actor_bytes);
    db.prepare(`UPDATE _workflow_event_delivery SET actor_json = ?
      WHERE instance_id = ?`).run('x'.repeat(actorBytes), instanceId);

    const second = track(new WorkflowService(db, registry));
    await expect(second.recoverInFlight()).rejects.toMatchObject({
      code: 'WORKFLOW_STATE_INVALID', status: 500,
    });
  });

  test('fails restart without recreating a deleted durable-runtime counter', async () => {
    const registry = waitingRegistry('deleted-runtime-accounting');
    const first = track(new WorkflowService(db, registry));
    const instanceId = await first.start('deleted-runtime-accounting');
    await first.dispose();
    db.prepare('DELETE FROM _workflow_runtime_usage WHERE instance_id = ?').run(instanceId);

    const second = track(new WorkflowService(db, registry));
    await expect(second.recoverInFlight()).rejects.toMatchObject({
      code: 'WORKFLOW_STATE_INVALID', status: 500,
    });
    expect(db.prepare(`SELECT instance_id FROM _workflow_runtime_usage
      WHERE instance_id = ?`).get(instanceId)).toBeNull();
  });

  test('rejects an oversized persisted graph value even with coherent aggregate accounting', async () => {
    const registry = waitingRegistry('oversized-persisted-value');
    const first = track(new WorkflowService(db, registry));
    const instanceId = await first.start('oversized-persisted-value');
    await first.dispose();
    const oversized = JSON.stringify('x'.repeat(MAX_WORKFLOW_RUNTIME_JSON_BYTES));
    expect(Buffer.byteLength(oversized, 'utf8')).toBeGreaterThan(
      MAX_WORKFLOW_RUNTIME_JSON_BYTES,
    );
    db.prepare(`UPDATE workflow_steps SET input = ?
      WHERE instance_id = ? AND parent_step_id IS NULL`).run(oversized, instanceId);
    db.prepare(`UPDATE _workflow_runtime_usage SET runtime_bytes = ?
      WHERE instance_id = ?`).run(durableRuntimeBytes(instanceId), instanceId);

    const second = track(new WorkflowService(db, registry));
    await expect(second.recoverInFlight()).rejects.toMatchObject({
      code: 'WORKFLOW_STATE_INVALID', status: 500,
    });
  });

  test('stops fan-out output amplification at the cumulative instance budget', async () => {
    const output = 'x'.repeat(900 * 1024);
    const registry = new WorkflowRegistry();
    let calls = 0;
    registry.registerActivity({
      name: 'large-item-output',
      handler: async ({ memory }) => {
        calls += 1;
        // This staged write must roll back when the same atomic commit cannot
        // reserve space for the activity output.
        memory!.set('marker', 'committed');
        return output;
      },
    });
    registry.create({
      name: 'fanout-budget',
      flow: flow(each(
        'items',
        expr.input('items'),
        flow(step('large-item', 'large-item-output', { retries: 1 })),
        { concurrency: 1 },
      )),
    });
    const service = track(new WorkflowService(db, registry));
    const instanceId = await service.start('fanout-budget', {
      items: Array.from({ length: 40 }, (_, index) => index),
    });

    expect(service.get(instanceId)?.status).toBe('failed');
    expect(calls).toBeLessThan(40);
    expect(durableRuntimeBytes(instanceId)).toBeLessThanOrEqual(
      MAX_WORKFLOW_INSTANCE_RUNTIME_BYTES,
    );
    expect(service.get(instanceId)?.error).toContain('durable runtime value capacity');
    const failedItem = db.prepare(`SELECT item_id FROM _workflow_each_items
      WHERE instance_id = ? AND status = 'failed' LIMIT 1`)
      .get(instanceId) as { item_id: string };
    expect(db.prepare(`SELECT memory_id FROM _workflow_memory
      WHERE instance_id = ? AND scope_id = ? LIMIT 1`)
      .get(instanceId, failedItem.item_id)).toBeNull();
  });

  test('bounds scratch-memory amplification across fan-out item namespaces', async () => {
    const registry = waitingRegistry('memory-fanout-budget');
    const service = track(new WorkflowService(db, registry));
    const instanceId = await service.start('memory-fanout-budget');
    service.pause(instanceId);
    const memory = service.getGraphRuntime().memory;
    const value = 'x'.repeat((64 * 1024) - 2);
    let writes = 0;
    let failure: unknown;
    for (let index = 0; index < 600; index += 1) {
      try {
        memory.set(
          { instanceId, kind: 'each-item', scopeId: `item-${index}` },
          'scratch',
          value,
        );
        writes += 1;
      } catch (error) {
        failure = error;
        break;
      }
    }

    expect(failure).toMatchObject({
      code: 'WORKFLOW_RUNTIME_LIMIT_EXCEEDED', status: 500,
    });
    expect(writes).toBeLessThan(600);
    expect(durableRuntimeBytes(instanceId)).toBeLessThanOrEqual(
      MAX_WORKFLOW_INSTANCE_RUNTIME_BYTES,
    );
    expect(Number((db.prepare(`SELECT COUNT(*) AS count FROM _workflow_memory
      WHERE instance_id = ?`).get(instanceId) as { count: number }).count)).toBe(writes);
  });
});

function waitingRegistry(name: string): WorkflowRegistry {
  const registry = new WorkflowRegistry();
  registry.create({ name, flow: flow(waitFor('wait', 'go')) });
  return registry;
}

function exactLimitString(): string {
  return 'x'.repeat(MAX_WORKFLOW_RUNTIME_JSON_BYTES - 2);
}

function track(service: WorkflowService): WorkflowService {
  services.push(service);
  return service;
}

function instanceCount(): number {
  return Number((db.prepare('SELECT COUNT(*) AS count FROM workflow_instances')
    .get() as { count: number }).count);
}

function eventCounts(instanceId: string): { public: number; private: number } {
  const count = (table: string) => Number((db.prepare(
    `SELECT COUNT(*) AS count FROM ${table} WHERE instance_id = ?`,
  ).get(instanceId) as { count: number }).count);
  return { public: count('workflow_events'), private: count('_workflow_event_delivery') };
}

function seedConsumedEvents(instanceId: string, count: number): void {
  db.transaction(() => {
    db.prepare(`WITH RECURSIVE seq(n) AS (
      SELECT 1 UNION ALL SELECT n + 1 FROM seq WHERE n < ?
    ) INSERT INTO workflow_events (
      event_id, instance_id, event_name, payload, sent_by, created_at
    ) SELECT printf('retained-%d', n), ?, 'old', NULL, NULL,
      printf('2030-01-01T00:00:%02d.000Z', n % 60) FROM seq`).run(count, instanceId);
    db.prepare(`WITH RECURSIVE seq(n) AS (
      SELECT 1 UNION ALL SELECT n + 1 FROM seq WHERE n < ?
    ) INSERT INTO _workflow_event_delivery (
      event_id, instance_id, event_name, claimed_by_step_id, claimed_at,
      actor_json, payload_bytes, actor_bytes, created_at
    ) SELECT printf('retained-%d', n), ?, 'old', printf('consumed:retained-%d', n),
      printf('2030-01-01T00:00:%02d.000Z', n % 60), NULL, 0, 0,
      printf('2030-01-01T00:00:%02d.000Z', n % 60) FROM seq`)
      .run(count, instanceId);
    db.prepare(`UPDATE _workflow_event_usage SET
      total_count = ?, total_bytes = 0, queued_count = 0, queued_bytes = 0,
      revision = ? WHERE instance_id = ?`).run(count, count * 3, instanceId);
  });
}

function durableRuntimeBytes(instanceId: string): number {
  const row = db.prepare(`SELECT COALESCE(SUM(bytes), 0) AS bytes FROM (
    SELECT length(CAST(COALESCE(input, '') AS BLOB))
      + length(CAST(COALESCE(output, '') AS BLOB)) AS bytes
    FROM workflow_instances WHERE instance_id = ?
    UNION ALL
    SELECT length(CAST(COALESCE(input, '') AS BLOB))
      + length(CAST(COALESCE(output, '') AS BLOB)) AS bytes
    FROM workflow_steps WHERE instance_id = ?
    UNION ALL
    SELECT length(CAST(COALESCE(input_json, '') AS BLOB))
      + length(CAST(COALESCE(output_json, '') AS BLOB)) AS bytes
    FROM _workflow_each_items WHERE instance_id = ?
    UNION ALL
    SELECT length(CAST(COALESCE(value_json, '') AS BLOB)) AS bytes
    FROM _workflow_memory WHERE instance_id = ?
    UNION ALL
    SELECT length(CAST(response.payload_json AS BLOB))
      + length(CAST(COALESCE(response.accepted_value_json, '') AS BLOB)) AS bytes
    FROM _workflow_interaction_responses AS response
    INNER JOIN workflow_interactions AS interaction
      ON interaction.interaction_id = response.interaction_id
    WHERE interaction.instance_id = ?
    UNION ALL
    SELECT length(CAST(COALESCE(detail.responder_policy_json, '') AS BLOB))
      + length(CAST(detail.response_schema_json AS BLOB))
      + length(CAST(COALESCE(detail.request_json, '') AS BLOB)) AS bytes
    FROM _workflow_interaction_details AS detail
    INNER JOIN workflow_interactions AS interaction
      ON interaction.interaction_id = detail.interaction_id
    WHERE interaction.instance_id = ?
  )`).get(
    instanceId, instanceId, instanceId, instanceId, instanceId, instanceId,
  ) as { bytes: number };
  return Number(row.bytes);
}
