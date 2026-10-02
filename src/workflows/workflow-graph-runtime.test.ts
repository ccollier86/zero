/** End-to-end contracts for the durable graph workflow runtime. */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { t } from 'elysia';
import { trustedSystemServiceDataScope } from '../auth/service-data-scope';
import { MemoryEventStore } from '../observability/memory-event-store';
import {
  configureObservability,
  getObservabilityRuntime,
} from '../observability/sink';
import { createReactiveDB, type ReactiveDB } from '../sync/reactive-db';
import {
  choose,
  each,
  flow,
  otherwise,
  parallel,
  requestAndWait,
  step,
  waitFor,
  when,
} from './workflow-dsl';
import { expr } from './workflow-expression';
import { WorkflowGraphPump } from './workflow-graph-pump';
import { WorkflowRegistry } from './workflow-registry';
import { defineWorkflowTables } from './workflow-schema';
import { getWorkflowGraphRuntime, WorkflowService } from './workflow-service';
import type { WorkflowServiceOptions } from './workflow-service';
import { WorkflowExecutor, type WorkflowClock } from './workflow-executor';
import { WorkflowInteractionAuthority } from './workflow-interaction-authority';

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

describe('workflow graph execution', () => {
  test('executes choices, parallel branches, and ordered bounded each fan-out', async () => {
    const registry = new WorkflowRegistry();
    const branchA = deferred<void>();
    const branchB = deferred<void>();
    const releaseBranches = deferred<void>();
    let fanoutActive = 0;
    let maxFanoutActive = 0;

    registry.registerActivity({
      name: 'load',
      handler: async () => ({ urgent: true, items: [1, 2, 3] }),
    });
    registry.registerActivity({
      name: 'branch-a',
      handler: async () => {
        branchA.resolve();
        await releaseBranches.promise;
        return 'a';
      },
    });
    registry.registerActivity({
      name: 'branch-b',
      handler: async () => {
        branchB.resolve();
        await releaseBranches.promise;
        return 'b';
      },
    });
    registry.registerActivity({ name: 'urgent', handler: async () => 'urgent' });
    registry.registerActivity({ name: 'normal', handler: async () => 'normal' });
    registry.registerActivity({
      name: 'fanout',
      handler: async ({ input }) => {
        fanoutActive += 1;
        maxFanoutActive = Math.max(maxFanoutActive, fanoutActive);
        await Promise.resolve();
        fanoutActive -= 1;
        return Number(input) * 2;
      },
    });
    registry.create({
      name: 'graph-controls',
      flow: flow(
        step('load', 'load'),
        choose(
          'route',
          when(expr.eq(expr.output('load', 'urgent'), true), step('urgent', 'urgent')),
          otherwise(step('normal', 'normal')),
        ),
        parallel('notify', {
          a: [step('branch-a', 'branch-a')],
          b: [step('branch-b', 'branch-b')],
        }),
        each(
          'fanout',
          expr.output('load', 'items'),
          flow(step('fanout-item', 'fanout')),
          { concurrency: 2, itemKey: expr.itemIndex(), onError: 'collect' },
        ),
      ),
    });

    const service = createService(registry);
    const started = service.start('graph-controls', {});
    await Promise.all([branchA.promise, branchB.promise]);
    releaseBranches.resolve();
    const instanceId = await started;

    expect(service.get(instanceId)?.status).toBe('completed');
    const graphSteps = service.getSteps(instanceId);
    expect(graphSteps.find((row) => row.node_id === 'normal')?.status)
      .toBe('skipped');
    expect(graphSteps.find((row) => row.node_id === 'branch-a')?.branch_key).toBe('a');
    expect(graphSteps.find((row) => row.node_id === 'branch-b')?.branch_key).toBe('b');
    const parallelJoin = graphSteps.find((row) => row.node_id === '@zero/notify/join')!;
    expect(parallelJoin.branch_key).toBeNull();
    expect(JSON.parse(parallelJoin.output!)).toEqual({ a: 'a', b: 'b' });
    expect(maxFanoutActive).toBe(2);
    const eachStep = service.getSteps(instanceId).find((row) => row.node_id === 'fanout'
      && row.parent_step_id === null);
    expect(JSON.parse(eachStep!.output!)).toEqual([
      { ok: true, value: 2 },
      { ok: true, value: 4 },
      { ok: true, value: 6 },
    ]);
  });

  test('honors explicit publication metadata and never retries invalid output', async () => {
    const registry = new WorkflowRegistry();
    let calls = 0;
    registry.registerActivity({
      name: 'bad-output',
      outputSchema: t.Object({ ok: t.Boolean() }),
      handler: async () => {
        calls += 1;
        return { ok: 'not-boolean' };
      },
    });
    registry.create({
      name: 'versioned-output',
      version: 7,
      activate: false,
      inputSchema: t.Object({ id: t.String() }),
      flow: flow(step('bad', 'bad-output', { retries: 5 })),
    });
    const service = createService(registry);

    await expect(service.start('versioned-output', { id: 'one' })).rejects.toMatchObject({
      code: 'WORKFLOW_VERSION_NOT_FOUND',
      status: 404,
    });

    await expect(service.start(
      'versioned-output', { id: 1 }, undefined, { version: 7 },
    )).rejects.toMatchObject({
      code: 'WORKFLOW_INPUT_INVALID',
      status: 422,
    });
    expect(service.list()).toHaveLength(0);
    const instanceId = await service.start(
      'versioned-output', { id: 'one' }, undefined, { version: 7 },
    );
    const catalog = db.prepare(`SELECT version, active_version_id
      FROM workflow_definitions WHERE name = 'versioned-output'`).get() as {
        version: number;
        active_version_id: string | null;
      };
    expect(catalog).toEqual({ version: 7, active_version_id: null });
    expect(service.get(instanceId)?.status).toBe('failed');
    expect(service.getSteps(instanceId)[0]).toMatchObject({ retries: 1, retry_at: null });
    expect(calls).toBe(1);
  });

  test('pins a graph version alongside an explicit standalone tenant scope', async () => {
    const registry = new WorkflowRegistry();
    registry.registerActivity({ name: 'tenant-version', handler: async () => 'done' });
    registry.create({
      name: 'tenant-version',
      version: 7,
      activate: false,
      flow: flow(step('run', 'tenant-version')),
    });
    const service = createService(registry, undefined, { tenancyMode: 'multi' });
    const scope = trustedSystemServiceDataScope({
      scopeKind: 'tenant',
      tenantId: 'tenant-version-scope',
    });

    const instanceId = await service.start(
      'tenant-version',
      {},
      undefined,
      scope,
      { version: 7 },
    );

    expect(service.get(instanceId, scope)).toMatchObject({
      tenant_id: 'tenant-version-scope',
      definition_version: 7,
      status: 'completed',
    });
  });

  test('routes named interaction events through auth and schema validation', async () => {
    const registry = new WorkflowRegistry();
    registry.registerActivity({ name: 'after', handler: async ({ input }) => input });
    registry.create({
      name: 'event-response',
      flow: flow(
        requestAndWait('approval', 'approval.response', {
          inputSchema: t.Object({ approved: t.Boolean() }),
          maxRejections: 3,
        }),
        step('after', 'after'),
      ),
    });
    const service = createService(registry, undefined, {
      interactionAuthority: TEST_SYSTEM_INTERACTION_AUTHORITY,
    });
    const instanceId = await service.start('event-response', {}, 'owner');

    expect(await sendSystemEvent(
      service,
      instanceId,
      'approval.response',
      { approved: true },
      'outsider',
    )).toBe(true);
    expect(service.get(instanceId)?.status).toBe('running');
    expect(getWorkflowGraphRuntime(service).listInteractions(instanceId)[0]).toMatchObject({
      status: 'open',
      rejectionCount: 0,
    });

    expect(await sendSystemEvent(
      service,
      instanceId,
      'approval.response',
      { approved: 'yes' },
      'owner',
    )).toBe(true);
    expect(service.get(instanceId)?.status).toBe('running');
    expect(getWorkflowGraphRuntime(service).listInteractions(instanceId)[0]).toMatchObject({
      status: 'open',
      rejectionCount: 1,
    });

    expect(await sendSystemEvent(
      service,
      instanceId,
      'approval.response',
      { approved: true },
      'owner',
    )).toBe(true);
    expect(service.get(instanceId)?.status).toBe('completed');
    expect(getWorkflowGraphRuntime(service).listInteractions(instanceId)[0]).toMatchObject({
      status: 'accepted',
      acceptedBy: 'system:owner',
    });
  });

  test('drains forbidden and invalid interaction-event backlog when a paused run resumes', async () => {
    const registry = new WorkflowRegistry();
    registry.create({
      name: 'event-backlog',
      flow: flow(requestAndWait('approval', 'approval.response', {
        inputSchema: t.Object({ approved: t.Boolean() }),
        maxRejections: 3,
      })),
    });
    const service = createService(registry, undefined, {
      interactionAuthority: TEST_SYSTEM_INTERACTION_AUTHORITY,
    });

    const forbiddenId = await service.start('event-backlog', {}, 'owner');
    service.pause(forbiddenId);
    expect(await sendSystemEvent(
      service, forbiddenId, 'approval.response', { approved: true }, 'outsider',
    )).toBe(false);
    expect(await sendSystemEvent(
      service, forbiddenId, 'approval.response', { approved: true }, 'owner',
    )).toBe(false);
    await service.resume(forbiddenId);
    expect(service.get(forbiddenId)?.status).toBe('completed');
    expect(getWorkflowGraphRuntime(service).listInteractions(forbiddenId)[0]).toMatchObject({
      status: 'accepted', rejectionCount: 0, acceptedBy: 'system:owner',
    });

    const invalidId = await service.start('event-backlog', {}, 'owner');
    service.pause(invalidId);
    expect(await sendSystemEvent(
      service, invalidId, 'approval.response', { approved: 'yes' }, 'owner',
    )).toBe(false);
    expect(await sendSystemEvent(
      service, invalidId, 'approval.response', { approved: true }, 'owner',
    )).toBe(false);
    await service.resume(invalidId);
    expect(service.get(invalidId)?.status).toBe('completed');
    expect(getWorkflowGraphRuntime(service).listInteractions(invalidId)[0]).toMatchObject({
      status: 'accepted', rejectionCount: 1, acceptedBy: 'system:owner',
    });
  });

  test('keeps a named-event validator coherent when pause interrupts its first attempt', async () => {
    const registry = new WorkflowRegistry();
    const entered = deferred<void>();
    let calls = 0;
    registry.registerActivity({
      name: 'event-pause-validator',
      handler: async ({ signal }) => {
        calls += 1;
        if (calls > 1) return true;
        entered.resolve();
        await new Promise<void>((resolve) => signal!.addEventListener('abort', () => resolve(), {
          once: true,
        }));
        return true;
      },
    });
    registry.create({
      name: 'event-pause-run',
      flow: flow(requestAndWait('approval', 'approval.response', {
        validator: { name: 'event-pause-validator' },
      })),
    });
    const service = createService(registry, undefined, {
      interactionAuthority: TEST_SYSTEM_INTERACTION_AUTHORITY,
    });
    const instanceId = await service.start('event-pause-run', {}, 'owner');
    const sending = sendSystemEvent(
      service, instanceId, 'approval.response', { approved: true }, 'owner',
    );
    await entered.promise;
    service.pause(instanceId);
    expect(await sending).toBe(true);
    expect(service.get(instanceId)?.status).toBe('paused');
    expect(getWorkflowGraphRuntime(service).listInteractions(instanceId)[0]).toMatchObject({
      status: 'open', rejectionCount: 0,
    });

    await service.resume(instanceId);
    expect(calls).toBe(2);
    expect(service.get(instanceId)?.status).toBe('completed');
    expect(getWorkflowGraphRuntime(service).listInteractions(instanceId)[0]?.status).toBe('accepted');
  });

  test('fails closed when a private event actor snapshot is corrupted', async () => {
    const registry = new WorkflowRegistry();
    registry.create({
      name: 'corrupt-event-actor',
      flow: flow(requestAndWait('approval', 'approval.response')),
    });
    const service = createService(registry, undefined, {
      interactionAuthority: TEST_SYSTEM_INTERACTION_AUTHORITY,
    });
    const instanceId = await service.start('corrupt-event-actor', {}, 'owner');
    service.pause(instanceId);
    await sendSystemEvent(service, instanceId, 'approval.response', { approved: true }, 'owner');
    db.exec('DROP TRIGGER trg_workflow_event_delivery_envelope_immutable');
    db.prepare(`UPDATE _workflow_event_delivery SET actor_json = ? WHERE instance_id = ?`)
      .run('{"actorId":7,"roles":"admin"}', instanceId);

    await service.resume(instanceId);
    expect(service.get(instanceId)?.status).toBe('running');
    expect(getWorkflowGraphRuntime(service).listInteractions(instanceId)[0]).toMatchObject({
      status: 'open',
      rejectionCount: 0,
    });
    expect(db.prepare(`SELECT queued_count, queued_bytes FROM _workflow_event_usage
      WHERE instance_id = ?`).get(instanceId)).toEqual({
      queued_count: 0,
      queued_bytes: 0,
    });
  });

  test('commits scratch memory only with a successful attempt and exposes it downstream', async () => {
    const registry = new WorkflowRegistry();
    let attempts = 0;
    registry.registerActivity({
      name: 'stage-memory',
      handler: async ({ memory }) => {
        attempts += 1;
        if (attempts === 1) {
          memory!.set('leaked', 'must-not-commit');
          throw new Error('retry me');
        }
        expect(memory!.get('leaked')).toBeUndefined();
        memory!.set('patient', { id: 'patient-1', verified: true });
        memory!.set('attempts', attempts);
        return 'staged';
      },
    });
    registry.registerActivity({
      name: 'read-memory',
      handler: async ({ memory }) => ({
        patient: memory!.get('patient'),
        attempts: memory!.get('attempts'),
        leaked: memory!.get('leaked') ?? null,
      }),
    });
    registry.create({
      name: 'memory-transaction',
      flow: flow(
        step('stage', 'stage-memory', { retries: 2, backoffMs: 0 }),
        step('read', 'read-memory'),
      ),
    });

    const service = createService(registry);
    const instanceId = await service.start('memory-transaction');
    expect(service.get(instanceId)?.status).toBe('completed');
    expect(attempts).toBe(2);
    expect(getWorkflowGraphRuntime(service).memory.list({ instanceId, kind: 'instance' }))
      .toMatchObject([
        { key: 'attempts', value: 2, version: 1 },
        { key: 'patient', value: { id: 'patient-1', verified: true }, version: 1 },
      ]);
    const read = service.getSteps(instanceId).find((row) => row.node_id === 'read');
    expect(JSON.parse(read!.output!)).toEqual({
      patient: { id: 'patient-1', verified: true },
      attempts: 2,
      leaked: null,
    });
  });

  test('recovers graph coordination without duplicating decisions, fan-out, or interactions', async () => {
    const registry = new WorkflowRegistry();
    let itemCalls = 0;
    registry.registerActivity({ name: 'load-recovery', handler: async () => ({ urgent: true }) });
    registry.registerActivity({
      name: 'recover-item',
      handler: async ({ input }) => {
        itemCalls += 1;
        return Number(input) * 10;
      },
    });
    registry.registerActivity({ name: 'recovery-done', handler: async ({ input }) => input });
    registry.registerActivity({ name: 'recovery-fallback', handler: async () => 'fallback' });
    registry.create({
      name: 'restart-graph',
      flow: flow(
        step('load-recovery', 'load-recovery'),
        choose(
          'recovery-route',
          when(
            expr.eq(expr.output('load-recovery', 'urgent'), true),
            parallel('recovery-parallel', {
              approval: [requestAndWait('recovery-approval', 'recovery.approval')],
              items: [each(
                'recovery-each',
                expr.literal([1, 2]),
                flow(step('recover-item', 'recover-item')),
                { concurrency: 2 },
              )],
            }),
          ),
          otherwise(step('recovery-fallback', 'recovery-fallback')),
        ),
        step('recovery-done', 'recovery-done'),
      ),
    });

    const first = createService(registry);
    const instanceId = await first.start('restart-graph', {}, 'owner');
    expect(first.get(instanceId)?.status).toBe('running');
    expect(itemCalls).toBe(2);
    const before = graphCoordinationCounts(instanceId);
    expect(before.interactions).toBe(1);
    expect(before.items).toBe(2);
    expect(before.decisions).toBeGreaterThanOrEqual(2);
    await first.dispose();

    const second = createService(registry);
    await second.recoverInFlight();
    await second.advance(instanceId);
    expect(graphCoordinationCounts(instanceId)).toEqual(before);
    expect(itemCalls).toBe(2);
    const interaction = getWorkflowGraphRuntime(second).listInteractions(instanceId)[0]!;
    await getWorkflowGraphRuntime(second).submitInteraction({
      interactionId: interaction.interactionId,
      submissionId: 'after-restart',
      actor: { actorId: 'owner' },
      payload: { approved: true },
      channel: 'test',
    });
    expect(second.get(instanceId)?.status).toBe('completed');
    expect(graphCoordinationCounts(instanceId)).toEqual(before);
  });

  test('reconciles each-item projections from terminal child steps after restart', async () => {
    const registry = new WorkflowRegistry();
    registry.registerActivity({ name: 'each-success', handler: async ({ input }) => input });
    registry.registerActivity({ name: 'each-failure', handler: async () => {
      throw new Error('terminal item failure');
    } });
    registry.create({
      name: 'each-success-recovery',
      flow: flow(each(
        'success-items',
        expr.literal(['one']),
        flow(step('success-item', 'each-success')),
      )),
    });
    registry.create({
      name: 'each-failure-recovery',
      flow: flow(each(
        'failed-items',
        expr.literal(['one']),
        flow(step('failed-item', 'each-failure', { retries: 1 })),
        { onError: 'collect' },
      )),
    });

    const first = createService(registry);
    const completedId = await first.start('each-success-recovery');
    const failedId = await first.start('each-failure-recovery');
    await first.dispose();

    for (const instanceId of [completedId, failedId]) {
      const parent = serviceStep(instanceId, null);
      db.prepare(`UPDATE workflow_instances SET status = 'running', output = NULL,
        error = NULL, completed_at = NULL WHERE instance_id = ?`).run(instanceId);
      db.prepare(`UPDATE workflow_steps SET status = 'waiting', output = NULL,
        error = NULL, completed_at = NULL WHERE step_id = ?`).run(parent.step_id);
      db.prepare(`UPDATE _workflow_each_items SET status = 'running', output_json = NULL,
        error = NULL, attempts = 0, completed_at = NULL WHERE instance_id = ?`).run(instanceId);
      const usage = db.prepare(`SELECT COALESCE(SUM(bytes), 0) AS bytes FROM (
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
      )`).get(instanceId, instanceId, instanceId) as { bytes: number };
      db.prepare(`UPDATE _workflow_runtime_usage SET runtime_bytes = ?
        WHERE instance_id = ?`).run(Number(usage.bytes), instanceId);
    }

    const second = createService(registry);
    await second.recoverInFlight();
    await Promise.all([second.advance(completedId), second.advance(failedId)]);

    expect(second.get(completedId)?.status).toBe('completed');
    expect(eachItem(completedId)).toMatchObject({
      status: 'completed',
      output_json: '"one"',
    });
    expect(second.get(failedId)?.status).toBe('completed');
    expect(eachItem(failedId)).toMatchObject({
      status: 'failed',
      error: 'terminal item failure',
    });
  });

  test('recreates missing interaction delivery steps after restart', async () => {
    const registry = new WorkflowRegistry();
    let deliveries = 0;
    registry.registerActivity({
      name: 'deliver-approval',
      handler: async () => {
        deliveries += 1;
        return { delivered: true };
      },
    });
    registry.create({
      name: 'delivery-recovery',
      flow: flow(requestAndWait('approval', 'approval.responded', {
        delivery: ['deliver-approval'],
        request: { prompt: 'private prompt' },
      })),
    });
    const first = createService(registry);
    const instanceId = await first.start('delivery-recovery', {}, 'owner');
    expect(deliveries).toBe(1);
    await first.dispose();
    const parent = serviceStep(instanceId, null);
    db.prepare('DELETE FROM workflow_steps WHERE parent_step_id = ?').run(parent.step_id);
    deliveries = 0;

    const second = createService(registry);
    await second.recoverInFlight();
    await second.advance(instanceId);

    expect(deliveries).toBe(1);
    expect(second.get(instanceId)?.status).toBe('running');
    expect(second.getSteps(instanceId).filter((row) => row.parent_step_id === parent.step_id))
      .toHaveLength(1);
  });

  test('starts an already-published historical code version without republishing current code', async () => {
    const original = new WorkflowRegistry();
    original.registerActivity({ name: 'historical-old', handler: async () => 'old' });
    original.create({
      name: 'historical-code',
      version: 1,
      inputSchema: t.Object({ old: t.String() }),
      flow: flow(step('historical-run', 'historical-old')),
    });
    const first = createService(original);
    await first.start('historical-code', { old: 'seed' });
    await first.dispose();

    const current = new WorkflowRegistry();
    current.registerActivity({ name: 'historical-old', handler: async () => 'old' });
    current.registerActivity({ name: 'historical-new', handler: async () => 'new' });
    current.create({
      name: 'historical-code',
      version: 2,
      activate: false,
      inputSchema: t.Object({ current: t.String() }),
      flow: flow(step('historical-run', 'historical-new')),
    });
    const second = createService(current);
    const versionsBefore = workflowVersionCount('historical-code');
    const activeInstanceId = await second.start('historical-code', { old: 'active' });
    expect(second.get(activeInstanceId)).toMatchObject({
      status: 'completed', definition_version: 1, output: '"old"',
    });
    const instanceId = await second.start(
      'historical-code',
      { old: 'still-valid' },
      undefined,
      { version: 1 },
    );
    expect(second.get(instanceId)).toMatchObject({
      status: 'completed',
      definition_version: 1,
      output: '"old"',
    });
    expect(workflowVersionCount('historical-code')).toBe(versionsBefore);
    const inactiveInstanceId = await second.start(
      'historical-code',
      { current: 'explicit' },
      undefined,
      { version: 2 },
    );
    expect(second.get(inactiveInstanceId)).toMatchObject({
      status: 'completed', definition_version: 2, output: '"new"',
    });
  });

  test('publishes a first explicitly requested registered version when the numbers match', async () => {
    const registry = new WorkflowRegistry();
    registry.registerActivity({ name: 'explicit-seven', handler: async () => 'seven' });
    registry.create({
      name: 'explicit-first-start',
      version: 7,
      flow: flow(step('explicit-seven', 'explicit-seven')),
    });
    const service = createService(registry);
    expect(workflowVersionCount('explicit-first-start')).toBe(1);
    const instanceId = await service.start(
      'explicit-first-start',
      {},
      undefined,
      { version: 7 },
    );
    expect(service.get(instanceId)).toMatchObject({
      status: 'completed',
      definition_version: 7,
      output: '"seven"',
    });
  });

  test('surfaces immutable code publication conflicts when the service initializes', async () => {
    const original = new WorkflowRegistry();
    original.registerActivity({ name: 'conflict-old', handler: async () => 'old' });
    original.create({
      name: 'startup-conflict', version: 3,
      flow: flow(step('startup-conflict', 'conflict-old')),
    });
    const first = createService(original);
    await first.dispose();

    const changed = new WorkflowRegistry();
    changed.registerActivity({ name: 'conflict-new', handler: async () => 'new' });
    changed.create({
      name: 'startup-conflict', version: 3,
      flow: flow(step('startup-conflict', 'conflict-new')),
    });
    expect(() => createService(changed)).toThrow(expect.objectContaining({
      code: 'WORKFLOW_VERSION_CONFLICT',
      status: 409,
    }));
  });

  test('fails a plain wait safely when its claimed event payload is invalid', async () => {
    const registry = new WorkflowRegistry();
    registry.create({
      name: 'typed-event',
      flow: flow(waitFor('payload', 'payload.ready', {
        inputSchema: t.Object({ id: t.String() }),
      })),
    });
    const service = createService(registry);
    const instanceId = await service.start('typed-event');
    expect(await service.sendEvent(instanceId, 'payload.ready', { id: 1 }, 'owner')).toBe(true);
    expect(service.get(instanceId)).toMatchObject({
      status: 'failed',
      error: 'Workflow wait "payload" received an invalid event payload',
    });
    expect(eventUsage(instanceId)).toMatchObject({ queued_count: 0, queued_bytes: 0 });
    expect(consumedEventCount(instanceId)).toBe(1);
  });

  test('consumes a valid plain-wait event from the bounded delivery queue', async () => {
    const registry = new WorkflowRegistry();
    registry.create({
      name: 'valid-event',
      flow: flow(waitFor('payload', 'payload.ready', {
        inputSchema: t.Object({ id: t.String() }),
      })),
    });
    const service = createService(registry);
    const instanceId = await service.start('valid-event');
    service.pause(instanceId);
    expect(await service.sendEvent(
      instanceId, 'payload.ready', { id: 'patient-1' }, 'owner',
    )).toBe(false);
    expect(eventUsage(instanceId).revision).toBe(1);
    await service.resume(instanceId);
    expect(service.get(instanceId)?.status).toBe('completed');
    expect(eventUsage(instanceId)).toMatchObject({ queued_count: 0, queued_bytes: 0 });
    expect(eventUsage(instanceId).revision).toBe(3);
    expect(consumedEventCount(instanceId)).toBe(1);
  });

  test('buffers an event response while paused and resumes after shifting deadlines', async () => {
    const clock = new ManualClock();
    const registry = new WorkflowRegistry();
    registry.registerActivity({ name: 'after', handler: async ({ input }) => input });
    registry.create({
      name: 'paused-response',
      flow: flow(
        requestAndWait('approval', 'approval.response', {
          timeoutMs: 100,
          inputSchema: t.Object({ approved: t.Boolean() }),
        }),
        step('after', 'after'),
      ),
    });
    const service = createService(registry, clock, {
      interactionAuthority: TEST_SYSTEM_INTERACTION_AUTHORITY,
    });
    const instanceId = await service.start('paused-response', {}, 'owner');
    const interaction = getWorkflowGraphRuntime(service).listInteractions(instanceId)[0]!;
    service.pause(instanceId);
    clock.advance(1_000);

    await expect(getWorkflowGraphRuntime(service).submitInteraction({
      interactionId: interaction.interactionId,
      submissionId: 'paused-answer',
      actor: { actorId: 'owner' },
      payload: { approved: true },
      channel: 'test',
    })).rejects.toMatchObject({ code: 'WORKFLOW_DRAINING', status: 409 });
    expect(await sendSystemEvent(
      service, instanceId,
      'approval.response',
      { approved: true },
      'owner',
    )).toBe(false);
    expect(service.get(instanceId)?.status).toBe('paused');
    expect(service.getSteps(instanceId).find((row) => row.node_id === 'after')?.status)
      .toBe('pending');
    expect(service.pollTimeouts()).toBe(0);

    await service.resume(instanceId);
    expect(service.get(instanceId)?.status).toBe('completed');
  });

  test('lets an inclusive expired graph wait deadline win over pause', async () => {
    const clock = new ManualClock();
    const registry = new WorkflowRegistry();
    registry.create({
      name: 'pause-expired-graph-wait',
      flow: flow(waitFor('approval', 'approval.response', { timeoutMs: 100 })),
    });
    const service = createService(registry, clock);
    const instanceId = await service.start('pause-expired-graph-wait');
    clock.advance(100);

    expect(() => service.pause(instanceId)).toThrow(expect.objectContaining({
      code: 'WORKFLOW_STATE_INVALID', status: 409,
    }));
    expect(service.get(instanceId)).toMatchObject({
      status: 'failed', error: 'Workflow step timed out',
    });
    expect(service.getSteps(instanceId)[0]).toMatchObject({
      status: 'failed', error: 'Step timed out', timeout_at: null,
    });
  });

  test('lets an inclusive expired interaction deadline win over pause', async () => {
    const clock = new ManualClock();
    const registry = new WorkflowRegistry();
    registry.create({
      name: 'pause-expired-interaction',
      flow: flow(requestAndWait('approval', 'approval.response', { timeoutMs: 100 })),
    });
    const service = createService(registry, clock, {
      interactionAuthority: TEST_SYSTEM_INTERACTION_AUTHORITY,
    });
    const instanceId = await service.start('pause-expired-interaction', {}, 'owner');
    clock.advance(100);

    expect(() => service.pause(instanceId)).toThrow(expect.objectContaining({
      code: 'WORKFLOW_STATE_INVALID', status: 409,
    }));
    await service.advance(instanceId);

    expect(getWorkflowGraphRuntime(service).listInteractions(instanceId)[0]?.status)
      .toBe('expired');
    expect(service.get(instanceId)).toMatchObject({
      status: 'failed', error: 'Workflow interaction expired',
    });
    expect(service.getSteps(instanceId)[0]).toMatchObject({
      status: 'failed', error: 'Workflow interaction expired', timeout_at: null,
    });
  });

  test('preserves graph retry backoff across pause and resume', async () => {
    const clock = new ManualClock();
    const registry = new WorkflowRegistry();
    let calls = 0;
    registry.registerActivity({
      name: 'pause-retry',
      handler: async () => {
        calls += 1;
        if (calls === 1) throw new Error('retry later');
        return 'done';
      },
    });
    registry.create({
      name: 'paused-backoff',
      flow: flow(step('retry', 'pause-retry', { retries: 2, backoffMs: 100 })),
    });
    const service = createService(registry, clock);
    const instanceId = await service.start('paused-backoff');
    expect(calls).toBe(1);
    service.pause(instanceId);
    clock.advance(1_000);
    expect(await service.pollRetries()).toBe(0);

    await service.resume(instanceId);
    expect(calls).toBe(1);
    clock.advance(99);
    expect(await service.pollRetries()).toBe(0);
    clock.advance(1);
    expect(await service.pollRetries()).toBe(1);
    await service.advance(instanceId);
    expect(calls).toBe(2);
    expect(service.get(instanceId)?.status).toBe('completed');
  });

  test('clears a cancelled graph retry and excludes it from due polling', async () => {
    const clock = new ManualClock();
    const registry = new WorkflowRegistry();
    let calls = 0;
    registry.registerActivity({
      name: 'cancel-retry',
      handler: async () => {
        calls += 1;
        throw new Error('retry later');
      },
    });
    registry.create({
      name: 'cancelled-backoff',
      flow: flow(step('retry', 'cancel-retry', { retries: 2, backoffMs: 100 })),
    });
    const service = createService(registry, clock);
    const instanceId = await service.start('cancelled-backoff');
    service.cancel(instanceId);
    clock.advance(1_000);

    expect(await service.pollRetries()).toBe(0);
    expect(calls).toBe(1);
    expect(service.get(instanceId)?.status).toBe('cancelled');
    expect(service.getSteps(instanceId)[0]).toMatchObject({
      status: 'skipped', retry_at: null, timeout_at: null,
    });
  });

  test('never resurrects cancelled fan-out items when an aborted handler settles', async () => {
    const registry = new WorkflowRegistry();
    const entered = deferred<void>();
    registry.registerActivity({
      name: 'cancel-item',
      handler: async ({ signal }) => {
        entered.resolve();
        await new Promise<void>((resolve) => signal!.addEventListener('abort', () => resolve(), {
          once: true,
        }));
        return 'late';
      },
    });
    registry.create({
      name: 'cancel-fanout',
      flow: flow(each(
        'cancel-each',
        expr.literal(['one']),
        flow(step('cancel-item', 'cancel-item')),
      )),
    });
    const service = createService(registry);
    const started = service.start('cancel-fanout');
    await entered.promise;
    const instanceId = (db.prepare(`
      SELECT instance_id FROM workflow_instances WHERE name = 'cancel-fanout' LIMIT 1
    `).get() as { instance_id: string }).instance_id;
    service.cancel(instanceId);
    await started;

    expect(service.get(instanceId)?.status).toBe('cancelled');
    expect((db.prepare(`
      SELECT status FROM _workflow_each_items WHERE instance_id = ? LIMIT 1
    `).get(instanceId) as { status: string }).status).toBe('cancelled');
    expect(service.getSteps(instanceId).find((row) => row.parent_step_id !== null)?.status)
      .toBe('skipped');
  });

  test('does not relaunch an each item while its workflow is paused', async () => {
    const registry = new WorkflowRegistry();
    const entered = deferred<void>();
    registry.registerActivity({
      name: 'pause-item',
      handler: async ({ signal }) => {
        entered.resolve();
        await new Promise<void>((resolve) => signal!.addEventListener('abort', () => resolve(), {
          once: true,
        }));
        return 'late';
      },
    });
    registry.create({
      name: 'pause-fanout',
      flow: flow(each(
        'pause-each',
        expr.literal(['one']),
        flow(step('pause-item', 'pause-item')),
      )),
    });
    const service = createService(registry);
    const started = service.start('pause-fanout');
    await entered.promise;
    const instanceId = workflowInstanceId('pause-fanout');
    service.pause(instanceId);
    await started;

    expect(service.get(instanceId)?.status).toBe('paused');
    expect(eachItem(instanceId).status).toBe('pending');
    expect(service.getSteps(instanceId).some((row) => row.status === 'running')).toBe(false);
  });

  test('does not relaunch an each item while its workflow is cancelled', async () => {
    const registry = new WorkflowRegistry();
    const entered = deferred<void>();
    registry.registerActivity({
      name: 'cancel-racing-item',
      handler: async ({ signal }) => {
        entered.resolve();
        await new Promise<void>((resolve) => signal!.addEventListener('abort', () => resolve(), {
          once: true,
        }));
        return 'late';
      },
    });
    registry.create({
      name: 'cancel-racing-fanout',
      flow: flow(each(
        'cancel-racing-each',
        expr.literal(['one']),
        flow(step('cancel-racing-item', 'cancel-racing-item')),
      )),
    });
    const service = createService(registry);
    const started = service.start('cancel-racing-fanout');
    await entered.promise;
    const instanceId = workflowInstanceId('cancel-racing-fanout');
    service.cancel(instanceId);
    await started;

    expect(service.get(instanceId)?.status).toBe('cancelled');
    expect(eachItem(instanceId).status).toBe('cancelled');
    expect(service.getSteps(instanceId).some((row) => row.status === 'running')).toBe(false);
  });

  test('fails corrupted pinned root metadata before a newly ready activity can execute', async () => {
    const corruptions = [
      { suffix: 'kind', changes: { node_kind: 'wait' } },
      { suffix: 'label', changes: { step_name: 'Forged label' } },
      { suffix: 'retries', changes: { max_retries: 10_000 } },
      { suffix: 'event', changes: { wait_event: 'forged.event' } },
    ] as const;

    for (const corruption of corruptions) {
      const registry = new WorkflowRegistry();
      let calls = 0;
      const activityName = `after-corruption-${corruption.suffix}`;
      const workflowName = `corrupt-before-execute-${corruption.suffix}`;
      registry.registerActivity({
        name: activityName,
        handler: async () => {
          calls += 1;
          return 'unsafe';
        },
      });
      registry.create({
        name: workflowName,
        flow: flow(
          waitFor('gate', 'gate.open'),
          step('after-corruption', activityName, { retries: 2 }),
        ),
      });
      const service = createService(registry);
      const instanceId = await service.start(workflowName);
      const corrupt = service.getSteps(instanceId)
        .find((row) => row.node_id === 'after-corruption')!;
      db.update('workflow_steps', corrupt.step_id, corruption.changes);

      expect(await service.sendEvent(instanceId, 'gate.open', {}, 'owner')).toBe(false);
      expect(service.get(instanceId)?.status).toBe('failed');
      expect(calls).toBe(0);
      await service.dispose();
    }
  });

  test('aborts graph activities before awaiting pump drainage on disposal', async () => {
    const registry = new WorkflowRegistry();
    const entered = deferred<void>();
    const aborted = deferred<void>();
    registry.registerActivity({
      name: 'until-abort',
      handler: async ({ signal }) => {
        entered.resolve();
        await new Promise<void>((resolve) => signal!.addEventListener('abort', () => {
          aborted.resolve();
          resolve();
        }, { once: true }));
        return 'aborted';
      },
    });
    registry.create({ name: 'dispose-graph', flow: flow(step('run', 'until-abort')) });
    const service = createService(registry);
    const started = service.start('dispose-graph');
    await entered.promise;

    await service.dispose();
    await aborted.promise;
    await started;
  });

  test('propagates graph collaborator failures after draining every shutdown path', async () => {
    const service = createService(new WorkflowRegistry());
    const graph = getWorkflowGraphRuntime(service);
    const originalDispose = graph.interactions.dispose.bind(graph.interactions);
    const cleanupError = new Error('interaction cleanup failed');
    graph.interactions.dispose = async () => {
      await originalDispose();
      throw cleanupError;
    };

    await expect(service.dispose()).rejects.toBe(cleanupError);
    expect(service.dispose()).toBe(service.dispose());
  });

  test('never emits an application-defined each item key to observability sinks', async () => {
    const previous = getObservabilityRuntime().config;
    const events = new MemoryEventStore();
    configureObservability({ console: false, store: events });
    try {
      const registry = new WorkflowRegistry();
      registry.registerActivity({
        name: 'fail-private-item',
        handler: async () => { throw new Error('expected item failure'); },
      });
      registry.create({
        name: 'private-item-key',
        flow: flow(each(
          'patients',
          expr.literal([{ patientId: 'patient-secret-123' }]),
          flow(step('validate-patient', 'fail-private-item', { retries: 1 })),
          { itemKey: expr.item('patientId') },
        )),
      });
      const service = createService(registry);
      await service.start('private-item-key');

      const failures = events.query({ code: 'workflows.each.item_failed' }).events;
      expect(failures).toHaveLength(1);
      expect(failures[0]?.metadata).toMatchObject({ itemIndex: 0 });
      expect(failures[0]?.metadata).not.toHaveProperty('itemKey');
      expect(JSON.stringify(failures[0]?.metadata)).not.toContain('patient-secret-123');
    } finally {
      configureObservability(previous);
    }
  });

  test('aborts and fences interaction validators on cancellation', async () => {
    const registry = new WorkflowRegistry();
    const entered = deferred<void>();
    const aborted = deferred<void>();
    registry.registerActivity({
      name: 'deferred-validator',
      handler: async ({ signal }) => {
        entered.resolve();
        await new Promise<void>((resolve) => signal!.addEventListener('abort', () => {
          aborted.resolve();
          resolve();
        }, { once: true }));
        return true;
      },
    });
    registry.create({
      name: 'cancel-validator',
      flow: flow(requestAndWait('approval', 'approval.response', {
        validator: { name: 'deferred-validator' },
      })),
    });
    const service = createService(registry);
    const instanceId = await service.start('cancel-validator', {}, 'owner');
    const interaction = getWorkflowGraphRuntime(service).listInteractions(instanceId)[0]!;
    const submission = getWorkflowGraphRuntime(service).submitInteraction({
      interactionId: interaction.interactionId,
      submissionId: 'deferred',
      actor: { actorId: 'owner' },
      payload: { approved: true },
    });
    await entered.promise;
    service.cancel(instanceId);
    await aborted.promise;
    await expect(submission).rejects.toBeDefined();
    expect(service.get(instanceId)?.status).toBe('cancelled');
    expect(getWorkflowGraphRuntime(service).listInteractions(instanceId)[0]?.status).toBe('cancelled');
  });

  test('fences validator submissions across pause and leaves no direct reservation behind', async () => {
    const registry = new WorkflowRegistry();
    const entered = deferred<void>();
    let calls = 0;
    registry.registerActivity({
      name: 'pause-validator',
      handler: async ({ signal }) => {
        calls += 1;
        if (calls > 1) return true;
        entered.resolve();
        await new Promise<void>((resolve) => signal!.addEventListener('abort', () => resolve(), {
          once: true,
        }));
        return true;
      },
    });
    registry.create({
      name: 'pause-validator-run',
      flow: flow(requestAndWait('approval', 'approval.response', {
        validator: { name: 'pause-validator' },
      })),
    });
    const service = createService(registry);
    const instanceId = await service.start('pause-validator-run', {}, 'owner');
    const interaction = getWorkflowGraphRuntime(service).listInteractions(instanceId)[0]!;
    const first = getWorkflowGraphRuntime(service).submitInteraction({
      interactionId: interaction.interactionId,
      submissionId: 'before-pause',
      actor: { actorId: 'owner' },
      payload: true,
    });
    await entered.promise;
    service.pause(instanceId);
    await expect(first).rejects.toBeDefined();
    expect(service.get(instanceId)?.status).toBe('paused');
    expect(getWorkflowGraphRuntime(service).listInteractions(instanceId)[0]?.status).toBe('open');

    await expect(getWorkflowGraphRuntime(service).submitInteraction({
      interactionId: interaction.interactionId,
      submissionId: 'while-paused',
      actor: { actorId: 'owner' },
      payload: true,
    })).rejects.toMatchObject({ code: 'WORKFLOW_DRAINING', status: 409, retryable: true });
    expect(service.get(instanceId)?.status).toBe('paused');
    expect(Number((db.prepare(`SELECT COUNT(*) AS count
      FROM _workflow_interaction_responses WHERE interaction_id = ?`)
      .get(interaction.interactionId) as { count: number }).count)).toBe(0);
    await service.resume(instanceId);
    const accepted = await getWorkflowGraphRuntime(service).submitInteraction({
      interactionId: interaction.interactionId,
      submissionId: 'after-resume',
      actor: { actorId: 'owner' },
      payload: true,
    });
    expect(accepted.outcome).toBe('accepted');
    expect(service.get(instanceId)?.status).toBe('completed');
  });

  test('rejects a paused direct response before authority, validation, or persistence', async () => {
    const registry = new WorkflowRegistry();
    registry.create({
      name: 'paused-direct-response',
      flow: flow(requestAndWait('approval', 'approval.response')),
    });
    let authorityCalls = 0;
    const service = createService(registry, undefined, {
      interactionAuthority: new WorkflowInteractionAuthority(() => {
        authorityCalls += 1;
        return true;
      }),
    });
    const instanceId = await service.start('paused-direct-response', {}, 'owner');
    const interaction = getWorkflowGraphRuntime(service).listInteractions(instanceId)[0]!;
    service.pause(instanceId);

    await expect(getWorkflowGraphRuntime(service).submitInteraction({
      interactionId: interaction.interactionId,
      submissionId: 'paused',
      actor: { actorId: 'delegate' },
      payload: true,
    })).rejects.toMatchObject({ code: 'WORKFLOW_DRAINING', status: 409, retryable: true });
    expect(authorityCalls).toBe(0);
    expect(db.prepare(`SELECT response_id FROM _workflow_interaction_responses
      WHERE interaction_id = ?`).get(interaction.interactionId)).toBeNull();
  });

  test('aborts a deferred authority before a validator can start', async () => {
    const registry = new WorkflowRegistry();
    const authorityEntered = deferred<void>();
    const releaseAuthority = deferred<void>();
    let validatorCalls = 0;
    registry.registerActivity({
      name: 'authority-race-validator',
      handler: async () => {
        validatorCalls += 1;
        return true;
      },
    });
    registry.create({
      name: 'authority-race',
      flow: flow(requestAndWait('approval', 'approval.response', {
        validator: { name: 'authority-race-validator' },
      })),
    });
    const service = createService(registry, undefined, {
      interactionAuthority: new WorkflowInteractionAuthority(async () => {
        authorityEntered.resolve();
        await releaseAuthority.promise;
        return true;
      }),
    });
    const instanceId = await service.start('authority-race', {}, 'owner');
    const interaction = getWorkflowGraphRuntime(service).listInteractions(instanceId)[0]!;
    const submission = getWorkflowGraphRuntime(service).submitInteraction({
      interactionId: interaction.interactionId,
      submissionId: 'authority-paused',
      actor: { actorId: 'delegate' },
      payload: true,
    });
    await authorityEntered.promise;
    service.pause(instanceId);
    await expect(Promise.resolve().then(() => service.resume(instanceId)))
      .rejects.toMatchObject({ code: 'WORKFLOW_DRAINING', status: 409, retryable: true });
    releaseAuthority.resolve();

    await expect(submission).rejects.toMatchObject({ code: 'WORKFLOW_DRAINING', status: 409 });
    expect(validatorCalls).toBe(0);
    expect(db.prepare(`SELECT response_id FROM _workflow_interaction_responses
      WHERE interaction_id = ?`).get(interaction.interactionId)).toBeNull();
  });

  test('fences an abort-ignoring authority after shutdown before the database closes', async () => {
    const localDb = createReactiveDB({ mode: 'memory' });
    defineWorkflowTables(localDb);
    const registry = new WorkflowRegistry();
    registry.create({
      name: 'shutdown-authority',
      flow: flow(requestAndWait('approval', 'approval.response')),
    });
    const entered = deferred<void>();
    const release = deferred<void>();
    const service = new WorkflowService(localDb, registry, {
      shutdownGraceMs: 0,
      interactionAuthority: new WorkflowInteractionAuthority(async ({ signal }) => {
        expect(signal).toBeInstanceOf(AbortSignal);
        entered.resolve();
        await release.promise;
        return true;
      }),
    });
    const instanceId = await service.start('shutdown-authority', {}, 'owner');
    const interaction = getWorkflowGraphRuntime(service).listInteractions(instanceId)[0]!;
    const submission = getWorkflowGraphRuntime(service).submitInteraction({
      interactionId: interaction.interactionId,
      submissionId: 'shutdown',
      actor: { actorId: 'delegate' },
      payload: true,
    });
    await entered.promise;
    await service.dispose();
    expect(localDb.prepare(`SELECT response_id FROM _workflow_interaction_responses
      WHERE interaction_id = ?`).get(interaction.interactionId)).toBeNull();
    localDb.dispose();
    release.resolve();

    await expect(submission).rejects.toMatchObject({ code: 'WORKFLOW_NOT_READY', status: 503 });
  });

  test('aborts in-flight interaction authority when a parallel branch terminates the run', async () => {
    const registry = new WorkflowRegistry();
    const failureEntered = deferred<void>();
    const releaseFailure = deferred<void>();
    const authorityEntered = deferred<void>();
    const authorityAborted = deferred<void>();
    registry.registerActivity({
      name: 'terminal-failure',
      handler: async () => {
        failureEntered.resolve();
        await releaseFailure.promise;
        throw new Error('parallel branch failed');
      },
    });
    registry.create({
      name: 'terminal-authority',
      flow: flow(parallel('race', {
        approval: [requestAndWait('approval', 'approval.response')],
        failure: [step('failure', 'terminal-failure', { retries: 1 })],
      })),
    });
    const service = createService(registry, undefined, {
      interactionAuthority: new WorkflowInteractionAuthority(async ({ signal }) => {
        authorityEntered.resolve();
        return new Promise<boolean>((_resolve, reject) => {
          signal!.addEventListener('abort', () => {
            authorityAborted.resolve();
            reject(signal!.reason);
          }, { once: true });
        });
      }),
    });
    const starting = service.start('terminal-authority', {}, 'owner');
    await failureEntered.promise;
    const instanceId = workflowInstanceId('terminal-authority');
    const interaction = getWorkflowGraphRuntime(service).listInteractions(instanceId)[0]!;
    const submission = getWorkflowGraphRuntime(service).submitInteraction({
      interactionId: interaction.interactionId,
      submissionId: 'terminal-race',
      actor: { actorId: 'delegate' },
      payload: true,
    });
    await authorityEntered.promise;
    releaseFailure.resolve();
    expect(await starting).toBe(instanceId);
    await authorityAborted.promise;
    await expect(submission).rejects.toMatchObject({
      code: 'WORKFLOW_STATE_INVALID', status: 409,
    });
    expect(service.get(instanceId)?.status).toBe('failed');
    expect(db.prepare(`SELECT response_id FROM _workflow_interaction_responses
      WHERE interaction_id = ?`).get(interaction.interactionId)).toBeNull();
  });

  test('supersedes direct processing responses atomically when a run becomes terminal', async () => {
    const entered = deferred<void>();
    const release = deferred<void>();
    const registry = new WorkflowRegistry();
    registry.registerActivity({
      name: 'slow-terminal-validator',
      handler: async () => {
        entered.resolve();
        await release.promise;
        return true;
      },
    });
    registry.create({
      name: 'terminal-processing-response',
      flow: flow(requestAndWait('approval', 'approval.response', {
        validator: { name: 'slow-terminal-validator' },
      })),
    });
    const clock = new ManualClock();
    const service = createService(registry, clock, {
      interactionAuthority: TEST_SYSTEM_INTERACTION_AUTHORITY,
    });
    const instanceId = await service.start('terminal-processing-response', {}, 'owner');
    const interaction = getWorkflowGraphRuntime(service).listInteractions(instanceId)[0]!;
    const pending = getWorkflowGraphRuntime(service).submitInteraction({
      interactionId: interaction.interactionId,
      submissionId: 'slow-web-response',
      actor: {
        actorId: 'owner',
        claims: { system: true, principal: 'owner' },
      },
      payload: { approved: true },
      channel: 'web',
    });
    await entered.promise;

    service.cancel(instanceId);
    expect(db.prepare(`SELECT status, origin, event_id FROM _workflow_interaction_responses
      WHERE interaction_id = ? AND submission_id = ?`).get(
      interaction.interactionId,
      'slow-web-response',
    )).toEqual({ status: 'superseded', origin: 'external', event_id: null });
    expect(db.prepare(`SELECT COUNT(*) AS count FROM _workflow_interaction_responses
      WHERE interaction_id = ? AND status = 'processing'`).get(interaction.interactionId))
      .toEqual({ count: 0 });

    release.resolve();
    await expect(pending).rejects.toThrow('Workflow cancelled');
    await service.dispose();
    // Simulate a crash-left row written by a release predating atomic
    // terminal cleanup. Runtime construction must reconcile it before any
    // recovery publication can expose the terminal run.
    db.prepare(`UPDATE _workflow_interaction_responses
      SET status = 'processing', decided_at = NULL
      WHERE interaction_id = ? AND submission_id = ?`).run(
      interaction.interactionId,
      'slow-web-response',
    );
    clock.advance(1_000);
    const standaloneExecutor = new WorkflowExecutor(db, registry, undefined, clock);
    await standaloneExecutor.dispose();
    const restarted = createService(registry, clock, {
      interactionAuthority: TEST_SYSTEM_INTERACTION_AUTHORITY,
    });
    expect(db.prepare(`SELECT status, created_at, decided_at
      FROM _workflow_interaction_responses
      WHERE interaction_id = ? AND submission_id = ?`).get(
      interaction.interactionId,
      'slow-web-response',
    )).toEqual({
      status: 'superseded',
      created_at: clockTimestamp(clock, -1_000),
      decided_at: clockTimestamp(clock),
    });
    const timestamps = db.prepare(`SELECT opened_at, updated_at
      FROM workflow_interactions WHERE interaction_id = ?`).get(
      interaction.interactionId,
    ) as { opened_at: string; updated_at: string };
    expect(Date.parse(timestamps.updated_at)).toBeGreaterThanOrEqual(
      Date.parse(timestamps.opened_at),
    );
    await restarted.recoverInFlight();
    expect(db.prepare(`SELECT COUNT(*) AS count FROM _workflow_interaction_responses
      WHERE interaction_id = ? AND status = 'processing'`).get(interaction.interactionId))
      .toEqual({ count: 0 });
  });

  test('aborts and drains interaction validators during runtime disposal', async () => {
    const registry = new WorkflowRegistry();
    const entered = deferred<void>();
    const aborted = deferred<void>();
    registry.registerActivity({
      name: 'shutdown-validator',
      handler: async ({ signal }) => {
        entered.resolve();
        await new Promise<void>((resolve) => signal!.addEventListener('abort', () => {
          aborted.resolve();
          resolve();
        }, { once: true }));
        return true;
      },
    });
    registry.create({
      name: 'shutdown-validator-run',
      flow: flow(requestAndWait('approval', 'approval.response', {
        validator: { name: 'shutdown-validator' },
      })),
    });
    const service = createService(registry);
    const instanceId = await service.start('shutdown-validator-run', {}, 'owner');
    const interaction = getWorkflowGraphRuntime(service).listInteractions(instanceId)[0]!;
    const submission = getWorkflowGraphRuntime(service).submitInteraction({
      interactionId: interaction.interactionId,
      submissionId: 'shutdown',
      actor: { actorId: 'owner' },
      payload: true,
    });
    await entered.promise;
    await service.dispose();
    await aborted.promise;
    await expect(submission).rejects.toMatchObject({ code: 'WORKFLOW_NOT_READY' });
    expect(getWorkflowGraphRuntime(service).listInteractions(instanceId)[0]?.status).toBe('open');
  });
});

