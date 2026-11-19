/** Actual Calendar realm/Guardian + Jobs service/realm + Torrent seal/runtime in MEMORY.
 * Physical file/actor ownership is simulated by the existing memory fixtures.
 * The one-shot scheduler is an explicit double. No files, child processes,
 * network listeners, dependencies or generated output; every owner closes in finally.
 */
import { expect, spyOn, test } from 'bun:test';
import { createDatabaseRef } from '../databases/database-file';
import { observeDatabaseCoordinatorCommits } from '../databases/database-coordinator-commit-notifications';
import { JobsError } from '../jobs/error';
import { memorySourceJobsFixture, untilMemoryJobs, type MemoryJobsOperation } from '../jobs/test-support/memory-source-fixture';
import { currentLoggingAttribution, runWithLoggingAttribution } from '../logging/logging-attribution';
import { loggingContext } from '../logging/test-support/logging-fixture';
import type { StepContext } from '../workflows/types';
import { CalendarIntegrationCoordinator, type CalendarIntegrationWakeScheduler } from './integration-coordinator';
import { CALENDAR_OBSERVATION_JOB, CALENDAR_OBSERVATION_WORKFLOW, calendarObservationPinInput, registerCalendarObservationWorkflow } from './integration-catalog';
import type { CalendarObservationRule } from './integration-catalog';
import type { CalendarIntegrationPolicyView } from './integration-model';
import type { CalendarIntegrationOwner } from './integration-runtime';
import type { CalendarRuntime, CalendarRuntimeSource } from './runtime';
import { memoryCalendarServiceFixture } from './test-support/memory-service-fixture';

function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }
function scheduler() {
  type Definition = Parameters<CalendarIntegrationWakeScheduler['scheduleAt']>[0];
  const pending = new Map<string, Definition>(), captured: Definition[] = [];
  let maxLive = 0;
  return {
    scheduleAt(definition: Definition) {
      if (pending.has(definition.name)) throw new Error('One-shot wake was not cancelled.');
      pending.set(definition.name, definition); captured.push(definition); maxLive = Math.max(maxLive, pending.size);
      return { cancel() { if (pending.get(definition.name) === definition) pending.delete(definition.name); } };
    },
    pending, captured,
    async fire(now: number) {
      const next = [...pending.values()].sort((a, b) => a.at - b.at)[0];
      if (!next || next.at > now) return false;
      pending.delete(next.name); await next.run({ signal: new AbortController().signal }); return true;
    },
    async flush(now: number) {
      for (let step = 0; step < 20; step++) if (!await this.fire(now)) return;
      throw new Error('One-shot scheduler did not become idle.');
    },
    maxLive: () => maxLive,
  };
}

