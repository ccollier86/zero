/** Durable cross-handle Torrent ownership and stale-generation fencing. */

import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { createReactiveDB, type ReactiveDB } from '../sync/reactive-db';
import { WorkflowExecutor } from './workflow-executor';
import { flow, step } from './workflow-dsl';
import { WorkflowRepository } from './workflow-repository';
import { WorkflowRegistry } from './workflow-registry';
import { WorkflowRuntimeLeaseStore } from './workflow-runtime-lease-store';
import type { WorkflowRuntimeOwnershipOptions } from './workflow-runtime-owner-lease';
import { WorkflowRuntimeStore } from './workflow-runtime-store';
import { defineWorkflowTables } from './workflow-schema';
import { WorkflowService } from './workflow-service';

describe('durable Torrent runtime ownership', () => {
  const cleanups: Array<() => Promise<void>> = [];

  afterEach(async () => {
    await Promise.allSettled(cleanups.splice(0).reverse().map((cleanup) => cleanup()));
  });

  test('renews only a live generation and never lets a stale token release its successor', () => {
    const db = createReactiveDB({ mode: 'memory' });
    defineWorkflowTables(db);
    try {
      const leases = new WorkflowRuntimeLeaseStore(db);
      const first = leases.acquire('owner-a', 1_000, 1_000);
      const renewed = leases.renew(first, 1_500, 1_000);
      expect(renewed).toMatchObject({ generation: 1, expiresAt: 2_500 });
      expect(() => leases.acquire('owner-b', 2_001, 1_000)).toThrow(expect.objectContaining({
        code: 'WORKFLOW_RUNTIME_OWNED', status: 503, retryable: true,
      }));
      expect(leases.renew(renewed!, 2_500, 1_000)).toBeNull();
      const replacement = leases.acquire('owner-b', 2_500, 1_000);
      expect(replacement).toMatchObject({ generation: 2, ownerId: 'owner-b' });
      expect(leases.release(first, 2_501)).toBe(false);
      expect(leases.isCurrent(replacement, 2_501)).toBe(true);
    } finally {
      db.dispose();
    }
  });

  test('admits exactly one simultaneous owner across independent workers', async () => {
    const harness = await fileHarness(cleanups);
    const outcomes = await acquireSimultaneously(harness.path, [
      'concurrent-owner-a',
      'concurrent-owner-b',
    ]);
    expect(outcomes.filter((outcome) => outcome.ok)).toHaveLength(1);
    expect(outcomes.filter((outcome) => !outcome.ok)).toEqual([
      expect.objectContaining({
        ok: false, code: 'WORKFLOW_RUNTIME_OWNED', status: 503,
      }),
    ]);
  });

  test('excludes a second live service and admits it after exact release', async () => {
    const harness = await fileHarness(cleanups);
    const clock = new ManualLeaseClock();
    const registry = new WorkflowRegistry();
    const first = harness.track(new WorkflowService(harness.first, registry, {
      runtimeOwnership: ownership(clock, 'owner-a'),
    }));

    expect(() => new WorkflowService(harness.second, registry, {
      runtimeOwnership: ownership(clock, 'owner-b'),
    })).toThrow(expect.objectContaining({
      code: 'WORKFLOW_RUNTIME_OWNED', status: 503, retryable: true,
    }));

    await first.dispose();
    const second = harness.track(new WorkflowService(harness.second, registry, {
      runtimeOwnership: ownership(clock, 'owner-b'),
    }));
    expect(harness.second.prepare(`SELECT generation, owner_id, released_at
      FROM _workflow_runtime_owner_lease`).get()).toEqual({
      generation: 2,
      owner_id: 'owner-b',
      released_at: null,
    });
    await second.dispose();
  });

  test('fences preconstructed unmanaged runtime helpers while a managed owner is live', async () => {
    const harness = await fileHarness(cleanups);
    const unmanaged = new WorkflowRuntimeStore(harness.first);
    const managed = harness.track(new WorkflowService(harness.second, new WorkflowRegistry()));

    expect(() => unmanaged.clearAllAttempts()).toThrow(expect.objectContaining({
      code: 'WORKFLOW_RUNTIME_OWNED', status: 503,
    }));
    expect(() => new WorkflowRuntimeStore(harness.first)).toThrow(expect.objectContaining({
      code: 'WORKFLOW_RUNTIME_OWNED', status: 503,
    }));

    await managed.dispose();
    expect(() => unmanaged.clearAllAttempts()).not.toThrow();
  });

  test('fences every preconstructed standalone executor mutation while an owner is live', async () => {
    const harness = await fileHarness(cleanups);
    const registry = new WorkflowRegistry();
    let handlerCalls = 0;
    registry.registerHandler('unmanaged-fence-handler', async () => {
      handlerCalls += 1;
      return 'unexpected';
    });
    registry.create({
      name: 'unmanaged-executor-fence',
      steps: [{
        name: 'Conditionally skipped',
        handler: 'unmanaged-fence-handler',
        condition: 'input.run === true',
      }],
    });

    const seed = harness.track(new WorkflowService(harness.first, registry));
    const instanceId = await seed.start('unmanaged-executor-fence', { run: false });
    await seed.dispose();
    const stepId = (harness.first.prepare(`SELECT step_id FROM workflow_steps
      WHERE instance_id = ? LIMIT 1`).get(instanceId) as { step_id: string }).step_id;
    harness.first.prepare(`UPDATE workflow_instances SET
      status = 'running', current_step = 0, output = NULL, error = NULL,
      completed_at = NULL WHERE instance_id = ?`).run(instanceId);
    harness.first.prepare(`UPDATE workflow_steps SET
      status = 'pending', output = NULL, error = NULL, completed_at = NULL,
      started_at = NULL WHERE step_id = ?`).run(stepId);

    // Construct before ownership is acquired. The condition-only skip path
    // touches the repository without needing a runtime-store mutation.
    const repository = new WorkflowRepository(harness.first);
    const runtime = new WorkflowRuntimeStore(harness.first);
    const unmanaged = new WorkflowExecutor(
      harness.first,
      registry,
      runtime,
      undefined,
      repository,
    );
    const managed = harness.track(new WorkflowService(harness.second, registry));

    await expect(unmanaged.executeStep(instanceId, stepId)).rejects.toMatchObject({
      code: 'WORKFLOW_RUNTIME_OWNED', status: 503, retryable: true,
    });
    expect(handlerCalls).toBe(0);
    expect(harness.second.prepare(`SELECT status FROM workflow_steps
      WHERE step_id = ?`).get(stepId)).toEqual({ status: 'pending' });

    await managed.dispose();
    expect(await unmanaged.executeStep(instanceId, stepId)).toBe('skipped');
    expect(handlerCalls).toBe(0);
    expect(harness.first.prepare(`SELECT status FROM workflow_steps
      WHERE step_id = ?`).get(stepId)).toEqual({ status: 'skipped' });
    await unmanaged.dispose();
  });

  test('rejects standalone executor collaborators from another database', () => {
    const first = createReactiveDB({ mode: 'memory' });
    const second = createReactiveDB({ mode: 'memory' });
    defineWorkflowTables(first);
    defineWorkflowTables(second);
    const registry = new WorkflowRegistry();
    try {
      const runtime = new WorkflowRuntimeStore(second);
      const repository = new WorkflowRepository(second);
      expect(() => new WorkflowExecutor(first, registry, runtime)).toThrow(
        expect.objectContaining({ code: 'WORKFLOW_CONFIG_INVALID', status: 500 }),
      );
      expect(() => new WorkflowExecutor(
        first,
        registry,
        undefined,
        undefined,
        repository,
      )).toThrow(expect.objectContaining({
        code: 'WORKFLOW_CONFIG_INVALID', status: 500,
      }));
    } finally {
      second.dispose();
      first.dispose();
    }
  });

  test('rejects stale legacy and graph handler completions after takeover', async () => {
    for (const kind of ['legacy', 'graph'] as const) {
      const harness = await fileHarness(cleanups);
      const clock = new ManualLeaseClock();
      const registry = new WorkflowRegistry();
      const entered = deferred<void>();
      const release = deferred<void>();
      let calls = 0;
      const handler = `${kind}-generation-handler`;
      const name = `${kind}-generation-fence`;
      const execute = async () => {
        calls += 1;
        if (calls === 1) {
          entered.resolve();
          await release.promise;
          return 'stale-owner-output';
        }
        return 'replacement-output';
      };
      if (kind === 'legacy') {
        registry.registerHandler(handler, execute);
        registry.create({ name, steps: [{ name: 'Execute', handler }] });
      } else {
        registry.registerActivity({ name: handler, handler: execute });
        registry.create({ name, flow: flow(step('execute', handler)) });
      }

      const first = harness.track(new WorkflowService(harness.first, registry, {
        runtimeOwnership: ownership(clock, `${kind}-owner-a`),
      }));
      const started = first.start(name);
      void started.catch(() => undefined);
      await entered.promise;
      const instanceId = onlyInstanceId(harness.first, name);

      clock.advance(1_001);
      const second = harness.track(new WorkflowService(harness.second, registry, {
        runtimeOwnership: ownership(clock, `${kind}-owner-b`),
      }));
      await second.recoverInFlight();
      await waitFor(() => second.get(instanceId)?.status === 'completed');
      expect(second.get(instanceId)?.output).toBe('"replacement-output"');

      release.resolve();
      await started.catch(() => undefined);
      expect(second.get(instanceId)?.output).toBe('"replacement-output"');
      expect(calls).toBe(2);
    }
  });
});

