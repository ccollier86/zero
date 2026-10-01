import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { createReactiveDB, type ReactiveDB } from '../sync/reactive-db';
import type { WorkflowClock } from './workflow-executor';
import { WorkflowRegistry } from './workflow-registry';
import { defineWorkflowTables } from './workflow-schema';
import { WorkflowService } from './workflow-service';
import type { WorkflowWakeTimer } from './workflow-wake-coordinator';

const START = Date.parse('2030-01-02T03:04:05.000Z');
const START_ISO = new Date(START).toISOString();

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

describe('workflow exact in-process wakes', () => {
  test('dispatches a millisecond retry at its exact injected-clock boundary', async () => {
    const clock = new ManualClock();
    const timer = new ManualWakeTimer(clock);
    const registry = new WorkflowRegistry();
    let attempts = 0;
    registry.registerHandler('retry', async () => {
      attempts += 1;
      if (attempts === 1) throw new Error('transient');
      return 'done';
    });
    registry.create({
      name: 'automatic-retry',
      steps: [{ name: 'Retry', handler: 'retry', retries: 2, backoffMs: 10 }],
    });
    const service = track(new WorkflowService(db, registry, { clock, wakeTimer: timer }));

    const instanceId = await service.start('automatic-retry');
    expect(attempts).toBe(1);
    expect(service.getSteps(instanceId)[0]).toMatchObject({
      status: 'failed',
      retry_at: new Date(START + 10).toISOString(),
    });

    timer.advance(9);
    await settleMicrotasks();
    expect(attempts).toBe(1);

    timer.advance(1);
    await waitFor(() => service.get(instanceId)?.status === 'completed');
    expect(attempts).toBe(2);
    expect(service.get(instanceId)?.output).toBe('"done"');
  });

  test('aborts and fences an active handler at the exact deterministic deadline', async () => {
    const clock = new ManualClock();
    const timer = new ManualWakeTimer(clock);
    const registry = new WorkflowRegistry();
    const entered = deferred<void>();
    let signal: AbortSignal | undefined;
    registry.registerHandler('blocked', async (context) => {
      signal = context.signal;
      entered.resolve();
      return new Promise<never>(() => {});
    });
    registry.create({
      name: 'automatic-timeout',
      steps: [{ name: 'Blocked', handler: 'blocked', timeoutMs: 25 }],
    });
    const service = track(new WorkflowService(db, registry, {
      clock,
      wakeTimer: timer,
      shutdownGraceMs: 1,
    }));

    const run = service.start('automatic-timeout');
    await entered.promise;
    const instanceId = onlyInstanceId(service);
    timer.advance(24);
    await settleMicrotasks();
    expect(service.get(instanceId)?.status).toBe('running');

    timer.advance(1);
    await run;
    expect(signal?.aborted).toBe(true);
    expect(service.get(instanceId)).toMatchObject({
      status: 'failed',
      error: 'Step "Blocked" timed out',
    });
    expect(service.getSteps(instanceId)[0]).toMatchObject({
      status: 'failed',
      error: 'Step timed out',
      timeout_at: null,
    });
  });

  test('uses native unref timers without waiting for the minute safety poll', async () => {
    const registry = new WorkflowRegistry();
    const entered = deferred<void>();
    let aborted = false;
    registry.registerHandler('native-blocked', async ({ signal }) => {
      entered.resolve();
      signal?.addEventListener('abort', () => { aborted = true; }, { once: true });
      return new Promise<never>(() => {});
    });
    registry.create({
      name: 'native-timeout',
      steps: [{ name: 'Native deadline', handler: 'native-blocked', timeoutMs: 20 }],
    });
    const service = track(new WorkflowService(db, registry, { shutdownGraceMs: 1 }));

    const run = service.start('native-timeout');
    await entered.promise;
    const instanceId = onlyInstanceId(service);
    await waitFor(() => service.get(instanceId)?.status === 'failed', 1_000);
    await run;
    expect(aborted).toBe(true);
    expect(service.getSteps(instanceId)[0]?.error).toBe('Step timed out');
  });

  test('freezes a deadline while paused, rearms it on resume, and clears it on cancel', async () => {
    const clock = new ManualClock();
    const timer = new ManualWakeTimer(clock);
    const registry = new WorkflowRegistry();
    registry.registerHandler('wait', async () => null);
    registry.create({
      name: 'pause-wake',
      steps: [{
        name: 'Wait',
        handler: 'wait',
        waitFor: 'continue',
        timeoutMs: 100,
      }],
    });
    const service = track(new WorkflowService(db, registry, { clock, wakeTimer: timer }));
    const instanceId = await service.start('pause-wake');
    expect(timer.size).toBe(1);

    timer.advance(40);
    service.pause(instanceId);
    expect(timer.size).toBe(0);
    timer.advance(1_000);
    await settleMicrotasks();
    expect(service.get(instanceId)?.status).toBe('paused');

    await service.resume(instanceId);
    expect(service.getSteps(instanceId)[0]?.timeout_at)
      .toBe(new Date(START + 1_100).toISOString());
    expect(timer.size).toBe(1);
    timer.advance(59);
    expect(service.get(instanceId)?.status).toBe('running');
    service.cancel(instanceId);
    expect(timer.size).toBe(0);
    timer.advance(1);
    await settleMicrotasks();
    expect(service.get(instanceId)?.status).toBe('cancelled');
  });

  test('rearms a future retry during startup recovery', async () => {
    const clock = new ManualClock();
    const registry = new WorkflowRegistry();
    let attempts = 0;
    registry.registerHandler('restart-retry', async () => {
      attempts += 1;
      if (attempts === 1) throw new Error('restart me');
      return 'recovered';
    });
    registry.create({
      name: 'restart-retry',
      steps: [{
        name: 'Retry after restart',
        handler: 'restart-retry',
        retries: 2,
        backoffMs: 10,
      }],
    });
    const first = track(new WorkflowService(db, registry, { clock, wakeTimer: false }));
    const instanceId = await first.start('restart-retry');
    await first.dispose();

    const timer = new ManualWakeTimer(clock);
    const second = track(new WorkflowService(db, registry, { clock, wakeTimer: timer }));
    expect(await second.recoverInFlight()).toBe(0);
    expect(timer.size).toBe(1);
    timer.advance(10);
    await waitFor(() => second.get(instanceId)?.status === 'completed');
    expect(attempts).toBe(2);
    expect(second.get(instanceId)?.output).toBe('"recovered"');
  });

  test('rearms an active future deadline during startup recovery', async () => {
    const clock = new ManualClock();
    const timer = new ManualWakeTimer(clock);
    const registry = new WorkflowRegistry();
    const entered = deferred<void>();
    let aborted = false;
    registry.registerHandler('retained-handler', async ({ signal }) => {
      entered.resolve();
      signal?.addEventListener('abort', () => { aborted = true; }, { once: true });
      return new Promise<never>(() => {});
    });
    seedFutureRunning('future-deadline');
    const service = track(new WorkflowService(db, registry, {
      clock,
      wakeTimer: timer,
      shutdownGraceMs: 1,
    }));

    expect(await service.recoverInFlight()).toBe(1);
    await entered.promise;
    expect(timer.size).toBe(1);
    timer.advance(49);
    expect(service.get('future-deadline')?.status).toBe('running');
    timer.advance(1);
    await waitFor(() => service.get('future-deadline')?.status === 'failed');
    expect(aborted).toBe(true);
  });
});

