/**
 * Deterministic event-inbox and cancellation transition matrix.
 *
 * The assertions cover both public workflow rows and the durable coordination
 * rows that make buffered delivery and attempt fencing restart-safe.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { createReactiveDB, type ReactiveDB } from '../sync/reactive-db';
import type { WorkflowClock } from './workflow-executor';
import { WorkflowRegistry } from './workflow-registry';
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
    const stepId = service.getSteps(instanceId)[0]!.step_id;

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
      claimed_by_step_id: stepId,
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
    const stepId = service.getSteps(instanceId)[0]!.step_id;

    expect(await service.sendEvent(instanceId, 'beta', { sequence: 1 })).toBe(false);
    expect(service.get(instanceId)?.status).toBe('running');
    expect(received).toBeUndefined();

    expect(await service.sendEvent(instanceId, 'alpha', { sequence: 2 })).toBe(true);
    expect(received).toMatchObject({ name: 'alpha', payload: { sequence: 2 } });
    expect(service.get(instanceId)?.status).toBe('completed');
    expect(deliveryRows()).toEqual([
      { event_name: 'beta', claimed_by_step_id: null },
      { event_name: 'alpha', claimed_by_step_id: stepId },
    ]);
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
    const stepId = service.getSteps(instanceId)[0]!.step_id;
    const unsubscribe = db.onChange((change) => {
      if (change.table === 'workflow_events' && change.op === 'INSERT') {
        db.update('workflow_events', change.rowId, { payload: '{bad json' });
      }
    });

    try {
      expect(await service.sendEvent(instanceId, 'continue', { valid: 'before hook' }))
        .toBe(true);
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
      claimed_by_step_id: stepId,
    }]);
  });
});

describe('workflow cancellation matrix', () => {
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
