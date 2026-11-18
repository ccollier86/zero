/** Actual in-memory Jobs/Torrent proof: construction and external mutation hints are not automatic startup. */
import { expect, test } from 'bun:test';
import { trustedSystemServiceDataScope } from '../auth/service-data-scope';
import { SchedulerService } from '../scheduler/scheduler-service';
import type { JobDefinition as SchedulerJobDefinition } from '../scheduler/types';
import { memorySourceJobsFixture, untilMemoryJobs } from './test-support/memory-source-fixture';

const activate = { expectedRevision: 0, idempotencyKey: 'dormant-register', pinInput: { value: 1 } };
type Fixture = Awaited<ReturnType<typeof memorySourceJobsFixture>>;
function discoveryCalls(fixture: Fixture): () => number {
  const original = fixture.runtime.dueScopePage.bind(fixture.runtime); let calls = 0;
  fixture.runtime.dueScopePage = (...args) => { calls++; return original(...args); };
  return () => calls;
}
async function settled(fixture: Fixture, expected: number): Promise<void> {
  await untilMemoryJobs(() => fixture.calls.length === expected && fixture.torrentDb.list('workflow_instances').every(row => row.status === 'completed')
    && fixture.service.diagnostics().runner.activeScopes === 0 && !fixture.service.diagnostics().runner.ticking);
  // Consume a final empty completion/refill microtask before observing quietness.
  await Bun.sleep(5);
}

test('source registration, create, evidence reads and request mutation stay dormant until an explicit trusted tick', async () => {
  const f = await memorySourceJobsFixture();
  try {
    const scans = discoveryCalls(f); f.enableDiscovery();
    const source = f.source(); await source.api.registration.activate(activate);
    const created = await source.api.schedules.create({ input: { value: 1 }, at: new Date(f.now()).toISOString() }, { idempotencyKey: 'dormant-source' });
    const requested = await f.request().schedules.create({ definition: f.requestDefinition, input: { value: 2 },
      timing: { kind: 'once', at: new Date(f.now() + 5_000).toISOString(), maxLatenessMs: 60_000 } }, { idempotencyKey: 'dormant-request' });
    expect(await source.api.registration.get()).toMatchObject({ state: 'active' });
    expect(await source.api.receipts.get('dormant-source')).toEqual(created);
    expect(await source.api.schedules.reconcileCreate('dormant-source')).toEqual(created);
    expect(await source.api.schedules.get(created.id)).toMatchObject({ receipt: created });
    expect(await f.request().schedules.get(requested.id)).toMatchObject({ id: requested.id });
    await Bun.sleep(5);
    expect(scans()).toBe(0); expect(f.calls).toHaveLength(0); expect(f.rows(source.scope, '_jobs_occurrences')).toHaveLength(0);
    expect(f.service.diagnostics().automaticWakes).toBe(false);
    await f.service.tick(); await settled(f, 1);
    f.advance(5_000); await f.service.tick(); await settled(f, 2);
    expect(scans()).toBeGreaterThan(0); expect(f.calls).toEqual([{ value: 1 }, { value: 2 }]);
    expect(f.service.diagnostics().automaticWakes).toBe(false);
  } finally { await f.close(); }
});

test('one explicit pre-start tick retains completion-driven refill across more scopes than the active database budget', async () => {
  const f = await memorySourceJobsFixture({ tenancy: 'multi' });
  try {
    const scans = discoveryCalls(f); f.enableDiscovery();
    for (let index = 0; index < 5; index++) {
      const source = f.source({ scope: trustedSystemServiceDataScope({ scopeKind: 'tenant', tenantId: 'dormant-refill-' + index }) });
      await source.api.registration.activate(activate);
      await source.api.schedules.create({ input: { value: index }, at: new Date(f.now()).toISOString() }, { idempotencyKey: 'refill-' + index });
    }
    await Bun.sleep(5); expect(scans()).toBe(0); expect(f.calls).toHaveLength(0);
    await f.service.tick(); await settled(f, 5);
    expect(f.calls.map(input => (input as { value: number }).value).sort()).toEqual([0, 1, 2, 3, 4]);
    expect(f.service.diagnostics().automaticWakes).toBe(false); expect(f.stats()).toMatchObject({ activeLeases: 0, backendLeases: 0 });
  } finally { await f.close(); }
});

test('successful native scheduler startup wakes retained work and enables later external mutation wakes', async () => {
  const f = await memorySourceJobsFixture(), scheduler = new SchedulerService({ shutdownGraceMs: 100 });
  try {
    const scans = discoveryCalls(f); f.enableDiscovery(); const source = f.source(); await source.api.registration.activate(activate);
    await source.api.schedules.create({ input: { value: 1 }, at: new Date(f.now()).toISOString() }, { idempotencyKey: 'before-native-start' });
    await Bun.sleep(5); expect(scans()).toBe(0);
    f.service.start(scheduler); await settled(f, 1);
    expect(scheduler.has('zero-durable-jobs')).toBe(true); expect(f.service.diagnostics().automaticWakes).toBe(true);
    await source.api.schedules.create({ input: { value: 2 }, at: new Date(f.now()).toISOString() }, { idempotencyKey: 'after-native-start' });
    await settled(f, 2); expect(f.calls).toEqual([{ value: 1 }, { value: 2 }]);
    await f.service.close(); const closedScans = scans();
    expect(f.service.diagnostics().automaticWakes).toBe(false); expect(scheduler.has('zero-durable-jobs')).toBe(false);
    await f.service.tick(); await Bun.sleep(5); expect(scans()).toBe(closedScans);
  } finally { try { await f.close(); } finally { await scheduler.close(); } }
});

