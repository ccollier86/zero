import { describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createReactiveDB, type ReactiveDB } from '../sync/reactive-db';
import type { WorkflowClock } from './workflow-executor';
import { WorkflowRegistry } from './workflow-registry';
import { defineWorkflowTables } from './workflow-schema';
import { WorkflowService } from './workflow-service';
import type { StepContext } from './types';

const START = Date.parse('2030-01-02T03:04:05.000Z');

describe('workflow file-backed restart recovery', () => {
  test('preserves a claimed event and logical execution identity while issuing a fresh attempt', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'zero-workflow-event-restart-'));
    const path = join(directory, 'workflow.db');
    const clock = new ManualClock();
    const firstEntered = deferred<StepContext>();
    let firstDb: ReactiveDB | null = null;
    let secondDb: ReactiveDB | null = null;
    let firstService: WorkflowService | null = null;
    let secondService: WorkflowService | null = null;
    const releaseSecond = gate();

    try {
      firstDb = openWorkflowDatabase(path);
      const firstRegistry = new WorkflowRegistry();
      firstRegistry.registerHandler('consume-approval', async (context) => {
        firstEntered.resolve(context);
        await aborted(context.signal);
        return { processWasStopping: true };
      });
      registerApprovalWorkflow(firstRegistry);
      firstService = new WorkflowService(firstDb, firstRegistry, { clock });

      const instanceId = await firstService.start(
        'approval-restart',
        { requestId: 'request_1' },
        'user_1',
      );
      const waitingStep = firstService.getSteps(instanceId)[0]!;
      const originalTimeoutAt = new Date(START + 60_000).toISOString();
      expect(waitingStep).toMatchObject({
        status: 'waiting',
        wait_event: 'approved',
        timeout_at: originalTimeoutAt,
      });

      const sending = firstService.sendEvent(
        instanceId,
        'approved',
        { approved: true, reviewer: 'reviewer_1' },
        'reviewer_1',
      );
      const firstContext = await firstEntered.promise;
      const eventId = firstContext.waitEvent?.id;
      expect(eventId).toEqual(expect.any(String));
      if (!eventId) throw new Error('Expected the approval event to be claimed');
      expect(firstContext.waitEvent).toEqual({
        id: eventId,
        name: 'approved',
        payload: { approved: true, reviewer: 'reviewer_1' },
      });

      // A graceful process boundary removes the physical attempt fence but
      // deliberately leaves the durable event claim and logical deadline.
      const stopping = firstService.dispose();
      await Promise.all([stopping, sending]);
      expect(firstContext.signal?.aborted).toBe(true);
      const stoppedStep = firstService.getSteps(instanceId)[0]!;
      expect(stoppedStep).toMatchObject({
        status: 'pending',
        timeout_at: originalTimeoutAt,
      });
      const publicStateBeforeClose = publicWorkflowState(firstDb);
      firstDb.dispose();
      firstDb = null;

      secondDb = openWorkflowDatabase(path);
      expect(publicWorkflowState(secondDb)).toEqual(publicStateBeforeClose);

      const secondEntered = deferred<StepContext>();
      const secondRegistry = new WorkflowRegistry();
      secondRegistry.registerHandler('consume-approval', async (context) => {
        secondEntered.resolve(context);
        await releaseSecond.promise;
        return { recovered: true };
      });
      registerApprovalWorkflow(secondRegistry);
      secondService = new WorkflowService(secondDb, secondRegistry, { clock });

      expect(await secondService.recoverInFlight()).toBe(0);
      const recoveredContext = await secondEntered.promise;
      expect(recoveredContext.waitEvent).toEqual(firstContext.waitEvent);
      expect(recoveredContext.attemptId).toEqual(expect.any(String));
      expect(recoveredContext.attemptId).not.toBe(firstContext.attemptId);
      expect(recoveredContext.idempotencyKey).toBe(firstContext.idempotencyKey);
      expect(recoveredContext.idempotencyKey)
        .toBe(`workflow:${instanceId}:step:0`);
      expect(secondService.getSteps(instanceId)[0]).toMatchObject({
        status: 'running',
        timeout_at: originalTimeoutAt,
      });
      expect(secondService.getEvents(instanceId)).toEqual([
        expect.objectContaining({
          event_id: eventId,
          event_name: 'approved',
          payload: JSON.stringify({ approved: true, reviewer: 'reviewer_1' }),
          sent_by: 'reviewer_1',
        }),
      ]);

      releaseSecond.open();
      await secondService.advance(instanceId);
      expect(secondService.get(instanceId)).toMatchObject({
        status: 'completed',
        output: JSON.stringify({ recovered: true }),
        started_by: 'user_1',
      });
      expect(secondService.getSteps(instanceId)[0]).toMatchObject({
        status: 'completed',
        timeout_at: null,
      });
    } finally {
      releaseSecond.open();
      await Promise.allSettled([
        secondService?.dispose(),
        firstService?.dispose(),
      ].filter((value): value is Promise<void> => Boolean(value)));
      secondDb?.dispose();
      firstDb?.dispose();
      await rm(directory, { recursive: true, force: true });
    }
  });

  test('recovers due retries, leaves future retries blocked, and permits recovery only once', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'zero-workflow-retry-restart-'));
    const path = join(directory, 'workflow.db');
    const firstClock = new ManualClock();
    let firstDb: ReactiveDB | null = null;
    let secondDb: ReactiveDB | null = null;
    let firstService: WorkflowService | null = null;
    let secondService: WorkflowService | null = null;

    try {
      firstDb = openWorkflowDatabase(path);
      const firstRegistry = retryRegistry(async () => {
        throw new Error('retry after restart');
      });
      firstService = new WorkflowService(firstDb, firstRegistry, { clock: firstClock });

      const dueId = await firstService.start('retry-due-after-restart');
      const futureId = await firstService.start('retry-future-after-restart');
      expect(firstService.getSteps(dueId)[0]).toMatchObject({
        status: 'failed',
        retries: 1,
        retry_at: new Date(START + 100).toISOString(),
      });
      const futureRetryAt = new Date(START + 200).toISOString();
      expect(firstService.getSteps(futureId)[0]).toMatchObject({
        status: 'failed',
        retries: 1,
        retry_at: futureRetryAt,
      });
      await firstService.dispose();
      firstDb.dispose();
      firstDb = null;

      const recoveredCalls: string[] = [];
      const secondClock = new ManualClock(START + 100);
      secondDb = openWorkflowDatabase(path);
      const secondRegistry = retryRegistry(async ({ instanceId }) => {
        recoveredCalls.push(instanceId);
        return { recovered: instanceId };
      });
      secondService = new WorkflowService(secondDb, secondRegistry, { clock: secondClock });

      expect(await secondService.recoverInFlight()).toBe(0);
      await secondService.advance(dueId);
      await secondService.advance(futureId);
      expect(recoveredCalls).toEqual([dueId]);
      expect(secondService.get(dueId)?.status).toBe('completed');
      expect(secondService.get(futureId)?.status).toBe('running');
      expect(secondService.getSteps(futureId)[0]).toMatchObject({
        status: 'failed',
        retries: 1,
        retry_at: futureRetryAt,
      });

      await expect(secondService.recoverInFlight()).rejects.toMatchObject({
        code: 'WORKFLOW_STATE_INVALID',
        status: 409,
      });
      expect(recoveredCalls).toEqual([dueId]);

      secondClock.advance(100);
      expect(await secondService.pollRetries()).toBe(1);
      await secondService.advance(futureId);
      expect(recoveredCalls).toEqual([dueId, futureId]);
      expect(secondService.get(futureId)?.status).toBe('completed');
    } finally {
      await Promise.allSettled([
        secondService?.dispose(),
        firstService?.dispose(),
      ].filter((value): value is Promise<void> => Boolean(value)));
      secondDb?.dispose();
      firstDb?.dispose();
      await rm(directory, { recursive: true, force: true });
    }
  });

  test('fails an exactly expired waiting deadline during restart recovery without invoking the handler', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'zero-workflow-timeout-restart-'));
    const path = join(directory, 'workflow.db');
    const firstClock = new ManualClock();
    let firstDb: ReactiveDB | null = null;
    let secondDb: ReactiveDB | null = null;
    let firstService: WorkflowService | null = null;
    let secondService: WorkflowService | null = null;

    try {
      firstDb = openWorkflowDatabase(path);
      const firstRegistry = timeoutRegistry(async () => null);
      firstService = new WorkflowService(firstDb, firstRegistry, { clock: firstClock });
      const instanceId = await firstService.start('deadline-restart');
      const deadline = new Date(START + 100).toISOString();
      expect(firstService.getSteps(instanceId)[0]).toMatchObject({
        status: 'waiting',
        timeout_at: deadline,
      });
      await firstService.dispose();
      firstDb.dispose();
      firstDb = null;

      let calls = 0;
      secondDb = openWorkflowDatabase(path);
      const secondRegistry = timeoutRegistry(async () => {
        calls += 1;
        return null;
      });
      secondService = new WorkflowService(secondDb, secondRegistry, {
        clock: new ManualClock(START + 100),
      });
      expect(secondService.getSteps(instanceId)[0]?.timeout_at).toBe(deadline);

      expect(await secondService.recoverInFlight()).toBe(0);
      await secondService.advance(instanceId);
      expect(calls).toBe(0);
      expect(secondService.get(instanceId)).toMatchObject({
        status: 'failed',
        completed_at: deadline,
      });
      expect(secondService.getSteps(instanceId)[0]).toMatchObject({
        status: 'failed',
        error: 'Step timed out',
        timeout_at: null,
        completed_at: deadline,
      });
    } finally {
      await Promise.allSettled([
        secondService?.dispose(),
        firstService?.dispose(),
      ].filter((value): value is Promise<void> => Boolean(value)));
      secondDb?.dispose();
      firstDb?.dispose();
      await rm(directory, { recursive: true, force: true });
    }
  });
});

