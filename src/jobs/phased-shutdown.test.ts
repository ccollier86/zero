/** Native phased lifecycle, using actual Jobs/Torrent only in memory. No files, timers or providers survive teardown. */
import { expect, spyOn, test } from 'bun:test';
import { SchedulerService } from '../scheduler/scheduler-service';
import type { JobDefinition as SchedulerJobDefinition } from '../scheduler/types';
import { createTrustedJobSource, requireJobSource } from './source-authority';
import { memorySourceJobsFixture, untilMemoryJobs } from './test-support/memory-source-fixture';

const activate = { expectedRevision: 0, idempotencyKey: 'shutdown-register', pinInput: { value: 1 } };
function latch() {
  let release!: () => void, enter!: () => void;
  const promise = new Promise<void>(resolve => { release = resolve; }), entered = new Promise<void>(resolve => { enter = resolve; });
  return { entered, release, async wait() { enter(); await promise; } };
}
class CapturingScheduler extends SchedulerService {
  current: SchedulerJobDefinition | undefined;
  override register(definition: SchedulerJobDefinition): void { this.current = definition; }
  override unregister(name: string, run?: SchedulerJobDefinition['run']): boolean {
    if (this.current?.name !== name || this.current.run !== run) return false;
    this.current = undefined; return true;
  }
}

for (const phase of ['owner-confirm', 'existing-read'] as const)
  test(`final Jobs close joins a held pre-gate ${phase} before closing native persistence`, async () => {
    const barrier = latch(); let holding = false;
    const f = await memorySourceJobsFixture({ nativeWriter: true, async beforeRead(operation) {
      if (holding && phase === 'existing-read' && operation.name === 'jobs.source.receipt') await barrier.wait();
    } });
    const providerClose = spyOn(f.runtime, 'close');
    let pending: Promise<unknown> | undefined, closing: Promise<unknown> | undefined;
    try {
      const source = f.source(); await source.api.registration.activate(activate);
      const original = requireJobSource(source.capability);
      const capability = createTrustedJobSource({ ...original, async confirmOwnerCurrent() {
        await original.confirmOwnerCurrent();
        if (holding && phase === 'owner-confirm') await barrier.wait();
      } });
      const api = f.service.forSource(capability), before = f.commands.length;
      const capacity = f.native(source.scope)!.engine.inspectAdmission(); holding = true;
      // Registration starts owner confirmation before it buys a gate slot or
      // writer command. Receipt lookup likewise has no shared gate callback.
      pending = (phase === 'owner-confirm'
        ? api.registration.activate({ ...activate, expectedRevision: 1, idempotencyKey: 'shutdown-pre-gate-never-write' })
        : api.receipts.get(activate.idempotencyKey)).then(value => ({ value }), error => ({ error }));
      await barrier.entered;
      expect(f.service.diagnostics().gate).toMatchObject({ active: 0, queued: 0 });
      expect(api.hydration!.inspect().preparing).toBe(1);
      // The earlier drain is intentionally NOT a source-evidence retirement or
      // join: Torrent may still need these reads during its own drainage.
      await f.service.drain(); expect(providerClose).not.toHaveBeenCalled();
      let closed = false; closing = f.service.close().then(() => { closed = true; });
      await Bun.sleep(5);
      expect(closed).toBe(false); expect(providerClose).not.toHaveBeenCalled();
      expect(f.runtime.diagnostics()).toMatchObject({ closed: false });
      expect(f.native(source.scope)!.engine.inspectAdmission()).toEqual(capacity);
      expect(f.commands).toHaveLength(before);
      // Once final closure starts, even a newly requested evidence pin must be
      // refused before owner/provider callbacks, so an empty join cannot race it.
      const checks = f.stats().ownerChecks;
      await expect(api.receipts.get(activate.idempotencyKey)).rejects.toMatchObject({ code: 'JOBS_NOT_READY' });
      expect(f.stats().ownerChecks).toBe(checks);
      barrier.release();
      expect(await pending).toMatchObject({ error: { code: 'JOBS_NOT_READY' } });
      await closing;
      expect(providerClose).toHaveBeenCalledTimes(1);
      expect(f.runtime.diagnostics()).toMatchObject({ closed: true });
      expect(f.commands).toHaveLength(before); expect(f.calls).toHaveLength(0);
      expect(f.stats()).toMatchObject({ activeLeases: 0, backendLeases: 0 });
    } finally {
      barrier.release();
      await Promise.allSettled([pending, closing].filter((value): value is Promise<unknown> => !!value));
      try { await f.close(); } finally { providerClose.mockRestore(); }
    }
  });