async function fixture(options: { tenancy?: 'single' | 'multi'; maxOwners?: number; commitHints?: boolean;
  beforeJobsWrite?: (operation: MemoryJobsOperation) => void | Promise<void>;
  afterJobsWrite?: (operation: MemoryJobsOperation) => void | Promise<void> } = {}) {
  const calendar = memoryCalendarServiceFixture({ tenancy: options.tenancy ?? 'single' });
  const all: CalendarIntegrationCoordinator[] = [], contexts: StepContext[] = [], attributionOwner = {};
  const attributions: unknown[] = [];
  let coordinator: CalendarIntegrationCoordinator | undefined;
  let jobs: Awaited<ReturnType<typeof memorySourceJobsFixture>> | undefined;
  let clock: ReturnType<typeof spyOn<typeof Date, 'now'>> | undefined;
  let beforeObservation: (() => Promise<void>) | null = null;
  let beforeVerify: ((owner: CalendarIntegrationOwner) => Promise<void>) | null = null;
  let discoveryCalls = 0, ownerCalls = 0, capabilityCalls = 0, proofs = 0, pinCalls = 0;
  let installedSource: CalendarRuntimeSource | null = null, removeHints: (() => void) | undefined;
  const source = (value: CalendarRuntimeSource) => { installedSource = value; (calendar.runtime as unknown as { source: CalendarRuntimeSource }).source = value; };
  try {
    jobs = await memorySourceJobsFixture({ tenancy: options.tenancy ?? 'single', definition: CALENDAR_OBSERVATION_JOB,
      registerWorkflow(registry) { registerCalendarObservationWorkflow(registry, () => ({ async execute(context) {
        contexts.push(context); await beforeObservation?.(); return coordinator!.execute(context);
      } })); }, beforeWrite: options.beforeJobsWrite, afterWrite: options.afterJobsWrite });
    clock = spyOn(Date, 'now').mockImplementation(() => jobs!.now());
    const nativeOwner = (record: Parameters<CalendarRuntime['forIntegrationOwner']>[0]): CalendarIntegrationOwner => {
      ownerCalls++;
      const owner = calendar.runtime.forIntegrationOwner(record);
      return { ...owner, async verify(opts) { proofs++; await beforeVerify?.(owner); return owner.verify(opts); },
        command(name, input, opts) { attributions.push(currentLoggingAttribution(attributionOwner)); return owner.command(name, input, opts); } };
    };
    const make = (rules: readonly CalendarObservationRule[] = [{ id: 'observe', version: '1', dueOffsetMs: 0, maxLatenessMs: 60_000 }]) => {
      const value = new CalendarIntegrationCoordinator({ rules,
        maxOwners: options.maxOwners, owner: nativeOwner,
        discover({ after, limit }) {
          discoveryCalls++;
          return calendar.runtime.integrationOwnerPage({ ...(after === undefined ? {} : { after }), limit });
        },
        resolveOwner: scope => calendar.runtime.integrationOwnerForScope(scope),
        pin(owner) {
          pinCalls++;
          return jobs!.bridge.pin(jobs!.bridge.system({ principal: 'jobs:source:src_' + 'f'.repeat(64), reason: 'Synthetic fixed native pin', scope: owner.scope }),
            CALENDAR_OBSERVATION_WORKFLOW, calendarObservationPinInput(), 1);
        },
        jobs: { forSource(source) { capabilityCalls++; expect(calendar.stats().activeLeases).toBe(0); return jobs!.service.forSource(source); } },
        inspect: (id, scope) => jobs!.workflows.getInstance(id, scope), now: () => jobs!.now(),
      });
      all.push(value); return value;
    };
    coordinator = make();
    if (options.commitHints) removeHints = observeDatabaseCoordinatorCommits((calendar.runtime as unknown as { owner: object }).owner,
      ref => installedSource?.wake(ref));
    const session = calendar.session('owner', { manager: true });
    const resource = await session.api.resources.create({ label: 'PRIVATE_RESOURCE', kind: 'person', timeZone: 'UTC' }, { idempotencyKey: 'seed' });
    const record = calendar.runtime.integrationOwners()[0]!;
    const owner = calendar.runtime.forIntegrationOwner(record);
    const appointment = (key = 'appointment', offset = 0) => session.api.appointments.create({ title: 'PRIVATE_TITLE', resourceIds: [resource.id],
      startAt: new Date(jobs!.now() + offset).toISOString(), endAt: new Date(jobs!.now() + offset + 60_000).toISOString(), timeZone: 'UTC' }, { idempotencyKey: key });
    return { calendar, jobs, session, resource, record, owner, contexts, attributions, attributionOwner, appointment,
      get coordinator() { return coordinator!; },
      install() { source(coordinator!.source); },
      replace(rules?: readonly CalendarObservationRule[]) { coordinator = make(rules); source(coordinator.source); return coordinator; },
      counters: () => ({ discoveryCalls, ownerCalls, capabilityCalls, proofs, pinCalls }),
      pauseObservation(callback: typeof beforeObservation) { beforeObservation = callback; },
      pauseVerify(callback: typeof beforeVerify) { beforeVerify = callback; },
      async close() {
        // Drain source callers, then shared Jobs callbacks and Torrent activities;
        // only then retire native evidence capabilities and physical owners.
        removeHints?.(); source({ prepare() {}, wake() {}, async close() {} });
        try {
          for (const value of all) await value.drain();
          jobs!.service.quiesce(); await jobs!.service.drain();
          try { await jobs!.workflows.dispose(); } finally { await jobs!.workflows.drainPhysical(); }
          for (const value of all) await value.closeEvidence();
        } finally { try { await jobs!.close(); } finally { try { await calendar.close(); } finally { clock?.mockRestore(); } } }
      },
    };
  } catch (error) {
    removeHints?.();
    try {
      for (const value of all) await value.drain();
      if (jobs) {
        jobs.service.quiesce(); await jobs.service.drain();
        try { await jobs.workflows.dispose(); } finally { await jobs.workflows.drainPhysical(); }
      }
      for (const value of all) await value.closeEvidence();
    }
    finally { try { await jobs?.close(); } finally { try { await calendar.close(); } finally { clock?.mockRestore(); } } }
    throw error;
  }
}

test('construction is inert; owner readiness is physically verified, capture-only and not a successful-readiness cache', async () => {
  const f = await fixture(); try {
    expect(f.counters()).toEqual({ discoveryCalls: 0, ownerCalls: 0, capabilityCalls: 0, proofs: 0, pinCalls: 0 });
    expect(f.coordinator.diagnostics()).toMatchObject({ state: 'dormant', retainedOwners: 0, scheduledAt: null });
    f.coordinator.source.prepare(f.record);
    await f.coordinator.ready(f.record); await f.coordinator.ready(f.record);
    expect(f.counters()).toMatchObject({ discoveryCalls: 0, ownerCalls: 1, capabilityCalls: 0, proofs: 2, pinCalls: 2 });
    expect((await f.owner.read<CalendarIntegrationPolicyView>('calendar.integration.policy', { ruleId: 'observe' })).state).toBe('activating');
    expect(f.calendar.sourceRows(f.session.scope, '_calendar_integration_controls')).toHaveLength(0);
    expect(f.jobs.commands).toHaveLength(0); expect(f.calendar.stats().activeLeases).toBe(0);
  } finally { await f.close(); }
});

