/** Regression coverage for fail-closed private graph coordination state. */

import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { t } from 'elysia';
import { createReactiveDB, type ReactiveDB } from '../sync/reactive-db';
import {
  each,
  flow,
  requestAndWait,
  step,
} from './workflow-dsl';
import { expr } from './workflow-expression';
import {
  MAX_INTERACTION_PAYLOAD_BYTES,
  normalizeOpenWorkflowInteractionInput,
} from './workflow-interaction-records';
import { WorkflowInteractionStore } from './workflow-interaction-store';
import { serializeWorkflowJson } from './workflow-json-value';
import { WorkflowRegistry } from './workflow-registry';
import { defineWorkflowTables } from './workflow-schema';
import { getWorkflowGraphRuntime, WorkflowService } from './workflow-service';
import type { WorkflowClock } from './workflow-executor';

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

describe('private graph persisted-state integrity', () => {
  test('accepts coherent each retry and invalid-item skip transitions', async () => {
    const clock = new ManualClock();
    const registry = new WorkflowRegistry();
    let attempts = 0;
    registry.registerActivity({
      name: 'retry-item',
      handler: async ({ input }) => {
        attempts += 1;
        if (attempts === 1) throw new Error('retry once');
        return input;
      },
    });
    registry.registerActivity({ name: 'skip-item', handler: async ({ input }) => input });
    registry.create({
      name: 'valid-each-transitions',
      flow: flow(
        each(
          'retried', expr.literal(['one']),
          flow(step('retry-item', 'retry-item', { retries: 2, backoffMs: 100 })),
        ),
        each(
          'skipped', expr.literal([{ id: 1 }, { invalid: true }]),
          flow(step('skip-item', 'skip-item')),
          {
            itemSchema: t.Object({ id: t.Number() }),
            itemKey: expr.itemIndex(),
            onInvalid: 'skip',
          },
        ),
        requestAndWait('hold', 'valid-each-transitions.hold'),
      ),
    });
    const service = createService(registry, clock);
    const instanceId = await service.start('valid-each-transitions', {}, 'owner');
    expect(attempts).toBe(1);
    clock.advance(100);
    await service.pollRetries();
    await service.advance(instanceId);

    expect(attempts).toBe(2);
    expect(service.get(instanceId)?.status).toBe('running');
    expect(db.prepare(`SELECT status FROM _workflow_each_items
      WHERE instance_id = ? AND node_id = 'skipped' ORDER BY item_index`).all(instanceId))
      .toEqual([{ status: 'completed' }, { status: 'skipped' }]);
  });

  test('reconciles every sibling in a failing concurrency batch', async () => {
    const registry = new WorkflowRegistry();
    registry.registerActivity({
      name: 'batch-item',
      handler: async ({ input }) => {
        if (input === 'bad') throw new Error('bad item');
        return input;
      },
    });
    registry.create({
      name: 'failing-each-batch',
      flow: flow(each(
        'items',
        expr.literal(['bad', 'good']),
        flow(step('item', 'batch-item', { retries: 1 })),
        { concurrency: 2, onError: 'fail' },
      )),
    });
    const service = createService(registry);
    const instanceId = await service.start('failing-each-batch', {}, 'owner');

    expect(service.get(instanceId)?.status).toBe('failed');
    expect(db.prepare(`SELECT status FROM _workflow_each_items
      WHERE instance_id = ? ORDER BY item_index`).all(instanceId)).toEqual([
      { status: 'failed' },
      { status: 'completed' },
    ]);
  });

  test('fails a live run before using a tampered each source mirror', async () => {
    const registry = fanoutRegistry('each-input-tamper');
    const service = createService(registry);
    const instanceId = await service.start('each-input-tamper', {}, 'owner');
    expect(service.get(instanceId)?.status).toBe('running');

    db.exec('DROP TRIGGER trg_workflow_each_item_identity_immutable');
    db.prepare(`UPDATE _workflow_each_items SET input_json = '999'
      WHERE instance_id = ? AND item_index = 0`).run(instanceId);
    await service.advance(instanceId);

    expect(service.get(instanceId)?.status).toBe('failed');
  });

  test('rejects a tampered each retry envelope during restart preflight', async () => {
    const registry = fanoutRegistry('each-restart-tamper');
    const first = createService(registry);
    const instanceId = await first.start('each-restart-tamper', {}, 'owner');
    await first.dispose();
    db.prepare(`UPDATE _workflow_each_items SET max_attempts = 99
      WHERE instance_id = ? AND item_index = 0`).run(instanceId);

    const second = createService(registry);
    await expect(second.recoverInFlight()).rejects.toMatchObject({
      code: 'WORKFLOW_STATE_INVALID',
      status: 500,
    });
  });

  test('rejects tampered each child metadata during restart preflight', async () => {
    const registry = fanoutRegistry('each-child-metadata-tamper');
    const first = createService(registry);
    const instanceId = await first.start('each-child-metadata-tamper', {}, 'owner');
    await first.dispose();
    db.prepare(`UPDATE workflow_steps
      SET step_name = 'Forged child', wait_event = 'forged.event', branch_key = 'forged'
      WHERE instance_id = ? AND parent_step_id IS NOT NULL AND item_index = 0`)
      .run(instanceId);

    const second = createService(registry);
    await expect(second.recoverInFlight()).rejects.toMatchObject({
      code: 'WORKFLOW_STATE_INVALID',
      status: 500,
    });
  });

  test('rejects tampered interaction-delivery metadata during restart preflight', async () => {
    const registry = new WorkflowRegistry();
    registry.registerActivity({
      name: 'deliver-metadata-tamper',
      handler: async () => ({ delivered: true }),
    });
    registry.create({
      name: 'delivery-metadata-tamper',
      flow: flow(requestAndWait('approval', 'delivery-metadata-tamper.answer', {
        delivery: ['deliver-metadata-tamper'],
      })),
    });
    const first = createService(registry);
    const instanceId = await first.start('delivery-metadata-tamper', {}, 'owner');
    await first.dispose();
    db.prepare(`UPDATE workflow_steps
      SET step_name = 'Forged delivery', wait_event = 'forged.event', branch_key = 'forged'
      WHERE instance_id = ? AND parent_step_id IS NOT NULL`)
      .run(instanceId);

    const second = createService(registry);
    await expect(second.recoverInFlight()).rejects.toMatchObject({
      code: 'WORKFLOW_STATE_INVALID',
      status: 500,
    });
  });

  test('rejects a graph step moved outside its parent tenant during restart', async () => {
    const registry = interactionRegistry('step-tenant-tamper');
    const first = createService(registry);
    const instanceId = await first.start('step-tenant-tamper', {}, 'owner');
    await first.dispose();
    db.exec('DROP TRIGGER trg_workflow_steps_tenant_immutable');
    db.exec('DROP TRIGGER trg_workflow_steps_tenant_matches_parent_update');
    db.prepare(`UPDATE workflow_steps SET tenant_id = 'foreign-tenant'
      WHERE instance_id = ?`).run(instanceId);

    const second = createService(registry);
    await expect(second.recoverInFlight()).rejects.toMatchObject({
      code: 'WORKFLOW_STATE_INVALID',
      status: 500,
    });
    expect(second.get(instanceId)?.status).toBe('running');
  });

  test('rejects a graph interaction moved outside its parent tenant during restart', async () => {
    const registry = interactionRegistry('interaction-tenant-tamper');
    const first = createService(registry);
    const instanceId = await first.start('interaction-tenant-tamper', {}, 'owner');
    await first.dispose();
    db.exec('DROP TRIGGER trg_workflow_interaction_identity_immutable');
    db.exec('DROP TRIGGER trg_workflow_interactions_tenant_matches_parent_update');
    db.prepare(`UPDATE workflow_interactions SET tenant_id = 'foreign-tenant'
      WHERE instance_id = ?`).run(instanceId);

    const second = createService(registry);
    await expect(second.recoverInFlight()).rejects.toMatchObject({
      code: 'WORKFLOW_STATE_INVALID',
      status: 500,
    });
    expect(second.get(instanceId)?.status).toBe('running');
  });

  test('rejects a graph event moved outside its parent tenant during restart', async () => {
    const registry = new WorkflowRegistry();
    registry.create({
      name: 'event-tenant-tamper',
      flow: flow(requestAndWait('approval', 'event-tenant-tamper.answer')),
    });
    const first = createService(registry);
    const instanceId = await first.start('event-tenant-tamper', {}, 'owner');
    first.pause(instanceId);
    await first.sendEvent(instanceId, 'queued.event', { secret: true }, 'owner');
    await first.dispose();
    db.exec('DROP TRIGGER trg_workflow_event_command_immutable');
    db.exec('DROP TRIGGER trg_workflow_events_tenant_immutable');
    db.exec('DROP TRIGGER trg_workflow_events_tenant_matches_parent_update');
    db.prepare(`UPDATE workflow_events SET tenant_id = 'foreign-tenant'
      WHERE instance_id = ?`).run(instanceId);

    const second = createService(registry);
    await expect(second.recoverInFlight()).rejects.toMatchObject({
      code: 'WORKFLOW_STATE_INVALID',
      status: 500,
    });
    expect(second.get(instanceId)?.status).toBe('paused');
  });

  test('fails closed when a graph interaction loses its private definition', async () => {
    const registry = interactionRegistry('missing-interaction-detail');
    const service = createService(registry);
    const instanceId = await service.start('missing-interaction-detail', {}, 'owner');
    const interaction = getWorkflowGraphRuntime(service).listInteractions(instanceId)[0]!;
    db.prepare('DELETE FROM _workflow_interaction_details WHERE interaction_id = ?')
      .run(interaction.interactionId);

    await service.advance(instanceId);
    expect(service.get(instanceId)?.status).toBe('failed');
  });

  test('rejects a pinned interaction-schema mismatch during restart preflight', async () => {
    const registry = interactionRegistry('interaction-restart-tamper');
    const first = createService(registry);
    const instanceId = await first.start('interaction-restart-tamper', {}, 'owner');
    await first.dispose();
    db.exec('DROP TRIGGER trg_workflow_interaction_definition_immutable');
    db.prepare(`UPDATE _workflow_interaction_details SET response_schema_json = 'null'
      WHERE interaction_id = (
        SELECT interaction_id FROM workflow_interactions WHERE instance_id = ? LIMIT 1
      )`).run(instanceId);

    const second = createService(registry);
    await expect(second.recoverInFlight()).rejects.toMatchObject({
      code: 'WORKFLOW_STATE_INVALID',
      status: 500,
    });
  });

  test('validates accepted-response linkage before driving a later wait', async () => {
    const registry = new WorkflowRegistry();
    registry.create({
      name: 'accepted-linkage',
      flow: flow(
        requestAndWait('first', 'first.answer'),
        requestAndWait('second', 'second.answer'),
      ),
    });
    const service = createService(registry);
    const instanceId = await service.start('accepted-linkage', {}, 'owner');
    const first = getWorkflowGraphRuntime(service).listInteractions(instanceId)[0]!;
    await getWorkflowGraphRuntime(service).submitInteraction({
      interactionId: first.interactionId,
      submissionId: 'first-answer',
      actor: { actorId: 'owner' },
      payload: { approved: true },
    });
    expect(getWorkflowGraphRuntime(service).listInteractions(instanceId)).toHaveLength(2);
    db.prepare(`UPDATE _workflow_interaction_details SET accepted_response_id = NULL
      WHERE interaction_id = ?`).run(first.interactionId);

    await service.advance(instanceId);
    expect(service.get(instanceId)?.status).toBe('failed');
  });

  test('recovers a timed open interaction after pause shifts its deadline', async () => {
    const clock = new ManualClock();
    const registry = interactionRegistry('shifted-interaction', 1_000);
    const first = createService(registry, clock);
    const instanceId = await first.start('shifted-interaction', {}, 'owner');
    first.pause(instanceId);
    clock.advance(5_000);
    await first.resume(instanceId);
    expect(first.get(instanceId)?.status).toBe('running');
    await first.dispose();

    const second = createService(registry, clock);
    await expect(second.recoverInFlight()).resolves.toBeGreaterThanOrEqual(0);
    expect(second.get(instanceId)?.status).toBe('running');
  });

  test('recovers coherent rejected and in-flight event response accounting', async () => {
    const clock = new ManualClock();
    const registry = interactionRegistry('interaction-response-accounting');
    const first = createService(registry, clock);
    const instanceId = await first.start('interaction-response-accounting', {}, 'owner');
    const interaction = getWorkflowGraphRuntime(first).listInteractions(instanceId)[0]!;
    const rejected = await getWorkflowGraphRuntime(first).submitInteraction({
      interactionId: interaction.interactionId,
      submissionId: 'rejected',
      actor: { actorId: 'owner' },
      payload: { approved: 'not-a-boolean' },
    });
    expect(rejected.outcome).toBe('rejected');
    clock.advance(10);
    reserveProcessingResponse(
      interaction.interactionId,
      'event-processing',
      { approved: true },
      clock.now().toISOString(),
    );
    const usage = interactionResponseUsage(interaction.interactionId);
    expect(usage).toEqual(exactInteractionResponseUsage(interaction.interactionId));
    await first.dispose();

    defineWorkflowTables(db);
    const second = createService(registry, clock);
    await expect(second.recoverInFlight()).resolves.toBeGreaterThanOrEqual(0);
    expect(second.get(instanceId)?.status).toBe('running');
  });

  test('keeps released response accounting coherent and fails closed on count tamper', async () => {
    const clock = new ManualClock();
    const registry = interactionRegistry('released-response-accounting');
    const first = createService(registry, clock);
    const instanceId = await first.start('released-response-accounting', {}, 'owner');
    const interaction = getWorkflowGraphRuntime(first).listInteractions(instanceId)[0]!;
    const store = reserveProcessingResponse(
      interaction.interactionId,
      'released',
      { approved: true },
      clock.now().toISOString(),
    );
    expect(store.releaseProcessingSubmission(
      interaction.interactionId,
      'released',
      clock.now().toISOString(),
    )).toBe(true);
    expect(interactionResponseUsage(interaction.interactionId)).toEqual({
      response_count: 0,
      response_bytes: 0,
    });
    await first.dispose();

    defineWorkflowTables(db);
    const second = createService(registry, clock);
    await expect(second.recoverInFlight()).resolves.toBeGreaterThanOrEqual(0);
    await second.dispose();
    db.prepare(`UPDATE _workflow_interaction_details SET response_count = 1
      WHERE interaction_id = ?`).run(interaction.interactionId);

    defineWorkflowTables(db);
    expect(interactionResponseUsage(interaction.interactionId).response_count).toBe(1);
    const third = createService(registry, clock);
    await expect(third.recoverInFlight()).rejects.toMatchObject({
      code: 'WORKFLOW_STATE_INVALID',
      status: 500,
    });
  });

  test('fails restart when private interaction byte accounting is tampered', async () => {
    const clock = new ManualClock();
    const registry = interactionRegistry('interaction-byte-tamper');
    const first = createService(registry, clock);
    const instanceId = await first.start('interaction-byte-tamper', {}, 'owner');
    const interaction = getWorkflowGraphRuntime(first).listInteractions(instanceId)[0]!;
    reserveProcessingResponse(
      interaction.interactionId,
      'processing',
      { approved: true },
      clock.now().toISOString(),
    );
    await first.dispose();
    db.prepare(`UPDATE _workflow_interaction_details
      SET response_bytes = response_bytes + 1 WHERE interaction_id = ?`)
      .run(interaction.interactionId);

    defineWorkflowTables(db);
    expect(interactionResponseUsage(interaction.interactionId).response_bytes)
      .toBe(exactInteractionResponseUsage(interaction.interactionId).response_bytes + 1);
    const second = createService(registry, clock);
    await expect(second.recoverInFlight()).rejects.toMatchObject({
      code: 'WORKFLOW_STATE_INVALID',
      status: 500,
    });
  });

  test('rejects forged and foreign trusted-event response origins during recovery', async () => {
    const clock = new ManualClock();
    const registry = interactionRegistry('interaction-origin-integrity');
    const first = createService(registry, clock);
    const instanceId = await first.start('interaction-origin-integrity', {}, 'owner');
    const interaction = getWorkflowGraphRuntime(first).listInteractions(instanceId)[0]!;
    reserveProcessingResponse(
      interaction.interactionId,
      'external-response',
      { approved: true },
      clock.now().toISOString(),
    );
    await first.dispose();
    db.exec('DROP TRIGGER trg_workflow_interaction_response_immutable');
    db.prepare(`UPDATE _workflow_interaction_responses
      SET submission_id = 'Event:forged'
      WHERE interaction_id = ?`).run(interaction.interactionId);

    const forged = createService(registry, clock);
    await expect(forged.recoverInFlight()).rejects.toMatchObject({
      code: 'WORKFLOW_STATE_INVALID',
      status: 500,
    });
    await forged.dispose();

    db.exec('DROP TRIGGER trg_workflow_interaction_response_immutable');
    db.prepare(`UPDATE _workflow_interaction_responses
      SET submission_id = 'external-response'
      WHERE interaction_id = ?`).run(interaction.interactionId);
    const foreignOwner = createService(registry, clock);
    const foreignInstanceId = await foreignOwner.start(
      'interaction-origin-integrity', {}, 'owner',
    );
    await foreignOwner.dispose();
    db.insert('workflow_events', {
      event_id: 'foreign-interaction-event',
      tenant_id: null,
      instance_id: foreignInstanceId,
      event_name: 'interaction-origin-integrity.answer',
      payload: 'true',
      sent_by: 'owner',
      created_at: clock.now().toISOString(),
    });
    db.exec('DROP TRIGGER trg_workflow_interaction_response_immutable');
    db.prepare(`UPDATE _workflow_interaction_responses SET
      origin = 'event', event_id = 'foreign-interaction-event', channel = 'event',
      submission_id = 'event:foreign-interaction-event'
      WHERE interaction_id = ?`).run(interaction.interactionId);

    const foreign = createService(registry, clock);
    await expect(foreign.recoverInFlight()).rejects.toMatchObject({
      code: 'WORKFLOW_STATE_INVALID',
      status: 500,
    });
    await foreign.dispose();

    db.exec('DROP TRIGGER trg_workflow_event_response_parent_delete');
    db.exec('PRAGMA foreign_keys = OFF');
    db.prepare('DELETE FROM workflow_events WHERE event_id = ?')
      .run('foreign-interaction-event');
    db.exec('PRAGMA foreign_keys = ON');
    const missing = createService(registry, clock);
    await expect(missing.recoverInFlight()).rejects.toMatchObject({
      code: 'WORKFLOW_STATE_INVALID',
      status: 500,
    });
  });

  test('enforces one graph interaction per step and caps every private definition field', async () => {
    const registry = interactionRegistry('unique-interaction');
    const service = createService(registry);
    const instanceId = await service.start('unique-interaction', {}, 'owner');
    const row = db.prepare(`SELECT * FROM workflow_interactions
      WHERE instance_id = ? LIMIT 1`).get(instanceId) as Record<string, unknown>;
    expect(() => db.insert('workflow_interactions', {
      ...row,
      interaction_id: 'wait_duplicate',
    })).toThrow();

    const oversized = 'x'.repeat(MAX_INTERACTION_PAYLOAD_BYTES + 1);
    for (const field of ['responderPolicy', 'request'] as const) {
      expect(() => normalizeOpenWorkflowInteractionInput({
        instanceId: 'instance',
        nodeId: 'node',
        stepId: 'step',
        safeLabel: 'Wait',
        openedAt: '2030-01-01T00:00:00.000Z',
        [field]: oversized,
      })).toThrow(expect.objectContaining({
        code: 'WORKFLOW_INTERACTION_INVALID',
        status: 413,
      }));
    }
    expect(() => normalizeOpenWorkflowInteractionInput({
      instanceId: 'instance', nodeId: 'node', stepId: 'step', safeLabel: 'Wait',
      openedAt: '2030-01-01T00:00:00.000Z',
      responseSchema: { type: 'string', description: oversized },
    })).toThrow(expect.objectContaining({
      code: 'WORKFLOW_INTERACTION_INVALID',
      status: 413,
    }));
    const normalized = normalizeOpenWorkflowInteractionInput({
      instanceId: 'instance', nodeId: 'node', stepId: 'step', safeLabel: 'Wait',
      openedAt: '2030-01-01T00:00:00.000Z',
      responseSchema: t.Object({ approved: t.Boolean() }),
    });
    expect(JSON.parse(normalized.responseSchemaJson)).toMatchObject({
      type: 'object',
      'x-zero-typebox-kind': 'Object',
    });
    expect(() => normalizeOpenWorkflowInteractionInput({
      instanceId: 'instance', nodeId: 'node', stepId: 'step', safeLabel: 'Wait',
      openedAt: '2030-01-01',
    })).toThrow(expect.objectContaining({ code: 'WORKFLOW_INTERACTION_INVALID', status: 400 }));
  });
});

