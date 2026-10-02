/**
 * Deterministic event-inbox and cancellation transition matrix.
 *
 * The assertions cover both public workflow rows and the durable coordination
 * rows that make buffered delivery and attempt fencing restart-safe.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';

import { createReactiveDB, type ReactiveDB } from '../sync/reactive-db';
import { flow, parallel, requestAndWait, step, waitFor } from './workflow-dsl';
import { validateWorkflowGraphEventState } from './workflow-event-persisted-state';
import type { WorkflowClock } from './workflow-executor';
import { WorkflowInteractionAuthority } from './workflow-interaction-authority';
import { WorkflowInteractionEventBridge } from './workflow-interaction-event-bridge';
import type { WorkflowInteractionStore } from './workflow-interaction-store';
import { WorkflowRegistry } from './workflow-registry';
import { WorkflowRuntimeStore } from './workflow-runtime-store';
import { defineWorkflowTables } from './workflow-schema';
import { WorkflowService } from './workflow-service';
import type { StepContext } from './types';

const START = Date.parse('2035-04-05T06:07:08.000Z');

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

describe('workflow event delivery matrix', () => {
  test('recovers an accepted interaction event and completes its wait atomically', async () => {
    const registry = new WorkflowRegistry();
    registry.create({
      name: 'accepted-event-recovery',
      flow: flow(
        requestAndWait('approval', 'approval.responded'),
        waitFor('later', 'later.event'),
      ),
    });
    const first = track(new WorkflowService(db, registry));
    const instanceId = await first.start('accepted-event-recovery', {}, 'owner');
    const approval = first.getSteps(instanceId).find((row) => row.node_id === 'approval')!;
    const runtime = (first as unknown as { runtime: WorkflowRuntimeStore }).runtime;
    const interaction = first.getGraphRuntime().listInteractions(instanceId)[0]!;
    const eventId = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    const payload = JSON.stringify({ approved: true });
    const actorJson = JSON.stringify({ actorId: 'owner' });
    db.transaction(() => {
      db.insert('workflow_events', {
        event_id: eventId,
        instance_id: instanceId,
        event_name: 'approval.responded',
        payload,
        sent_by: 'owner',
        created_at: createdAt,
      });
      runtime.recordDeliverableEvent(
        eventId,
        instanceId,
        'approval.responded',
        createdAt,
        actorJson,
        Buffer.byteLength(payload),
        Buffer.byteLength(actorJson),
      );
    });
    expect(runtime.claimEvent(
      instanceId,
      approval.step_id,
      'approval.responded',
      createdAt,
    )?.eventId).toBe(eventId);
    await expect(first.getGraphRuntime().interactions.submitClaimedEvent({
      interactionId: interaction.interactionId,
      eventId,
      actor: { actorId: 'owner' },
      payload: { approved: true },
    })).resolves.toMatchObject({ outcome: 'accepted' });

    expect(db.query('workflow_interactions')[0]?.status).toBe('accepted');
    expect(first.getSteps(instanceId).find((row) => row.node_id === 'approval')?.status)
      .toBe('waiting');
    const deliveryBefore = db.prepare(`SELECT event_id, claimed_by_step_id
      FROM _workflow_event_delivery WHERE event_id = ?`).get(eventId) as {
        event_id: string; claimed_by_step_id: string | null;
    };
    expect(deliveryBefore.claimed_by_step_id).toBe(approval.step_id);
    const queuedBytes = Buffer.byteLength(payload) + Buffer.byteLength(actorJson);
    const usageBefore = db.prepare(`SELECT queued_count, queued_bytes, revision
      FROM _workflow_event_usage WHERE instance_id = ?`).get(instanceId);
    expect(usageBefore).toEqual({
      queued_count: 1,
      queued_bytes: queuedBytes,
      revision: 2,
    });

    db.exec(`CREATE TRIGGER test_reject_accepted_wait_completion
      BEFORE UPDATE OF status ON workflow_steps
      WHEN NEW.step_id = '${approval.step_id}' AND NEW.status = 'completed'
      BEGIN SELECT RAISE(ABORT, 'simulated accepted wait completion failure'); END`);
    try {
      expect(() => db.transaction(() => {
        runtime.consumeAcceptedInteractionEvent(
          approval.step_id,
          instanceId,
          eventId,
        );
        db.update('workflow_steps', approval.step_id, { status: 'completed' });
      })).toThrow('simulated accepted wait completion failure');
    } finally {
      db.exec('DROP TRIGGER test_reject_accepted_wait_completion');
    }
    expect(first.getSteps(instanceId).find((row) => row.node_id === 'approval')?.status)
      .toBe('waiting');
    expect(db.prepare(`SELECT claimed_by_step_id FROM _workflow_event_delivery
      WHERE event_id = ?`).get(eventId)).toEqual({
      claimed_by_step_id: approval.step_id,
    });
    expect(db.prepare(`SELECT queued_count, queued_bytes, revision
      FROM _workflow_event_usage WHERE instance_id = ?`).get(instanceId))
      .toEqual(usageBefore);

    await first.dispose();
    const second = track(new WorkflowService(db, registry));
    await second.recoverInFlight();
    await second.advance(instanceId);

    expect(second.get(instanceId)?.status).toBe('running');
    expect(second.getSteps(instanceId).find((row) => row.node_id === 'approval')?.status)
      .toBe('completed');
    expect(second.getSteps(instanceId).find((row) => row.node_id === 'later')?.status)
      .toBe('waiting');
    expect(db.prepare(`SELECT claimed_by_step_id FROM _workflow_event_delivery
      WHERE event_id = ?`).get(deliveryBefore.event_id)).toEqual({
      claimed_by_step_id: `consumed:${deliveryBefore.event_id}`,
    });
    expect(db.prepare(`SELECT queued_count, queued_bytes, revision
      FROM _workflow_event_usage WHERE instance_id = ?`).get(instanceId)).toEqual({
      queued_count: 0,
      queued_bytes: 0,
      revision: 3,
    });
    expect(() => validateWorkflowGraphEventState(db, instanceId)).not.toThrow();
  });

  test('reconciles a claimed event when an external response wins an async authority race', async () => {
    const eventAuthorityEntered = deferred<void>();
    const releaseEventAuthority = deferred<void>();
    const interactionAuthority = new WorkflowInteractionAuthority(async ({ actor }) => {
      if (actor.actorId !== 'event-responder') return true;
      eventAuthorityEntered.resolve();
      await releaseEventAuthority.promise;
      return true;
    });
    const registry = new WorkflowRegistry();
    registry.create({
      name: 'external-response-race',
      flow: flow(
        requestAndWait('approval', 'approval.responded'),
        waitFor('later', 'later.event'),
      ),
    });
    const service = track(new WorkflowService(db, registry, { interactionAuthority }));
    const instanceId = await service.start('external-response-race', {}, 'owner');
    const approval = service.getSteps(instanceId).find((row) => row.node_id === 'approval')!;
    const runtime = (service as unknown as { runtime: WorkflowRuntimeStore }).runtime;
    const graph = service.getGraphRuntime();
    const interaction = graph.listInteractions(instanceId)[0]!;
    const eventId = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    const payload = JSON.stringify({ approved: 'event' });
    const actorJson = JSON.stringify({ actorId: 'event-responder' });
    db.transaction(() => {
      db.insert('workflow_events', {
        event_id: eventId,
        instance_id: instanceId,
        event_name: 'approval.responded',
        payload,
        sent_by: 'event-responder',
        created_at: createdAt,
      });
      runtime.recordDeliverableEvent(
        eventId,
        instanceId,
        'approval.responded',
        createdAt,
        actorJson,
        Buffer.byteLength(payload),
        Buffer.byteLength(actorJson),
      );
    });

    const advancing = service.advance(instanceId);
    await eventAuthorityEntered.promise;
    await expect(graph.interactions.submit({
      interactionId: interaction.interactionId,
      submissionId: 'external-winner',
      actor: { actorId: 'owner' },
      payload: { approved: 'external' },
      channel: 'web',
    })).resolves.toMatchObject({ outcome: 'accepted' });
    releaseEventAuthority.resolve();
    await expect(advancing).resolves.toBeUndefined();

    expect(service.getSteps(instanceId).find((row) => row.node_id === 'approval')?.status)
      .toBe('completed');
    expect(service.getSteps(instanceId).find((row) => row.node_id === 'later')?.status)
      .toBe('waiting');
    expect(graph.interactions.getSubmission(
      interaction.interactionId,
      `event:${eventId}`,
    )).toBeNull();
    expect(graph.interactions.getSubmission(
      interaction.interactionId,
      'external-winner',
    )).toMatchObject({ status: 'accepted' });
    expect(db.prepare(`SELECT claimed_by_step_id FROM _workflow_event_delivery
      WHERE event_id = ?`).get(eventId)).toEqual({
      claimed_by_step_id: `consumed:${eventId}`,
    });
    expect(db.prepare(`SELECT queued_count, queued_bytes FROM _workflow_event_usage
      WHERE instance_id = ?`).get(instanceId)).toEqual({
      queued_count: 0,
      queued_bytes: 0,
    });
    expect(() => validateWorkflowGraphEventState(db, instanceId)).not.toThrow();
  });

  test('releases a crash-left processing event response after an external winner', async () => {
    const registry = new WorkflowRegistry();
    registry.create({
      name: 'processing-event-recovery',
      flow: flow(
        requestAndWait('approval', 'approval.responded'),
        waitFor('later', 'later.event'),
      ),
    });
    const service = track(new WorkflowService(db, registry));
    const instanceId = await service.start('processing-event-recovery', {}, 'owner');
    const approval = service.getSteps(instanceId).find((row) => row.node_id === 'approval')!;
    const runtime = (service as unknown as { runtime: WorkflowRuntimeStore }).runtime;
    const graph = service.getGraphRuntime();
    const interaction = graph.listInteractions(instanceId)[0]!;
    const store = (graph.interactions as unknown as {
      store: WorkflowInteractionStore;
    }).store;
    const eventId = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    const payload = JSON.stringify({ approved: 'event' });
    const actorJson = JSON.stringify({ actorId: 'owner' });
    db.transaction(() => {
      db.insert('workflow_events', {
        event_id: eventId,
        instance_id: instanceId,
        event_name: 'approval.responded',
        payload,
        sent_by: 'owner',
        created_at: createdAt,
      });
      runtime.recordDeliverableEvent(
        eventId,
        instanceId,
        'approval.responded',
        createdAt,
        actorJson,
        Buffer.byteLength(payload),
        Buffer.byteLength(actorJson),
      );
    });
    expect(runtime.claimEvent(
      instanceId,
      approval.step_id,
      'approval.responded',
      createdAt,
    )?.eventId).toBe(eventId);
    expect(store.beginSubmission({
      interactionId: interaction.interactionId,
      submissionId: `event:${eventId}`,
      actorId: 'owner',
      channel: 'event',
      payloadHash: createHash('sha256').update(payload).digest('hex'),
      payloadJson: payload,
      now: createdAt,
      requireRunningInstance: true,
    })).toMatchObject({ status: 'processing', channel: 'event' });
    await expect(graph.interactions.submit({
      interactionId: interaction.interactionId,
      submissionId: 'external-after-crash',
      actor: { actorId: 'owner' },
      payload: { approved: 'external' },
      channel: 'web',
    })).resolves.toMatchObject({ outcome: 'accepted' });
    expect(db.prepare(`SELECT response_count FROM _workflow_interaction_details
      WHERE interaction_id = ?`).get(interaction.interactionId)).toEqual({ response_count: 2 });

    await service.advance(instanceId);

    expect(service.getSteps(instanceId).find((row) => row.node_id === 'approval')?.status)
      .toBe('completed');
    expect(service.getSteps(instanceId).find((row) => row.node_id === 'later')?.status)
      .toBe('waiting');
    expect(graph.interactions.getSubmission(
      interaction.interactionId,
      `event:${eventId}`,
    )).toBeNull();
    expect(db.prepare(`SELECT response_count FROM _workflow_interaction_details
      WHERE interaction_id = ?`).get(interaction.interactionId)).toEqual({ response_count: 1 });
    expect(db.prepare(`SELECT claimed_by_step_id FROM _workflow_event_delivery
      WHERE event_id = ?`).get(eventId)).toEqual({
      claimed_by_step_id: `consumed:${eventId}`,
    });
    expect(db.prepare(`SELECT queued_count, queued_bytes FROM _workflow_event_usage
      WHERE instance_id = ?`).get(instanceId)).toEqual({
      queued_count: 0,
      queued_bytes: 0,
    });
    expect(() => validateWorkflowGraphEventState(db, instanceId)).not.toThrow();
  });

  test('does not claim a later event from a stale open interaction snapshot', async () => {
    const registry = new WorkflowRegistry();
    registry.create({
      name: 'stale-open-interaction',
      flow: flow(
        requestAndWait('approval', 'approval.responded'),
        waitFor('later', 'approval.responded'),
      ),
    });
    const service = track(new WorkflowService(db, registry));
    const instanceId = await service.start('stale-open-interaction', {}, 'owner');
    const approval = service.getSteps(instanceId).find((row) => row.node_id === 'approval')!;
    const runtime = (service as unknown as { runtime: WorkflowRuntimeStore }).runtime;
    const graph = service.getGraphRuntime();
    const staleOpenInteraction = graph.listInteractions(instanceId)[0]!;
    await expect(graph.interactions.submit({
      interactionId: staleOpenInteraction.interactionId,
      submissionId: 'external-before-later-event',
      actor: { actorId: 'owner' },
      payload: { approved: true },
      channel: 'web',
    })).resolves.toMatchObject({ outcome: 'accepted' });

    const eventId = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    const payload = JSON.stringify({ for: 'later' });
    const actorJson = JSON.stringify({ actorId: 'later-responder' });
    db.transaction(() => {
      db.insert('workflow_events', {
        event_id: eventId,
        instance_id: instanceId,
        event_name: 'approval.responded',
        payload,
        sent_by: 'later-responder',
        created_at: createdAt,
      });
      runtime.recordDeliverableEvent(
        eventId,
        instanceId,
        'approval.responded',
        createdAt,
        actorJson,
        Buffer.byteLength(payload),
        Buffer.byteLength(actorJson),
      );
    });

    const bridge = new WorkflowInteractionEventBridge(runtime, graph.interactions);
    await expect(bridge.consume({
      instanceId,
      nodeId: 'approval',
      stepId: approval.step_id,
      eventName: 'approval.responded',
      interaction: staleOpenInteraction,
    })).resolves.toMatchObject({ status: 'accepted' });
    expect(db.prepare(`SELECT claimed_by_step_id FROM _workflow_event_delivery
      WHERE event_id = ?`).get(eventId)).toEqual({ claimed_by_step_id: null });

    await service.advance(instanceId);

    expect(service.get(instanceId)?.status).toBe('completed');
    expect(service.getSteps(instanceId).find((row) => row.node_id === 'approval')?.status)
      .toBe('completed');
    expect(service.getSteps(instanceId).find((row) => row.node_id === 'later')?.status)
      .toBe('completed');
    expect(db.prepare(`SELECT claimed_by_step_id FROM _workflow_event_delivery
      WHERE event_id = ?`).get(eventId)).toEqual({
      claimed_by_step_id: `consumed:${eventId}`,
    });
    expect(() => validateWorkflowGraphEventState(db, instanceId)).not.toThrow();
  });

  test('keeps an event buffered while paused and claims it only after resume', async () => {
    const registry = new WorkflowRegistry();
    let received: StepContext['waitEvent'];
    registry.registerHandler('paused-event-handler', async (context) => {
      received = context.waitEvent;
      return 'accepted';
    });
    registry.create({
      name: 'paused-event',
      steps: [{
        name: 'Wait while paused',
        handler: 'paused-event-handler',
        waitFor: 'continue',
      }],
    });
    const service = track(new WorkflowService(db, registry));
    const instanceId = await service.start('paused-event');

    service.pause(instanceId);
    expect(await service.sendEvent(instanceId, 'continue', { value: 42 })).toBe(false);
    expect(received).toBeUndefined();
    expect(deliveryRows()).toEqual([{
      event_name: 'continue',
      claimed_by_step_id: null,
    }]);

    await service.resume(instanceId);
    expect(received).toMatchObject({
      name: 'continue',
      payload: { value: 42 },
    });
    expect(service.get(instanceId)?.status).toBe('completed');
    expect(deliveryRows()).toEqual([{
      event_name: 'continue',
      claimed_by_step_id: expect.stringMatching(/^consumed:/),
    }]);
  });

  test('leaves nonmatching events buffered while the matching event advances the frontier', async () => {
    const registry = new WorkflowRegistry();
    let received: StepContext['waitEvent'];
    registry.registerHandler('matching-event-handler', async (context) => {
      received = context.waitEvent;
      return null;
    });
    registry.create({
      name: 'matching-event',
      steps: [{
        name: 'Wait for alpha',
        handler: 'matching-event-handler',
        waitFor: 'alpha',
      }],
    });
    const service = track(new WorkflowService(db, registry));
    const instanceId = await service.start('matching-event');

    expect(await service.sendEvent(instanceId, 'beta', { sequence: 1 })).toBe(false);
    expect(service.get(instanceId)?.status).toBe('running');
    expect(received).toBeUndefined();

    expect(await service.sendEvent(instanceId, 'alpha', { sequence: 2 })).toBe(true);
    expect(received).toMatchObject({ name: 'alpha', payload: { sequence: 2 } });
    expect(service.get(instanceId)?.status).toBe('completed');
    expect(deliveryRows()).toEqual([
      { event_name: 'beta', claimed_by_step_id: expect.stringMatching(/^discarded:/) },
      { event_name: 'alpha', claimed_by_step_id: expect.stringMatching(/^consumed:/) },
    ]);
    expect(() => validateWorkflowGraphEventState(db, instanceId)).not.toThrow();
  });

  test('rejects terminal-instance events without partially inserting either durable row', async () => {
    const registry = new WorkflowRegistry();
    registry.registerHandler('complete-now', async () => 'done');
    registry.registerHandler('fail-now', async () => {
      throw new Error('terminal failure');
    });
    registry.registerHandler('wait-forever', async () => null);
    registry.create({
      name: 'terminal-completed',
      steps: [{ name: 'Complete', handler: 'complete-now' }],
    });
    registry.create({
      name: 'terminal-failed',
      steps: [{ name: 'Fail', handler: 'fail-now', retries: 1 }],
    });
    registry.create({
      name: 'terminal-cancelled',
      steps: [{ name: 'Wait', handler: 'wait-forever', waitFor: 'never' }],
    });
    const service = track(new WorkflowService(db, registry));
    const completedId = await service.start('terminal-completed');
    const failedId = await service.start('terminal-failed');
    const cancelledId = await service.start('terminal-cancelled');
    service.cancel(cancelledId);

    for (const instanceId of [completedId, failedId, cancelledId]) {
      const before = eventCounts();
      await expect(service.sendEvent(instanceId, 'too-late', { instanceId }))
        .rejects.toMatchObject({ code: 'WORKFLOW_STATE_INVALID', status: 409 });
      expect(eventCounts()).toEqual(before);
    }
  });

  test('turns a claimed malformed payload into a durable terminal failure', async () => {
    const registry = new WorkflowRegistry();
    let calls = 0;
    registry.registerHandler('invalid-payload-handler', async () => {
      calls += 1;
      return null;
    });
    registry.create({
      name: 'invalid-event-payload',
      steps: [{
        name: 'Decode event',
        handler: 'invalid-payload-handler',
        waitFor: 'continue',
      }],
    });
    const service = track(new WorkflowService(db, registry));
    const instanceId = await service.start('invalid-event-payload');
    const unsubscribe = db.onChange((change) => {
      if (change.table === 'workflow_events' && change.op === 'INSERT') {
        db.update('workflow_events', change.rowId, { payload: '{bad json' });
      }
    });

    try {
      expect(await service.sendEvent(instanceId, 'continue', { valid: 'before hook' }))
        .toBe(false);
    } finally {
      unsubscribe();
    }

    expect(calls).toBe(0);
    expect(service.get(instanceId)).toMatchObject({ status: 'failed' });
    expect(service.getSteps(instanceId)[0]).toMatchObject({
      status: 'failed',
      retry_at: null,
      timeout_at: null,
    });
    expect(String(service.getSteps(instanceId)[0]?.error))
      .toContain('Workflow event payload is invalid');
    expect(deliveryRows()).toEqual([{
      event_name: 'continue',
      claimed_by_step_id: expect.stringMatching(/^discarded:/),
    }]);
  });
});

describe('workflow cancellation matrix', () => {
  test('supersedes external processing responses atomically at cancellation', async () => {
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
    const service = track(new WorkflowService(db, registry));
    const instanceId = await service.start('terminal-processing-response', {}, 'owner');
    const interaction = service.getGraphRuntime().listInteractions(instanceId)[0]!;
    const pending = service.getGraphRuntime().submitInteraction({
      interactionId: interaction.interactionId,
      submissionId: 'slow-web-response',
      actor: { actorId: 'owner' },
      payload: { approved: true },
      channel: 'web',
    });
    await entered.promise;

    service.cancel(instanceId);
    expect(db.prepare(`SELECT status FROM _workflow_interaction_responses
      WHERE interaction_id = ? AND submission_id = ?`).get(
      interaction.interactionId,
      'slow-web-response',
    )).toEqual({ status: 'superseded' });
    expect(db.prepare(`SELECT COUNT(*) AS count FROM _workflow_interaction_responses
      WHERE interaction_id = ? AND status = 'processing'`).get(interaction.interactionId))
      .toEqual({ count: 0 });

    release.resolve();
    await expect(pending).rejects.toThrow('Workflow cancelled');
  });

  test('releases in-flight event responses and their byte accounting atomically', async () => {
    const entered = deferred<void>();
    const release = deferred<void>();
    const registry = new WorkflowRegistry();
    registry.registerActivity({
      name: 'slow-event-validator',
      handler: async () => {
        entered.resolve();
        await release.promise;
        return true;
      },
    });
    registry.create({
      name: 'terminal-event-response',
      flow: flow(requestAndWait('approval', 'approval.responded', {
        validator: { name: 'slow-event-validator' },
      })),
    });
    const service = track(new WorkflowService(db, registry));
    const instanceId = await service.start('terminal-event-response', {}, 'owner');
    const interaction = service.getGraphRuntime().listInteractions(instanceId)[0]!;
    const pending = service.sendEvent(
      instanceId,
      'approval.responded',
      { approved: true },
      'owner',
      { actorId: 'owner' },
    );
    await entered.promise;
    expect(interactionUsage(interaction.interactionId).response_count).toBe(1);

    service.cancel(instanceId);
    expect(db.prepare(`SELECT COUNT(*) AS count FROM _workflow_interaction_responses
      WHERE interaction_id = ?`).get(interaction.interactionId)).toEqual({ count: 0 });
    expect(interactionUsage(interaction.interactionId)).toEqual({
      response_count: 0,
      response_bytes: 0,
    });
    expect(deliveryRows()).toEqual([{
      event_name: 'approval.responded',
      claimed_by_step_id: expect.stringMatching(/^consumed:/),
    }]);

    release.resolve();
    // The event was durably accepted for the then-running workflow even though
    // cancellation won the later validation race and discarded its response.
    await expect(pending).resolves.toBe(true);
  });

  test('reconciles orphaned terminal interactions through tracked updates', async () => {
    const registry = new WorkflowRegistry();
    registry.create({
      name: 'terminal-reconciliation',
      flow: flow(requestAndWait('approval', 'approval.responded')),
    });
    const service = track(new WorkflowService(db, registry));
    const instanceId = await service.start('terminal-reconciliation');
    expect(db.query('workflow_interactions')[0]?.status).toBe('open');

    await service.dispose();
    db.prepare(`UPDATE workflow_instances
      SET status = 'failed', error = 'simulated terminal orphan'
      WHERE instance_id = ?`).run(instanceId);
    const interactionChanges: Array<{ op: string; status: unknown }> = [];
    const unsubscribe = db.onChange((change) => {
      if (change.table !== 'workflow_interactions') return;
      interactionChanges.push({ op: change.op, status: change.row?.status });
    });

    try {
      new WorkflowRuntimeStore(db);
      expect(db.query('workflow_interactions')[0]?.status).toBe('cancelled');
      expect(interactionChanges).toEqual([{ op: 'UPDATE', status: 'cancelled' }]);
    } finally {
      unsubscribe();
    }
  });

  test('publishes a tracked interaction cancellation when a parallel branch fails', async () => {
    const registry = new WorkflowRegistry();
    const releaseFailure = deferred<void>();
    registry.registerActivity({
      name: 'terminal-failure',
      handler: async () => {
        await releaseFailure.promise;
        throw new Error('parallel failure');
      },
    });
    registry.create({
      name: 'tracked-terminal-interaction',
      flow: flow(parallel('terminal-race', {
        approval: [requestAndWait('approval', 'approval.responded')],
        failure: [step('fail', 'terminal-failure', { retries: 1 })],
      })),
    });
    const service = track(new WorkflowService(db, registry));
    const interactionChanges: Array<{ op: string; status: unknown }> = [];
    const unsubscribe = db.onChange((change) => {
      if (change.table !== 'workflow_interactions') return;
      interactionChanges.push({ op: change.op, status: change.row?.status });
    });

    try {
      const starting = service.start('tracked-terminal-interaction');
      await eventually(() => db.query('workflow_interactions').length === 1);
      interactionChanges.length = 0;
      releaseFailure.resolve();
      const instanceId = await starting;

      expect(service.get(instanceId)?.status).toBe('failed');
      expect(db.query('workflow_interactions')[0]?.status).toBe('cancelled');
      expect(interactionChanges).toEqual([{ op: 'UPDATE', status: 'cancelled' }]);
    } finally {
      unsubscribe();
    }
  });

  test('cancels a waiting step and clears its deadline', async () => {
    const clock = new ManualClock();
    const registry = new WorkflowRegistry();
    let calls = 0;
    registry.registerHandler('waiting-cancel-handler', async () => {
      calls += 1;
      return null;
    });
    registry.create({
      name: 'cancel-waiting',
      steps: [{
        name: 'Waiting cancellation',
        handler: 'waiting-cancel-handler',
        waitFor: 'continue',
        timeoutMs: 100,
      }],
    });
    const service = track(new WorkflowService(db, registry, { clock }));
    const instanceId = await service.start('cancel-waiting');

    service.cancel(instanceId);
    clock.advance(100);
    expect(service.pollTimeouts()).toBe(0);
    expect(calls).toBe(0);
    expect(service.get(instanceId)?.status).toBe('cancelled');
    expect(service.getSteps(instanceId)[0]).toMatchObject({
      status: 'skipped',
      error: 'Workflow cancelled',
      retry_at: null,
      timeout_at: null,
    });
  });

  test('cancels a retry-scheduled step so it can never be dispatched again', async () => {
    const clock = new ManualClock();
    const registry = new WorkflowRegistry();
    let calls = 0;
    registry.registerHandler('retry-cancel-handler', async () => {
      calls += 1;
      throw new Error('retry later');
    });
    registry.create({
      name: 'cancel-retrying',
      steps: [{
        name: 'Retry cancellation',
        handler: 'retry-cancel-handler',
        retries: 3,
        backoffMs: 50,
      }],
    });
    const service = track(new WorkflowService(db, registry, { clock }));
    const instanceId = await service.start('cancel-retrying');
    expect(service.getSteps(instanceId)[0]).toMatchObject({
      status: 'failed',
      retry_at: iso(50),
    });

    service.cancel(instanceId);
    clock.advance(1_000);
    expect(await service.pollRetries()).toBe(0);
    expect(calls).toBe(1);
    expect(service.get(instanceId)?.status).toBe('cancelled');
    expect(service.getSteps(instanceId)[0]).toMatchObject({
      status: 'skipped',
      retry_at: null,
      timeout_at: null,
    });
  });

  test('preserves completed work and skips every remaining step on multistep cancellation', async () => {
    const registry = new WorkflowRegistry();
    const calls: string[] = [];
    registry.registerHandler('first-step', async () => {
      calls.push('first');
      return { first: true };
    });
    registry.registerHandler('second-step', async () => {
      calls.push('second');
      return { second: true };
    });
    registry.registerHandler('third-step', async () => {
      calls.push('third');
      return { third: true };
    });
    registry.create({
      name: 'cancel-multistep',
      steps: [
        { name: 'Already complete', handler: 'first-step' },
        { name: 'Waiting frontier', handler: 'second-step', waitFor: 'continue' },
        { name: 'Never reached', handler: 'third-step' },
      ],
    });
    const service = track(new WorkflowService(db, registry));
    const instanceId = await service.start('cancel-multistep');
    expect(calls).toEqual(['first']);

    service.cancel(instanceId);

    expect(service.get(instanceId)?.status).toBe('cancelled');
    expect(service.getSteps(instanceId).map((step) => step.status)).toEqual([
      'completed',
      'skipped',
      'skipped',
    ]);
    expect(service.getSteps(instanceId)[0]?.output).toBe(JSON.stringify({ first: true }));
    expect(calls).toEqual(['first']);
  });
});

function deliveryRows(): Array<{
  event_name: string;
  claimed_by_step_id: string | null;
}> {
  return db.prepare(`
    SELECT event_name, claimed_by_step_id
    FROM _workflow_event_delivery
    ORDER BY rowid ASC
  `).all() as Array<{ event_name: string; claimed_by_step_id: string | null }>;
}

function eventCounts(): { events: number; deliveries: number } {
  const events = db.prepare('SELECT COUNT(*) AS count FROM workflow_events')
    .get() as { count: number };
  const deliveries = db.prepare('SELECT COUNT(*) AS count FROM _workflow_event_delivery')
    .get() as { count: number };
  return { events: Number(events.count), deliveries: Number(deliveries.count) };
}

function interactionUsage(interactionId: string): {
  response_count: number;
  response_bytes: number;
} {
  return db.prepare(`SELECT response_count, response_bytes
    FROM _workflow_interaction_details WHERE interaction_id = ?`).get(interactionId) as {
    response_count: number;
    response_bytes: number;
  };
}

function track(service: WorkflowService): WorkflowService {
  services.push(service);
  return service;
}

function iso(offsetMs: number): string {
  return new Date(START + offsetMs).toISOString();
}

class ManualClock implements WorkflowClock {
  constructor(private value = START) {}

  now(): Date {
    return new Date(this.value);
  }

  advance(milliseconds: number): void {
    this.value += milliseconds;
  }
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

async function eventually(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await Bun.sleep(1);
  }
  throw new Error('condition was not reached');
}