test('same-owner readiness coalesces only its in-flight work while an independent owner progresses', async () => {
  const f = await fixture({ tenancy: 'multi' }), entered = deferred(), gate = deferred();
  try {
    const other = f.calendar.session('other', { tenantId: 'other', manager: true });
    await other.api.resources.create({ label: 'OTHER', kind: 'room', timeZone: 'UTC' }, { idempotencyKey: 'other' });
    const otherRecord = f.calendar.runtime.integrationOwners().find(row => row.scope_id === 'tenant:other')!;
    f.pauseVerify(async owner => { if (owner.owner.id === f.record.id) { entered.resolve(); await gate.promise; } });
    const a = f.coordinator.ready(f.record); await entered.promise;
    const b = f.coordinator.ready(f.record); expect(b).toBe(a);
    await f.coordinator.ready(otherRecord); expect(f.counters().proofs).toBe(2);
    expect(f.calendar.stats().activeLeases).toBe(0); gate.resolve(); await Promise.all([a, b]);
    await f.coordinator.ready(f.record); expect(f.counters().proofs).toBe(3);
  } finally { gate.resolve(); await f.close(); }
});

test('an exact installed capture lets a new appointment commit while its actual Jobs registration writer is still held', async () => {
  const entered = deferred(), gate = deferred();
  const f = await fixture({ beforeJobsWrite: async operation => {
    if (operation.name === 'jobs.source.register') { entered.resolve(); await gate.promise; }
  } }), wake = scheduler();
  let starting: Promise<void> | undefined, creating: ReturnType<typeof f.appointment> | undefined;
  try {
    f.install(); await f.coordinator.ready(f.record);
    starting = f.coordinator.start(wake); void starting.catch(() => {}); await entered.promise;
    expect(f.calendar.stats().activeLeases).toBe(0); expect(f.jobs.stats().activeLeases).toBe(0);
    const before = await f.owner.read<CalendarIntegrationPolicyView>('calendar.integration.policy', { ruleId: 'observe' });
    expect(before.state).toBe('activating');
    creating = f.appointment(); void creating.catch(() => {});
    await untilMemoryJobs(() => f.calendar.sourceRows(f.session.scope, '_calendar_integration_intents').length === 1);
    const appointment = await creating;
    expect(appointment.changed).toBe(true);
    expect(f.calendar.sourceRows(f.session.scope, '_calendar_integration_intents')[0]!.policy_epoch).toBe(before.epoch);
    expect(f.jobs.commands.filter(row => row.name === 'jobs.source.register')).toHaveLength(0);
    expect(f.coordinator.diagnostics()).toMatchObject({ readiness: { active: 0, queued: 0 }, intake: { active: 1 } });
    expect(f.calendar.stats().activeLeases).toBe(0);
  } finally {
    gate.resolve(); await Promise.allSettled([...(starting ? [starting] : []), ...(creating ? [creating] : [])]); await f.close();
  }
});

test('startup discovers durable work without hints and real Jobs/Torrent observation reaches the source cutoff', async () => {
  const f = await fixture(), wake = scheduler(); try {
    await f.coordinator.ready(f.record); await f.appointment();
    expect(f.jobs.commands).toHaveLength(0);
    await f.coordinator.start(wake);
    expect(f.counters().discoveryCalls).toBe(1);
    expect(f.calendar.sourceRows(f.session.scope, '_calendar_integration_dispatch')[0]!.state).toBe('accepted');
    expect(f.jobs.rows(f.session.scope, 'job_schedules')).toHaveLength(1);
    expect(wake.pending.size).toBe(1); expect(wake.maxLive()).toBe(1);
    expect(f.coordinator.diagnostics().scheduledAt).toBe(f.jobs.now() + 60_001);
    await f.jobs.tick(); await untilMemoryJobs(() => f.calendar.sourceRows(f.session.scope, '_calendar_integration_effect_outcomes').length === 1);
    expect(f.contexts).toHaveLength(1); expect(f.calendar.stats().activeLeases).toBe(0); expect(f.jobs.stats().activeLeases).toBe(0);
    expect(JSON.stringify(f.jobs.commands)).not.toContain('PRIVATE_');
  } finally { await f.close(); }
});