test('graph pump never loses a trigger at an active-pump boundary', async () => {
  const entered = deferred<void>();
  const release = deferred<void>();
  let calls = 0;
  const pump = new WorkflowGraphPump(async () => {
    calls += 1;
    if (calls === 1) {
      entered.resolve();
      await release.promise;
    }
  });
  const first = pump.advance('instance');
  await entered.promise;
  const second = pump.advance('instance');
  release.resolve();
  await Promise.all([first, second]);
  expect(calls).toBeGreaterThanOrEqual(2);
  pump.stop();
  await pump.drain();
});

function createService(
  registry: WorkflowRegistry,
  clock?: WorkflowClock,
  options: WorkflowServiceOptions = {},
): WorkflowService {
  const service = new WorkflowService(db, registry, {
    ...options,
    clock,
    shutdownGraceMs: options.shutdownGraceMs ?? 25,
  });
  services.push(service);
  return service;
}

const TEST_SYSTEM_INTERACTION_AUTHORITY = new WorkflowInteractionAuthority(({ actor }) => (
  actor.claims?.system === true && actor.claims?.principal === 'owner'
));

function sendSystemEvent(
  service: WorkflowService,
  instanceId: string,
  eventName: string,
  payload: unknown,
  principal = 'owner',
): Promise<boolean> {
  return service.sendEventAsSystem(instanceId, eventName, payload, {
    principal,
    reason: 'Exercise a trusted workflow interaction event in tests',
  });
}

