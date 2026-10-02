/** Durable cross-handle workflow ownership and stale-generation fencing. */

import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { createReactiveDB, type ReactiveDB } from '../sync/reactive-db';
import {
  each,
  flow,
  requestAndWait,
  step,
  waitFor as waitForEvent,
} from './workflow-dsl';
import { expr } from './workflow-expression';
import { WorkflowExecutor, type WorkflowClock } from './workflow-executor';
import { WorkflowExecutionAuthorityStore } from './workflow-execution-authority';
import { WorkflowExecutionAuthorityGate } from './workflow-execution-authority-gate';
import { getWorkflowGraphRuntime, WorkflowService } from './workflow-service';
import {
  WorkflowRuntimeOwnerLease,
  type WorkflowRuntimeHeartbeatTimer,
  type WorkflowRuntimeOwnershipOptions,
} from './workflow-runtime-owner-lease';
import type {
  WorkflowObservability,
} from './workflow-observability';
import { WorkflowRuntimeLeaseStore } from './workflow-runtime-lease-store';
import { WorkflowRuntimeStore } from './workflow-runtime-store';
import { WorkflowInteractionAuthority } from './workflow-interaction-authority';
import { WorkflowRegistry } from './workflow-registry';
import { WorkflowRepository } from './workflow-repository';
import { defineWorkflowTables } from './workflow-schema';
import type { WorkflowWakeTimer } from './workflow-wake-coordinator';