test('unknown Jobs create settlement retries on its original key at the durable future wake without a new appointment hint', async () => {
  let lose = true;
  const f = await fixture({ afterJobsWrite(operation) {
    if (operation.name === 'jobs.source.schedule.create' && lose) { lose = false; throw new JobsError('JOBS_OUTCOME_UNKNOWN'); }
  } }), wake = scheduler();
  try {
    await f.coordinator.ready(f.record); await f.appointment(); await f.coordinator.start(wake);
    expect(f.calendar.sourceRows(f.session.scope, '_calendar_integration_dispatch')[0]!.state).toBe('unknown');
    expect(f.jobs.rows(f.session.scope, 'job_schedules')).toHaveLength(1);
    const key = f.calendar.sourceRows(f.session.scope, '_calendar_integration_intents')[0]!.create_key;
    expect(f.coordinator.diagnostics().scheduledAt).toBe(f.jobs.now() + 1000);
    expect(await wake.fire(f.jobs.now())).toBe(false);
    f.jobs.advance(1000); await wake.fire(f.jobs.now());
    expect(f.calendar.sourceRows(f.session.scope, '_calendar_integration_dispatch')[0]!.state).toBe('accepted');
    expect(f.jobs.commands.filter(row => row.name === 'jobs.source.schedule.create')).toHaveLength(1);
    expect(f.calendar.sourceRows(f.session.scope, '_calendar_integration_intents')[0]!.create_key).toBe(key);
    expect(f.calendar.sourceRows(f.session.scope, '_calendar_integration_receipts')).toHaveLength(1);
  } finally { await f.close(); }
});

test('unknown registration control uses its original durable key and does not rotate the Jobs epoch', async () => {
  let lose = true;
  const f = await fixture({ afterJobsWrite(operation) {
    if (operation.name === 'jobs.source.register' && lose) { lose = false; throw new JobsError('JOBS_OUTCOME_UNKNOWN'); }
  } }), wake = scheduler();
  try {
    await f.coordinator.start(wake);
    const before = f.calendar.sourceRows(f.session.scope, '_calendar_integration_controls')[0]!;
    expect(f.coordinator.diagnostics().blockedOwners[0]!.code).toBe('JOBS_OUTCOME_UNKNOWN');
    expect(f.coordinator.diagnostics().scheduledAt).toBe(f.jobs.now() + 1000);
    f.jobs.advance(1000); await wake.fire(f.jobs.now());
    const after = f.calendar.sourceRows(f.session.scope, '_calendar_integration_controls')[0]!;
    expect(after.jobs_key).toBe(before.jobs_key);
    expect(f.calendar.sourceRows(f.session.scope, '_calendar_integration_controls')).toHaveLength(1);
    expect(f.jobs.commands.filter(row => row.name === 'jobs.source.register')).toHaveLength(1);
    expect((await f.owner.read<CalendarIntegrationPolicyView>('calendar.integration.policy', { ruleId: 'observe' })).registration?.generation).toBe(1);
  } finally { await f.close(); }
});

test('pending A backoff is reconciled before desired B preparation and cannot strand recovery after the first pass', async () => {
  let reject = true;
  const f = await fixture({ beforeJobsWrite(operation) {
    if (operation.name === 'jobs.source.register' && reject) throw new JobsError('JOBS_CAPACITY');
  } }), wake = scheduler();
  try {
    await f.coordinator.start(wake);
    const original = f.calendar.sourceRows(f.session.scope, '_calendar_integration_controls')[0]!;
    expect(f.coordinator.diagnostics().scheduledAt).toBe(f.jobs.now() + 5000);
    await f.coordinator.drain();
    const b = f.replace([{ id: 'observe', version: '2', dueOffsetMs: 0, maxLatenessMs: 60_000 }]);
    // A changed capture is not eligible for the exact-policy readiness fast path.
    await expect(b.ready(f.record)).rejects.toMatchObject({ code: 'CALENDAR_NOT_READY' });
    await b.start(wake);
    expect((await f.owner.read<CalendarIntegrationPolicyView>('calendar.integration.policy', { ruleId: 'observe' })).epoch).toBe(1);
    expect(f.calendar.sourceRows(f.session.scope, '_calendar_integration_controls')).toHaveLength(1);
    expect(b.diagnostics().scheduledAt).toBe(f.jobs.now() + 5000);
    reject = false; f.jobs.advance(5000); await wake.fire(f.jobs.now());
    const current = await f.owner.read<CalendarIntegrationPolicyView>('calendar.integration.policy', { ruleId: 'observe' });
    expect(current.state).toBe('active'); expect(current.epoch).toBe(2); expect(current.policy.ruleVersion).toBe('2');
    expect(f.calendar.sourceRows(f.session.scope, '_calendar_integration_controls')[0]!.jobs_key).toBe(original.jobs_key);
    expect(f.jobs.commands.filter(row => row.name === 'jobs.source.register')).toHaveLength(2);
    expect(b.diagnostics().blockedOwners).toHaveLength(0);
  } finally { await f.close(); }
});