interface FileHarness {
  path: string;
  first: ReactiveDB;
  second: ReactiveDB;
  track(service: WorkflowService): WorkflowService;
}

async function fileHarness(
  cleanups: Array<() => Promise<void>>,
): Promise<FileHarness> {
  const root = await mkdtemp(join(tmpdir(), 'zero-torrent-owner-'));
  const path = join(root, 'workflow.sqlite');
  const first = createReactiveDB({ mode: 'file', path, busyTimeout: 5_000 });
  defineWorkflowTables(first);
  const second = createReactiveDB({ mode: 'file', path, busyTimeout: 5_000 });
  defineWorkflowTables(second);
  const services: WorkflowService[] = [];
  cleanups.push(async () => {
    await Promise.allSettled(services.reverse().map((service) => service.dispose()));
    second.dispose();
    first.dispose();
    await rm(root, { recursive: true, force: true });
  });
  return {
    path,
    first,
    second,
    track(service) {
      services.push(service);
      return service;
    },
  };
}

class ManualLeaseClock {
  private value = 1_000;
  readonly now = (): number => this.value;

  advance(milliseconds: number): void {
    this.value += milliseconds;
  }
}

function ownership(
  clock: ManualLeaseClock,
  ownerId: string,
): WorkflowRuntimeOwnershipOptions {
  return {
    ownerId,
    now: clock.now,
    leaseMs: 1_000,
    heartbeatMs: 100,
    heartbeat: false,
  };
}