describe('durable workflow runtime ownership', () => {
  const cleanups: Array<() => Promise<void>> = [];

  afterEach(async () => {
    await Promise.allSettled(cleanups.splice(0).reverse().map((cleanup) => cleanup()));
  });

  test('renews only a live generation and never lets its stale token release a successor', () => {
    const db = createReactiveDB({ mode: 'memory' });
    defineWorkflowTables(db);
    try {
      const leases = new WorkflowRuntimeLeaseStore(db);
      const first = leases.acquire('owner-a', 1_000, 1_000);
      const renewed = leases.renew(first, 1_500, 1_000);
      expect(renewed).toMatchObject({ generation: 1, expiresAt: 2_500 });
      expect(() => leases.acquire('owner-b', 2_001, 1_000)).toThrow(expect.objectContaining({
        code: 'WORKFLOW_RUNTIME_OWNED',
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

  test('admits exactly one simultaneous owner across independent worker handles', async () => {
    const harness = await fileHarness(cleanups);
    const outcomes = await acquireSimultaneously(harness.path, [
      'concurrent-owner-a',
      'concurrent-owner-b',
    ]);

    expect(outcomes.filter((outcome) => outcome.ok)).toHaveLength(1);
    expect(outcomes.filter((outcome) => !outcome.ok)).toEqual([
      expect.objectContaining({
        ok: false,
        code: 'WORKFLOW_RUNTIME_OWNED',
        status: 503,
      }),
    ]);
    expect(harness.first.prepare(`SELECT generation, released_at
      FROM _workflow_runtime_owner_lease`).get()).toEqual({
      generation: 1,
      released_at: null,
    });
  });

  test('releases an acquired generation when heartbeat construction fails', async () => {
    const harness = await fileHarness(cleanups);
    const clock = new ManualLeaseClock();
    const timerFailure = new Error('heartbeat timer unavailable');
    const brokenTimer: WorkflowRuntimeHeartbeatTimer = {
      schedule() { throw timerFailure; },
      cancel() {},
    };

    expect(() => new WorkflowService(harness.first, new WorkflowRegistry(), {
      runtimeOwnership: {
        ...ownership(clock, 'constructor-failure'),
        heartbeat: true,
        heartbeatTimer: brokenTimer,
      },
    })).toThrow(timerFailure);
    expect(harness.first.prepare(`SELECT generation, owner_id, released_at
      FROM _workflow_runtime_owner_lease`).get()).toEqual({
      generation: 1,
      owner_id: 'constructor-failure',
      released_at: 1_000,
    });

    const replacement = harness.track(new WorkflowService(
      harness.second,
      new WorkflowRegistry(),
      { runtimeOwnership: ownership(clock, 'constructor-replacement') },
    ));
    expect(harness.second.prepare(`SELECT generation, owner_id, released_at
      FROM _workflow_runtime_owner_lease`).get()).toEqual({
      generation: 2,
      owner_id: 'constructor-replacement',
      released_at: null,
    });
    await replacement.dispose();
  });

  test('keeps lease errors and quiescence stable when observability is hostile', () => {
    const diagnosticFailure = new Error('hostile workflow emitter');
    const hostile: WorkflowObservability = {
      emitNow() { throw diagnosticFailure; },
      emitAfterCommit() { throw diagnosticFailure; },
    };
    const lifecycleDb = createReactiveDB({ mode: 'memory' });
    defineWorkflowTables(lifecycleDb);
    const lifecycleClock = new ManualLeaseClock();
    try {
      const owner = new WorkflowRuntimeOwnerLease(
        lifecycleDb,
        ownership(lifecycleClock, 'hostile-owner'),
        hostile,
      );
      expect(() => new WorkflowRuntimeOwnerLease(
        lifecycleDb,
        ownership(lifecycleClock, 'hostile-conflict'),
        hostile,
      )).toThrow(expect.objectContaining({
        code: 'WORKFLOW_RUNTIME_OWNED', status: 503, retryable: true,
      }));
      expect(() => owner.release()).not.toThrow();
    } finally {
      lifecycleDb.dispose();
    }

    const heartbeatDb = createReactiveDB({ mode: 'memory' });
    defineWorkflowTables(heartbeatDb);
    const heartbeatClock = new ManualLeaseClock();
    const heartbeatTimer = new ManualHeartbeatTimer();
    const heartbeatOwner = new WorkflowRuntimeOwnerLease(heartbeatDb, {
      ...ownership(heartbeatClock, 'hostile-heartbeat'),
      heartbeat: true,
      heartbeatTimer,
    }, hostile);
    let lostNotifications = 0;
    heartbeatOwner.onLost(() => {
      lostNotifications += 1;
      throw new Error('hostile ownership-loss listener');
    });
    heartbeatClock.advance(1_001);
    heartbeatDb.dispose();

    expect(() => heartbeatTimer.fire()).not.toThrow();
    expect(lostNotifications).toBe(1);
    expect(heartbeatTimer.size).toBe(0);
    expect(() => heartbeatOwner.assertCurrent()).toThrow(expect.objectContaining({
      code: 'WORKFLOW_RUNTIME_LEASE_LOST', status: 503, retryable: true,
    }));
    expect(() => heartbeatOwner.release()).not.toThrow();
  });

  test('fences preconstructed low-level collaborators while a managed owner is live', async () => {
    const harness = await fileHarness(cleanups);
    const registry = new WorkflowRegistry();
    let handlerCalls = 0;
    registry.registerHandler('unmanaged-fence-handler', async () => {
      handlerCalls += 1;
      return 'must-not-run';
    });
    registry.create({
      name: 'unmanaged-fence',
      steps: [{
        name: 'Conditionally skipped',
        handler: 'unmanaged-fence-handler',
        condition: 'input.run === true',
      }],
    });

    const seed = harness.track(new WorkflowService(harness.first, registry));
    const instanceId = await seed.start('unmanaged-fence', { run: false });
    await seed.dispose();
    const stepId = (harness.first.prepare(`SELECT step_id FROM workflow_steps
      WHERE instance_id = ? LIMIT 1`).get(instanceId) as { step_id: string }).step_id;
    harness.first.prepare(`UPDATE workflow_instances SET
      status = 'running', current_step = 0, output = NULL, error = NULL,
      completed_at = NULL WHERE instance_id = ?`).run(instanceId);
    harness.first.prepare(`UPDATE workflow_steps SET
      status = 'pending', output = NULL, error = NULL, completed_at = NULL,
      started_at = NULL WHERE step_id = ?`).run(stepId);

    // These model release/1.3 callers that retained and injected every
    // low-level collaborator before a managed service acquired ownership.
    const repository = new WorkflowRepository(harness.first);
    const runtime = new WorkflowRuntimeStore(harness.first);
    const authority = new WorkflowExecutionAuthorityGate(harness.first);
    const managed = harness.track(new WorkflowService(harness.second, registry));
    const futureWorkflowClock: WorkflowClock = {
      now: () => new Date(Date.now() + 86_400_000),
    };
    const unmanaged = new WorkflowExecutor(
      harness.first,
      registry,
      runtime,
      futureWorkflowClock,
      repository,
      undefined,
      undefined,
      authority,
    );

    await expect(unmanaged.executeStep(instanceId, stepId)).rejects.toMatchObject({
      code: 'WORKFLOW_RUNTIME_OWNED', status: 503, retryable: true,
    });
    expect(handlerCalls).toBe(0);
    expect(harness.second.prepare(`SELECT status FROM workflow_steps
      WHERE step_id = ?`).get(stepId)).toEqual({ status: 'pending' });
    expect(() => runtime.clearAllAttempts()).toThrow(expect.objectContaining({
      code: 'WORKFLOW_RUNTIME_OWNED', status: 503,
    }));
    expect(() => new WorkflowRuntimeStore(
      harness.first,
      undefined,
      () => futureWorkflowClock.now(),
    )).toThrow(expect.objectContaining({ code: 'WORKFLOW_RUNTIME_OWNED' }));
    expect(() => new WorkflowExecutor(
      harness.first,
      registry,
      undefined,
      futureWorkflowClock,
    )).toThrow(expect.objectContaining({ code: 'WORKFLOW_RUNTIME_OWNED' }));

    await managed.dispose();
    expect(await unmanaged.executeStep(instanceId, stepId)).toBe('skipped');
    expect(handlerCalls).toBe(0);
    expect(harness.first.prepare(`SELECT status FROM workflow_steps
      WHERE step_id = ?`).get(stepId)).toEqual({ status: 'skipped' });
    expect(() => runtime.clearAllAttempts()).not.toThrow();
    await unmanaged.dispose();
  });

  test('rejects every cross-database low-level collaborator before admission', async () => {
    const executorDb = createReactiveDB({ mode: 'memory' });
    const managedDb = createReactiveDB({ mode: 'memory' });
    defineWorkflowTables(executorDb);
    defineWorkflowTables(managedDb);
    const registry = new WorkflowRegistry();
    const repository = new WorkflowRepository(managedDb);
    const runtime = new WorkflowRuntimeStore(managedDb);
    const authority = new WorkflowExecutionAuthorityGate(managedDb);
    const managed = new WorkflowService(managedDb, registry);

    try {
      const expectDatabaseMismatch = (construct: () => unknown) => {
        expect(construct).toThrow(expect.objectContaining({
          code: 'WORKFLOW_CONFIG_INVALID',
          status: 500,
        }));
      };
      expectDatabaseMismatch(() => new WorkflowExecutor(
        executorDb,
        registry,
        runtime,
        undefined,
        repository,
        undefined,
        undefined,
        authority,
      ));
      expectDatabaseMismatch(() => new WorkflowExecutor(executorDb, registry, runtime));
      expectDatabaseMismatch(() => new WorkflowExecutor(
        executorDb, registry, undefined, undefined, repository,
      ));
      expectDatabaseMismatch(() => new WorkflowExecutor(
        executorDb, registry, undefined, undefined, undefined,
        undefined, undefined, authority,
      ));

      const managedAuthorityStore = new WorkflowExecutionAuthorityStore(managedDb);
      expectDatabaseMismatch(() => new WorkflowRuntimeStore(
        executorDb,
        managedAuthorityStore,
      ));
      expectDatabaseMismatch(() => new WorkflowExecutionAuthorityGate(
        executorDb,
        managedAuthorityStore,
      ));

      expect(managed.pollTimeouts()).toBe(0);
      expect(managedDb.prepare(`SELECT owner_id, released_at
        FROM _workflow_runtime_owner_lease`).get()).toEqual({
        owner_id: expect.stringContaining('workflow-owner-'),
        released_at: null,
      });
    } finally {
      await managed.dispose();
      managedDb.dispose();
      executorDb.dispose();
    }
  });

  test('rejects a runtime template from another database and releases the lease', async () => {
    const harness = await fileHarness(cleanups);
    const unrelated = createReactiveDB({ mode: 'memory' });
    defineWorkflowTables(unrelated);
    const template = new WorkflowRuntimeStore(unrelated);
    const clock = new ManualLeaseClock();
    try {
      expect(() => new WorkflowService(harness.first, new WorkflowRegistry(), {
        runtime: template,
        runtimeOwnership: ownership(clock, 'bad-template-owner'),
      })).toThrow(expect.objectContaining({
        code: 'WORKFLOW_CONFIG_INVALID',
        status: 500,
      }));

      const replacement = harness.track(new WorkflowService(
        harness.second,
        new WorkflowRegistry(),
        { runtimeOwnership: ownership(clock, 'template-replacement') },
      ));
      expect(harness.second.prepare(`SELECT generation, owner_id
        FROM _workflow_runtime_owner_lease`).get()).toEqual({
        generation: 2,
        owner_id: 'template-replacement',
      });
      await replacement.dispose();
    } finally {
      unrelated.dispose();
    }
  });

  test('excludes a second live service and admits recovery after exact release', async () => {
    const harness = await fileHarness(cleanups);
    const clock = new ManualLeaseClock();
    const registry = new WorkflowRegistry();
    const entered = deferred<void>();
    const release = deferred<void>();
    let calls = 0;
    registry.registerHandler('owned-handler', async () => {
      calls += 1;
      entered.resolve();
      await release.promise;
      return 'first-owner';
    });
    registry.registerHandler('resume-handler', async ({ waitEvent }) => waitEvent?.payload);
    registry.create({
      name: 'owned-work',
      steps: [{ name: 'Owned work', handler: 'owned-handler' }],
    });
    registry.create({
      name: 'release-recovery',
      steps: [{ name: 'Resume', handler: 'resume-handler', waitFor: 'continue' }],
    });

    const first = harness.track(new WorkflowService(harness.first, registry, {
      runtimeOwnership: ownership(clock, 'owner-a'),
    }));
    const running = first.start('owned-work');
    await entered.promise;

    expect(() => new WorkflowService(harness.second, registry, {
      runtimeOwnership: ownership(clock, 'owner-b'),
    })).toThrow(expect.objectContaining({
      code: 'WORKFLOW_RUNTIME_OWNED', status: 503, retryable: true,
    }));
    expect(calls).toBe(1);

    release.resolve();
    await running;
    const waitingId = await first.start('release-recovery');
    await first.dispose();
    await expect(first.recoverInFlight()).rejects.toMatchObject({
      code: 'WORKFLOW_NOT_READY', status: 503,
    });

    const second = harness.track(new WorkflowService(harness.second, registry, {
      runtimeOwnership: ownership(clock, 'owner-b'),
    }));
    await second.recoverInFlight();
    await second.sendEvent(waitingId, 'continue', { recovered: true }, 'owner');
    expect(second.get(waitingId)).toMatchObject({
      status: 'completed', output: '{"recovered":true}',
    });
    expect(harness.second.prepare(`SELECT generation, owner_id, released_at
      FROM _workflow_runtime_owner_lease`).get()).toMatchObject({
      generation: 2,
      owner_id: 'owner-b',
      released_at: null,
    });
  });

  test('heartbeat loss cancels legacy wakes and quiesces their callbacks', async () => {
    const harness = await fileHarness(cleanups);
    const leaseClock = new ManualLeaseClock();
    const workflowClock = new ManualWorkflowClock();
    const heartbeatTimer = new ManualHeartbeatTimer();
    const wakeTimer = new TrackingWakeTimer();
    const registry = new WorkflowRegistry();
    let attempts = 0;
    registry.registerHandler('retry-after-owner-loss', async () => {
      attempts += 1;
      throw new Error('schedule a retry');
    });
    registry.create({
      name: 'owner-loss-wake',
      steps: [{
        name: 'Retry later',
        handler: 'retry-after-owner-loss',
        retries: 2,
        backoffMs: 5_000,
      }],
    });
    const service = harness.track(new WorkflowService(harness.first, registry, {
      clock: workflowClock,
      wakeTimer,
      runtimeOwnership: {
        ...ownership(leaseClock, 'heartbeat-owner'),
        heartbeat: true,
        heartbeatTimer,
      },
    }));

    const instanceId = await service.start('owner-loss-wake');
    expect(attempts).toBe(1);
    expect(service.getSteps(instanceId)[0]).toMatchObject({
      status: 'failed',
      retry_at: new Date(workflowClock.now().getTime() + 5_000).toISOString(),
    });
    expect(wakeTimer.size).toBe(1);
    expect(heartbeatTimer.size).toBe(1);

    leaseClock.advance(1_001);
    heartbeatTimer.fire();
    await waitFor(() => wakeTimer.size === 0 && heartbeatTimer.size === 0);
    expect(() => service.pollTimeouts()).toThrow(expect.objectContaining({
      code: 'WORKFLOW_RUNTIME_LEASE_LOST',
      status: 503,
    }));
    wakeTimer.fireAll();
    await settleMicrotasks();
    expect(attempts).toBe(1);
  });

  test('rejects a former legacy owner late output with a same-db runtime template', async () => {
    const harness = await fileHarness(cleanups);
    const clock = new ManualLeaseClock();
    const registry = new WorkflowRegistry();
    const firstEntered = deferred<void>();
    const releaseFirst = deferred<void>();
    let calls = 0;
    registry.registerHandler('legacy-generation-handler', async () => {
      calls += 1;
      if (calls === 1) {
        firstEntered.resolve();
        await releaseFirst.promise;
        return 'stale-legacy-output';
      }
      return 'replacement-legacy-output';
    });
    registry.create({
      name: 'legacy-generation-fence',
      steps: [{ name: 'Execute', handler: 'legacy-generation-handler' }],
    });
    const template = new WorkflowRuntimeStore(harness.first);
    const first = harness.track(new WorkflowService(harness.first, registry, {
      runtime: template,
      runtimeOwnership: ownership(clock, 'legacy-owner-a'),
    }));
    const started = first.start('legacy-generation-fence');
    void started.catch(() => undefined);
    await firstEntered.promise;
    const instanceId = onlyInstanceId(harness.first, 'legacy-generation-fence');

    clock.advance(1_001);
    const second = harness.track(new WorkflowService(harness.second, registry, {
      runtimeOwnership: ownership(clock, 'legacy-owner-b'),
    }));
    await second.recoverInFlight();
    await waitFor(() => second.get(instanceId)?.status === 'completed');
    expect(second.get(instanceId)?.output).toBe('"replacement-legacy-output"');

    releaseFirst.resolve();
    await started.catch(() => undefined);
    expect(second.get(instanceId)?.output).toBe('"replacement-legacy-output"');
    expect(calls).toBe(2);
  });

  test('takes over only after expiry and rejects the former graph owner late commit', async () => {
    const harness = await fileHarness(cleanups);
    const clock = new ManualLeaseClock();
    const registry = new WorkflowRegistry();
    const firstEntered = deferred<void>();
    const releaseFirst = deferred<void>();
    let calls = 0;
    registry.registerActivity({
      name: 'generation-activity',
      handler: async () => {
        calls += 1;
        if (calls === 1) {
          firstEntered.resolve();
          await releaseFirst.promise;
          return 'stale-owner-output';
        }
        return 'replacement-output';
      },
    });
    registry.create({
      name: 'generation-fence',
      flow: flow(step('execute', 'generation-activity')),
    });

    const first = harness.track(new WorkflowService(harness.first, registry, {
      runtimeOwnership: ownership(clock, 'owner-a'),
    }));
    const started = first.start('generation-fence');
    void started.catch(() => undefined);
    await firstEntered.promise;
    const instanceId = onlyInstanceId(harness.first, 'generation-fence');

    clock.advance(1_001);
    const second = harness.track(new WorkflowService(harness.second, registry, {
      runtimeOwnership: ownership(clock, 'owner-b'),
    }));
    await second.recoverInFlight();
    await waitFor(() => second.get(instanceId)?.status === 'completed');
    expect(calls).toBe(2);
    expect(second.get(instanceId)?.output).toBe('"replacement-output"');

    const eventsBefore = eventCount(harness.second, instanceId);
    await expect(first.sendEvent(instanceId, 'late', null, 'owner-a'))
      .rejects.toMatchObject({
        code: 'WORKFLOW_RUNTIME_LEASE_LOST', status: 503, retryable: true,
      });
    expect(eventCount(harness.second, instanceId)).toBe(eventsBefore);

    releaseFirst.resolve();
    await started.catch(() => undefined);
    expect(second.get(instanceId)?.output).toBe('"replacement-output"');
    expect(harness.second.prepare(`SELECT COUNT(*) AS count
      FROM _workflow_step_attempts WHERE instance_id = ?`).get(instanceId))
      .toEqual({ count: 0 });
  });

  test('fences expired each-item activity output behind the replacement generation', async () => {
    const harness = await fileHarness(cleanups);
    const clock = new ManualLeaseClock();
    const registry = new WorkflowRegistry();
    const firstEntered = deferred<void>();
    const releaseFirst = deferred<void>();
    let calls = 0;
    registry.registerActivity({
      name: 'each-generation-activity',
      handler: async () => {
        calls += 1;
        if (calls === 1) {
          firstEntered.resolve();
          await releaseFirst.promise;
          return 'stale-item';
        }
        return 'replacement-item';
      },
    });
    registry.create({
      name: 'each-generation-fence',
      flow: flow(each(
        'items',
        expr.literal(['one']),
        flow(step('item', 'each-generation-activity')),
      )),
    });

    const first = harness.track(new WorkflowService(harness.first, registry, {
      runtimeOwnership: ownership(clock, 'owner-a'),
    }));
    const started = first.start('each-generation-fence');
    void started.catch(() => undefined);
    await firstEntered.promise;
    const instanceId = onlyInstanceId(harness.first, 'each-generation-fence');

    clock.advance(1_001);
    const second = harness.track(new WorkflowService(harness.second, registry, {
      runtimeOwnership: ownership(clock, 'owner-b'),
    }));
    await second.recoverInFlight();
    await waitFor(() => second.get(instanceId)?.status === 'completed');
    releaseFirst.resolve();
    await started.catch(() => undefined);

    const item = harness.second.prepare(`SELECT status, output_json
      FROM _workflow_each_items WHERE instance_id = ? LIMIT 1`).get(instanceId);
    expect(item).toEqual({ status: 'completed', output_json: '"replacement-item"' });
    expect(calls).toBe(2);
  });

  test('fences an expired interaction validator and lets the replacement decide', async () => {
    const harness = await fileHarness(cleanups);
    const clock = new ManualLeaseClock();
    const registry = new WorkflowRegistry();
    const firstEntered = deferred<void>();
    const releaseFirst = deferred<void>();
    let calls = 0;
    registry.registerActivity({
      name: 'generation-validator',
      handler: async () => {
        calls += 1;
        if (calls === 1) {
          firstEntered.resolve();
          await releaseFirst.promise;
        }
        return true;
      },
    });
    registry.create({
      name: 'validator-generation-fence',
      flow: flow(requestAndWait('approval', 'approval.responded', {
        validator: { name: 'generation-validator' },
      })),
    });
    const interactionAuthority = new WorkflowInteractionAuthority(() => true);
    const first = harness.track(new WorkflowService(harness.first, registry, {
      interactionAuthority,
      runtimeOwnership: ownership(clock, 'owner-a'),
    }));
    const instanceId = await first.start('validator-generation-fence', {}, 'owner');
    const interaction = getWorkflowGraphRuntime(first).listInteractions(instanceId)[0]!;
    const staleSubmission = getWorkflowGraphRuntime(first).submitInteraction({
      interactionId: interaction.interactionId,
      submissionId: 'stale-generation',
      actor: { actorId: 'owner' },
      payload: { approved: true },
    });
    await firstEntered.promise;

    clock.advance(1_001);
    const second = harness.track(new WorkflowService(harness.second, registry, {
      interactionAuthority,
      runtimeOwnership: ownership(clock, 'owner-b'),
    }));
    await second.recoverInFlight();
    releaseFirst.resolve();
    await expect(staleSubmission).rejects.toMatchObject({
      code: 'WORKFLOW_RUNTIME_LEASE_LOST', status: 503,
    });
    expect(harness.second.prepare(`SELECT COUNT(*) AS count
      FROM _workflow_interaction_responses
      WHERE interaction_id = ? AND status = 'accepted'`).get(interaction.interactionId))
      .toEqual({ count: 0 });

    await getWorkflowGraphRuntime(second).submitInteraction({
      interactionId: interaction.interactionId,
      submissionId: 'replacement-generation',
      actor: { actorId: 'owner' },
      payload: { approved: true },
    });
    await waitFor(() => second.get(instanceId)?.status === 'completed');
    expect(calls).toBe(2);
  });

  test('fences stale recovery failure and definition or draft administration', async () => {
    const harness = await fileHarness(cleanups);
    const clock = new ManualLeaseClock();
    const registry = new WorkflowRegistry();
    registry.registerHandler('ownership-wait', async ({ waitEvent }) => waitEvent?.payload);
    registry.create({
      name: 'ownership-administration',
      steps: [{ name: 'Wait', handler: 'ownership-wait', waitFor: 'continue' }],
    });
    const first = harness.track(new WorkflowService(harness.first, registry, {
      runtimeOwnership: ownership(clock, 'owner-a'),
    }));
    const instanceId = await first.start('ownership-administration');
    const staleRuntime = getWorkflowGraphRuntime(first);
    const catalog = staleRuntime.versions.findCatalog('ownership-administration')!;

    clock.advance(1_001);
    const second = harness.track(new WorkflowService(harness.second, registry, {
      runtimeOwnership: ownership(clock, 'owner-b'),
    }));
    const before = second.get(instanceId);
    harness.second.prepare(`UPDATE _workflow_execution_authorities
      SET authority_mac = 'invalid' WHERE instance_id = ?`).run(instanceId);

    await expect(first.recoverInFlight()).rejects.toMatchObject({
      code: 'WORKFLOW_RUNTIME_LEASE_LOST', status: 503,
    });
    expect(second.get(instanceId)).toMatchObject({
      status: before?.status,
      error: before?.error,
    });

    const graph = {
      schemaVersion: 1 as const,
      entry: 'wait',
      nodes: [{ id: 'wait', kind: 'wait' as const, event: 'continue' }],
      edges: [],
    };
    expect(() => staleRuntime.versions.publish({
      name: 'stale-owner-definition',
      source: 'database',
      graphFormat: 'graph',
      schemaVersion: 1,
      graph,
    })).toThrow(expect.objectContaining({ code: 'WORKFLOW_RUNTIME_LEASE_LOST' }));
    expect(() => staleRuntime.versions.drafts.save({
      definitionId: catalog.definition_id,
      source: 'code',
      graphFormat: 'graph',
      schemaVersion: 1,
      graph,
    })).toThrow(expect.objectContaining({ code: 'WORKFLOW_RUNTIME_LEASE_LOST' }));
    expect(harness.second.prepare(`SELECT COUNT(*) AS count FROM workflow_definitions
      WHERE name = 'stale-owner-definition'`).get()).toEqual({ count: 0 });
    expect(harness.second.prepare('SELECT COUNT(*) AS count FROM _workflow_definition_drafts')
      .get()).toEqual({ count: 0 });
  });

  test('fences legacy and graph cancel, pause, and resume transitions', async () => {
    const scenarios = [
      { kind: 'legacy', action: 'cancel' },
      { kind: 'legacy', action: 'pause' },
      { kind: 'legacy', action: 'resume' },
      { kind: 'graph', action: 'cancel' },
      { kind: 'graph', action: 'pause' },
      { kind: 'graph', action: 'resume' },
    ] as const;

    for (const scenario of scenarios) {
      const harness = await fileHarness(cleanups);
      const clock = new ManualLeaseClock();
      const registry = new WorkflowRegistry();
      const name = `${scenario.kind}-${scenario.action}-ownership-transition`;
      if (scenario.kind === 'legacy') {
        const handler = `${name}-handler`;
        registry.registerHandler(handler, async ({ waitEvent }) => waitEvent?.payload);
        registry.create({
          name,
          steps: [{ name: 'Wait', handler, waitFor: 'continue' }],
        });
      } else {
        registry.create({ name, flow: flow(waitForEvent('wait', 'continue')) });
      }

      const first = harness.track(new WorkflowService(harness.first, registry, {
        runtimeOwnership: ownership(clock, `${name}-owner-a`),
      }));
      const instanceId = await first.start(name);
      if (scenario.action === 'resume') first.pause(instanceId);

      clock.advance(1_001);
      harness.track(new WorkflowService(harness.second, registry, {
        runtimeOwnership: ownership(clock, `${name}-owner-b`),
      }));
      const before = workflowMutationSnapshot(harness.second, instanceId);

      if (scenario.action === 'resume') {
        await expect(first.resume(instanceId)).rejects.toMatchObject({
          code: 'WORKFLOW_RUNTIME_LEASE_LOST', status: 503,
        });
      } else {
        expect(() => first[scenario.action](instanceId)).toThrow(expect.objectContaining({
          code: 'WORKFLOW_RUNTIME_LEASE_LOST', status: 503,
        }));
      }
      expect(workflowMutationSnapshot(harness.second, instanceId)).toEqual(before);
    }
  });
});

interface FileHarness {
  path: string;
  first: ReactiveDB;
  second: ReactiveDB;
  track(service: WorkflowService): WorkflowService;
}

async function fileHarness(cleanups: Array<() => Promise<void>>): Promise<FileHarness> {
  const root = await mkdtemp(join(tmpdir(), 'zero-workflow-owner-'));
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

function eventCount(db: ReactiveDB, instanceId: string): number {
  return Number((db.prepare(`SELECT COUNT(*) AS count FROM workflow_events
    WHERE instance_id = ?`).get(instanceId) as { count: number }).count);
}

function workflowMutationSnapshot(db: ReactiveDB, instanceId: string): unknown {
  return {
    instance: db.prepare('SELECT * FROM workflow_instances WHERE instance_id = ?')
      .get(instanceId),
    steps: db.prepare(`SELECT * FROM workflow_steps WHERE instance_id = ?
      ORDER BY step_index, step_id`).all(instanceId),
    pause: db.prepare('SELECT * FROM _workflow_pauses WHERE instance_id = ?')
      .get(instanceId),
  };
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
        postMessage({
          type: 'result',
          outcome: {
            ok: false,
            ownerId: input.ownerId,
            code: error && typeof error === 'object' ? error.code : undefined,
            status: error && typeof error === 'object' ? error.status : undefined,
            message: error instanceof Error ? error.message : String(error),
          },
        });
      } finally {
        db.dispose();
      }
    };
  `;
  const workerPath = join(dirname(databasePath), 'workflow-owner-acquire-worker.mjs');
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
  input: {
    databasePath: string;
    ownerId: string;
    gateBuffer: SharedArrayBuffer;
  },
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
    const message = event.data as {
      type?: string;
      outcome?: OwnerAcquisitionOutcome;
    };
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

class ManualWorkflowClock implements WorkflowClock {
  constructor(private value = Date.parse('2030-01-02T03:04:05.000Z')) {}

  now(): Date {
    return new Date(this.value);
  }
}

class ManualHeartbeatTimer implements WorkflowRuntimeHeartbeatTimer {
  private sequence = 0;
  private readonly callbacks = new Map<number, () => void>();

  get size(): number {
    return this.callbacks.size;
  }

  schedule(callback: () => void): number {
    const handle = ++this.sequence;
    this.callbacks.set(handle, callback);
    return handle;
  }

  cancel(handle: unknown): void {
    this.callbacks.delete(Number(handle));
  }

  fire(): void {
    for (const callback of [...this.callbacks.values()]) callback();
  }
}

class TrackingWakeTimer implements WorkflowWakeTimer {
  private sequence = 0;
  private readonly callbacks = new Map<number, () => void>();

  get size(): number {
    return this.callbacks.size;
  }

  schedule(callback: () => void): number {
    const handle = ++this.sequence;
    this.callbacks.set(handle, callback);
    return handle;
  }

  cancel(handle: unknown): void {
    this.callbacks.delete(Number(handle));
  }

  fireAll(): void {
    for (const [handle, callback] of [...this.callbacks]) {
      this.callbacks.delete(handle);
      callback();
    }
  }
}

async function settleMicrotasks(): Promise<void> {
  for (let index = 0; index < 10; index += 1) await Promise.resolve();
}

async function waitFor(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for workflow state');
    await Bun.sleep(2);
  }
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