test('an appointment ready before activation failure receives durable backoff instead of spinning the absolute wake', async () => {
  let reject = true;
  const f = await fixture({ beforeJobsWrite(operation) {
    if (operation.name === 'jobs.source.register' && reject) throw new JobsError('JOBS_CAPACITY');
  } }), wake = scheduler();
  try {
    await f.coordinator.ready(f.record); await f.appointment(); await f.coordinator.start(wake);
    // The very first thrown control failure must defer this appointment, not
    // rearm at now before a later returned-backoff result even has a chance.
    expect(f.coordinator.diagnostics().scheduledAt).toBe(f.jobs.now() + 1000);
    await wake.flush(f.jobs.now());
    const blocked = f.calendar.sourceRows(f.session.scope, '_calendar_integration_dispatch')[0]!;
    expect(blocked.state).toBe('pending'); expect(blocked.blocked_code).toBe('JOBS_NOT_READY');
    expect(blocked.create_attempted).toBe(0); expect(blocked.next_attempt_ms).toBe(f.jobs.now() + 1000);
    expect(f.coordinator.diagnostics().scheduledAt).toBe(f.jobs.now() + 1000);
    expect(f.jobs.rows(f.session.scope, 'job_schedules')).toHaveLength(0);
    for (let step = 0; step < 4; step++) {
      f.jobs.advance(1000); await wake.flush(f.jobs.now());
      expect(f.coordinator.diagnostics().scheduledAt).toBe(f.jobs.now() + 1000);
    }
    reject = false; f.jobs.advance(1000); await wake.flush(f.jobs.now());
    expect(f.calendar.sourceRows(f.session.scope, '_calendar_integration_dispatch')[0]!.state).toBe('accepted');
    expect(f.jobs.commands.filter(row => row.name === 'jobs.source.register')).toHaveLength(1);
    expect(f.jobs.rows(f.session.scope, 'job_schedules')).toHaveLength(1); expect(wake.maxLive()).toBe(1);
  } finally { await f.close(); }
});

test('actual native commit hints converge after bounded empty passes while activation and appointment retries are backed off', async () => {
  let reject = true;
  const f = await fixture({ commitHints: true, beforeJobsWrite(operation) {
    if (operation.name === 'jobs.source.register' && reject) throw new JobsError('JOBS_CAPACITY');
  } }), wake = scheduler();
  try {
    f.install(); await f.coordinator.ready(f.record); await f.appointment(); await f.coordinator.start(wake);
    // Source claim/defer/control acknowledgments themselves produce native
    // advisory hints. An extra empty pass may run, but must become quiet.
    await wake.flush(f.jobs.now());
    expect(f.coordinator.diagnostics().scheduledAt).toBe(f.jobs.now() + 1000);
    for (let step = 0; step < 4; step++) { f.jobs.advance(1000); await wake.flush(f.jobs.now()); }
    reject = false; f.jobs.advance(1000); await wake.flush(f.jobs.now());
    expect(f.calendar.sourceRows(f.session.scope, '_calendar_integration_dispatch')[0]!.state).toBe('accepted');
    expect(f.coordinator.diagnostics().scheduledAt).toBe(f.jobs.now() + 55_001);
    expect(wake.captured.length).toBeLessThan(16); expect(wake.maxLive()).toBe(1);
  } finally { await f.close(); }
});

test('an unjournaled transient owner-proof failure retries in one second despite a far-future accepted expiry', async () => {
  const f = await fixture(), wake = scheduler(); let refuse = true;
  try {
    await f.coordinator.ready(f.record); await f.appointment(); await f.coordinator.start(wake);
    expect(f.coordinator.diagnostics().scheduledAt).toBe(f.jobs.now() + 60_001);
    f.pauseVerify(async () => { if (refuse) { refuse = false; throw new Error('Synthetic short proof refusal'); } });
    f.coordinator.hint(createDatabaseRef(f.record.id)); await wake.flush(f.jobs.now());
    expect(f.coordinator.diagnostics().scheduledAt).toBe(f.jobs.now() + 1000);
    expect(f.coordinator.diagnostics().blockedOwners[0]!.code).toBe('INTEGRATION_RETRY');
    f.jobs.advance(1000); await wake.flush(f.jobs.now());
    expect(f.coordinator.diagnostics().blockedOwners).toHaveLength(0);
    expect(f.coordinator.diagnostics().scheduledAt).toBe(f.jobs.now() + 59_001);
    expect(f.jobs.commands.filter(row => row.name === 'jobs.source.schedule.create')).toHaveLength(1);
  } finally { await f.close(); }
});

test('an unjournaled owner-proof refusal backs off an already-due appointment instead of immediate wake recursion', async () => {
  const f = await fixture(), wake = scheduler(); let refuse = true;
  try {
    await f.coordinator.ready(f.record); await f.appointment();
    f.pauseVerify(async () => { if (refuse) { refuse = false; throw new Error('Synthetic short proof refusal'); } });
    await f.coordinator.start(wake); await wake.flush(f.jobs.now());
    expect(f.coordinator.diagnostics().scheduledAt).toBe(f.jobs.now() + 1000);
    expect(f.jobs.rows(f.session.scope, 'job_schedules')).toHaveLength(0);
    f.jobs.advance(1000); await wake.flush(f.jobs.now());
    expect(f.coordinator.diagnostics().blockedOwners).toHaveLength(0);
    expect(f.calendar.sourceRows(f.session.scope, '_calendar_integration_dispatch')[0]!.state).toBe('accepted');
  } finally { await f.close(); }
});