/** Native scheduler double only: no timer or provider. Published callbacks are retained deliberately for ownership-fence assertions. */
class CapturingScheduler extends SchedulerService {
  readonly captured: SchedulerJobDefinition[] = [];
  readonly unregistered: SchedulerJobDefinition['run'][] = [];
  readonly callbackTasks: Promise<void>[] = [];
  readonly failure = new Error('Synthetic scheduler published then rejected registration.');
  current: SchedulerJobDefinition | null = null;
  fail = true;
  override register(definition: SchedulerJobDefinition): void {
    this.captured.push(definition); this.current = definition;
    this.callbackTasks.push(Promise.resolve(definition.run({ signal: new AbortController().signal })));
    if (this.fail) { this.fail = false; throw this.failure; }
  }
  override unregister(name: string, expectedRun?: SchedulerJobDefinition['run']): boolean {
    if (!this.current || this.current.name !== name || this.current.run !== expectedRun) return false;
    this.unregistered.push(this.current.run); this.current = null; return true;
  }
}

test('an immediate/published callback from a failed start stays dormant after a successful retry and after close', async () => {
  const f = await memorySourceJobsFixture(), scheduler = new CapturingScheduler();
  try {
    const scans = discoveryCalls(f); f.enableDiscovery(); const source = f.source(); await source.api.registration.activate(activate);
    await source.api.schedules.create({ input: { value: 1 }, at: new Date(f.now()).toISOString() }, { idempotencyKey: 'failed-start-retained' });
    expect(() => f.service.start(scheduler)).toThrow(scheduler.failure);
    await Promise.all(scheduler.callbackTasks); await scheduler.captured[0]!.run({ signal: new AbortController().signal }); await Bun.sleep(5);
    expect(scans()).toBe(0); expect(f.calls).toHaveLength(0); expect(f.service.diagnostics().automaticWakes).toBe(false);
    expect(scheduler.current).toBeNull(); expect(scheduler.unregistered).toEqual([scheduler.captured[0]!.run]);
    const second = f.source({ identity: { ownerId: 'synthetic-second-dormant-owner' } }); await second.api.registration.activate(activate);
    await second.api.schedules.create({ input: { value: 2 }, at: new Date(f.now()).toISOString() }, { idempotencyKey: 'after-failed-start' });
    await Bun.sleep(5); expect(scans()).toBe(0);
    f.service.start(scheduler); await settled(f, 2);
    expect(() => f.service.start(scheduler)).toThrow();
    expect(f.service.diagnostics().automaticWakes).toBe(true); expect(scheduler.current).toBe(scheduler.captured[1]!);
    const retriedScans = scans();
    await scheduler.captured[0]!.run({ signal: new AbortController().signal }); await Bun.sleep(5); expect(scans()).toBe(retriedScans);
    await scheduler.captured[1]!.run({ signal: new AbortController().signal }); await Bun.sleep(5); expect(scans()).toBeGreaterThan(retriedScans);
    await f.service.close(); const closedScans = scans();
    await scheduler.captured[0]!.run({ signal: new AbortController().signal }); await scheduler.captured[1]!.run({ signal: new AbortController().signal });
    await Bun.sleep(5); expect(scans()).toBe(closedScans); expect(f.service.diagnostics().automaticWakes).toBe(false);
    expect(scheduler.unregistered).toEqual(scheduler.captured.map(definition => definition.run));
    expect(scheduler.current).toBeNull();
  } finally { try { await f.close(); } finally { await Promise.allSettled(scheduler.callbackTasks); await scheduler.close(); } }
});

test('failed startup cleanup never unregisters a different callback published by the scheduler', async () => {
  const f = await memorySourceJobsFixture(), replacement = async () => {}, failure = new Error('Synthetic replaced registration');
  let captured: SchedulerJobDefinition | undefined, retained: SchedulerJobDefinition | undefined;
  class ReplacingScheduler extends SchedulerService {
    override register(definition: SchedulerJobDefinition): void { captured = definition; retained = { ...definition, run: replacement }; throw failure; }
    override unregister(name: string, expectedRun?: SchedulerJobDefinition['run']): boolean {
      if (retained?.name !== name || retained.run !== expectedRun) return false;
      retained = undefined; return true;
    }
  }
  const scheduler = new ReplacingScheduler();
  try {
    const scans = discoveryCalls(f); f.enableDiscovery(); const source = f.source(); await source.api.registration.activate(activate);
    await source.api.schedules.create({ input: { value: 1 }, at: new Date(f.now()).toISOString() }, { idempotencyKey: 'replacement-preserved' });
    expect(() => f.service.start(scheduler)).toThrow(failure); expect(retained?.run).toBe(replacement);
    await captured!.run({ signal: new AbortController().signal }); await Bun.sleep(5);
    expect(scans()).toBe(0); expect(f.calls).toHaveLength(0); expect(f.service.diagnostics().automaticWakes).toBe(false);
  } finally { try { await f.close(); } finally { await scheduler.close(); } }
});