test('Jobs drain leaves original source execution/receipts usable by a still-running Torrent activity until final close', async () => {
  const activity = latch(), scheduler = new CapturingScheduler();
  let readInActivity: (() => Promise<unknown>) | undefined, evidence: unknown;
  const f = await memorySourceJobsFixture({ async activity() { await activity.wait(); evidence = await readInActivity!(); } });
  try {
    const source = f.source(), registration = await source.api.registration.activate(activate);
    const created = await source.api.schedules.create({ input: { value: 1 }, at: new Date(f.now()).toISOString() }, { idempotencyKey: 'shutdown-observation' });
    readInActivity = () => source.api.executions.get(created.id, { generation: 1, scheduledAt: f.now() });
    f.enableDiscovery(); f.service.start(scheduler); const callback = scheduler.current!.run;
    await activity.entered; f.service.quiesce(); f.service.quiesce();
    await f.service.drain(); await f.service.drain();
    expect(scheduler.current).toBeUndefined(); expect(f.service.diagnostics()).toMatchObject({ automaticWakes: false, gate: { state: 'open', active: 0, queued: 0 } });
    expect(f.runtime.diagnostics()).toMatchObject({ closed: false });
    expect(f.torrentDb.list('workflow_instances')).toHaveLength(1);
    expect(f.torrentDb.list('workflow_instances')[0]!.status).toBe('running');
    const before = f.commands.length, checks = f.stats().ownerChecks;
    expect(await source.api.registration.get()).toEqual(registration);
    expect(await source.api.registration.reconcile(activate.idempotencyKey)).toEqual(registration);
    expect(await source.api.schedules.reconcileCreate('shutdown-observation')).toEqual(created);
    expect(await source.api.receipts.get('shutdown-observation')).toEqual(created);
    expect(await source.api.schedules.get(created.id)).toMatchObject({ receipt: created });
    expect(await readInActivity()).toMatchObject({ scheduleId: created.id, generation: 1, scheduledAt: f.now(), status: 'running' });
    expect(f.stats().ownerChecks).toBeGreaterThan(checks);
    await expect(source.api.registration.activate({ ...activate, idempotencyKey: 'late-activate', expectedRevision: 1 })).rejects.toMatchObject({ code: 'JOBS_NOT_READY', outcome: 'not-started' });
    await expect(source.api.registration.retire({ expectedRevision: 1, idempotencyKey: 'late-retire' })).rejects.toMatchObject({ code: 'JOBS_NOT_READY', outcome: 'not-started' });
    await expect(source.api.schedules.create({ input: {}, at: new Date(f.now()).toISOString() }, { idempotencyKey: 'late-create' })).rejects.toMatchObject({ code: 'JOBS_NOT_READY', outcome: 'not-started' });
    await expect(source.api.schedules.replace(created.id, { input: {}, at: new Date(f.now()).toISOString() }, { expectedRevision: 1, idempotencyKey: 'late-replace' })).rejects.toMatchObject({ code: 'JOBS_NOT_READY', outcome: 'not-started' });
    await expect(source.api.schedules.cancel(created.id, { expectedRevision: 1, idempotencyKey: 'late-cancel' })).rejects.toMatchObject({ code: 'JOBS_NOT_READY', outcome: 'not-started' });
    await expect(f.request().enqueue(f.requestDefinition, {}, { idempotencyKey: 'late-request' })).rejects.toMatchObject({ code: 'JOBS_NOT_READY', outcome: 'not-started' });
    await expect(f.request().receipts.get('shutdown-observation')).rejects.toMatchObject({ code: 'JOBS_NOT_READY' });
    expect(() => f.service.start(scheduler)).toThrow();
    await callback({ signal: new AbortController().signal }); await f.service.tick();
    expect(f.commands).toHaveLength(before);
    activity.release(); await untilMemoryJobs(() => f.torrentDb.list('workflow_instances')[0]?.status === 'completed');
    expect(evidence).toMatchObject({ scheduleId: created.id, generation: 1, status: 'running' });
    await f.workflows.dispose(); await f.service.close();
    expect(f.runtime.diagnostics()).toMatchObject({ closed: true });
    await expect(source.api.registration.get()).rejects.toMatchObject({ code: 'JOBS_NOT_READY' });
  } finally { activity.release(); try { await f.close(); } finally { await scheduler.close(); } }
});

