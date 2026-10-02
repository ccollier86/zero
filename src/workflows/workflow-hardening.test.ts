import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { createReactiveDB, type ReactiveDB } from '../sync/reactive-db';
import { applicationServiceDataScope } from '../auth/service-data-scope';
import type { WorkflowClock } from './workflow-executor';
import {
  createSystemAuthority,
  WorkflowExecutionAuthorityStore,
} from './workflow-execution-authority';
import { WorkflowRegistry } from './workflow-registry';
import { defineWorkflowTables } from './workflow-schema';
import { WorkflowService } from './workflow-service';

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

describe('workflow initialization recovery', () => {
  test('preflights all topology and handlers before mutation, then permits a corrected retry once', async () => {
    const registry = new WorkflowRegistry();
    registry.registerHandler('registered', async () => null);
    seedRunning('corrupt', 'corrupt-step', 'registered', 1);
    seedRunning('missing', 'missing-step', 'late-handler', 0);
    const service = track(new WorkflowService(db, registry));
    const original = publicRows();

    await expect(service.recoverInFlight()).rejects.toMatchObject({
      code: 'WORKFLOW_STATE_INVALID',
    });
    expect(publicRows()).toEqual(original);

    db.update('workflow_steps', 'corrupt-step', { step_index: 0 });
    const beforeMissingHandler = publicRows();
    await expect(service.recoverInFlight()).rejects.toMatchObject({
      code: 'WORKFLOW_HANDLER_NOT_REGISTERED',
    });
    expect(publicRows()).toEqual(beforeMissingHandler);

    registry.registerHandler('late-handler', async () => null);
    expect(await service.recoverInFlight()).toBe(2);
    await settleMicrotasks();
    expect(service.get('corrupt')?.status).toBe('completed');
    expect(service.get('missing')?.status).toBe('completed');
    await expect(service.recoverInFlight()).rejects.toMatchObject({
      code: 'WORKFLOW_STATE_INVALID',
    });
  });

  test('rejects a running instance with no durable steps without mutating it', async () => {
    const registry = new WorkflowRegistry();
    seedInstance('empty', 'running', []);
    const service = track(new WorkflowService(db, registry));
    const original = publicRows();

    await expect(service.recoverInFlight()).rejects.toMatchObject({
      code: 'WORKFLOW_STATE_INVALID',
    });
    expect(publicRows()).toEqual(original);
  });

  test('rejects recovery after normal workflow operations have begun', async () => {
    const registry = new WorkflowRegistry();
    registry.registerHandler('noop', async () => null);
    registry.create({
      name: 'already-live',
      steps: [{ name: 'Noop', handler: 'noop' }],
    });
    const service = track(new WorkflowService(db, registry));
    await service.start('already-live');

    await expect(service.recoverInFlight()).rejects.toMatchObject({
      code: 'WORKFLOW_STATE_INVALID',
    });
  });

  test('rejects direct workflow operations reentered during recovery preflight', async () => {
    const registry = new WorkflowRegistry();
    registry.registerHandler('recover-handler', async () => null);
    seedRunning('reentrant-recovery', 'reentrant-recovery-step', 'recover-handler', 0);
    const service = track(new WorkflowService(db, registry));
    const originalGetHandler = registry.getHandler.bind(registry);
    let reentrantError: unknown;
    let attempted = false;
    registry.getHandler = (name: string) => {
      if (!attempted) {
        attempted = true;
        try {
          service.pause('reentrant-recovery');
        } catch (error) {
          reentrantError = error;
        }
      }
      return originalGetHandler(name);
    };

    expect(await service.recoverInFlight()).toBe(1);
    expect(reentrantError).toMatchObject({ code: 'WORKFLOW_NOT_READY', status: 503 });
    await settleMicrotasks();
    expect(service.get('reentrant-recovery')?.status).toBe('completed');
  });

  test('fails closed when recovery encounters an unsupported pending instance state', async () => {
    const registry = new WorkflowRegistry();
    registry.registerHandler('pending-handler', async () => null);
    seedInstance('pending-instance', 'pending', [{ name: 'Step', handler: 'pending-handler' }]);
    db.insert('workflow_steps', {
      step_id: 'pending-step',
      instance_id: 'pending-instance',
      step_index: 0,
      step_name: 'Step',
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
      created_at: START_ISO,
    });
    seedResourceAccounting(db, 'pending-instance');
    const service = track(new WorkflowService(db, registry));
    const original = publicRows();

    await expect(service.recoverInFlight()).rejects.toMatchObject({
      code: 'WORKFLOW_STATE_INVALID',
    });
    expect(publicRows()).toEqual(original);
  });

  test('does not require an obsolete handler for a completed step during recovery', async () => {
    const registry = new WorkflowRegistry();
    registry.registerHandler('live-handler', async () => 'recovered');
    seedInstance('retired-handler', 'running', [
      { name: 'Old step', handler: 'removed-handler' },
      { name: 'Live step', handler: 'live-handler' },
    ]);
    db.insert('workflow_steps', {
      step_id: 'retired-step',
      instance_id: 'retired-handler',
      step_index: 0,
      step_name: 'Old step',
      status: 'completed',
      input: null,
      output: '"old-output"',
      error: null,
      retries: 0,
      max_retries: 3,
      retry_at: null,
      wait_event: null,
      timeout_at: null,
      started_at: START_ISO,
      completed_at: START_ISO,
      created_at: START_ISO,
    });
    db.insert('workflow_steps', {
      step_id: 'live-step',
      instance_id: 'retired-handler',
      step_index: 1,
      step_name: 'Live step',
      status: 'running',
      input: '"old-output"',
      output: null,
      error: null,
      retries: 0,
      max_retries: 3,
      retry_at: null,
      wait_event: null,
      timeout_at: null,
      started_at: START_ISO,
      completed_at: null,
      created_at: START_ISO,
    });
    seedResourceAccounting(db, 'retired-handler');
    const service = track(new WorkflowService(db, registry));

    expect(await service.recoverInFlight()).toBe(1);
    await settleMicrotasks();
    expect(service.get('retired-handler')).toMatchObject({
      status: 'completed',
      output: '"recovered"',
    });
  });

  test('does not report recovery success when disposal wins during normalization', async () => {
    const registry = new WorkflowRegistry();
    let handlerCalls = 0;
    registry.registerHandler('recover-handler', async () => {
      handlerCalls += 1;
      return null;
    });
    seedRunning('dispose-recovery', 'dispose-recovery-step', 'recover-handler', 0);
    const service = track(new WorkflowService(db, registry));
    let disposal: Promise<void> | null = null;
    const unsubscribe = db.onChange((change) => {
      if (disposal
        || change.table !== 'workflow_steps'
        || change.row?.step_id !== 'dispose-recovery-step'
        || change.row.status !== 'pending') return;
      disposal = service.dispose();
    });

    try {
      await expect(service.recoverInFlight()).rejects.toMatchObject({
        code: 'WORKFLOW_NOT_READY',
      });
      if (disposal) await disposal;
      expect(handlerCalls).toBe(0);
      expect(service.get('dispose-recovery')?.status).toBe('running');
      expect(service.getSteps('dispose-recovery')[0]?.status).toBe('pending');
    } finally {
      unsubscribe();
    }
  });
});