test('a live local retirement and pending retirement control reconcile after a hint although policy id is unchanged', async () => {
  const f = await fixture(), wake = scheduler(); try {
    await f.coordinator.ready(f.record); await f.appointment(); await f.coordinator.start(wake);
    const active = await f.owner.read<CalendarIntegrationPolicyView>('calendar.integration.policy', { ruleId: 'observe' });
    await f.owner.command('calendar.integration.policy.retire', { ruleId: 'observe', epoch: active.epoch }, { idempotencyKey: 'live-local-retirement' });
    await f.owner.command('calendar.integration.control.prepare', { ruleId: 'observe', epoch: active.epoch, action: 'retire', expectedRegistration: active.registration },
      { idempotencyKey: 'live-retirement-control' });
    f.coordinator.hint(createDatabaseRef(f.record.id)); await wake.flush(f.jobs.now());
    const retired = await f.owner.read<CalendarIntegrationPolicyView>('calendar.integration.policy', { ruleId: 'observe' });
    expect(retired.id).toBe(active.id); expect(retired.state).toBe('retired'); expect(wake.pending.size).toBe(0);
    expect(f.jobs.commands.filter(row => row.name === 'jobs.source.retire')).toHaveLength(1);
    expect(f.calendar.sourceRows(f.session.scope, '_calendar_integration_dispatch')[0]!.state).toBe('cancelled');
    expect((await f.owner.read<{ pending: unknown }>('calendar.integration.controlEvidence', { ruleId: 'observe' })).pending).toBeNull();
    // A later unrelated native hint does not repeatedly retire a healthy source.
    f.coordinator.hint(createDatabaseRef(f.record.id)); await wake.flush(f.jobs.now());
    expect(f.jobs.commands.filter(row => row.name === 'jobs.source.retire')).toHaveLength(1);
  } finally { await f.close(); }
});

test('a removed/unselected retained rule fails closed for operator review without activating it or another rule', async () => {
  const f = await fixture(), wake = scheduler(); try {
    await f.coordinator.start(wake); await f.coordinator.drain();
    const next = f.replace([{ id: 'different-rule', version: '1', dueOffsetMs: 0, maxLatenessMs: 60_000 }]);
    await expect(next.ready(f.record)).rejects.toMatchObject({ code: 'CALENDAR_NOT_READY' });
    const before = f.counters().capabilityCalls;
    await next.start(wake);
    expect(f.counters().capabilityCalls).toBe(before);
    expect(f.jobs.commands.filter(row => row.name === 'jobs.source.register')).toHaveLength(1);
    expect(f.calendar.sourceRows(f.session.scope, '_calendar_integration_policy_history')).toHaveLength(1);
    expect(next.diagnostics().blockedOwners[0]).toMatchObject({ code: 'CALENDAR_NOT_READY', unselectedRule: true });
    expect(wake.pending.size).toBe(0);
  } finally { await f.close(); }
});

test('hints coalesce into one absolute wake, and a cancelled captured wake cannot execute after quiescence', async () => {
  const f = await fixture(), wake = scheduler(); try {
    await f.coordinator.start(wake); expect(wake.pending.size).toBe(0);
    await f.appointment();
    for (let step = 0; step < 1000; step++) f.coordinator.hint(createDatabaseRef(f.record.id));
    expect(wake.pending.size).toBe(1); expect(wake.captured).toHaveLength(1);
    const old = wake.captured[0]!; f.coordinator.quiesce(); expect(wake.pending.size).toBe(0);
    await old.run({ signal: new AbortController().signal });
    expect(f.jobs.rows(f.session.scope, 'job_schedules')).toHaveLength(0);
    await expect(f.coordinator.ready(f.record)).rejects.toMatchObject({ code: 'CALENDAR_NOT_READY' });
    await f.coordinator.drain(); expect(f.owner.signal.aborted).toBe(false); await f.owner.verify();
  } finally { await f.close(); }
});

test('a failed absolute-wake registration leaves its captured callback inert after a later successful startup', async () => {
  const f = await fixture(), wake = scheduler();
  let captured: Parameters<CalendarIntegrationWakeScheduler['scheduleAt']>[0] | undefined;
  try {
    await f.coordinator.ready(f.record); await f.appointment();
    await expect(f.coordinator.start({ scheduleAt(definition) { captured = definition; throw new Error('Synthetic scheduler refusal'); } })).rejects.toThrow('Synthetic scheduler refusal');
    expect(f.coordinator.diagnostics().state).toBe('dormant');
    await f.coordinator.start(wake);
    const writes = f.attributions.length;
    await captured!.run({ signal: new AbortController().signal });
    expect(f.attributions).toHaveLength(writes); expect(wake.pending.size).toBe(1);
    expect(f.jobs.commands.filter(row => row.name === 'jobs.source.schedule.create')).toHaveLength(1);
  } finally { await f.close(); }
});