for (const owner of ['source', 'request'] as const) for (const phase of ['before', 'after'] as const)
  test(`${owner} ${phase}-commit callback remains physically draining after quiesce rejects its caller as unknown`, async () => {
    const barrier = latch(), operationName = owner === 'source' ? 'jobs.source.schedule.create' : 'jobs.schedule.create';
    const hold = async (operation: { name: string }) => { if (operation.name === operationName) await barrier.wait(); };
    const f = await memorySourceJobsFixture(phase === 'before' ? { beforeWrite: hold } : { afterWrite: hold });
    let creating: Promise<unknown> | undefined, draining: Promise<unknown> | undefined, reconciling: Promise<unknown> | undefined;
    try {
      const source = f.source(); await source.api.registration.activate(activate);
      const key = `shutdown-${owner}-${phase}`, when = new Date(f.now() + 5_000).toISOString();
      creating = (owner === 'source'
        ? source.api.schedules.create({ input: { value: 1 }, at: when }, { idempotencyKey: key })
        : f.request().schedules.create({ definition: f.requestDefinition, input: { value: 1 }, timing: { kind: 'once', at: when, maxLatenessMs: 60_000 } }, { idempotencyKey: key }))
        .then(value => ({ value }), error => ({ error }));
      await barrier.entered; f.service.quiesce();
      expect(await creating).toMatchObject({ error: { code: 'JOBS_OUTCOME_UNKNOWN', outcome: 'unknown' } });
      let drained = false;
      draining = f.service.drain().then(() => { drained = true; });
      // A keyed native evidence barrier remains admissible during drainage.
      if (owner === 'source') {
        reconciling = source.api.schedules.reconcileCreate(key);
        await untilMemoryJobs(() => f.service.diagnostics().gate.queued === 1);
      }
      await Bun.sleep(5);
      expect(drained).toBe(false); expect(f.service.diagnostics().gate.active).toBe(1);
      expect(f.runtime.diagnostics()).toMatchObject({ closed: false });
      barrier.release(); await draining;
      if (owner === 'source') {
        const receipt = await reconciling;
        expect(receipt).toEqual(await source.api.receipts.get(key));
        if (phase === 'before') expect(receipt).toBeNull(); else expect(receipt).toMatchObject({ revision: 1, generation: 1 });
      }
      expect(f.commands.filter(operation => operation.name === operationName)).toHaveLength(phase === 'before' ? 0 : 1);
      expect(f.service.diagnostics().gate).toMatchObject({ state: 'open', active: 0, queued: 0 });
      expect(f.stats()).toMatchObject({ activeLeases: 0, backendLeases: 0 });
    } finally {
      barrier.release(); await Promise.allSettled([creating, draining, reconciling].filter((value): value is Promise<unknown> => !!value)); await f.close();
    }
  });