describe('workflow deadline and reentrant prepare fencing', () => {
  test('lets an expired deadline win over pause and reports the failed transition', async () => {
    const clock = new ManualClock();
    const registry = new WorkflowRegistry();
    registry.registerHandler('after-event', async () => null);
    registry.create({
      name: 'pause-at-deadline',
      steps: [{
        name: 'Wait',
        handler: 'after-event',
        waitFor: 'continue',
        timeoutMs: 100,
      }],
    });
    const service = track(new WorkflowService(db, registry, { clock }));
    const instanceId = await service.start('pause-at-deadline');
    clock.advance(100);

    let thrown: unknown;
    try {
      service.pause(instanceId);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toMatchObject({ code: 'WORKFLOW_STATE_INVALID', status: 409 });
    expect(service.get(instanceId)).toMatchObject({ status: 'failed' });
    expect(service.getSteps(instanceId)[0]).toMatchObject({
      status: 'failed',
      error: 'Step timed out',
      timeout_at: null,
    });
  });

  for (const transition of ['pause', 'cancel'] as const) {
    test(`does not invoke a handler when a change listener ${transition}s during prepare`, async () => {
      const registry = new WorkflowRegistry();
      let handlerCalls = 0;
      registry.registerHandler('must-not-run', async () => {
        handlerCalls += 1;
        return null;
      });
      registry.create({
        name: `prepare-${transition}`,
        steps: [{ name: 'Guarded', handler: 'must-not-run' }],
      });
      const service = track(new WorkflowService(db, registry));
      let transitioned = false;
      const unsubscribe = db.onChange((change) => {
        if (transitioned
          || change.table !== 'workflow_steps'
          || change.row?.status !== 'running') return;
        transitioned = true;
        const instanceId = String(change.row.instance_id);
        if (transition === 'pause') service.pause(instanceId);
        else service.cancel(instanceId);
      });

      try {
        const instanceId = await service.start(`prepare-${transition}`);
        expect(handlerCalls).toBe(0);
        expect(service.get(instanceId)?.status)
          .toBe(transition === 'pause' ? 'paused' : 'cancelled');
      } finally {
        unsubscribe();
      }
    });
  }
});

describe('workflow durable payload validation', () => {
  test('passes decoded null into conditions without coercing it to an object', async () => {
    const registry = new WorkflowRegistry();
    let calls = 0;
    registry.registerHandler('null-input', async () => {
      calls += 1;
      return null;
    });
    registry.create({
      name: 'null-condition',
      steps: [{
        name: 'Null input',
        handler: 'null-input',
        condition: 'input === null',
      }],
    });
    const service = track(new WorkflowService(db, registry));

    const instanceId = await service.start('null-condition', null);
    expect(calls).toBe(1);
    expect(service.get(instanceId)?.status).toBe('completed');
  });

  test('fails closed on malformed persisted workflow input', async () => {
    const { service, calls } = waitingService('bad-input');
    const instanceId = await service.start('bad-input');
    db.update('workflow_instances', instanceId, { input: '{bad json' });

    await service.sendEvent(instanceId, 'continue', { ok: true });
    expect(calls()).toBe(0);
    expect(service.get(instanceId)?.status).toBe('failed');
    expect(service.getSteps(instanceId)[0]?.error).toContain('Workflow input');
  });

  test('fails closed when a predecessor output is malformed', async () => {
    const registry = new WorkflowRegistry();
    let secondCalls = 0;
    registry.registerHandler('first', async () => ({ ok: true }));
    registry.registerHandler('second', async () => {
      secondCalls += 1;
      return null;
    });
    registry.create({
      name: 'bad-predecessor',
      steps: [
        { name: 'First', handler: 'first' },
        { name: 'Second', handler: 'second' },
      ],
    });
    const service = track(new WorkflowService(db, registry));
    let corrupted = false;
    const unsubscribe = db.onChange((change) => {
      if (corrupted
        || change.table !== 'workflow_steps'
        || change.row?.step_index !== 0
        || change.row.status !== 'completed') return;
      corrupted = true;
      db.update('workflow_steps', String(change.row.step_id), { output: '{bad json' });
    });

    try {
      const instanceId = await service.start('bad-predecessor');
      expect(secondCalls).toBe(0);
      expect(service.get(instanceId)?.status).toBe('failed');
      expect(service.getSteps(instanceId)[1]?.error).toContain('step 0 output');
    } finally {
      unsubscribe();
    }
  });

  test('fails closed on a malformed claimed event payload', async () => {
    const { service, calls } = waitingService('bad-event');
    const instanceId = await service.start('bad-event');
    db.exec('DROP TRIGGER trg_workflow_event_command_immutable');
    const unsubscribe = db.onChange((change) => {
      if (change.table === 'workflow_events' && change.op === 'INSERT') {
        db.update('workflow_events', change.rowId, { payload: '{bad json' });
      }
    });

    try {
      await service.sendEvent(instanceId, 'continue', { ok: true });
      expect(calls()).toBe(0);
      expect(service.get(instanceId)?.status).toBe('failed');
      expect(service.getSteps(instanceId)[0]?.error).toContain('event payload is invalid');
    } finally {
      unsubscribe();
    }
  });

  test('rejects event names with surrounding whitespace before persistence', async () => {
    const { service } = waitingService('event-spacing');
    const instanceId = await service.start('event-spacing');

    await expect(service.sendEvent(instanceId, ' continue ', null))
      .rejects.toMatchObject({ code: 'WORKFLOW_EVENT_INVALID', status: 422 });
    expect(service.getEvents(instanceId)).toHaveLength(0);
  });
});

describe('workflow teardown failure safety', () => {
  test('always fences, aborts, and drains handlers before sharing normalization failure', async () => {
    const registry = new WorkflowRegistry();
    let aborted = false;
    const started = deferred<void>();
    registry.registerHandler('long-running', async ({ signal }) => {
      started.resolve();
      await new Promise<void>((resolve) => {
        if (signal?.aborted) {
          aborted = true;
          resolve();
          return;
        }
        signal?.addEventListener('abort', () => {
          aborted = true;
          resolve();
        }, { once: true });
      });
      return null;
    });
    registry.create({
      name: 'dispose-failure',
      steps: [{ name: 'Long running', handler: 'long-running' }],
    });
    const service = track(new WorkflowService(db, registry));
    const startPromise = service.start('dispose-failure');
    await started.promise;
    db.exec(`
      CREATE TRIGGER fail_workflow_disposal_normalization
      BEFORE UPDATE OF status ON workflow_steps
      WHEN OLD.status = 'running' AND NEW.status = 'pending'
      BEGIN
        SELECT RAISE(ABORT, 'injected workflow normalization failure');
      END
    `);

    const first = service.dispose();
    const second = service.dispose();
    const results = await Promise.allSettled([first, second]);
    expect(results[0]?.status).toBe('rejected');
    expect(results[1]?.status).toBe('rejected');
    if (results[0]?.status === 'rejected' && results[1]?.status === 'rejected') {
      expect(results[0].reason).toBe(results[1].reason);
      expect(String(results[0].reason)).toContain('injected workflow normalization failure');
    }
    expect(aborted).toBe(true);
    await startPromise;
    expect((db.prepare('SELECT COUNT(*) AS count FROM _workflow_step_attempts').get() as {
      count: number;
    }).count).toBe(0);
  });
});

function waitingService(name: string): {
  service: WorkflowService;
  calls: () => number;
} {
  const registry = new WorkflowRegistry();
  let callCount = 0;
  registry.registerHandler('wait-handler', async () => {
    callCount += 1;
    return null;
  });
  registry.create({
    name,
    steps: [{ name: 'Wait', handler: 'wait-handler', waitFor: 'continue' }],
  });
  return {
    service: track(new WorkflowService(db, registry)),
    calls: () => callCount,
  };
}

function seedRunning(
  instanceId: string,
  stepId: string,
  handler: string,
  stepIndex: number,
): void {
  seedInstance(instanceId, 'running', [{ name: 'Step', handler }]);
  db.insert('workflow_steps', {
    step_id: stepId,
    instance_id: instanceId,
    step_index: stepIndex,
    step_name: 'Step',
    status: 'running',
    input: null,
    output: null,
    error: null,
    retries: 0,
    max_retries: 3,
    retry_at: null,
    wait_event: null,
    timeout_at: null,
    started_at: START_ISO,
    completed_at: null,
    created_at: START_ISO,
  });
  seedResourceAccounting(db, instanceId);
}

function seedInstance(
  instanceId: string,
  status: string,
  steps: Array<{ name: string; handler: string }>,
): void {
  db.insert('workflow_instances', {
    instance_id: instanceId,
    definition_id: `definition-${instanceId}`,
    name: 'recovery-test',
    status,
    current_step: 0,
    input: null,
    output: null,
    error: null,
    started_by: null,
    steps_json: JSON.stringify(steps),
    created_at: START_ISO,
    updated_at: START_ISO,
    completed_at: null,
  });
  new WorkflowExecutionAuthorityStore(db).insert(
    instanceId,
    createSystemAuthority({
      principal: 'workflow-hardening-test',
      reason: 'Seed a recoverable standalone workflow fixture',
      scope: applicationServiceDataScope(),
      legacyCompatibility: true,
    }),
  );
  seedResourceAccounting(db, instanceId);
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

function publicRows(): Record<string, unknown[]> {
  return {
    instances: db.query('workflow_instances'),
    steps: db.query('workflow_steps'),
    events: db.query('workflow_events'),
  };
}

function track(service: WorkflowService): WorkflowService {
  services.push(service);
  return service;
}

async function settleMicrotasks(): Promise<void> {
  for (let index = 0; index < 10; index += 1) await Promise.resolve();
}

class ManualClock implements WorkflowClock {
  constructor(private time = START) {}

  now(): Date {
    return new Date(this.time);
  }

  advance(milliseconds: number): void {
    this.time += milliseconds;
  }
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value?: T) => void;
} {
  let resolve!: (value?: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise as (value?: T) => void;
  });
  return { promise, resolve };
}