test('a running-state wake registration failure fails closed and explicit startup recovers without losing the old handle or intent', async () => {
  const f = await fixture(), wake = scheduler();
  let refuse = false, failed: Parameters<CalendarIntegrationWakeScheduler['scheduleAt']>[0] | undefined;
  try {
    await f.coordinator.ready(f.record); await f.appointment();
    await f.coordinator.start({ scheduleAt(definition) {
      if (refuse) { failed = definition; throw new Error('Synthetic running wake refusal'); }
      return wake.scheduleAt(definition);
    } });
    const old = wake.captured[0]!;
    await f.appointment('later-appointment', 120_000);
    refuse = true; f.coordinator.hint(createDatabaseRef(f.record.id));
    expect(f.coordinator.diagnostics()).toMatchObject({ state: 'dormant', scheduledAt: null, uncancelledWakeAt: null, wakeFailure: 'INTEGRATION_RETRY' });
    expect(wake.pending.size).toBe(0);
    expect(f.calendar.sourceRows(f.session.scope, '_calendar_integration_dispatch').filter(row => row.state === 'pending')).toHaveLength(1);
    expect(f.owner.signal.aborted).toBe(false); await f.owner.verify();
    await f.coordinator.start(wake);
    expect(f.coordinator.diagnostics()).toMatchObject({ state: 'running', wakeFailure: null });
    expect(f.jobs.commands.filter(row => row.name === 'jobs.source.schedule.create')).toHaveLength(2);
    const writes = f.attributions.length;
    await old.run({ signal: new AbortController().signal }); await failed!.run({ signal: new AbortController().signal });
    expect(f.attributions).toHaveLength(writes); expect(wake.pending.size).toBe(1);
  } finally { await f.close(); }
});

test('callback-finally rearm failure becomes restartable dormant state rather than a running service with no recovery wake', async () => {
  const f = await fixture(), wake = scheduler();
  let registrations = 0, failed: Parameters<CalendarIntegrationWakeScheduler['scheduleAt']>[0] | undefined;
  try {
    await f.coordinator.start({ scheduleAt(definition) {
      if (++registrations === 2) { failed = definition; throw new Error('Synthetic rearm refusal'); }
      return wake.scheduleAt(definition);
    } });
    await f.appointment(); f.coordinator.hint(createDatabaseRef(f.record.id));
    await expect(wake.fire(f.jobs.now())).rejects.toThrow('Synthetic rearm refusal');
    expect(f.coordinator.diagnostics()).toMatchObject({ state: 'dormant', scheduledAt: null, wakeFailure: 'INTEGRATION_RETRY' });
    expect(wake.pending.size).toBe(0);
    expect(f.calendar.sourceRows(f.session.scope, '_calendar_integration_dispatch')[0]!.state).toBe('accepted');
    expect(f.calendar.sourceRows(f.session.scope, '_calendar_integration_receipts')).toHaveLength(1);
    await f.coordinator.start(wake);
    expect(f.coordinator.diagnostics()).toMatchObject({ state: 'running', wakeFailure: null });
    expect(f.jobs.commands.filter(row => row.name === 'jobs.source.schedule.create')).toHaveLength(1);
    const writes = f.attributions.length; await failed!.run({ signal: new AbortController().signal });
    expect(f.attributions).toHaveLength(writes); expect(wake.pending.size).toBe(1);
  } finally { await f.close(); }
});

test('wake cancellation failure still quiesces intake and keeps one exact cleanup handle until a truthful successful retry', async () => {
  const f = await fixture(), wake = scheduler(); let blocked = true;
  try {
    await f.coordinator.ready(f.record); await f.appointment();
    await f.coordinator.start({ scheduleAt(definition) {
      const handle = wake.scheduleAt(definition);
      return { cancel() { if (blocked) throw new Error('Synthetic wake cancellation refusal'); handle.cancel(); } };
    } });
    expect(() => f.coordinator.quiesce()).toThrow('Synthetic wake cancellation refusal');
    expect(f.coordinator.diagnostics()).toMatchObject({ state: 'quiescing', uncancelledWakeAt: f.jobs.now() + 60_001 });
    await expect(f.coordinator.ready(f.record)).rejects.toMatchObject({ code: 'CALENDAR_NOT_READY' });
    await expect(f.coordinator.drain()).rejects.toThrow('Calendar integration intake did not drain cleanly');
    expect(wake.pending.size).toBe(1); expect(f.owner.signal.aborted).toBe(false);
    blocked = false; await f.coordinator.drain();
    expect(f.coordinator.diagnostics().uncancelledWakeAt).toBeNull(); expect(wake.pending.size).toBe(0);
  } finally { blocked = false; await f.close(); }
});

