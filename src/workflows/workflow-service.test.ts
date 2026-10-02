/**
 * Deterministic workflow-core lifecycle and concurrency contracts.
 *
 * These tests intentionally use explicit promise barriers and an injected
 * clock. Timing sleeps would make the races under test probabilistic.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { t } from 'elysia';
import { MemoryEventStore } from '../observability/memory-event-store';
import {
  configureObservability,
  getObservabilityRuntime,
} from '../observability/sink';
import { createReactiveDB, type ReactiveDB } from '../sync/reactive-db';
import type { WorkflowClock } from './workflow-executor';
import { WorkflowRegistry } from './workflow-registry';
import { defineWorkflowTables } from './workflow-schema';
import { WorkflowService } from './workflow-service';
import type { StepContext } from './types';

const START_TIME = Date.parse('2030-01-02T03:04:05.000Z');

let db: ReactiveDB;
let services: WorkflowService[];
let cleanupReleases: Array<() => void>;

beforeEach(() => {
  db = createReactiveDB({ mode: 'memory' });
  defineWorkflowTables(db);
  services = [];
  cleanupReleases = [];
});

afterEach(async () => {
  for (const release of cleanupReleases) release();
  await Promise.allSettled(services.map((service) => service.dispose()));
  db.dispose();
});

describe('workflow frontier and execution concurrency', () => {
  test('does not pass a failed retry frontier to execute a later step', async () => {
    const clock = new ManualWorkflowClock();
    const registry = new WorkflowRegistry();
    const order: string[] = [];
    const completed = deferred<void>();
    let attempts = 0;

    registry.registerHandler('retry-frontier', async () => {
      attempts += 1;
      order.push(`frontier:${attempts}`);
      if (attempts === 1) throw new Error('retry me');
      return { ready: true };
    });
    registry.registerHandler('later-step', async () => {
      order.push('later');
      completed.resolve();
      return { complete: true };
    });
    registry.create({
      name: 'frontier-order',
      steps: [
        {
          name: 'Retry frontier',
          handler: 'retry-frontier',
          retries: 2,
          backoffMs: 100,
        },
        { name: 'Later step', handler: 'later-step' },
      ],
    });

    const service = createService(registry, clock);
    const instanceId = await service.run('frontier-order');

    expect(order).toEqual(['frontier:1']);
    expect(service.get(instanceId)?.status).toBe('running');
    expect(service.getSteps(instanceId).map((step) => step.status)).toEqual([
      'failed',
      'pending',
    ]);

    clock.advance(99);
    expect(await service.pollRetries()).toBe(0);
    expect(order).toEqual(['frontier:1']);

    clock.advance(1);
    expect(await service.pollRetries()).toBe(1);
    await completed.promise;
    await service.advance(instanceId);
    expect(order).toEqual(['frontier:1', 'frontier:2', 'later']);
    expect(service.get(instanceId)?.status).toBe('completed');
  });

  test('coalesces concurrent advance calls into one physical execution', async () => {
    const registry = new WorkflowRegistry();
    const entered = deferred<StepContext>();
    const release = cleanupGate();
    let calls = 0;

    registry.registerHandler('barrier', async (context) => {
      calls += 1;
      entered.resolve(context);
      await release.promise;
      return { calls };
    });
    registry.create({
      name: 'one-execution',
      steps: [{ name: 'Barrier', handler: 'barrier' }],
    });

    const service = createService(registry);
    const run = service.run('one-execution');
    await entered.promise;
    const instanceId = onlyInstanceId(service);

    const advances = Array.from({ length: 100 }, () => service.advance(instanceId));
    expect(calls).toBe(1);
    expect(service.get(instanceId)?.status).toBe('running');
    expect(service.getSteps(instanceId)[0]?.status).toBe('running');

    release.open();
    await Promise.all([run, ...advances]);

    expect(calls).toBe(1);
    expect(service.get(instanceId)?.status).toBe('completed');
  });

  test('allows different workflow instances to execute concurrently', async () => {
    const registry = new WorkflowRegistry();
    const enteredA = deferred<void>();
    const enteredB = deferred<void>();
    const releaseA = cleanupGate();
    const releaseB = cleanupGate();
    let active = 0;
    let maxActive = 0;

    registry.registerHandler('parallel', async ({ workflowInput }) => {
      const id = (workflowInput as { id: string }).id;
      active += 1;
      maxActive = Math.max(maxActive, active);
      if (id === 'a') enteredA.resolve();
      else enteredB.resolve();
      try {
        await (id === 'a' ? releaseA.promise : releaseB.promise);
        return id;
      } finally {
        active -= 1;
      }
    });
    registry.create({
      name: 'parallel-instances',
      steps: [{ name: 'Parallel', handler: 'parallel' }],
    });

    const service = createService(registry);
    const runA = service.run('parallel-instances', { id: 'a' });
    await enteredA.promise;
    const runB = service.run('parallel-instances', { id: 'b' });
    await enteredB.promise;

    expect(maxActive).toBe(2);
    releaseA.open();
    releaseB.open();
    await Promise.all([runA, runB]);

    expect(service.list({ name: 'parallel-instances', status: 'completed' })).toHaveLength(2);
  });

  test('starts every due retry without a long instance starving the others', async () => {
    const clock = new ManualWorkflowClock();
    const registry = new WorkflowRegistry();
    const retryAEntered = deferred<void>();
    const retryBEntered = deferred<void>();
    const releaseA = cleanupGate();
    const attempts = new Map<string, number>();

    registry.registerHandler('parallel-retry', async ({ workflowInput }) => {
      const id = (workflowInput as { id: string }).id;
      const attempt = (attempts.get(id) ?? 0) + 1;
      attempts.set(id, attempt);
      if (attempt === 1) throw new Error('schedule retry');
      if (id === 'a') {
        retryAEntered.resolve();
        await releaseA.promise;
      } else {
        retryBEntered.resolve();
      }
      return id;
    });
    registry.create({
      name: 'parallel-retries',
      steps: [{
        name: 'Retry independently',
        handler: 'parallel-retry',
        retries: 2,
        backoffMs: 100,
      }],
    });

    const service = createService(registry, clock);
    await service.start('parallel-retries', { id: 'a' });
    await service.start('parallel-retries', { id: 'b' });
    clock.advance(100);

    const polling = service.pollRetries();
    await Promise.all([retryAEntered.promise, retryBEntered.promise]);
    expect(attempts).toEqual(new Map([['a', 2], ['b', 2]]));

    releaseA.open();
    expect(await polling).toBe(2);
    await Promise.all(
      service.list({ name: 'parallel-retries' })
        .map((instance) => service.advance(instance.instance_id as string)),
    );
    expect(service.list({ status: 'completed' })).toHaveLength(2);
  });

  test('returns from retry polling while one dispatched handler remains running', async () => {
    const clock = new ManualWorkflowClock();
    const registry = new WorkflowRegistry();
    const hangingEntered = deferred<void>();
    const releaseHanging = cleanupGate();
    let hangingCalls = 0;
    let laterCalls = 0;

    registry.registerHandler('hanging-retry', async () => {
      hangingCalls += 1;
      if (hangingCalls === 1) throw new Error('retry later');
      hangingEntered.resolve();
      await releaseHanging.promise;
      return 'released';
    });
    registry.registerHandler('later-retry', async () => {
      laterCalls += 1;
      if (laterCalls === 1) throw new Error('retry later');
      return 'completed';
    });
    registry.create({
      name: 'hanging-retry-flow',
      steps: [{
        name: 'Hanging retry',
        handler: 'hanging-retry',
        retries: 2,
        backoffMs: 100,
      }],
    });
    registry.create({
      name: 'later-retry-flow',
      steps: [{
        name: 'Later retry',
        handler: 'later-retry',
        retries: 2,
        backoffMs: 200,
      }],
    });

    const service = createService(registry, clock);
    await service.start('hanging-retry-flow');
    const laterId = await service.start('later-retry-flow');

    clock.advance(100);
    expect(await service.pollRetries()).toBe(1);
    await hangingEntered.promise;
    expect(hangingCalls).toBe(2);

    clock.advance(100);
    expect(await service.pollRetries()).toBe(1);
    await service.advance(laterId);
    expect(laterCalls).toBe(2);
    expect(service.get(laterId)?.status).toBe('completed');

    releaseHanging.open();
  });

  test('does not begin a later step after disposal starts between commits', async () => {
    const registry = new WorkflowRegistry();
    const calls: string[] = [];
    registry.registerHandler('dispose-first', async () => {
      calls.push('one');
      return 'one';
    });
    registry.registerHandler('dispose-second', async () => {
      calls.push('two');
      return 'two';
    });
    registry.create({
      name: 'dispose-between-steps',
      steps: [
        { name: 'First display label', handler: 'dispose-first' },
        { name: 'Second display label', handler: 'dispose-second' },
      ],
    });
    const service = createService(registry);
    let disposal: Promise<void> | null = null;
    const unsubscribe = db.onChange((change) => {
      if (change.table !== 'workflow_steps'
        || change.row?.step_index !== 0
        || change.row?.status !== 'completed'
        || disposal) return;
      disposal = service.dispose();
    });

    try {
      const instanceId = await service.start('dispose-between-steps');
      await disposal;
      expect(calls).toEqual(['one']);
      expect(service.get(instanceId)?.status).toBe('running');
      expect(service.getSteps(instanceId).map((step) => step.status)).toEqual([
        'completed',
        'pending',
      ]);
      expect(service.getSteps(instanceId).map((step) => step.step_name)).toEqual([
        'First display label',
        'Second display label',
      ]);
    } finally {
      unsubscribe();
    }
  });
});

describe('workflow event inbox', () => {
  test('buffers an event received before its wait step becomes the frontier', async () => {
    const registry = new WorkflowRegistry();
    const firstEntered = deferred<void>();
    const releaseFirst = cleanupGate();
    let received: StepContext['waitEvent'];

    registry.registerHandler('first', async () => {
      firstEntered.resolve();
      await releaseFirst.promise;
      return { ready: true };
    });
    registry.registerHandler('approval', async (context) => {
      received = context.waitEvent;
      return { approved: true };
    });
    registry.create({
      name: 'early-event',
      steps: [
        { name: 'First', handler: 'first' },
        { name: 'Approval', handler: 'approval', waitFor: 'approved' },
      ],
    });

    const service = createService(registry);
    const run = service.run('early-event');
    await firstEntered.promise;
    const instanceId = onlyInstanceId(service);
    const event = service.sendEvent(instanceId, 'approved', { reviewer: 'casey' });

    expect(service.getEvents(instanceId)).toHaveLength(1);
    expect(received).toBeUndefined();

    releaseFirst.open();
    await Promise.all([run, event]);

    expect(await event).toBe(true);
    expect(received).toMatchObject({
      name: 'approved',
      payload: { reviewer: 'casey' },
    });
    expect(service.get(instanceId)?.status).toBe('completed');
  });

  test('retains the same claimed event and payload across a handler retry', async () => {
    const clock = new ManualWorkflowClock();
    const registry = new WorkflowRegistry();
    const deliveries: Array<{ id: string | undefined; payload: unknown }> = [];
    const completed = deferred<void>();

    registry.registerHandler('event-retry', async ({ waitEvent }) => {
      deliveries.push({ id: waitEvent?.id, payload: waitEvent?.payload });
      if (deliveries.length === 1) throw new Error('transient');
      completed.resolve();
      return { accepted: true };
    });
    registry.create({
      name: 'event-retry-flow',
      steps: [{
        name: 'Event retry',
        handler: 'event-retry',
        waitFor: 'continue',
        retries: 2,
        backoffMs: 50,
      }],
    });

    const service = createService(registry, clock);
    const instanceId = await service.run('event-retry-flow');
    expect(service.getSteps(instanceId)[0]?.status).toBe('waiting');

    expect(await service.sendEvent(instanceId, 'continue', { value: 42 })).toBe(true);
    expect(deliveries).toHaveLength(1);
    expect(service.getSteps(instanceId)[0]?.status).toBe('failed');

    clock.advance(50);
    expect(await service.pollRetries()).toBe(1);
    await completed.promise;
    await service.advance(instanceId);

    expect(deliveries).toHaveLength(2);
    expect(deliveries[1]).toEqual(deliveries[0]);
    expect(deliveries[0]?.payload).toEqual({ value: 42 });
    expect(service.getEvents(instanceId)).toHaveLength(1);
    expect(service.get(instanceId)?.status).toBe('completed');
  });

  test('claims distinct same-name events for consecutive wait steps', async () => {
    const clock = new ManualWorkflowClock();
    const registry = new WorkflowRegistry();
    const firstEntered = deferred<void>();
    const releaseFirst = cleanupGate();
    const received: Array<{ id: string | undefined; sequence: number | undefined }> = [];

    registry.registerHandler('hold', async () => {
      firstEntered.resolve();
      await releaseFirst.promise;
      return null;
    });
    registry.registerHandler('receive-one', async ({ waitEvent }) => {
      received.push({
        id: waitEvent?.id,
        sequence: (waitEvent?.payload as { sequence?: number } | undefined)?.sequence,
      });
      return null;
    });
    registry.registerHandler('receive-two', async ({ waitEvent }) => {
      received.push({
        id: waitEvent?.id,
        sequence: (waitEvent?.payload as { sequence?: number } | undefined)?.sequence,
      });
      return null;
    });
    registry.create({
      name: 'same-event-name',
      steps: [
        { name: 'Hold', handler: 'hold' },
        { name: 'First signal', handler: 'receive-one', waitFor: 'signal' },
        { name: 'Second signal', handler: 'receive-two', waitFor: 'signal' },
      ],
    });

    const service = createService(registry, clock);
    const run = service.run('same-event-name');
    await firstEntered.promise;
    const instanceId = onlyInstanceId(service);

    const firstEvent = service.sendEvent(instanceId, 'signal', { sequence: 1 });
    clock.advance(1);
    const secondEvent = service.sendEvent(instanceId, 'signal', { sequence: 2 });
    releaseFirst.open();

    await Promise.all([run, firstEvent, secondEvent]);
    expect(await firstEvent).toBe(true);
    expect(await secondEvent).toBe(true);
    expect(received.map((item) => item.sequence)).toEqual([1, 2]);
    expect(received[0]?.id).toBeString();
    expect(received[1]?.id).toBeString();
    expect(received[0]?.id).not.toBe(received[1]?.id);
  });
});

describe('workflow deadlines and stale-result fencing', () => {
  test('assigns a waiting deadline and expires at the exact injected-clock boundary', async () => {
    const clock = new ManualWorkflowClock();
    const registry = new WorkflowRegistry();
    let calls = 0;

    registry.registerHandler('wait-with-timeout', async () => {
      calls += 1;
      return null;
    });
    registry.create({
      name: 'waiting-timeout',
      steps: [{
        name: 'Wait',
        handler: 'wait-with-timeout',
        waitFor: 'never-arrives',
        timeoutMs: 1_000,
      }],
    });

    const service = createService(registry, clock);
    const instanceId = await service.run('waiting-timeout');
    const step = service.getSteps(instanceId)[0]!;

    expect(step.status).toBe('waiting');
    expect(step.timeout_at).toBe(new Date(START_TIME + 1_000).toISOString());
    expect(calls).toBe(0);

    clock.advance(999);
    expect(service.pollTimeouts()).toBe(0);
    expect(service.get(instanceId)?.status).toBe('running');

    clock.advance(1);
    expect(service.pollTimeouts()).toBe(1);
    expect(service.get(instanceId)?.status).toBe('failed');
    expect(service.getSteps(instanceId)[0]).toMatchObject({
      status: 'failed',
      error: 'Step timed out',
    });
  });

  test('discards a running handler completion after cancellation', async () => {
    const registry = new WorkflowRegistry();
    const entered = deferred<AbortSignal | undefined>();
    const release = cleanupGate();

    registry.registerHandler('late-success', async ({ signal }) => {
      entered.resolve(signal);
      await release.promise;
      return { mustNotCommit: true };
    });
    registry.create({
      name: 'cancel-fence',
      steps: [{ name: 'Late success', handler: 'late-success' }],
    });

    const service = createService(registry);
    const run = service.run('cancel-fence');
    const signal = await entered.promise;
    const instanceId = onlyInstanceId(service);

    service.cancel(instanceId);
    expect(signal?.aborted).toBe(true);
    expect(service.get(instanceId)?.status).toBe('cancelled');

    release.open();
    await run;

    expect(service.get(instanceId)?.status).toBe('cancelled');
    expect(service.get(instanceId)?.output).toBeNull();
    expect(service.getSteps(instanceId)[0]?.output).toBeNull();
  });

  test('discards a running handler completion after its exact timeout wins', async () => {
    const clock = new ManualWorkflowClock();
    const registry = new WorkflowRegistry();
    const entered = deferred<AbortSignal | undefined>();
    const release = cleanupGate();

    registry.registerHandler('timeout-late-success', async ({ signal }) => {
      entered.resolve(signal);
      await release.promise;
      return { mustNotCommit: true };
    });
    registry.create({
      name: 'timeout-fence',
      steps: [{
        name: 'Timeout',
        handler: 'timeout-late-success',
        timeoutMs: 100,
      }],
    });

    const service = createService(registry, clock);
    const run = service.run('timeout-fence');
    const signal = await entered.promise;
    const instanceId = onlyInstanceId(service);

    clock.advance(100);
    expect(service.pollTimeouts()).toBe(1);
    expect(signal?.aborted).toBe(true);

    release.open();
    await run;

    expect(service.get(instanceId)?.status).toBe('failed');
    expect(service.get(instanceId)?.output).toBeNull();
    expect(service.getSteps(instanceId)[0]).toMatchObject({
      status: 'failed',
      output: null,
      error: 'Step timed out',
    });
  });

  test('fails resume fast while a physical handler drains, then retries without overlap', async () => {
    const registry = new WorkflowRegistry();
    const firstEntered = deferred<AbortSignal | undefined>();
    const releaseFirst = cleanupGate();
    const firstSettled = deferred<void>();
    let calls = 0;
    let active = 0;
    let maxActive = 0;

    registry.registerHandler('ignore-abort', async ({ signal }) => {
      calls += 1;
      const call = calls;
      active += 1;
      maxActive = Math.max(maxActive, active);
      try {
        if (call === 1) {
          firstEntered.resolve(signal);
          await releaseFirst.promise;
          return { attempt: 'stale' };
        }
        return { attempt: 'fresh' };
      } finally {
        active -= 1;
        if (call === 1) firstSettled.resolve();
      }
    });
    registry.create({
      name: 'pause-drain',
      steps: [{ name: 'Ignore abort', handler: 'ignore-abort' }],
    });

    const service = createService(registry);
    const run = service.run('pause-drain');
    const firstSignal = await firstEntered.promise;
    const instanceId = onlyInstanceId(service);

    service.pause(instanceId);
    expect(firstSignal?.aborted).toBe(true);
    await expect(service.resume(instanceId)).rejects.toMatchObject({
      code: 'WORKFLOW_DRAINING',
      status: 409,
      retryable: true,
    });

    expect(calls).toBe(1);
    expect(maxActive).toBe(1);
    expect(service.get(instanceId)?.status).toBe('paused');

    releaseFirst.open();
    await firstSettled.promise;
    for (let index = 0; index < 10; index += 1) await Promise.resolve();
    await service.resume(instanceId);
    await run;

    expect(calls).toBe(2);
    expect(maxActive).toBe(1);
    expect(service.get(instanceId)).toMatchObject({
      status: 'completed',
      output: JSON.stringify({ attempt: 'fresh' }),
    });
  });

  test('does not reopen a paused instance when disposal wins during physical drainage', async () => {
    const registry = new WorkflowRegistry();
    const entered = deferred<void>();
    const release = cleanupGate();
    registry.registerHandler('dispose-race', async () => {
      entered.resolve();
      await release.promise;
      return 'stale';
    });
    registry.create({
      name: 'resume-dispose-race',
      steps: [{ name: 'Dispose race', handler: 'dispose-race' }],
    });

    const service = createService(registry);
    const run = service.start('resume-dispose-race');
    await entered.promise;
    const instanceId = onlyInstanceId(service);
    service.pause(instanceId);

    const resume = service.resume(instanceId);
    const disposal = service.dispose();
    release.open();
    await run;
    await expect(resume).rejects.toMatchObject({ code: 'WORKFLOW_DRAINING' });
    await disposal;

    expect(service.get(instanceId)?.status).toBe('paused');
    expect(service.getSteps(instanceId)[0]?.status).toBe('pending');
  });

  test('rejects resume on a running instance without waiting for its handler', async () => {
    const registry = new WorkflowRegistry();
    const entered = deferred<void>();
    const release = cleanupGate();
    registry.registerHandler('running-resume', async () => {
      entered.resolve();
      await release.promise;
      return null;
    });
    registry.create({
      name: 'invalid-running-resume',
      steps: [{ name: 'Running', handler: 'running-resume' }],
    });
    const service = createService(registry);
    const run = service.start('invalid-running-resume');
    await entered.promise;
    const instanceId = onlyInstanceId(service);

    await expect(service.resume(instanceId)).rejects.toMatchObject({
      code: 'WORKFLOW_STATE_INVALID',
    });
    release.open();
    await run;
  });

  test('makes concurrent disposal callers await the same physical drainage', async () => {
    const registry = new WorkflowRegistry();
    const entered = deferred<void>();
    const release = cleanupGate();
    registry.registerHandler('shared-disposal', async () => {
      entered.resolve();
      await release.promise;
      return null;
    });
    registry.create({
      name: 'shared-disposal',
      steps: [{ name: 'Drain once', handler: 'shared-disposal' }],
    });
    const service = createService(registry);
    const run = service.start('shared-disposal');
    await entered.promise;

    const first = service.dispose();
    const second = service.dispose();
    expect(second).toBe(first);
    let secondSettled = false;
    void second.then(() => { secondSettled = true; });
    await Promise.resolve();
    expect(secondSettled).toBe(false);

    release.open();
    await Promise.all([run, first, second]);
    expect(secondSettled).toBe(true);
  });

  test('bounds shutdown, warns once, and never lets a late rejection touch the database', async () => {
    const previousObservability = getObservabilityRuntime().config;
    const events = new MemoryEventStore();
    configureObservability({ console: false, store: events });
    let guardDatabase = false;
    let guardedAccesses = 0;
    const guardedMethods = new Set([
      'exec',
      'prepare',
      'transaction',
      'insert',
      'update',
      'delete',
      'query',
      'queryOne',
    ]);
    const guardedDb = new Proxy(db, {
      get(target, property) {
        if (guardDatabase && guardedMethods.has(String(property))) guardedAccesses += 1;
        const value = Reflect.get(target, property, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    }) as ReactiveDB;
    const registry = new WorkflowRegistry();
    const entered = deferred<void>();
    const late = deferred<never>();
    registry.registerHandler('late-rejection', async () => {
      entered.resolve();
      return late.promise;
    });
    registry.create({
      name: 'bounded-shutdown',
      steps: [{ name: 'Late rejection', handler: 'late-rejection' }],
    });
    const service = new WorkflowService(guardedDb, registry, {
      shutdownGraceMs: 5,
    });
    services.push(service);

    try {
      const run = service.start('bounded-shutdown');
      await entered.promise;
      const firstDisposal = service.dispose();
      expect(service.dispose()).toBe(firstDisposal);
      await Promise.race([
        firstDisposal,
        new Promise<never>((_resolve, reject) => {
          setTimeout(() => reject(new Error('shutdown did not honor its grace')), 500);
        }),
      ]);
      await run;

      const warnings = events.query({
        code: 'workflows.shutdown.grace_exhausted',
      }).events;
      expect(warnings).toHaveLength(1);
      expect(warnings[0]?.metadata).toMatchObject({
        shutdownGraceMs: 5,
        executionCount: 1,
        instanceCount: 1,
        stepCount: 1,
      });

      guardDatabase = true;
      late.reject(new Error('settled after workflow teardown'));
      for (let index = 0; index < 10; index += 1) await Promise.resolve();
      expect(guardedAccesses).toBe(0);
    } finally {
      guardDatabase = false;
      configureObservability(previousObservability);
    }
  });

  test('rejects shutdown grace values that cannot form a finite runtime timer', () => {
    const registry = new WorkflowRegistry();
    for (const shutdownGraceMs of [-1, 1.5, Number.POSITIVE_INFINITY, 2_147_483_648]) {
      expect(() => new WorkflowService(db, registry, { shutdownGraceMs }))
        .toThrow(expect.objectContaining({ code: 'WORKFLOW_CONFIG_INVALID' }));
    }
  });
});

describe('workflow lifecycle, recovery, and input contracts', () => {
  test('keeps terminal workflow states immutable, including completed stop alias behavior', async () => {
    const registry = new WorkflowRegistry();
    registry.registerHandler('complete', async () => 'done');
    registry.registerHandler('fail', async () => {
      throw new Error('terminal failure');
    });
    registry.create({
      name: 'completed-terminal',
      steps: [{ name: 'Complete', handler: 'complete' }],
    });
    registry.create({
      name: 'failed-terminal',
      steps: [{ name: 'Fail', handler: 'fail', retries: 1 }],
    });

    const service = createService(registry);
    const completedId = await service.run('completed-terminal');
    const failedId = await service.run('failed-terminal');

    for (const instanceId of [completedId, failedId]) {
      const terminalStatus = service.get(instanceId)?.status;
      expect(() => service.stop(instanceId)).toThrow(/Cannot cancel workflow/);
      expect(() => service.pause(instanceId)).toThrow(/Cannot pause workflow/);
      await expect(service.resume(instanceId)).rejects.toThrow(/Cannot resume workflow/);
      expect(service.get(instanceId)?.status).toBe(terminalStatus);
    }
  });

  test('keeps cancelled state immutable after the active attempt settles', async () => {
    const registry = new WorkflowRegistry();
    const entered = deferred<void>();
    const release = cleanupGate();

    registry.registerHandler('cancelled-handler', async () => {
      entered.resolve();
      await release.promise;
      return null;
    });
    registry.create({
      name: 'cancelled-terminal',
      steps: [{ name: 'Cancel', handler: 'cancelled-handler' }],
    });

    const service = createService(registry);
    const run = service.run('cancelled-terminal');
    await entered.promise;
    const instanceId = onlyInstanceId(service);
    service.cancel(instanceId);
    release.open();
    await run;

    expect(() => service.cancel(instanceId)).toThrow(/Cannot cancel workflow/);
    expect(() => service.pause(instanceId)).toThrow(/Cannot pause workflow/);
    await expect(service.resume(instanceId)).rejects.toThrow(/Cannot resume workflow/);
    expect(service.get(instanceId)?.status).toBe('cancelled');
  });

  test('recovery preflights missing handlers without mutating public workflow state', async () => {
    const registry = new WorkflowRegistry();
    const service = createService(registry);
    seedRunningInstance(db, {
      instanceId: 'run_missing_handler',
      stepId: 'step_missing_handler',
      handler: 'not-registered',
    });
    const before = publicWorkflowSnapshot(db);

    await expect(service.recoverInFlight()).rejects.toMatchObject({
      code: 'WORKFLOW_HANDLER_NOT_REGISTERED',
    });

    expect(publicWorkflowSnapshot(db)).toEqual(before);
  });

  test('normalizes a legacy paused/running step when it resumes', async () => {
    const clock = new ManualWorkflowClock();
    const registry = new WorkflowRegistry();
    registry.registerHandler('legacy-paused', async () => 'resumed');
    const service = createService(registry, clock);
    seedRunningInstance(db, {
      instanceId: 'legacy_paused_instance',
      stepId: 'legacy_paused_step',
      handler: 'legacy-paused',
    });
    db.update('workflow_instances', 'legacy_paused_instance', { status: 'paused' });
    db.update('workflow_instances', 'legacy_paused_instance', {
      steps_json: JSON.stringify([{
        name: 'Missing',
        handler: 'legacy-paused',
        timeoutMs: 100,
      }]),
    });
    db.update('workflow_steps', 'legacy_paused_step', {
      timeout_at: new Date(START_TIME + 100).toISOString(),
    });
    clock.advance(1_000);

    await service.resume('legacy_paused_instance');

    expect(service.get('legacy_paused_instance')?.status).toBe('completed');
    expect(service.getSteps('legacy_paused_instance')[0]?.status).toBe('completed');
  });

  test('dispatches recovered attempts without blocking readiness on handler lifetime', async () => {
    const registry = new WorkflowRegistry();
    const entered = deferred<void>();
    const release = cleanupGate();
    registry.registerHandler('recovery-dispatch', async () => {
      entered.resolve();
      await release.promise;
      return 'recovered';
    });
    const service = createService(registry);
    seedRunningInstance(db, {
      instanceId: 'recovery_dispatch_instance',
      stepId: 'recovery_dispatch_step',
      handler: 'recovery-dispatch',
    });

    expect(await service.recoverInFlight()).toBe(1);
    await entered.promise;
    expect(service.getSteps('recovery_dispatch_instance')[0]?.status).toBe('running');

    release.open();
    await service.advance('recovery_dispatch_instance');
    expect(service.get('recovery_dispatch_instance')?.status).toBe('completed');
  });

  test('durably fails even when a thrown value cannot be formatted', async () => {
    const registry = new WorkflowRegistry();
    registry.registerHandler('hostile-error', async () => {
      throw {
        toString() {
          throw new Error('formatter exploded');
        },
      };
    });
    registry.create({
      name: 'hostile-error',
      steps: [{ name: 'Hostile error', handler: 'hostile-error', retries: 1 }],
    });
    const service = createService(registry);

    const instanceId = await service.start('hostile-error');
    expect(service.get(instanceId)?.status).toBe('failed');
    expect(service.getSteps(instanceId)[0]).toMatchObject({
      status: 'failed',
      error: 'Workflow handler failed with an unprintable error',
    });
  });

  test('passes workflow input to both first-step input fields', async () => {
    const registry = new WorkflowRegistry();
    let received: Pick<StepContext, 'input' | 'workflowInput'> | undefined;
    registry.registerHandler('input-contract', async (context) => {
      received = {
        input: context.input,
        workflowInput: context.workflowInput,
      };
      return null;
    });
    registry.create({
      name: 'first-input',
      steps: [{ name: 'Input', handler: 'input-contract' }],
    });

    const service = createService(registry);
    const input = { accountId: 'acct_1', nested: { enabled: true } };
    await service.run('first-input', input);

    expect(received).toEqual({ input, workflowInput: input });
  });

  test('validates workflow input schema before creating durable rows', async () => {
    const registry = new WorkflowRegistry();
    let calls = 0;
    registry.registerHandler('validated', async () => {
      calls += 1;
      return null;
    });
    registry.create({
      name: 'schema-validation',
      inputSchema: t.Object({
        jobId: t.String({ minLength: 1 }),
        priority: t.Optional(t.Number({ minimum: 0 })),
      }),
      steps: [{ name: 'Validated', handler: 'validated' }],
    });

    const service = createService(registry);
    await expect(service.run('schema-validation', { jobId: 123 }))
      .rejects.toMatchObject({ code: 'WORKFLOW_INPUT_INVALID' });
    expect(service.list({ name: 'schema-validation' })).toHaveLength(0);
    expect(calls).toBe(0);

    const instanceId = await service.run('schema-validation', {
      jobId: 'job_1',
      priority: 2,
    });
    expect(service.get(instanceId)?.status).toBe('completed');
    expect(calls).toBe(1);
  });
});

function createService(
  registry: WorkflowRegistry,
  clock: WorkflowClock = new ManualWorkflowClock(),
): WorkflowService {
  const service = new WorkflowService(db, registry, { clock });
  services.push(service);
  return service;
}

function onlyInstanceId(service: WorkflowService): string {
  const instances = service.list();
  expect(instances).toHaveLength(1);
  return String(instances[0]!.instance_id);
}

class ManualWorkflowClock implements WorkflowClock {
  constructor(private value = START_TIME) {}

  now(): Date {
    return new Date(this.value);
  }

  advance(milliseconds: number): void {
    this.value += milliseconds;
  }
}

function deferred<T = void>(): {
  promise: Promise<T>;
  resolve: (value?: T) => void;
  reject: (reason?: unknown) => void;
} {
  let resolve!: (value?: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise as (value?: T) => void;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function cleanupGate(): { promise: Promise<void>; open: () => void } {
  const gate = deferred<void>();
  let opened = false;
  const open = () => {
    if (opened) return;
    opened = true;
    gate.resolve();
  };
  cleanupReleases.push(open);
  return { promise: gate.promise, open };
}

function seedRunningInstance(
  target: ReactiveDB,
  options: { instanceId: string; stepId: string; handler: string },
): void {
  const now = new Date(START_TIME).toISOString();
  const steps = [{ name: 'Missing', handler: options.handler }];
  target.insert('workflow_instances', {
    instance_id: options.instanceId,
    definition_id: 'definition_missing_handler',
    name: 'missing-handler-flow',
    status: 'running',
    current_step: 0,
    input: JSON.stringify({ recover: true }),
    output: null,
    error: null,
    started_by: 'user_1',
    steps_json: JSON.stringify(steps),
    created_at: now,
    updated_at: now,
    completed_at: null,
  });
  target.insert('workflow_steps', {
    step_id: options.stepId,
    instance_id: options.instanceId,
    step_index: 0,
    step_name: options.handler,
    status: 'running',
    input: null,
    output: null,
    error: null,
    retries: 0,
    max_retries: 3,
    retry_at: null,
    wait_event: null,
    timeout_at: null,
    started_at: now,
    completed_at: null,
    created_at: now,
  });
  seedResourceAccounting(target, options.instanceId);
}

function seedResourceAccounting(database: ReactiveDB, instanceId: string): void {
  const bytes = Number((database.prepare(`SELECT
    length(CAST(COALESCE(instance.input, '') AS BLOB))
      + length(CAST(COALESCE(instance.output, '') AS BLOB))
      + COALESCE((SELECT SUM(length(CAST(COALESCE(step.input, '') AS BLOB))
        + length(CAST(COALESCE(step.output, '') AS BLOB)))
        FROM workflow_steps AS step WHERE step.instance_id = instance.instance_id), 0) AS bytes
    FROM workflow_instances AS instance WHERE instance.instance_id = ?`)
    .get(instanceId) as { bytes: number }).bytes);
  database.prepare(`INSERT OR REPLACE INTO _workflow_runtime_usage
    (instance_id, runtime_bytes) VALUES (?, ?)`).run(instanceId, bytes);
  database.prepare(`INSERT OR REPLACE INTO _workflow_event_usage
    (instance_id, total_count, total_bytes, queued_count, queued_bytes, revision)
    VALUES (?, 0, 0, 0, 0, 0)`).run(instanceId);
}

function publicWorkflowSnapshot(target: ReactiveDB): Record<string, unknown[]> {
  return {
    definitions: target.query('workflow_definitions'),
    instances: target.query('workflow_instances'),
    steps: target.query('workflow_steps'),
    events: target.query('workflow_events'),
  };
}