describe('workflow recovery timeout precedence', () => {
  test('times out expired waiting, running, and retry frontiers without retired handlers', async () => {
    seedExpired('expired-waiting', 'waiting');
    seedExpired('expired-running', 'running');
    seedExpired('expired-retry', 'failed');
    const service = track(new WorkflowService(db, new WorkflowRegistry(), {
      clock: new ManualClock(),
    }));

    expect(await service.recoverInFlight()).toBe(0);
    for (const instanceId of ['expired-waiting', 'expired-running', 'expired-retry']) {
      expect(service.get(instanceId)).toMatchObject({
        status: 'failed',
        completed_at: START_ISO,
      });
      expect(service.getSteps(instanceId)[0]).toMatchObject({
        status: 'failed',
        error: 'Step timed out',
        timeout_at: null,
        completed_at: START_ISO,
      });
    }
    expect(service.pollTimeouts()).toBe(0);
  });

  test('validates the whole recovery set before expiring any otherwise-due frontier', async () => {
    seedExpired('valid-expired', 'waiting');
    seedCorruptSuccessor('corrupt-successor');
    const service = track(new WorkflowService(db, new WorkflowRegistry(), {
      clock: new ManualClock(),
    }));

    await expect(service.recoverInFlight()).rejects.toMatchObject({
      code: 'WORKFLOW_STATE_INVALID',
    });
    expect(service.get('valid-expired')?.status).toBe('running');
    expect(service.getSteps('valid-expired')[0]?.status).toBe('waiting');
  });
});