function fanoutRegistry(name: string): WorkflowRegistry {
  const registry = new WorkflowRegistry();
  registry.registerActivity({ name: `${name}.item`, handler: async ({ input }) => input });
  registry.create({
    name,
    flow: flow(
      each(
        'items',
        expr.literal([{ id: 'one' }, { id: 'two' }]),
        flow(step('item', `${name}.item`, { retries: 2 })),
        { itemKey: expr.item('id'), concurrency: 2 },
      ),
      requestAndWait('hold', `${name}.hold`),
    ),
  });
  return registry;
}

function interactionRegistry(name: string, timeoutMs?: number): WorkflowRegistry {
  const registry = new WorkflowRegistry();
  registry.create({
    name,
    flow: flow(requestAndWait('approval', `${name}.answer`, {
      inputSchema: t.Object({ approved: t.Boolean() }),
      ...(timeoutMs === undefined ? {} : { timeoutMs }),
      request: { prompt: 'Approve this request' },
    })),
  });
  return registry;
}

function createService(registry: WorkflowRegistry, clock?: WorkflowClock): WorkflowService {
  const service = new WorkflowService(db, registry, {
    clock,
    shutdownGraceMs: 25,
  });
  services.push(service);
  return service;
}

function reserveProcessingResponse(
  interactionId: string,
  submissionId: string,
  payload: unknown,
  now: string,
): WorkflowInteractionStore {
  const store = new WorkflowInteractionStore(db);
  const payloadJson = serializeWorkflowJson(payload);
  store.beginSubmission({
    interactionId,
    submissionId,
    actorId: 'owner',
    channel: 'test',
    origin: 'external',
    payloadJson,
    payloadHash: createHash('sha256').update(payloadJson).digest('hex'),
    now,
    requireRunningInstance: true,
  });
  return store;
}

function interactionResponseUsage(interactionId: string): {
  response_count: number;
  response_bytes: number;
} {
  return db.prepare(`SELECT response_count, response_bytes
    FROM _workflow_interaction_details WHERE interaction_id = ?`).get(interactionId) as {
    response_count: number;
    response_bytes: number;
  };
}

function exactInteractionResponseUsage(interactionId: string): {
  response_count: number;
  response_bytes: number;
} {
  return db.prepare(`SELECT COUNT(*) AS response_count, COALESCE(SUM(
    length(CAST(payload_json AS BLOB))
      + length(CAST(COALESCE(accepted_value_json, '') AS BLOB))
  ), 0) AS response_bytes FROM _workflow_interaction_responses
  WHERE interaction_id = ?`).get(interactionId) as {
    response_count: number;
    response_bytes: number;
  };
}

class ManualClock implements WorkflowClock {
  private milliseconds = Date.parse('2030-01-01T00:00:00.000Z');
  now(): Date { return new Date(this.milliseconds); }
  advance(milliseconds: number): void { this.milliseconds += milliseconds; }
}