test('a registration committed before quiesce stays unknown until physical settlement and retains its original evidence', async () => {
  const barrier = latch(), f = await memorySourceJobsFixture({ async afterWrite(operation) { if (operation.name === 'jobs.source.register') await barrier.wait(); } });
  let activating: Promise<unknown> | undefined, draining: Promise<unknown> | undefined, reconciling: Promise<unknown> | undefined;
  try {
    const source = f.source();
    activating = source.api.registration.activate(activate).then(value => ({ value }), error => ({ error }));
    await barrier.entered; f.service.quiesce();
    expect(await activating).toMatchObject({ error: { code: 'JOBS_OUTCOME_UNKNOWN', outcome: 'unknown' } });
    let drained = false; draining = f.service.drain().then(() => { drained = true; });
    reconciling = source.api.registration.reconcile(activate.idempotencyKey);
    await untilMemoryJobs(() => f.service.diagnostics().gate.queued === 1);
    expect(drained).toBe(false); barrier.release(); await draining;
    expect(await reconciling).toEqual(await source.api.registration.get());
    expect(await source.api.registration.get()).toMatchObject({ state: 'active', generation: 1, revision: 1 });
    expect(f.commands.filter(operation => operation.name === 'jobs.source.register')).toHaveLength(1);
    source.revokeOwner();
    await expect(source.api.registration.reconcile(activate.idempotencyKey)).rejects.toMatchObject({ code: 'JOBS_AUTHORITY_RETIRED' });
    await expect(source.api.receipts.get(activate.idempotencyKey)).rejects.toMatchObject({ code: 'JOBS_AUTHORITY_RETIRED' });
  } finally {
    barrier.release(); await Promise.allSettled([activating, draining, reconciling].filter((value): value is Promise<unknown> => !!value)); await f.close();
  }
});

test('a physical writer accepting after quiesce still has an unknown caller and an original receipt after drainage', async () => {
  const barrier = latch(), f = await memorySourceJobsFixture();
  let creating: Promise<unknown> | undefined, queued: Promise<unknown> | undefined, draining: Promise<unknown> | undefined, reconciling: Promise<unknown> | undefined;
  try {
    const source = f.source(); await source.api.registration.activate(activate);
    const write = f.runtime.writeExisting.bind(f.runtime);
    // Model a separate physical writer which crossed its own admission edge
    // before cancellation and cannot retract the accepted command afterward.
    // The actual realm transaction intentionally commits only after quiesce.
    f.runtime.writeExisting = async <T>(...args: Parameters<typeof f.runtime.writeExisting>): Promise<T> => {
      const [scope, name, input, transport, guard, signal] = args;
      if (name !== 'jobs.source.schedule.create') return write<T>(scope, name, input, transport, guard, signal);
      guard(); await barrier.wait(); return write<T>(scope, name, input, transport, () => {});
    };
    const key = 'accepted-after-quiesce', input = { input: { value: 1 }, at: new Date(f.now()).toISOString() };
    creating = source.api.schedules.create(input, { idempotencyKey: key }).then(value => ({ value }), error => ({ error }));
    await barrier.entered;
    queued = source.api.schedules.create(input, { idempotencyKey: key }).then(value => ({ value }), error => ({ error }));
    await untilMemoryJobs(() => f.service.diagnostics().gate.queued === 1);
    f.service.quiesce();
    expect(await creating).toMatchObject({ error: { code: 'JOBS_OUTCOME_UNKNOWN', outcome: 'unknown' } });
    expect(await queued).toMatchObject({ error: { code: 'JOBS_NOT_READY', outcome: 'not-started' } });
    expect(await source.api.receipts.get(key)).toBeNull();
    let drained = false; draining = f.service.drain().then(() => { drained = true; });
    reconciling = source.api.schedules.reconcileCreate(key);
    await untilMemoryJobs(() => f.service.diagnostics().gate.queued === 1);
    expect(drained).toBe(false); barrier.release(); await draining;
    expect(await reconciling).toMatchObject({ revision: 1, generation: 1, control: 'active' });
    expect(await reconciling).toEqual(await source.api.receipts.get(key));
    expect(f.commands.filter(operation => operation.name === 'jobs.source.schedule.create')).toHaveLength(1);
  } finally {
    barrier.release(); await Promise.allSettled([creating, queued, draining, reconciling].filter((value): value is Promise<unknown> => !!value)); await f.close();
  }
});