function graphCoordinationCounts(instanceId: string) {
  const count = (table: string) => Number((db.prepare(
    `SELECT COUNT(*) AS count FROM ${table} WHERE instance_id = ?`,
  ).get(instanceId) as { count: number }).count);
  return {
    decisions: count('_workflow_decisions'),
    items: count('_workflow_each_items'),
    interactions: count('workflow_interactions'),
    steps: count('workflow_steps'),
  };
}

function eventUsage(instanceId: string) {
  return db.prepare(`SELECT total_count, total_bytes, queued_count, queued_bytes, revision
    FROM _workflow_event_usage WHERE instance_id = ? LIMIT 1`).get(instanceId) as {
      total_count: number;
      total_bytes: number;
      queued_count: number;
      queued_bytes: number;
      revision: number;
    };
}

function consumedEventCount(instanceId: string): number {
  return Number((db.prepare(`SELECT COUNT(*) AS count
    FROM _workflow_event_delivery
    WHERE instance_id = ? AND claimed_by_step_id LIKE 'consumed:%'`)
    .get(instanceId) as { count: number }).count);
}

function workflowVersionCount(name: string): number {
  return Number((db.prepare(`
    SELECT COUNT(*) AS count FROM workflow_definition_versions
    WHERE definition_id = (SELECT definition_id FROM workflow_definitions WHERE name = ?)
  `).get(name) as { count: number }).count);
}

function workflowInstanceId(name: string): string {
  return (db.prepare(`SELECT instance_id FROM workflow_instances
    WHERE name = ? ORDER BY rowid DESC LIMIT 1`).get(name) as { instance_id: string }).instance_id;
}

function serviceStep(instanceId: string, parentStepId: string | null) {
  return db.prepare(`SELECT * FROM workflow_steps
    WHERE instance_id = ? AND parent_step_id IS ? ORDER BY rowid ASC LIMIT 1`)
    .get(instanceId, parentStepId) as { step_id: string };
}

function eachItem(instanceId: string) {
  return db.prepare(`SELECT status, output_json, error FROM _workflow_each_items
    WHERE instance_id = ? ORDER BY rowid ASC LIMIT 1`).get(instanceId) as {
      status: string;
      output_json: string | null;
      error: string | null;
    };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

class ManualClock implements WorkflowClock {
  private milliseconds = Date.parse('2030-01-01T00:00:00.000Z');
  now(): Date { return new Date(this.milliseconds); }
  advance(milliseconds: number): void { this.milliseconds += milliseconds; }
}

function clockTimestamp(clock: WorkflowClock, offset = 0): string {
  return new Date(clock.now().getTime() + offset).toISOString();
}
