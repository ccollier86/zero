/**
 * Deterministic event-inbox and cancellation transition matrix.
 *
 * The assertions cover both public workflow rows and the durable coordination
 * rows that make buffered delivery and attempt fencing restart-safe.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { createReactiveDB, type ReactiveDB } from '../sync/reactive-db';
import { flow, parallel, requestAndWait, step, waitFor } from './workflow-dsl';
import type { WorkflowClock } from './workflow-executor';
import { validateWorkflowGraphEventState } from './workflow-event-persisted-state';
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
    db.exec('DROP TRIGGER trg_workflow_event_command_immutable');
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

  test('never executes graph or legacy waits from an invalid authority seal', async () => {
    const registry = new WorkflowRegistry();
    let graphCalls = 0;
    let legacyCalls = 0;
    registry.registerActivity({
      name: 'after-sealed-wait',
      handler: async () => {
        graphCalls += 1;
        return 'unexpected';
      },
    });
    registry.registerHandler('sealed-legacy-wait', async () => {
      legacyCalls += 1;
      return 'unexpected';
    });
    registry.create({
      name: 'sealed-graph-wait',
      flow: flow(
        waitFor('sealed-wait', 'continue'),
        step('after', 'after-sealed-wait'),
      ),
    });
    registry.create({
      name: 'sealed-legacy-wait',
      steps: [{
        name: 'Sealed legacy wait',
        handler: 'sealed-legacy-wait',
        waitFor: 'continue',
      }],
    });
    const service = track(new WorkflowService(db, registry));

    const graphId = await service.start('sealed-graph-wait');
    service.pause(graphId);
    expect(await service.sendEventAsSystem(
      graphId,
      'continue',
      { approved: true },
      { principal: 'seal-test', reason: 'Exercise graph event integrity' },
    )).toBe(false);
    // A failed seal takes precedence over decoding the now-untrusted payload.
    // Malformed tampering must still reach the stable authority failure path.
    tamperEventPayload(graphId, true, true);
    await service.resume(graphId);
    expect(service.get(graphId)).toMatchObject({
      status: 'failed',
      error: 'Workflow event authority is invalid',
    });
    expect(graphCalls).toBe(0);

    const legacyId = await service.start('sealed-legacy-wait');
    service.pause(legacyId);
    expect(await service.sendEventAsSystem(
      legacyId,
      'continue',
      { approved: true },
      { principal: 'seal-test', reason: 'Exercise legacy event integrity' },
    )).toBe(false);
    tamperEventPayload(legacyId, false);
    await service.resume(legacyId);
    expect(service.get(legacyId)).toMatchObject({
      status: 'failed',
      error: 'Workflow event authority is invalid',
    });
    expect(legacyCalls).toBe(0);
  });
});

describe('workflow cancellation matrix', () => {
  test('reconciles orphaned terminal interactions through tracked updates', async () => {
    const registry = new WorkflowRegistry();
    registry.create({
      name: 'terminal-reconciliation',
      flow: flow(requestAndWait('approval', 'approval.responded')),
    });
    const service = track(new WorkflowService(db, registry));
    const instanceId = await service.start('terminal-reconciliation');
    expect(db.query('workflow_interactions')[0]?.status).toBe('open');

    // A second low-level runtime may repair crash-left state only after the
    // managed generation releases ownership. Public unmanaged helpers now
    // fail closed while a WorkflowService lease is live.
    await service.dispose();

    // Model a terminal row left by an older runtime/crash before its public
    // interaction projection was closed. Startup reconciliation owns this
    // repair path and must publish it through ReactiveDB rather than raw SQL.
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

function tamperEventPayload(
  instanceId: string,
  dropTrigger = true,
  malformed = false,
): void {
  if (dropTrigger) db.exec('DROP TRIGGER trg_workflow_event_command_immutable');
  const row = db.prepare(`SELECT event_id, payload FROM workflow_events
    WHERE instance_id = ? ORDER BY rowid DESC LIMIT 1`).get(instanceId) as {
      event_id: string;
      payload: string;
    };
  const payload = malformed
    ? row.payload.replace(':true', ' true')
    : row.payload.replace('true', 'null');
  expect(Buffer.byteLength(payload)).toBe(Buffer.byteLength(row.payload));
  db.prepare('UPDATE workflow_events SET payload = ? WHERE event_id = ?')
    .run(payload, row.event_id);
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
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

async function eventually(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await Bun.sleep(1);
  }
  throw new Error('Timed out waiting for workflow test state');
}
