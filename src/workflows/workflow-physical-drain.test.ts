/** Physical callback barriers, strictly in memory. Logical cancellation/grace never proves an authored body settled. */
import { expect, test } from 'bun:test';
import { applicationServiceDataScope } from '../auth/service-data-scope';
import { createReactiveDB, type ReactiveDB } from '../sync/reactive-db';
import { flow, requestAndWait, step } from './workflow-dsl';
import { WorkflowExecutionTracker } from './workflow-execution-tracker';
import { WorkflowInteractionAuthority } from './workflow-interaction-authority';
import { WorkflowRegistry } from './workflow-registry';
import { defineWorkflowTables } from './workflow-schema';
import { getWorkflowGraphRuntime, WorkflowService } from './workflow-service';
import type { StepContext } from './types';

function latch() {
  let release!: () => void, enter!: () => void;
  const promise = new Promise<void>(resolve => { release = resolve; }), entered = new Promise<void>(resolve => { enter = resolve; });
  return { promise, entered, release, async wait() { enter(); await promise; } };
}
async function expectPending(promise: Promise<unknown>): Promise<void> {
  let settled = false; void promise.then(() => { settled = true; }, () => { settled = true; });
  await Bun.sleep(5); expect(settled).toBe(false);
}
function guardedMemory() {
  const db = createReactiveDB({ mode: 'memory' }); db.getRawDatabase().run('PRAGMA temp_store=MEMORY');
  let closed = false, lateCalls = 0;
  const guarded = new Proxy(db, { get(target, property) {
    const value = Reflect.get(target, property, target);
    if (typeof value !== 'function') return value;
    return (...args: unknown[]) => {
      if (closed) { lateCalls++; throw new Error('Late workflow database access.'); }
      return Reflect.apply(value, target, args);
    };
  } }) as ReactiveDB;
  return { db: guarded, lateCalls: () => lateCalls, close() { if (!closed) { closed = true; db.dispose(); } } };
}

test('tracker retains a raw invocation after timeout/cancel and public grace even when a newer logical attempt settles first', async () => {
  const tracker = new WorkflowExecutionTracker(0), older = latch(), newer = latch(), oldController = new AbortController(), newController = new AbortController();
  let draining: Promise<void> | undefined;
  try {
    tracker.track('instance', 'step', 'older-attempt', oldController, older.promise);
    oldController.abort(new Error('Synthetic attempt timeout.'));
    tracker.track('instance', 'step', 'newer-attempt', newController, newer.promise);
    newer.release(); await Bun.sleep(1);
    expect(tracker.isStepActive('step')).toBe(false);
    await tracker.dispose(); draining = tracker.drainPhysical(); await expectPending(draining);
    older.release(); await draining; await tracker.drainPhysical();
  } finally { older.release(); newer.release(); await tracker.dispose(); await tracker.drainPhysical(); await draining; }
});

test('settling an older invocation cannot delete a newer active entry even when its authored attempt ID was reused', async () => {
  const tracker = new WorkflowExecutionTracker(0), older = latch(), newer = latch();
  try {
    tracker.track('instance', 'step', 'same-attempt', new AbortController(), older.promise);
    tracker.track('instance', 'step', 'same-attempt', new AbortController(), newer.promise);
    older.release(); await Bun.sleep(1); expect(tracker.isStepActive('step')).toBe(true);
    const draining = tracker.drainPhysical(); await expectPending(draining);
    newer.release(); await draining; expect(tracker.isStepActive('step')).toBe(false);
  } finally { older.release(); newer.release(); await tracker.dispose(); await tracker.drainPhysical(); }
});

test('tracking after disposal still joins an already-started body and aborts an unstarted deferred body', async () => {
  const tracker = new WorkflowExecutionTracker(0), body = latch(), began = new AbortController(), deferred = new AbortController();
  let deferredCalls = 0;
  try {
    await tracker.dispose();
    const invocation = body.wait(); await body.entered;
    tracker.track('instance', 'already-started', 'one', began, invocation);
    expect(began.signal.aborted).toBe(true);
    const deferredBody = Promise.resolve().then(() => { deferred.signal.throwIfAborted(); deferredCalls++; });
    tracker.track('instance', 'not-started', 'two', deferred, deferredBody);
    expect(deferred.signal.aborted).toBe(true);
    const draining = tracker.drainPhysical(); await expectPending(draining); expect(deferredCalls).toBe(0);
    body.release(); await draining; expect(deferredCalls).toBe(0);
  } finally { body.release(); await tracker.drainPhysical(); }
});

