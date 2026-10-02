/**
 * Deterministic pause/deadline/retry transition matrix.
 *
 * These tests deliberately use an injected clock and explicit promise gates.
 * They must never depend on wall-clock sleeps or scheduler timing.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { createReactiveDB, type ReactiveDB } from '../sync/reactive-db';
import type { WorkflowClock } from './workflow-executor';
import { WorkflowRegistry } from './workflow-registry';
import { defineWorkflowTables } from './workflow-schema';
import { WorkflowService } from './workflow-service';

const START = Date.parse('2035-04-05T06:07:08.000Z');

let db: ReactiveDB;
let services: WorkflowService[];
let gateReleases: Array<() => void>;

beforeEach(() => {
  db = createReactiveDB({ mode: 'memory' });
  defineWorkflowTables(db);
  services = [];
  gateReleases = [];
});

afterEach(async () => {
  for (const release of gateReleases) release();
  await Promise.allSettled(services.map((service) => service.dispose()));
  db.dispose();
});

describe('workflow pause deadline matrix', () => {
  test('shifts a waiting deadline by exactly the paused duration', async () => {
    const clock = new ManualClock();
    const registry = new WorkflowRegistry();
    registry.registerHandler('waiting-handler', async () => null);
    registry.create({
      name: 'waiting-pause-shift',
      steps: [{
        name: 'Wait for approval',
        handler: 'waiting-handler',
        waitFor: 'approved',
        timeoutMs: 100,
      }],
    });
    const service = track(new WorkflowService(db, registry, { clock }));

    const instanceId = await service.start('waiting-pause-shift');
    expect(service.getSteps(instanceId)[0]).toMatchObject({
      status: 'waiting',
      timeout_at: iso(100),
    });

    clock.advance(40);
    service.pause(instanceId);
    clock.advance(60);

    // A deadline that passes while paused cannot terminate the instance.
    expect(service.pollTimeouts()).toBe(0);
    expect(service.get(instanceId)?.status).toBe('paused');

    await service.resume(instanceId);
    expect(service.getSteps(instanceId)[0]).toMatchObject({
      status: 'waiting',
      timeout_at: iso(160),
    });

    clock.advance(59);
    expect(service.pollTimeouts()).toBe(0);
    clock.advance(1);
    expect(service.pollTimeouts()).toBe(1);
    expect(service.get(instanceId)?.status).toBe('failed');
  });

  test('accumulates repeated pause durations without deadline drift', async () => {
    const clock = new ManualClock();
    const registry = new WorkflowRegistry();
    registry.registerHandler('repeat-wait', async () => null);
    registry.create({
      name: 'repeated-pause-shift',
      steps: [{
        name: 'Repeatedly paused wait',
        handler: 'repeat-wait',
        waitFor: 'continue',
        timeoutMs: 100,
      }],
    });
    const service = track(new WorkflowService(db, registry, { clock }));
    const instanceId = await service.start('repeated-pause-shift');

    clock.advance(10);
    service.pause(instanceId);
    clock.advance(20);
    await service.resume(instanceId);
    expect(service.getSteps(instanceId)[0]?.timeout_at).toBe(iso(120));

    clock.advance(10);
    service.pause(instanceId);
    clock.advance(30);
    await service.resume(instanceId);
    expect(service.getSteps(instanceId)[0]?.timeout_at).toBe(iso(150));

    clock.advance(79);
    expect(service.pollTimeouts()).toBe(0);
    clock.advance(1);
    expect(service.pollTimeouts()).toBe(1);
    expect(service.get(instanceId)?.status).toBe('failed');
  });

  test('shifts an active handler deadline before starting the resumed attempt', async () => {
    const clock = new ManualClock();
    const registry = new WorkflowRegistry();
    const firstEntered = deferred<AbortSignal | undefined>();
    const firstSettled = deferred<void>();
    const secondEntered = deferred<AbortSignal | undefined>();
    const releaseSecond = gate();
    let calls = 0;

    registry.registerHandler('active-handler', async ({ signal }) => {
      calls += 1;
      if (calls === 1) {
        firstEntered.resolve(signal);
        await aborted(signal);
        firstSettled.resolve();
        return 'stale first result';
      }
      secondEntered.resolve(signal);
      await releaseSecond.promise;
      return 'late second result';
    });
    registry.create({
      name: 'running-pause-shift',
      steps: [{
        name: 'Active operation',
        handler: 'active-handler',
        timeoutMs: 100,
      }],
    });
    const service = track(new WorkflowService(db, registry, { clock }));

    const starting = service.start('running-pause-shift');
    const firstSignal = await firstEntered.promise;
    const instanceId = onlyInstanceId(service);
    expect(service.getSteps(instanceId)[0]?.timeout_at).toBe(iso(100));

    clock.advance(20);
    service.pause(instanceId);
    expect(firstSignal?.aborted).toBe(true);
    clock.advance(30);
    await firstSettled.promise;
    for (let index = 0; index < 10; index += 1) await Promise.resolve();

    const resuming = service.resume(instanceId);
    const secondSignal = await secondEntered.promise;
    expect(calls).toBe(2);
    expect(service.getSteps(instanceId)[0]).toMatchObject({
      status: 'running',
      timeout_at: iso(130),
    });

    clock.advance(79);
    expect(service.pollTimeouts()).toBe(0);
    clock.advance(1);
    expect(service.pollTimeouts()).toBe(1);
    expect(secondSignal?.aborted).toBe(true);

    releaseSecond.open();
    await Promise.all([starting, resuming]);
    expect(service.get(instanceId)?.status).toBe('failed');
    expect(service.getSteps(instanceId)[0]).toMatchObject({
      status: 'failed',
      error: 'Step timed out',
      output: null,
    });
  });

  test('shifts both retry and timeout deadlines for a retry-scheduled step', async () => {
    const clock = new ManualClock();
    const registry = new WorkflowRegistry();
    const completed = deferred<void>();
    let calls = 0;

    registry.registerHandler('retry-handler', async () => {
      calls += 1;
      if (calls === 1) throw new Error('transient');
      completed.resolve();
      return 'recovered';
    });
    registry.create({
      name: 'retry-pause-shift',
      steps: [{
        name: 'Retry after pause',
        handler: 'retry-handler',
        retries: 2,
        backoffMs: 20,
        timeoutMs: 100,
      }],
    });
    const service = track(new WorkflowService(db, registry, { clock }));

    const instanceId = await service.start('retry-pause-shift');
    expect(service.getSteps(instanceId)[0]).toMatchObject({
      status: 'failed',
      retry_at: iso(20),
      timeout_at: iso(100),
    });

    clock.advance(5);
    service.pause(instanceId);
    clock.advance(50);
    await service.resume(instanceId);
    expect(service.getSteps(instanceId)[0]).toMatchObject({
      status: 'failed',
      retry_at: iso(70),
      timeout_at: iso(150),
    });

    clock.advance(14);
    expect(await service.pollRetries()).toBe(0);
    clock.advance(1);
    expect(await service.pollRetries()).toBe(1);
    await completed.promise;
    await service.advance(instanceId);
    expect(calls).toBe(2);
    expect(service.get(instanceId)?.status).toBe('completed');
  });
});

describe('workflow deadline collision matrix', () => {
  test('lets timeout win when retry and timeout become due at the same instant', async () => {
    const clock = new ManualClock();
    const registry = new WorkflowRegistry();
    let calls = 0;

    registry.registerHandler('collision-handler', async () => {
      calls += 1;
      throw new Error('retryable');
    });
    registry.create({
      name: 'retry-timeout-collision',
      steps: [{
        name: 'Deadline collision',
        handler: 'collision-handler',
        retries: 3,
        backoffMs: 100,
        timeoutMs: 100,
      }],
    });
    const service = track(new WorkflowService(db, registry, { clock }));
    const instanceId = await service.start('retry-timeout-collision');

    expect(service.getSteps(instanceId)[0]).toMatchObject({
      status: 'failed',
      retry_at: iso(100),
      timeout_at: iso(100),
    });

    clock.advance(100);
    expect(await service.pollRetries()).toBe(1);
    await service.advance(instanceId);

    expect(calls).toBe(1);
    expect(service.get(instanceId)).toMatchObject({
      status: 'failed',
      error: 'Step "Deadline collision" timed out',
    });
    expect(service.getSteps(instanceId)[0]).toMatchObject({
      status: 'failed',
      error: 'Step timed out',
      retry_at: null,
      timeout_at: null,
    });
  });

  test('keeps timeout terminal when it wins immediately before cancellation', async () => {
    const { service, clock, instanceId } = await waitingDeadline('timeout-first');
    clock.advance(100);

    expect(service.pollTimeouts()).toBe(1);
    expect(() => service.cancel(instanceId)).toThrow(/Cannot cancel workflow/);
    expect(service.get(instanceId)?.status).toBe('failed');
    expect(service.getSteps(instanceId)[0]?.error).toBe('Step timed out');
  });

  test('keeps cancellation terminal when it wins immediately before timeout polling', async () => {
    const { service, clock, instanceId } = await waitingDeadline('cancel-first');
    clock.advance(100);

    service.cancel(instanceId);
    expect(service.pollTimeouts()).toBe(0);
    expect(service.get(instanceId)?.status).toBe('cancelled');
    expect(service.getSteps(instanceId)[0]).toMatchObject({
      status: 'skipped',
      error: 'Workflow cancelled',
      retry_at: null,
      timeout_at: null,
    });
  });
});

async function waitingDeadline(name: string): Promise<{
  service: WorkflowService;
  clock: ManualClock;
  instanceId: string;
}> {
  const clock = new ManualClock();
  const registry = new WorkflowRegistry();
  registry.registerHandler(`${name}-handler`, async () => null);
  registry.create({
    name,
    steps: [{
      name: 'Wait with deadline',
      handler: `${name}-handler`,
      waitFor: 'continue',
      timeoutMs: 100,
    }],
  });
  const service = track(new WorkflowService(db, registry, { clock }));
  return { service, clock, instanceId: await service.start(name) };
}

function track(service: WorkflowService): WorkflowService {
  services.push(service);
  return service;
}

function onlyInstanceId(service: WorkflowService): string {
  const instances = service.list();
  expect(instances).toHaveLength(1);
  return String(instances[0]!.instance_id);
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

function deferred<T = void>(): {
  promise: Promise<T>;
  resolve: (value?: T) => void;
} {
  let resolve!: (value?: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise as (value?: T) => void;
  });
  return { promise, resolve };
}

function gate(): { promise: Promise<void>; open: () => void } {
  const value = deferred<void>();
  let opened = false;
  const open = () => {
    if (opened) return;
    opened = true;
    value.resolve();
  };
  gateReleases.push(open);
  return { promise: value.promise, open };
}

function aborted(signal: AbortSignal | undefined): Promise<void> {
  if (!signal || signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    signal.addEventListener('abort', () => resolve(), { once: true });
  });
}