test('recovered observation evidence works before startup and after intake drain without retaining/hydrating an owner', async () => {
  const f = await fixture(), entered = deferred(), gate = deferred(), wake = scheduler();
  try {
    f.pauseObservation(async () => { entered.resolve(); await gate.promise; });
    await f.coordinator.ready(f.record); await f.appointment(); await f.coordinator.start(wake);
    await f.jobs.tick(); await entered.promise;
    const original = f.coordinator; await original.drain();
    const recovered = f.replace();
    expect(recovered.diagnostics().retainedOwners).toBe(0); expect(recovered.diagnostics().state).toBe('dormant');
    const observed = await recovered.execute(f.contexts[0]!);
    expect(observed.state).toBe('observed'); expect(recovered.diagnostics().retainedOwners).toBe(0);
    expect(f.counters().discoveryCalls).toBe(1); // original startup only
    await recovered.drain();
    expect((await recovered.execute(f.contexts[0]!)).state).toBe('observed');
    expect(f.calendar.sourceRows(f.session.scope, '_calendar_integration_effect_admissions')).toHaveLength(1);
    expect(f.calendar.sourceRows(f.session.scope, '_calendar_integration_effect_outcomes')).toHaveLength(1);
    gate.resolve(); await untilMemoryJobs(() => !f.jobs.workflows.getInstance(f.contexts[0]!.instanceId, f.session.scope)?.status?.includes('running'));
    await recovered.closeEvidence();
    await expect(recovered.execute(f.contexts[0]!)).rejects.toMatchObject({ code: 'CALENDAR_NOT_READY' });
    expect(f.owner.signal.aborted).toBe(false);
  } finally { gate.resolve(); await f.close(); }
});

test('retired desired rules reconcile retirement but background startup/readiness never implicitly reactivate them', async () => {
  const f = await fixture(), wake = scheduler(); try {
    await f.coordinator.start(wake);
    const active = await f.owner.read<CalendarIntegrationPolicyView>('calendar.integration.policy', { ruleId: 'observe' });
    await f.coordinator.drain();
    await f.owner.command('calendar.integration.policy.retire', { ruleId: 'observe', epoch: active.epoch }, { idempotencyKey: 'explicit-local-retirement' });
    const recovered = f.replace();
    await expect(recovered.ready(f.record)).rejects.toMatchObject({ code: 'CALENDAR_NOT_READY' });
    await recovered.start(wake);
    const retired = await f.owner.read<CalendarIntegrationPolicyView>('calendar.integration.policy', { ruleId: 'observe' });
    expect(retired.id).toBe(active.id); expect(retired.epoch).toBe(active.epoch); expect(retired.state).toBe('retired');
    expect(f.calendar.sourceRows(f.session.scope, '_calendar_integration_policy_history')).toHaveLength(1);
    expect(f.jobs.commands.filter(row => row.name === 'jobs.source.retire')).toHaveLength(1);
    expect(recovered.diagnostics().blockedOwners[0]!.retiredRule).toBe(true); expect(wake.pending.size).toBe(0);
  } finally { await f.close(); }
});

test('bounded private owner discovery rejects capacity before activation and does not claim the full 10000-owner envelope', async () => {
  const f = await fixture({ tenancy: 'multi', maxOwners: 1 }), wake = scheduler(); try {
    const other = f.calendar.session('other', { tenantId: 'other', manager: true });
    await other.api.resources.create({ label: 'OTHER', kind: 'room', timeZone: 'UTC' }, { idempotencyKey: 'other' });
    await expect(f.coordinator.start(wake)).rejects.toMatchObject({ code: 'CALENDAR_CAPACITY' });
    expect(f.coordinator.diagnostics()).toMatchObject({ state: 'dormant', retainedOwners: 1, maxOwners: 1, scheduledAt: null });
    expect(f.counters().capabilityCalls).toBe(0); expect(f.jobs.commands).toHaveLength(0); expect(wake.pending.size).toBe(0);
  } finally { await f.close(); }
});

test('background native policy writes and wake work do not inherit request logging attribution', async () => {
  const f = await fixture(), wake = scheduler(); try {
    await runWithLoggingAttribution(f.attributionOwner, loggingContext(null), () => {}, async () => {
      await f.coordinator.ready(f.record); await f.coordinator.start(wake);
    });
    await f.appointment();
    await runWithLoggingAttribution(f.attributionOwner, loggingContext(null), () => {}, () => {
      f.coordinator.hint(createDatabaseRef(f.record.id));
    });
    await wake.flush(f.jobs.now());
    expect(f.attributions.length).toBeGreaterThan(0); expect(f.attributions.every(value => value === null)).toBe(true);
  } finally { await f.close(); }
});