test('legacy direct close waits physical Jobs settlement before disposing runtime and retires evidence immediately', async () => {
  const barrier = latch(), f = await memorySourceJobsFixture({ async afterWrite(operation) { if (operation.name === 'jobs.source.schedule.create') await barrier.wait(); } });
  let creating: Promise<unknown> | undefined, closing: Promise<unknown> | undefined;
  try {
    const source = f.source(); await source.api.registration.activate(activate);
    creating = source.api.schedules.create({ input: {}, at: new Date(f.now()).toISOString() }, { idempotencyKey: 'direct-close' })
      .then(value => ({ value }), error => ({ error }));
    await barrier.entered; let closed = false;
    closing = f.service.close().then(() => { closed = true; });
    expect(f.service.close()).toBe(f.service.close());
    expect(await creating).toMatchObject({ error: { code: 'JOBS_OUTCOME_UNKNOWN' } });
    await expect(source.api.receipts.get('direct-close')).rejects.toMatchObject({ code: 'JOBS_NOT_READY' });
    await Bun.sleep(5); expect(closed).toBe(false); expect(f.runtime.diagnostics()).toMatchObject({ closed: false });
    barrier.release(); await closing;
    expect(f.runtime.diagnostics()).toMatchObject({ closed: true });
    expect(f.service.diagnostics().gate).toMatchObject({ state: 'closed', active: 0, queued: 0 });
  } finally {
    barrier.release(); await Promise.allSettled([creating, closing].filter((value): value is Promise<unknown> => !!value)); await f.close();
  }
});

test('scheduler unregister failure still quiesces intake and drains callbacks before reporting failure and final disposal', async () => {
  const failure = new Error('Synthetic unregister failure'), barrier = latch();
  class FailingScheduler extends CapturingScheduler {
    override unregister(): boolean { throw failure; }
  }
  const scheduler = new FailingScheduler();
  const f = await memorySourceJobsFixture({ async afterWrite(operation) { if (operation.name === 'jobs.source.schedule.create') await barrier.wait(); } });
  let creating: Promise<unknown> | undefined, draining: Promise<unknown> | undefined;
  try {
    const source = f.source(); await source.api.registration.activate(activate); f.service.start(scheduler);
    creating = source.api.schedules.create({ input: {}, at: new Date(f.now()).toISOString() }, { idempotencyKey: 'unregister-failure' })
      .then(value => ({ value }), error => ({ error }));
    await barrier.entered; expect(() => f.service.quiesce()).toThrow(failure);
    expect(await creating).toMatchObject({ error: { code: 'JOBS_OUTCOME_UNKNOWN' } });
    let drained = false; draining = f.service.drain().then(value => ({ value }), error => { drained = true; return { error }; });
    await Bun.sleep(5); expect(drained).toBe(false); barrier.release(); expect(await draining).toEqual({ error: failure });
    expect(await source.api.schedules.reconcileCreate('unregister-failure')).toMatchObject({ revision: 1 });
    await expect(f.service.close()).rejects.toBe(failure);
    expect(f.runtime.diagnostics()).toMatchObject({ closed: true });
  } finally {
    barrier.release(); await Promise.allSettled([creating, draining].filter((value): value is Promise<unknown> => !!value));
    try { await f.close(); } catch (error) { expect(error).toBe(failure); } finally { await scheduler.close(); }
  }
});