function openWorkflowDatabase(path: string): ReactiveDB {
  const db = createReactiveDB({ mode: path });
  defineWorkflowTables(db);
  return db;
}

function registerApprovalWorkflow(registry: WorkflowRegistry): void {
  registry.create({
    name: 'approval-restart',
    steps: [{
      name: 'Consume approval',
      handler: 'consume-approval',
      waitFor: 'approved',
      timeoutMs: 60_000,
    }],
  });
}

function retryRegistry(handler: (context: StepContext) => Promise<unknown>): WorkflowRegistry {
  const registry = new WorkflowRegistry();
  registry.registerHandler('retry-due-handler', handler);
  registry.registerHandler('retry-future-handler', handler);
  registry.create({
    name: 'retry-due-after-restart',
    steps: [{
      name: 'Due retry',
      handler: 'retry-due-handler',
      retries: 2,
      backoffMs: 100,
    }],
  });
  registry.create({
    name: 'retry-future-after-restart',
    steps: [{
      name: 'Future retry',
      handler: 'retry-future-handler',
      retries: 2,
      backoffMs: 200,
    }],
  });
  return registry;
}

function timeoutRegistry(handler: (context: StepContext) => Promise<unknown>): WorkflowRegistry {
  const registry = new WorkflowRegistry();
  registry.registerHandler('deadline-handler', handler);
  registry.create({
    name: 'deadline-restart',
    steps: [{
      name: 'Wait for deadline',
      handler: 'deadline-handler',
      waitFor: 'continue',
      timeoutMs: 100,
    }],
  });
  return registry;
}

function publicWorkflowState(db: ReactiveDB): Record<string, unknown[]> {
  return {
    definitions: db.query('workflow_definitions'),
    instances: db.query('workflow_instances'),
    steps: db.query('workflow_steps'),
    events: db.query('workflow_events'),
  };
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

function aborted(signal: AbortSignal | undefined): Promise<void> {
  if (!signal || signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    signal.addEventListener('abort', () => resolve(), { once: true });
  });
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function gate(): { promise: Promise<void>; open: () => void } {
  const state = deferred<void>();
  let opened = false;
  return {
    promise: state.promise,
    open() {
      if (opened) return;
      opened = true;
      state.resolve();
    },
  };
}