describe('workflow strict frontier corruption fencing', () => {
  test('timeout polling and pause never terminalize an expired successor', () => {
    seedCorruptExpiredSuccessor('expired-successor');
    const service = track(new WorkflowService(db, new WorkflowRegistry(), {
      clock: new ManualClock(),
    }));
    const before = service.getSteps('expired-successor');

    expect(service.pollTimeouts()).toBe(0);
    expect(() => service.pause('expired-successor'))
      .toThrow(/persisted state is invalid/);
    expect(service.get('expired-successor')?.status).toBe('running');
    expect(service.getSteps('expired-successor')).toEqual(before);
  });

  test('never expires a non-frontier row and never projects its forged output', async () => {
    seedCorruptSuccessor('corrupt-successor');
    const registry = new WorkflowRegistry();
    let calls = 0;
    registry.registerHandler('first', async () => {
      calls += 1;
      return 'correct';
    });
    registry.registerHandler('second', async () => 'second');
    const service = track(new WorkflowService(db, registry, {
      clock: new ManualClock(),
    }));
    const before = service.getSteps('corrupt-successor');

    expect(service.pollTimeouts()).toBe(0);
    expect(service.getSteps('corrupt-successor')).toEqual(before);
    await service.advance('corrupt-successor');
    expect(calls).toBe(0);
    expect(service.get('corrupt-successor')).toMatchObject({
      status: 'failed',
      output: null,
    });
    expect(service.getSteps('corrupt-successor')[1]).toMatchObject({
      status: 'completed',
      output: '"wrong"',
    });
  });

  test('recovery rejects a progressed successor without mutating public rows', async () => {
    seedCorruptSuccessor('recovery-corrupt');
    const registry = new WorkflowRegistry();
    registry.registerHandler('first', async () => null);
    registry.registerHandler('second', async () => null);
    const service = track(new WorkflowService(db, registry, {
      clock: new ManualClock(),
    }));
    const before = publicRows();

    await expect(service.recoverInFlight()).rejects.toMatchObject({
      code: 'WORKFLOW_STATE_INVALID',
    });
    expect(publicRows()).toEqual(before);
  });
});

function seedExpired(
  instanceId: string,
  status: 'waiting' | 'running' | 'failed',
): void {
  const waitFor = status === 'waiting' ? 'continue' : undefined;
  const retries = status === 'failed' ? 1 : 0;
  const definition = {
    name: 'Expired',
    handler: `retired-${instanceId}`,
    ...(waitFor ? { waitFor } : {}),
    ...(status === 'failed' ? { retries: 2, backoffMs: 100 } : {}),
    timeoutMs: 100,
  };
  insertInstance(instanceId, [definition]);
  db.insert('workflow_steps', {
    step_id: `${instanceId}-step`,
    instance_id: instanceId,
    step_index: 0,
    step_name: 'Expired',
    status,
    input: null,
    output: null,
    error: status === 'failed' ? 'transient' : null,
    retries,
    max_retries: status === 'failed' ? 2 : 3,
    retry_at: status === 'failed' ? new Date(START + 1_000).toISOString() : null,
    wait_event: waitFor ?? null,
    timeout_at: START_ISO,
    started_at: new Date(START - 100).toISOString(),
    completed_at: null,
    created_at: new Date(START - 100).toISOString(),
  });
}

function seedFutureRunning(instanceId: string): void {
  insertInstance(instanceId, [{
    name: 'Future deadline',
    handler: 'retained-handler',
    timeoutMs: 50,
  }]);
  db.insert('workflow_steps', {
    ...pristineStep(instanceId, 0, 'Future deadline'),
    status: 'running',
    timeout_at: new Date(START + 50).toISOString(),
    started_at: START_ISO,
  });
}