for (const kind of ['legacy-dispose', 'graph-dispose', 'graph-timeout'] as const)
  test(`${kind}: native SYSTEM activity ignores abort; dispose settles grace but physical drain waits the actual body without late database publication`, async () => {
    const memory = guardedMemory(), barrier = latch(), registry = new WorkflowRegistry();
    let now = Date.parse('2026-12-01T00:00:00.000Z'), context: StepContext | undefined, bodySettled = false, guardRejected = false;
    const handler = async (value: StepContext) => {
      context = value; await barrier.wait();
      expect(value.signal!.aborted).toBe(true);
      try { value.assertCurrentAuthority(); } catch { guardRejected = true; }
      bodySettled = true; return { mustNotPublish: true };
    };
    if (kind === 'legacy-dispose') {
      registry.registerHandler('physical.hold', handler);
      registry.create({ name: 'physical.workflow', steps: [{ name: 'Hold', handler: 'physical.hold' }] });
    } else {
      registry.registerActivity({ name: 'physical.hold', version: '1', handler });
      registry.create({ name: 'physical.workflow', version: 1,
        flow: flow(step('hold', { name: 'physical.hold', version: '1' }, kind === 'graph-timeout' ? { timeoutMs: 5 } : {})) });
    }
    defineWorkflowTables(memory.db);
    const service = new WorkflowService(memory.db, registry, { clock: { now: () => new Date(now) }, wakeTimer: false, shutdownGraceMs: 0 });
    let starting: Promise<unknown> | undefined, draining: Promise<void> | undefined;
    try {
      starting = service.startAsSystem('physical.workflow', {}, { principal: 'native:physical-drain', reason: 'Synthetic physical callback qualification', scope: applicationServiceDataScope() })
        .then(value => ({ value }), error => ({ error }));
      await barrier.entered;
      if (kind === 'graph-timeout') { now += 10; expect(service.pollTimeouts()).toBeGreaterThan(0); await starting; }
      await service.dispose(); await starting;
      expect(context!.signal!.aborted).toBe(true); expect(bodySettled).toBe(false);
      draining = service.drainPhysical(); await expectPending(draining);
      expect(memory.db.list('workflow_steps').some(row => row.output === '{"mustNotPublish":true}')).toBe(false);
      const stoppedRows = JSON.stringify(memory.db.list('workflow_steps'));
      // Managed teardown retains providers until the authored body settles;
      // joining must neither revive its authority nor publish its late result.
      barrier.release(); await draining;
      expect(bodySettled).toBe(true); expect(guardRejected).toBe(true);
      expect(JSON.stringify(memory.db.list('workflow_steps'))).toBe(stoppedRows);
      memory.close();
      // Joining a disposed service requires no live DB/current-owner proof.
      await service.drainPhysical(); await Bun.sleep(5); expect(memory.lateCalls()).toBe(0);
    } finally {
      barrier.release(); await Promise.allSettled([starting, draining].filter((value): value is Promise<unknown> => !!value));
      try { await service.dispose(); } finally { await service.drainPhysical(); memory.close(); }
    }
  });

for (const provider of ['authority', 'validator'] as const)
  test(`a graph interaction ${provider} callback remains physically joinable after public dispose grace`, async () => {
    const memory = guardedMemory(), barrier = latch(), registry = new WorkflowRegistry();
    let callbackSettled = false, signal: AbortSignal | undefined;
    const authority = provider === 'authority'
      ? new WorkflowInteractionAuthority(async context => { signal = context.signal; await barrier.wait(); callbackSettled = true; return true; })
      : new WorkflowInteractionAuthority(() => true);
    if (provider === 'validator') registry.registerActivity({ name: 'physical.validator', version: '1', handler: async context => {
      signal = context.signal; await barrier.wait(); callbackSettled = true; return true;
    } });
    registry.create({ name: 'physical.interaction', version: 1,
      flow: flow(requestAndWait('approval', 'approval.response', provider === 'validator' ? { validator: { name: 'physical.validator', version: '1' } } : {})) });
    defineWorkflowTables(memory.db);
    const service = new WorkflowService(memory.db, registry, { wakeTimer: false, shutdownGraceMs: 0, interactionAuthority: authority });
    let submitted: Promise<unknown> | undefined, draining: Promise<void> | undefined;
    try {
      const id = await service.startAsSystem('physical.interaction', {}, { principal: 'native:physical-drain', reason: 'Synthetic interaction callback qualification', scope: applicationServiceDataScope() });
      const graph = getWorkflowGraphRuntime(service), interaction = graph.listInteractions(id)[0]!;
      submitted = graph.submitInteraction({ interactionId: interaction.interactionId, submissionId: 'physical-submission', actor: { actorId: 'synthetic-responder' }, payload: true })
        .then(value => ({ value }), error => ({ error }));
      await barrier.entered; await service.dispose();
      expect(signal!.aborted).toBe(true); expect(callbackSettled).toBe(false);
      draining = service.drainPhysical(); await expectPending(draining);
      barrier.release(); await draining; expect(await submitted).toHaveProperty('error');
      expect(callbackSettled).toBe(true); memory.close(); await service.drainPhysical();
      await Bun.sleep(5); expect(memory.lateCalls()).toBe(0);
    } finally {
      barrier.release(); await Promise.allSettled([submitted, draining].filter((value): value is Promise<unknown> => !!value));
      try { await service.dispose(); } finally { await service.drainPhysical(); memory.close(); }
    }
  });