function onlyInstanceId(db: ReactiveDB, name: string): string {
  return (db.prepare(`SELECT instance_id FROM workflow_instances
    WHERE name = ? LIMIT 1`).get(name) as { instance_id: string }).instance_id;
}

interface OwnerAcquisitionOutcome {
  ok: boolean;
  ownerId: string;
  code?: string;
  status?: number;
  message?: string;
}

async function acquireSimultaneously(
  databasePath: string,
  ownerIds: readonly [string, string],
): Promise<OwnerAcquisitionOutcome[]> {
  const gateBuffer = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT);
  const gate = new Int32Array(gateBuffer);
  const reactiveDbModule = new URL('../sync/reactive-db.ts', import.meta.url).href;
  const leaseStoreModule = new URL('./workflow-runtime-lease-store.ts', import.meta.url).href;
  const source = `
    self.onmessage = async (event) => {
      const input = event.data;
      const [{ createReactiveDB }, { WorkflowRuntimeLeaseStore }] = await Promise.all([
        import(${JSON.stringify(reactiveDbModule)}),
        import(${JSON.stringify(leaseStoreModule)}),
      ]);
      const db = createReactiveDB({ mode: 'file', path: input.databasePath, busyTimeout: 5000 });
      const store = new WorkflowRuntimeLeaseStore(db);
      const gate = new Int32Array(input.gateBuffer);
      postMessage({ type: 'ready' });
      Atomics.wait(gate, 0, 0);
      try {
        store.acquire(input.ownerId, 1000, 1000);
        postMessage({ type: 'result', outcome: { ok: true, ownerId: input.ownerId } });
      } catch (error) {
        postMessage({ type: 'result', outcome: {
          ok: false,
          ownerId: input.ownerId,
          code: error && typeof error === 'object' ? error.code : undefined,
          status: error && typeof error === 'object' ? error.status : undefined,
          message: error instanceof Error ? error.message : String(error),
        }});
      } finally {
        db.dispose();
      }
    };
  `;
  const workerPath = join(dirname(databasePath), 'torrent-owner-acquire-worker.mjs');
  await Bun.write(workerPath, source);
  const workerUrl = pathToFileURL(workerPath);
  const workers = ownerIds.map((ownerId) => startAcquisitionWorker(
    workerUrl,
    { databasePath, ownerId, gateBuffer },
  ));
  try {
    await Promise.all(workers.map(({ ready }) => ready));
    Atomics.store(gate, 0, 1);
    Atomics.notify(gate, 0, workers.length);
    return await Promise.all(workers.map(({ result }) => result));
  } finally {
    await Promise.allSettled(workers.map(({ worker }) => Promise.resolve(worker.terminate())));
  }
}

function startAcquisitionWorker(
  url: URL,
  input: { databasePath: string; ownerId: string; gateBuffer: SharedArrayBuffer },
): {
  worker: Worker;
  ready: Promise<void>;
  result: Promise<OwnerAcquisitionOutcome>;
} {
  const worker = new Worker(url);
  const ready = deferred<void>();
  const result = deferred<OwnerAcquisitionOutcome>();
  void ready.promise.catch(() => undefined);
  void result.promise.catch(() => undefined);
  worker.onmessage = (event: MessageEvent) => {
    const message = event.data as { type?: string; outcome?: OwnerAcquisitionOutcome };
    if (message.type === 'ready') ready.resolve();
    if (message.type === 'result' && message.outcome) result.resolve(message.outcome);
  };
  worker.onerror = (event: ErrorEvent) => {
    const error = event.error ?? new Error(event.message);
    ready.reject(error);
    result.reject(error);
  };
  worker.postMessage(input);
  return { worker, ready: ready.promise, result: result.promise };
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve(value: T | PromiseLike<T>): void;
  reject(reason?: unknown): void;
} {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  throw new Error('Timed out waiting for workflow state');
}