function seedCorruptSuccessor(instanceId: string): void {
  const definitions = [
    { name: 'First', handler: 'first' },
    { name: 'Second', handler: 'second', timeoutMs: 100 },
  ];
  insertInstance(instanceId, definitions);
  db.insert('workflow_steps', pristineStep(instanceId, 0, 'First'));
  db.insert('workflow_steps', {
    ...pristineStep(instanceId, 1, 'Second'),
    status: 'completed',
    output: '"wrong"',
    timeout_at: null,
    started_at: new Date(START - 100).toISOString(),
    completed_at: new Date(START - 50).toISOString(),
  });
}

function seedCorruptExpiredSuccessor(instanceId: string): void {
  const definitions = [
    { name: 'First', handler: 'first' },
    {
      name: 'Later wait',
      handler: 'second',
      waitFor: 'continue',
      timeoutMs: 100,
    },
  ];
  insertInstance(instanceId, definitions);
  db.insert('workflow_steps', pristineStep(instanceId, 0, 'First'));
  db.insert('workflow_steps', {
    ...pristineStep(instanceId, 1, 'Later wait'),
    status: 'waiting',
    wait_event: 'continue',
    timeout_at: START_ISO,
    started_at: new Date(START - 100).toISOString(),
  });
}

function insertInstance(instanceId: string, definitions: unknown[]): void {
  db.insert('workflow_instances', {
    instance_id: instanceId,
    definition_id: `${instanceId}-definition`,
    name: instanceId,
    status: 'running',
    current_step: 0,
    input: null,
    output: null,
    error: null,
    started_by: null,
    steps_json: JSON.stringify(definitions),
    created_at: new Date(START - 100).toISOString(),
    updated_at: new Date(START - 100).toISOString(),
    completed_at: null,
  });
}

function pristineStep(
  instanceId: string,
  stepIndex: number,
  stepName: string,
): Record<string, unknown> {
  return {
    step_id: `${instanceId}-step-${stepIndex}`,
    instance_id: instanceId,
    step_index: stepIndex,
    step_name: stepName,
    status: 'pending',
    input: null,
    output: null,
    error: null,
    retries: 0,
    max_retries: 3,
    retry_at: null,
    wait_event: null,
    timeout_at: null,
    started_at: null,
    completed_at: null,
    created_at: new Date(START - 100).toISOString(),
  };
}

function publicRows(): Record<string, unknown[]> {
  return {
    instances: db.query('workflow_instances'),
    steps: db.query('workflow_steps'),
    events: db.query('workflow_events'),
  };
}

function onlyInstanceId(service: WorkflowService): string {
  const rows = service.list();
  expect(rows).toHaveLength(1);
  return String(rows[0]!.instance_id);
}

function track(service: WorkflowService): WorkflowService {
  services.push(service);
  return service;
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

class ManualWakeTimer implements WorkflowWakeTimer {
  private sequence = 0;
  private readonly jobs = new Map<number, { at: number; callback: () => void }>();

  constructor(private readonly clock: ManualClock) {}

  get size(): number {
    return this.jobs.size;
  }

  schedule(callback: () => void, delayMs: number): number {
    const id = ++this.sequence;
    this.jobs.set(id, { at: this.clock.now().getTime() + delayMs, callback });
    return id;
  }

  cancel(handle: unknown): void {
    this.jobs.delete(Number(handle));
  }

  advance(milliseconds: number): void {
    this.clock.advance(milliseconds);
    while (true) {
      const due = [...this.jobs.entries()]
        .filter(([, job]) => job.at <= this.clock.now().getTime())
        .sort((left, right) => left[1].at - right[1].at || left[0] - right[0]);
      if (due.length === 0) return;
      for (const [id, job] of due) {
        if (!this.jobs.delete(id)) continue;
        job.callback();
      }
    }
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

async function settleMicrotasks(): Promise<void> {
  for (let index = 0; index < 10; index += 1) await Promise.resolve();
}

async function waitFor(predicate: () => boolean, timeoutMs = 500): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    if (predicate()) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 1));
  }
  throw new Error('Timed out waiting for workflow state');
}
