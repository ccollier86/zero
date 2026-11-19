/** Actual Calendar realm/Guardian + Jobs service/realm + Torrent seal/runtime in MEMORY.
 * Physical file/actor ownership is simulated by the existing memory fixtures.
 * The one-shot scheduler is an explicit double. No files, child processes,
 * network listeners, dependencies or generated output; every owner closes in finally.
 */
import { expect, spyOn, test } from 'bun:test';
import { trustedSystemServiceDataScope } from '../auth/service-data-scope';
import { createDatabaseRef } from '../databases/database-file';
import { observeDatabaseCoordinatorCommits } from '../databases/database-coordinator-commit-notifications';
import { JobsError } from '../jobs/error';
import type { JobsSourceBroker, SourceJobs } from '../jobs/source-service';
import type { WorkPool } from '../workers/work-pool';
import { memorySourceJobsFixture, untilMemoryJobs, type MemoryJobsOperation } from '../jobs/test-support/memory-source-fixture';
import { currentLoggingAttribution, runWithLoggingAttribution } from '../logging/logging-attribution';
import { loggingContext } from '../logging/test-support/logging-fixture';
import type { StepContext } from '../workflows/types';
import { CalendarIntegrationCoordinator, type CalendarIntegrationCoordinatorOptions, type CalendarIntegrationWakeScheduler } from './integration-coordinator';
import { CALENDAR_OBSERVATION_JOB, CALENDAR_OBSERVATION_WORKFLOW, calendarObservationPinInput, registerCalendarObservationWorkflow } from './integration-catalog';
import type { CalendarObservationRule } from './integration-catalog';
import type { CalendarIntegrationPolicyView } from './integration-model';
import type { CalendarIntegrationOwner } from './integration-runtime';
import type { CalendarRuntime, CalendarRuntimeSource } from './runtime';
import { memoryCalendarServiceFixture } from './test-support/memory-service-fixture';
import { calendarHash } from './validation';
import { CalendarIntegrationWakeCatalog, installCalendarIntegrationWakeCatalog } from './integration-wake-catalog';

function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }
const capture = <T>(task: Promise<T>) => task.then(value => ({ ok: true as const, value }), error => ({ ok: false as const, error }));
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

async function fixture(options: { tenancy?: 'single' | 'multi'; maxOwners?: number; commitHints?: boolean; nativeJobsWriter?: boolean;
  catalog?: true;
  refreshWake?: CalendarIntegrationCoordinatorOptions['refreshWake'];
  beforeJobsRead?: (operation: MemoryJobsOperation) => void | Promise<void>;
  beforeJobsWrite?: (operation: MemoryJobsOperation) => void | Promise<void>;
  afterJobsWrite?: (operation: MemoryJobsOperation) => void | Promise<void> } = {}) {
  const calendar = memoryCalendarServiceFixture({ tenancy: options.tenancy ?? 'single' });
  const all: CalendarIntegrationCoordinator[] = [], contexts: StepContext[] = [], attributionOwner = {};
  const attributions: unknown[] = [], sourceReads: string[] = [];
  const clients: SourceJobs[] = [];
  let coordinator: CalendarIntegrationCoordinator | undefined;
  let jobs: Awaited<ReturnType<typeof memorySourceJobsFixture>> | undefined;
  let clock: ReturnType<typeof spyOn<typeof Date, 'now'>> | undefined;
  let beforeObservation: (() => Promise<void>) | null = null;
  let beforeVerify: ((owner: CalendarIntegrationOwner) => Promise<void>) | null = null;
  let beforeSourceCommand: ((name: string) => Promise<void>) | null = null;
  let pinFingerprint: string | null = null;
  let discoveryCalls = 0, ownerCalls = 0, capabilityCalls = 0, proofs = 0, pinCalls = 0;
  let installedSource: CalendarRuntimeSource | null = null, removeHints: (() => void) | undefined;
  const source = (value: CalendarRuntimeSource) => { installedSource = value; (calendar.runtime as unknown as { source: CalendarRuntimeSource }).source = value; };
  try {
    jobs = await memorySourceJobsFixture({ tenancy: options.tenancy ?? 'single', definition: CALENDAR_OBSERVATION_JOB, nativeWriter: options.nativeJobsWriter,
      registerWorkflow(registry) { registerCalendarObservationWorkflow(registry, () => ({ async execute(context) {
        contexts.push(context); await beforeObservation?.(); return coordinator!.execute(context);
      } })); }, beforeRead: options.beforeJobsRead, beforeWrite: options.beforeJobsWrite, afterWrite: options.afterJobsWrite });
    clock = spyOn(Date, 'now').mockImplementation(() => jobs!.now());
    let wakeCatalog: CalendarIntegrationWakeCatalog | undefined;
    if (options.catalog) {
      const native = calendar.runtime as unknown as { rootHash: string; wakeCatalog: CalendarIntegrationWakeCatalog };
      await installCalendarIntegrationWakeCatalog(calendar.system, true);
      wakeCatalog = new CalendarIntegrationWakeCatalog(calendar.system, native.rootHash); native.wakeCatalog = wakeCatalog;
    }
    const nativeOwner = (record: Parameters<CalendarRuntime['forIntegrationOwner']>[0]): CalendarIntegrationOwner => {
      ownerCalls++;
      const owner = calendar.runtime.forIntegrationOwner(record);
      return { ...owner, async verify(opts) { proofs++; await beforeVerify?.(owner); return owner.verify(opts); },
        read(name, input, opts) { sourceReads.push(name); return owner.read(name, input, opts); },
        async command(name, input, opts) { attributions.push(currentLoggingAttribution(attributionOwner)); await beforeSourceCommand?.(name); return owner.command(name, input, opts); } };
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
          const pin = jobs!.bridge.pin(jobs!.bridge.system({ principal: 'jobs:source:src_' + 'f'.repeat(64), reason: 'Synthetic fixed native pin', scope: owner.scope }),
            CALENDAR_OBSERVATION_WORKFLOW, calendarObservationPinInput(), 1);
          return pinFingerprint === null ? pin : { ...pin, fingerprint: pinFingerprint };
        },
        jobs: { forSource(source) { capabilityCalls++; expect(calendar.stats().activeLeases).toBe(0); const client = jobs!.service.forSource(source); clients.push(client); return client; },
          tryDetachSources: (handles, ids) => jobs!.service.tryDetachSources(handles, ids) },
        ...(wakeCatalog ? { wakeCatalog: () => wakeCatalog! } : {}),
        inspect: (id, scope) => jobs!.workflows.getInstance(id, scope), now: () => jobs!.now(),
        refreshWake: options.refreshWake ?? (wakeCatalog ? (record, failure) => calendar.runtime.refreshIntegrationWake(record, failure) : undefined),
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
    return { calendar, jobs, session, resource, record, owner, contexts, attributions, sourceReads, attributionOwner, appointment, clients, wakeCatalog,
      async configure() { await calendar.runtime.prepareIntegrationWakes(coordinator!.configurationStamp(), jobs!.now(), () => undefined); },
      get coordinator() { return coordinator!; },
      install() { source(coordinator!.source); },
      replace(rules?: readonly CalendarObservationRule[]) { coordinator = make(rules); source(coordinator.source); return coordinator; },
      counters: () => ({ discoveryCalls, ownerCalls, capabilityCalls, proofs, pinCalls }),
      pauseObservation(callback: typeof beforeObservation) { beforeObservation = callback; },
      pauseVerify(callback: typeof beforeVerify) { beforeVerify = callback; },
      pauseSourceCommand(callback: typeof beforeSourceCommand) { beforeSourceCommand = callback; },
      overridePinFingerprint(value: string | null) { pinFingerprint = value; },
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

test('configuration stamp is detached, deterministic and inert across coordinator instances', async () => {
  const f = await fixture(); try {
    const before = f.counters(), stamp = f.coordinator.configurationStamp(), same = f.replace();
    expect(stamp).toMatch(/^[a-f0-9]{64}$/); expect(same.configurationStamp()).toBe(stamp);
    expect(f.counters()).toEqual(before);
    const different = f.replace([{ id: 'observe', version: '2', dueOffsetMs: 0, maxLatenessMs: 60_000 }]);
    expect(different.configurationStamp()).not.toBe(stamp); expect(f.counters()).toEqual(before);
  } finally { await f.close(); }
});

test('catalog demand attaches only the original accepted control with all schedule slots and owner intake held, spending no write/key', async () => {
  const f = await fixture({ catalog: true, nativeJobsWriter: true }), wake = scheduler(), held = deferred(), entered = deferred();
  let blocker: Promise<unknown> | undefined; const pending: Promise<unknown>[] = [];
  try {
    f.install(); await f.configure(); await f.coordinator.ready(f.record); await f.appointment('demand-original', 1000);
    await f.coordinator.start(wake); await wake.flush(f.jobs.now());
    const original = f.clients.find(client => client.hydration!.inspect().attached)!;
    const row = f.jobs.rows(f.session.scope, 'job_schedules')[0]!, detail = await original.schedules.get(String(row.id));
    expect(f.jobs.service.tryDetachSources([original])).toBe('detached');
    f.jobs.service.bindNativeSourceHydrator((scope, admission, signal) => f.coordinator.hydrateSource(scope, admission, signal));
    const controls = f.calendar.sourceRows(f.session.scope, '_calendar_integration_controls'), writes = f.attributions.length, commands = f.jobs.commands.length;
    const sequence = f.jobs.torrentDb.currentSeq, admission = f.jobs.native(f.session.scope)!.engine.inspectAdmission();
    const ownerPool = (f.coordinator as unknown as { intake: WorkPool }).intake;
    blocker = ownerPool.run(async () => { entered.resolve(); await held.promise; }, { key: 'calendar-owner:' + calendarHash(f.record.id) });
    await entered.promise;
    const native = f.jobs.service as unknown as { gate: WorkPool; sources: JobsSourceBroker };
    for (let index = 0; index < native.gate.capacity; index++) pending.push(native.gate.run(async () => {
      const pin = await native.sources.prepareDispatch(f.session.scope, detail.admission);
      try { return await pin.run(() => { pin.assertCurrent(); return true; }); } finally { pin.abandon(); }
    }, { key: 'held-schedule-slot-' + index }));
    expect(await Promise.all(pending)).toEqual(new Array(native.gate.capacity).fill(true));
    expect(original.hydration!.inspect().attached).toBe(true);
    expect(f.jobs.native(f.session.scope)!.engine.inspectAdmission()).toEqual(admission);
    expect(f.calendar.sourceRows(f.session.scope, '_calendar_integration_controls')).toEqual(controls);
    expect(f.attributions).toHaveLength(writes); expect(f.jobs.commands).toHaveLength(commands); expect(f.jobs.torrentDb.currentSeq).toBe(sequence);
    expect(f.coordinator.diagnostics().residency).toMatchObject({ queued: 0, physical: 0 });
  } finally { held.resolve(); await blocker; await Promise.allSettled(pending); await f.close(); }
});

test('catalog native eviction/revisit detaches exact bindings without retirement and reconstructs original activation read-only', async () => {
  const f = await fixture({ catalog: true, nativeJobsWriter: true, tenancy: 'multi', maxOwners: 1 }), wake = scheduler();
  try {
    f.install(); await f.configure(); await f.coordinator.ready(f.record); await f.appointment('eviction-original', 1000);
    await f.coordinator.start(wake); await wake.flush(f.jobs.now());
    const original = f.clients.find(client => client.hydration!.inspect().attached)!, registration = await original.registration.get();
    const schedule = f.jobs.rows(f.session.scope, 'job_schedules')[0]!, detail = await original.schedules.get(String(schedule.id));
    const other = f.calendar.session('resident-other', { tenantId: 'resident-other', manager: true });
    await other.api.resources.create({ label: 'Other', kind: 'person', timeZone: 'UTC' }, { idempotencyKey: 'other-resident' });
    expect(original.hydration!.inspect().attached).toBe(false); expect(await original.registration.get()).toEqual(registration);
    expect(f.coordinator.diagnostics()).toMatchObject({ residentOwners: 1, residency: { evictedOwners: 1 } });
    const commands = f.jobs.commands.length, writes = f.attributions.length;
    expect(await f.coordinator.hydrateSource(f.session.scope, detail.admission, new AbortController().signal)).toBe(true);
    expect(f.coordinator.diagnostics()).toMatchObject({ residentOwners: 1, residency: { evictedOwners: 2 } });
    const replacement = f.clients.find(client => client.hydration!.inspect().attached)!;
    expect(replacement).not.toBe(original); expect(original.hydration!.tryDetach()).toBe('not-current');
    expect(await replacement.registration.get()).toEqual(registration);
    expect(await original.receipts.get(f.calendar.sourceRows(f.session.scope, '_calendar_integration_controls')[0]!.jobs_key as string)).toEqual(registration);
    expect(f.jobs.commands).toHaveLength(commands); expect(f.attributions).toHaveLength(writes); expect(f.owner.signal.aborted).toBe(false);
    expect(f.jobs.rows(f.session.scope, '_jobs_sources')[0]?.state).toBe('active');
  } finally { await f.close(); }
});

test('catalog native all-busy and inherited unknown-capability proofs keep the existing resident charged', async () => {
  const f = await fixture({ catalog: true, nativeJobsWriter: true, tenancy: 'multi', maxOwners: 1 }), wake = scheduler();
  let pin: Awaited<ReturnType<JobsSourceBroker['prepareDispatch']>> | undefined;
  try {
    f.install(); await f.configure(); await f.coordinator.ready(f.record); await f.appointment('busy-original', 1000);
    await f.coordinator.start(wake); await wake.flush(f.jobs.now());
    const original = f.clients.find(client => client.hydration!.inspect().attached)!, schedule = f.jobs.rows(f.session.scope, 'job_schedules')[0]!;
    const detail = await original.schedules.get(String(schedule.id));
    const native = f.jobs.service as unknown as { sources: JobsSourceBroker };
    pin = await native.sources.prepareDispatch(f.session.scope, detail.admission);
    const other = f.calendar.session('busy-other', { tenantId: 'busy-other', manager: true });
    await expect(other.api.resources.create({ label: 'Other', kind: 'person', timeZone: 'UTC' }, { idempotencyKey: 'busy-other' }))
      .rejects.toMatchObject({ code: 'CALENDAR_NOT_READY' });
    expect(original.hydration!.inspect().attached).toBe(true); expect(f.coordinator.diagnostics().residency.evictedOwners).toBe(0);
    pin.abandon(); pin = undefined;
    await f.coordinator.drain(); const next = f.replace(); await next.ready(f.record);
    expect(next.diagnostics().residency.sourceBindings).toBe(0); // ready remains capture-only
    const otherRecord = f.calendar.runtime.integrationOwnerForScope(other.scope)!;
    await expect(next.ready(otherRecord)).rejects.toMatchObject({ code: 'CALENDAR_NOT_READY' });
    expect(original.hydration!.inspect().attached).toBe(true); expect(next.diagnostics().residency.evictedOwners).toBe(0);
    expect(f.owner.signal.aborted).toBe(false);
  } finally { pin?.abandon(); await f.close(); }
});

test('demand rejects removed/current-desired mismatch and pin drift during attach without fresh activation fallback', async () => {
  let hold = false; const entered = deferred(), held = deferred();
  const f = await fixture({ catalog: true, nativeJobsWriter: true, beforeJobsRead: async operation => {
    if (hold && operation.name === 'jobs.source.receipt') { entered.resolve(); await held.promise; }
  } }), wake = scheduler(); let pending: Promise<unknown> | undefined;
  try {
    f.install(); await f.configure(); await f.coordinator.ready(f.record); await f.appointment('drift-original', 1000);
    await f.coordinator.start(wake); await wake.flush(f.jobs.now());
    const original = f.clients.find(client => client.hydration!.inspect().attached)!, schedule = f.jobs.rows(f.session.scope, 'job_schedules')[0]!;
    const detail = await original.schedules.get(String(schedule.id)); original.hydration!.tryDetach();
    const commands = f.jobs.commands.length, writes = f.attributions.length;
    f.overridePinFingerprint('f'.repeat(64));
    await expect(f.coordinator.hydrateSource(f.session.scope, detail.admission, new AbortController().signal)).rejects.toMatchObject({ code: 'JOBS_NOT_READY' });
    expect(original.hydration!.inspect().attached).toBe(false); f.overridePinFingerprint(null);
    hold = true; pending = f.coordinator.hydrateSource(f.session.scope, detail.admission, new AbortController().signal);
    const captured = capture(pending); await entered.promise; f.overridePinFingerprint('e'.repeat(64)); held.resolve();
    expect((await captured).ok).toBe(false); expect(original.hydration!.inspect().attached).toBe(false);
    expect(f.jobs.commands).toHaveLength(commands); expect(f.attributions).toHaveLength(writes);
    f.overridePinFingerprint(null); hold = false; await f.coordinator.drain(); const removed = f.replace([]); await removed.start(wake);
    await expect(removed.hydrateSource(f.session.scope, detail.admission, new AbortController().signal)).rejects.toMatchObject({ code: 'JOBS_NOT_READY' });
    expect(f.jobs.commands.filter(command => command.name === 'jobs.source.register')).toHaveLength(1);
  } finally { held.resolve(); await pending?.catch(() => {}); await f.close(); }
});

test('native wake publication runs once after a full owner pass and replaces the redundant source wake query', async () => {
  let refresh: NonNullable<CalendarIntegrationCoordinatorOptions['refreshWake']> = async () => null;
  const f = await fixture({ refreshWake: (record, failure) => refresh(record, failure) }), wake = scheduler();
  const calls: unknown[] = [];
  try {
    refresh = async (record, failure) => {
      calls.push({ record, failure }); expect(record).toEqual(f.record); expect(failure).toBeUndefined();
      expect(f.calendar.stats().activeLeases).toBe(0); expect(f.jobs.stats().activeLeases).toBe(0);
      expect(f.calendar.sourceRows(f.session.scope, '_calendar_integration_dispatch')[0]!.state).toBe('accepted');
      expect(f.jobs.rows(f.session.scope, 'job_schedules')).toHaveLength(1);
      return f.jobs.now() + 12_345;
    };
    await f.coordinator.ready(f.record); await f.appointment(); await f.coordinator.start(wake);
    expect(calls).toHaveLength(1); expect(f.sourceReads.filter(name => name === 'calendar.integration.nextWake')).toEqual([]);
    expect(f.coordinator.diagnostics().scheduledAt).toBe(f.jobs.now() + 12_345);
    expect(f.coordinator.diagnostics().residency).toMatchObject({ sourceBindings: 1, physicalControllerCallbacks: 0,
      activeDispatchers: 0, unsettledUninvokedClaims: 0, idleReleaseQualified: false });
  } finally { await f.close(); }
});

test('a refused native wake publication retains accepted Jobs facts and retries locally without a second publication', async () => {
  let calls = 0, fail = true;
  const f = await fixture({ refreshWake: async () => { calls++; if (fail) throw new Error('synthetic-publication-refused'); return null; } }), wake = scheduler();
  try {
    await f.coordinator.ready(f.record); await f.appointment(); await f.coordinator.start(wake);
    expect(calls).toBe(1); expect(f.coordinator.diagnostics().scheduledAt).toBe(f.jobs.now() + 1000);
    expect(f.calendar.sourceRows(f.session.scope, '_calendar_integration_dispatch')[0]!.state).toBe('accepted');
    expect(f.jobs.rows(f.session.scope, 'job_schedules')).toHaveLength(1);
    fail = false; f.jobs.advance(1000); await wake.flush(f.jobs.now());
    expect(calls).toBe(2); expect(f.coordinator.diagnostics().scheduledAt).toBeNull();
    expect(f.jobs.rows(f.session.scope, 'job_schedules')).toHaveLength(1);
    expect(f.sourceReads.filter(name => name === 'calendar.integration.nextWake')).toEqual([]);
  } finally { await f.close(); }
});

test('a hint arriving during native wake publication cannot be overwritten by its earlier quiet return', async () => {
  let refresh: NonNullable<CalendarIntegrationCoordinatorOptions['refreshWake']> = async () => null;
  const f = await fixture({ refreshWake: (record, failure) => refresh(record, failure) }), wake = scheduler();
  try {
    refresh = async () => { f.coordinator.hint(createDatabaseRef(f.record.id)); return null; };
    await f.coordinator.start(wake);
    expect(f.coordinator.diagnostics().scheduledAt).toBe(f.jobs.now());
    refresh = async () => null;
    await wake.flush(f.jobs.now());
    expect(f.coordinator.diagnostics().scheduledAt).toBeNull();
  } finally { await f.close(); }
});

test('an unjournaled owner failure publishes a finite durable retry instead of a false clean source snapshot', async () => {
  let refresh: NonNullable<CalendarIntegrationCoordinatorOptions['refreshWake']> = async () => null;
  const f = await fixture({ refreshWake: (record, failure) => refresh(record, failure) }), wake = scheduler();
  const calls: unknown[] = [];
  try {
    refresh = async (record, failure) => { calls.push({ record, failure }); return failure!.nextWakeAt; };
    f.pauseVerify(async () => { throw new Error('synthetic-owner-unavailable'); });
    await f.coordinator.start(wake);
    expect(calls).toEqual([{ record: f.record, failure: { classification: 'retry', nextWakeAt: f.jobs.now() + 1000 } }]);
    expect(f.sourceReads.filter(name => name === 'calendar.integration.nextWake')).toEqual([]);
    expect(f.coordinator.diagnostics().scheduledAt).toBe(f.jobs.now() + 1000);
    expect(f.jobs.commands).toEqual([]);
  } finally { f.pauseVerify(null); await f.close(); }
});

test('an empty rule catalog is evidence-only and still physically verifies ordinary Calendar readiness', async () => {
  const f = await fixture(), wake = scheduler(); try {
    const empty = f.replace([]), before = f.counters();
    await empty.ready(f.record); await empty.ready(f.record);
    expect(f.counters()).toMatchObject({ proofs: before.proofs + 2, pinCalls: before.pinCalls, capabilityCalls: before.capabilityCalls });
    await f.appointment('no-rules'); await empty.start(wake);
    expect(f.calendar.sourceRows(f.session.scope, '_calendar_integration_policy_history')).toHaveLength(0);
    expect(f.calendar.sourceRows(f.session.scope, '_calendar_integration_intents')).toHaveLength(0);
    expect(f.jobs.commands).toHaveLength(0); expect(wake.pending.size).toBe(0);
    expect(f.calendar.stats().activeLeases).toBe(0);
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

test('removed active rules keep accepted receipt evidence and expiry cancellation progressing without new registration', async () => {
  const f = await fixture(), wake = scheduler(); try {
    await f.coordinator.ready(f.record); await f.appointment(); await f.coordinator.start(wake);
    const original = f.calendar.sourceRows(f.session.scope, '_calendar_integration_intents')[0]!;
    await f.coordinator.drain(); const empty = f.replace([]);
    await expect(empty.ready(f.record)).rejects.toMatchObject({ code: 'CALENDAR_NOT_READY' });
    await empty.start(wake);
    expect(empty.diagnostics().scheduledAt).toBe(f.jobs.now() + 60_001);
    expect(f.calendar.sourceRows(f.session.scope, '_calendar_integration_dispatch')[0]!.state).toBe('accepted');
    f.jobs.advance(60_001); await wake.flush(f.jobs.now());
    expect(f.calendar.sourceRows(f.session.scope, '_calendar_integration_dispatch')[0]!.state).toBe('cancelled');
    expect(f.calendar.sourceRows(f.session.scope, '_calendar_integration_intents')[0]!.create_key).toBe(original.create_key);
    expect(f.calendar.sourceRows(f.session.scope, '_calendar_integration_receipts')).toHaveLength(2);
    expect(f.jobs.commands.filter(row => row.name === 'jobs.source.register')).toHaveLength(1);
    expect(f.jobs.commands.filter(row => row.name === 'jobs.source.retire')).toHaveLength(0);
    expect((await f.owner.read<CalendarIntegrationPolicyView>('calendar.integration.policy', { ruleId: 'observe' })).state).toBe('active');
    expect(wake.pending.size).toBe(0);
  } finally { await f.close(); }
});

test('removed rules reconcile an unknown accepted original create and later cancel without rotating its key', async () => {
  let lose = true;
  const f = await fixture({ afterJobsWrite(operation) {
    if (operation.name === 'jobs.source.schedule.create' && lose) { lose = false; throw new JobsError('JOBS_OUTCOME_UNKNOWN'); }
  } }), wake = scheduler(); try {
    await f.coordinator.ready(f.record); await f.appointment(); await f.coordinator.start(wake);
    const original = f.calendar.sourceRows(f.session.scope, '_calendar_integration_intents')[0]!;
    expect(f.calendar.sourceRows(f.session.scope, '_calendar_integration_dispatch')[0]!.state).toBe('unknown');
    await f.coordinator.drain(); const empty = f.replace([]); await empty.start(wake);
    f.jobs.advance(1000); await wake.flush(f.jobs.now());
    expect(f.calendar.sourceRows(f.session.scope, '_calendar_integration_dispatch')[0]!.state).toBe('accepted');
    f.jobs.advance(59_001); await wake.flush(f.jobs.now());
    expect(f.calendar.sourceRows(f.session.scope, '_calendar_integration_dispatch')[0]!.state).toBe('cancelled');
    expect(f.jobs.commands.filter(row => row.name === 'jobs.source.schedule.create')).toHaveLength(1);
    expect(f.calendar.sourceRows(f.session.scope, '_calendar_integration_intents')[0]!.create_key).toBe(original.create_key);
    expect(f.jobs.commands.filter(row => row.name === 'jobs.source.retire')).toHaveLength(0);
  } finally { await f.close(); }
});

test('removed rules reconcile an accepted activation control without hydrating fresh eligibility', async () => {
  let lose = true;
  const f = await fixture({ afterJobsWrite(operation) {
    if (operation.name === 'jobs.source.register' && lose) { lose = false; throw new JobsError('JOBS_OUTCOME_UNKNOWN'); }
  } }), wake = scheduler(); try {
    await f.coordinator.start(wake);
    const original = f.calendar.sourceRows(f.session.scope, '_calendar_integration_controls')[0]!;
    await f.coordinator.drain(); const empty = f.replace([]); await empty.start(wake);
    expect((await f.owner.read<{ pending: unknown }>('calendar.integration.controlEvidence', { ruleId: 'observe' })).pending).toBeNull();
    expect(f.calendar.sourceRows(f.session.scope, '_calendar_integration_controls')[0]!.jobs_key).toBe(original.jobs_key);
    expect(f.jobs.commands.filter(row => row.name === 'jobs.source.register')).toHaveLength(1);
    expect(f.jobs.commands.filter(row => row.name === 'jobs.source.retire')).toHaveLength(0);
    expect((await f.owner.read<CalendarIntegrationPolicyView>('calendar.integration.policy', { ruleId: 'observe' })).state).toBe('active');
    await expect(empty.ready(f.record)).rejects.toMatchObject({ code: 'CALENDAR_NOT_READY' });
    expect(wake.pending.size).toBe(0);
  } finally { await f.close(); }
});

test('removed activation evidence waits for the original late accepted Jobs writer without activating again', async () => {
  const entered = deferred(), gate = deferred(); let hold = true;
  const f = await fixture({ async afterJobsWrite(operation) {
    if (operation.name === 'jobs.source.register' && hold) { hold = false; entered.resolve(); await gate.promise; }
  } }), wake = scheduler();
  let starting: ReturnType<typeof capture> | undefined, recovering: ReturnType<typeof capture> | undefined;
  try {
    starting = capture(f.coordinator.start(wake)); await entered.promise;
    const original = f.calendar.sourceRows(f.session.scope, '_calendar_integration_controls')[0]!;
    const drained = await capture(f.coordinator.drain());
    // Cancelling the startup caller cannot certify that its accepted native
    // Jobs callback settled. Preserve that first truthful shutdown failure.
    expect(drained.ok).toBe(false);
    const empty = f.replace([]); let settled = false;
    recovering = capture(empty.start(wake)).then(result => { settled = true; return result; });
    await untilMemoryJobs(() => empty.diagnostics().intake.active === 1);
    expect(settled).toBe(false); expect(f.jobs.commands.filter(row => row.name === 'jobs.source.register')).toHaveLength(1);
    expect(f.calendar.stats().activeLeases).toBe(0); expect(f.jobs.stats().activeLeases).toBe(0);
    gate.resolve(); expect((await recovering).ok).toBe(true);
    expect((await f.owner.read<{ pending: unknown }>('calendar.integration.controlEvidence', { ruleId: 'observe' })).pending).toBeNull();
    expect(f.calendar.sourceRows(f.session.scope, '_calendar_integration_controls')[0]!.jobs_key).toBe(original.jobs_key);
    expect(f.jobs.commands.filter(row => row.name === 'jobs.source.register')).toHaveLength(1);
    expect(f.jobs.commands.filter(row => row.name === 'jobs.source.retire')).toHaveLength(0);
  } finally { gate.resolve(); await starting; await recovering; await f.close(); }
});

test('a removed active rule does not stop an already configured healthy rule from executing accepted work', async () => {
  const f = await fixture(), wake = scheduler(); try {
    const healthy = { id: 'healthy', version: '1', dueOffsetMs: 0, maxLatenessMs: 60_000 };
    const both = f.replace([{ ...healthy, id: 'observe' }, healthy]);
    await both.ready(f.record); await f.appointment('two-rules'); await both.start(wake);
    expect(f.calendar.sourceRows(f.session.scope, '_calendar_integration_receipts')).toHaveLength(2);
    await both.drain(); const next = f.replace([healthy]);
    await expect(next.ready(f.record)).rejects.toMatchObject({ code: 'CALENDAR_NOT_READY' });
    await next.start(wake); await f.jobs.tick();
    await untilMemoryJobs(() => f.calendar.sourceRows(f.session.scope, '_calendar_integration_effect_outcomes').length === 1);
    const intent = f.calendar.sourceRows(f.session.scope, '_calendar_integration_intents').find(row => row.rule_id === 'healthy')!;
    expect(f.calendar.sourceRows(f.session.scope, '_calendar_integration_effect_admissions').map(row => row.intent_id)).toEqual([intent.id]);
    expect(f.jobs.commands.filter(row => row.name === 'jobs.source.register')).toHaveLength(2);
    expect(f.jobs.commands.filter(row => row.name === 'jobs.source.retire')).toHaveLength(0);
    expect(next.diagnostics().blockedOwners[0]).toMatchObject({ unselectedRule: true });
  } finally { await f.close(); }
});

test('a backed-off removed control cannot starve a later configured healthy rule', async () => {
  let reject = true;
  const f = await fixture({ beforeJobsWrite(operation) {
    if (operation.name === 'jobs.source.register' && reject) throw new JobsError('JOBS_CAPACITY');
  } }), wake = scheduler();
  try {
    const healthy = { id: 'zz-healthy', version: '1', dueOffsetMs: 0, maxLatenessMs: 60_000 };
    const both = f.replace([{ ...healthy, id: 'observe' }, healthy]);
    await both.ready(f.record); await f.appointment('two-rules'); await both.start(wake); await both.drain();
    reject = false; f.jobs.advance(5000);
    const next = f.replace([healthy]); await next.start(wake); await f.jobs.tick();
    await untilMemoryJobs(() => f.calendar.sourceRows(f.session.scope, '_calendar_integration_effect_outcomes').length === 1);
    const intent = f.calendar.sourceRows(f.session.scope, '_calendar_integration_intents').find(row => row.rule_id === 'zz-healthy')!;
    expect(f.calendar.sourceRows(f.session.scope, '_calendar_integration_effect_admissions').map(row => row.intent_id)).toEqual([intent.id]);
    const removed = await f.owner.read<CalendarIntegrationPolicyView>('calendar.integration.policy', { ruleId: 'observe' });
    expect(removed.state).toBe('activating'); expect(removed.registration).toBeNull();
    expect((await f.owner.read<{ pending: { lastFailure: string } }>('calendar.integration.controlEvidence', { ruleId: 'observe' })).pending.lastFailure).toBe('CALENDAR_NOT_READY');
    expect(f.jobs.commands.filter(row => row.name === 'jobs.source.register')).toHaveLength(1);
    expect(f.jobs.commands.filter(row => row.name === 'jobs.source.retire')).toHaveLength(0);
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

test('removed or changed code policies cannot freshly admit an already accepted original Jobs execution', async () => {
  const f = await fixture(), wake = scheduler(), entered = deferred(), gate = deferred();
  try {
    f.pauseObservation(async () => { entered.resolve(); await gate.promise; });
    await f.coordinator.ready(f.record); await f.appointment(); await f.coordinator.start(wake); await f.jobs.tick(); await entered.promise;
    await f.coordinator.drain();
    for (const rules of [[], [{ id: 'observe', version: '2', dueOffsetMs: 0, maxLatenessMs: 60_000 }]]) {
      const recovered = f.replace(rules);
      await expect(recovered.execute(f.contexts[0]!)).rejects.toMatchObject({ code: 'JOBS_AUTHORITY_RETIRED' });
      expect(f.calendar.sourceRows(f.session.scope, '_calendar_integration_effect_admissions')).toHaveLength(0);
    }
    expect(f.calendar.sourceRows(f.session.scope, '_calendar_integration_receipts')).toHaveLength(1);
    expect(f.jobs.commands.filter(row => row.name === 'jobs.source.schedule.create')).toHaveLength(1);
  } finally { gate.resolve(); await f.close(); }
});

test('a changed native code pin during effect writer admission refuses the final fresh cutoff', async () => {
  const f = await fixture(), wake = scheduler(), entered = deferred(), gate = deferred();
  try {
    f.pauseSourceCommand(async name => { if (name === 'calendar.integration.effect.admit') { entered.resolve(); await gate.promise; } });
    await f.coordinator.ready(f.record); await f.appointment(); await f.coordinator.start(wake); await f.jobs.tick(); await entered.promise;
    f.overridePinFingerprint('f'.repeat(64)); gate.resolve();
    await untilMemoryJobs(() => !f.jobs.workflows.getInstance(f.contexts[0]!.instanceId, f.session.scope)?.status?.includes('running'));
    expect(f.calendar.sourceRows(f.session.scope, '_calendar_integration_effect_admissions')).toHaveLength(0);
    expect(f.calendar.sourceRows(f.session.scope, '_calendar_integration_effect_outcomes')).toHaveLength(0);
  } finally { gate.resolve(); await f.close(); }
});

test('an already admitted observation settles after code configuration removal and pin replacement', async () => {
  const f = await fixture(), wake = scheduler(), entered = deferred(), gate = deferred();
  try {
    f.pauseSourceCommand(async name => { if (name === 'calendar.integration.effect.settle') { entered.resolve(); await gate.promise; } });
    await f.coordinator.ready(f.record); await f.appointment(); await f.coordinator.start(wake); await f.jobs.tick(); await entered.promise;
    await f.coordinator.drain(); const empty = f.replace([]);
    expect((await empty.inspect(f.session.scope))!.effects.admittedButUnsettled).toBe(true);
    f.overridePinFingerprint('f'.repeat(64)); gate.resolve();
    await untilMemoryJobs(() => f.calendar.sourceRows(f.session.scope, '_calendar_integration_effect_outcomes').length === 1);
    expect((await empty.inspect(f.session.scope))!.effects.admittedButUnsettled).toBe(false);
    expect(f.calendar.sourceRows(f.session.scope, '_calendar_integration_effect_admissions')).toHaveLength(1);
    expect(f.calendar.sourceRows(f.session.scope, '_calendar_integration_receipts')).toHaveLength(1);
  } finally { gate.resolve(); await f.close(); }
});

test('retired desired rules preserve physically verified ordinary readiness without implicit reactivation', async () => {
  const f = await fixture(), wake = scheduler(); try {
    await f.coordinator.start(wake);
    const active = await f.owner.read<CalendarIntegrationPolicyView>('calendar.integration.policy', { ruleId: 'observe' });
    await f.coordinator.drain();
    await f.owner.command('calendar.integration.policy.retire', { ruleId: 'observe', epoch: active.epoch }, { idempotencyKey: 'explicit-local-retirement' });
    const recovered = f.replace();
    const proofs = f.counters().proofs;
    await recovered.ready(f.record); expect(f.counters().proofs).toBeGreaterThan(proofs);
    await f.session.api.resources.create({ label: 'AFTER_RETIREMENT', kind: 'room', timeZone: 'UTC' }, { idempotencyKey: 'after-retirement-resource' });
    await f.appointment('after-retirement');
    expect(f.calendar.sourceRows(f.session.scope, '_calendar_integration_intents')).toHaveLength(0);
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

test('native inspection is existing-only and never hydrates an owner, pins a graph or provisions Jobs storage', async () => {
  const f = await fixture({ tenancy: 'multi' }); try {
    const absent = trustedSystemServiceDataScope({ scopeKind: 'tenant', tenantId: 'absent-owner' }), before = f.counters();
    const expected = { id: calendarHash(['tenant:absent-owner', 'observe', 1]), epoch: 1, policyDigest: 'f'.repeat(64) };
    expect(await f.coordinator.inspect(absent)).toBeNull();
    await expect(f.coordinator.retire(absent, { ruleId: 'observe', expected })).rejects.toMatchObject({ code: 'CALENDAR_NOT_FOUND' });
    await expect(f.coordinator.reactivate(absent, { ruleId: 'observe', expected })).rejects.toMatchObject({ code: 'CALENDAR_NOT_FOUND' });
    expect(f.counters()).toEqual(before); expect(f.calendar.runtime.integrationOwners()).toHaveLength(1);
    const empty = await f.coordinator.inspect(f.session.scope);
    expect(empty).toMatchObject({ rules: [], retained: { policies: { used: 0 }, intents: { used: 0 } }, evidenceOwnerRequired: true,
      snapshot: 'separate-source-and-jobs-observations' });
    expect(f.coordinator.diagnostics().retainedOwners).toBe(0); expect(f.counters()).toMatchObject({ discoveryCalls: 0, pinCalls: 0, capabilityCalls: 0 });
    expect(f.attributions).toHaveLength(0); expect(f.jobs.commands).toHaveLength(0); expect(f.jobs.stats().planes).toBe(0);
    await f.coordinator.ready(f.record); await f.coordinator.drain();
    const cold = f.replace(), counters = f.counters(), rows = f.calendar.sourceRows(f.session.scope, '_calendar_integration_policy_history');
    const captured = await cold.inspect(f.session.scope);
    expect(captured?.rules[0]).toMatchObject({ ruleId: 'observe', state: 'activating', configured: true, downstream: null, capacity: null });
    expect(cold.diagnostics()).toMatchObject({ state: 'dormant', retainedOwners: 0 });
    expect(f.counters()).toMatchObject({ discoveryCalls: counters.discoveryCalls, pinCalls: counters.pinCalls });
    expect(f.calendar.sourceRows(f.session.scope, '_calendar_integration_policy_history')).toEqual(rows);
    expect(f.jobs.commands).toHaveLength(0); expect(f.jobs.stats().planes).toBe(0);
    const cancelled = new AbortController(); cancelled.abort(new Error('pre-aborted-inspection'));
    await expect(cold.inspect(f.session.scope, { signal: cancelled.signal })).rejects.toThrow('pre-aborted-inspection');
    expect(cold.diagnostics().retainedOwners).toBe(0); expect(f.calendar.stats().activeLeases).toBe(0);
  } finally { await f.close(); }
});

test('native inspection reports bounded redacted source and Jobs facts before and after intake drainage', async () => {
  const f = await fixture({ nativeJobsWriter: true }), wake = scheduler(); try {
    await f.coordinator.ready(f.record); const appointment = await f.appointment(); await f.coordinator.start(wake);
    const commands = f.jobs.commands.length, sourceWrites = f.attributions.length, pins = f.counters().pinCalls;
    const view = await f.coordinator.inspect(f.session.scope), rule = view!.rules[0]!;
    expect(view).toMatchObject({ evidenceOwnerRequired: true, snapshot: 'separate-source-and-jobs-observations',
      retained: { policies: { used: 1 }, intents: { used: 1 } },
      dispatch: { pending: false, unknown: false, blocked: false, accepted: true, claimed: false }, effects: { admittedButUnsettled: false } });
    expect(rule).toMatchObject({ ruleId: 'observe', epoch: 1, state: 'active', configured: true, pendingControl: null,
      downstream: { generation: 1, revision: 1, state: 'active', matchesPolicy: true }, capacity: { version: 3,
        retained: { sourceSchedules: { used: 1 }, file: { schedules: { used: 1 }, sources: { used: 1 }, sourcePolicies: { used: 1 } } },
        working: { sourceSchedules: { used: 1 }, fileSchedules: { used: 1 } } } });
    expect(rule.selection).toEqual({ id: rule.id, epoch: rule.epoch, policyDigest: rule.policyDigest });
    expect(rule.capacity!.retained.sourceSchedules).not.toHaveProperty('limit');
    const transport = rule.capacity!.transport;
    expect(transport.policyFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(transport.permanentKeys).toBeGreaterThan(0);
    expect(transport.permanentKeys).toBe(transport.retainedResults + transport.expiredTombstones);
    expect(transport.ordinaryRemaining).toBe(Math.max(0, transport.keyLimit - transport.permanentKeys - transport.settlementUnits));
    expect(transport.settlementRemaining).toBe(Math.max(0, transport.keyLimit - transport.permanentKeys));
    expect(transport.deficit).toBe(0);
    expect(transport.sourceControlUnits).toBeGreaterThan(0);
    expect(transport.actorControlUnits).toBe(0);
    for (const budget of [view!.retained.policies, view!.retained.intents, ...Object.values(rule.capacity!.working), ...Object.values(rule.capacity!.retained.file)]) {
      expect(budget.limit).toBeGreaterThanOrEqual(budget.used); expect(budget.remaining).toBe(budget.limit - budget.used);
    }
    const wire = JSON.stringify(view);
    for (const secret of ['PRIVATE_', f.resource.id, appointment.id, 'jobsKey', 'jobs_key', 'createKey', 'rootHash', 'rootDirectory', 'workflow', 'pinInput', 'initiatedBy', 'executionId', 'instanceId', 'safeToDisable']) expect(wire).not.toContain(secret);
    expect(f.jobs.commands).toHaveLength(commands); expect(f.attributions).toHaveLength(sourceWrites); expect(f.counters().pinCalls).toBe(pins);
    await f.coordinator.drain(); const after = await f.coordinator.inspect(f.session.scope);
    expect(after).toEqual(view); expect(after!.evidenceOwnerRequired).toBe(true);
    expect(f.owner.signal.aborted).toBe(false); expect(f.calendar.stats().activeLeases).toBe(0); expect(f.jobs.stats().activeLeases).toBe(0);
  } finally { await f.close(); }
});

test('native inspection retains admitted-but-unsettled evidence through intake drain without claiming effects drained', async () => {
  const f = await fixture(), wake = scheduler(), entered = deferred(), gate = deferred();
  try {
    f.pauseSourceCommand(async name => { if (name === 'calendar.integration.effect.settle') { entered.resolve(); await gate.promise; } });
    await f.coordinator.ready(f.record); await f.appointment(); await f.coordinator.start(wake); await f.jobs.tick(); await entered.promise;
    expect((await f.coordinator.inspect(f.session.scope))!.effects).toEqual({ admittedButUnsettled: true });
    await f.coordinator.drain();
    const retained = await f.coordinator.inspect(f.session.scope); expect(retained!.effects.admittedButUnsettled).toBe(true); expect(retained!.evidenceOwnerRequired).toBe(true);
    expect(retained).not.toHaveProperty('safeToDisable'); expect(f.calendar.stats().activeLeases).toBe(0);
    gate.resolve(); await untilMemoryJobs(() => f.calendar.sourceRows(f.session.scope, '_calendar_integration_effect_outcomes').length === 1);
    expect((await f.coordinator.inspect(f.session.scope))!.effects.admittedButUnsettled).toBe(false);
  } finally { gate.resolve(); await f.close(); }
});

test('native selected retirement leaves ordinary readiness usable and explicit same-policy reactivation creates a new epoch', async () => {
  const f = await fixture(), wake = scheduler(); try {
    f.install(); await f.coordinator.start(wake);
    const initial = (await f.coordinator.inspect(f.session.scope))!.rules[0]!, input = { ruleId: initial.ruleId, expected: initial.selection };
    const cancelled = new AbortController(); cancelled.abort(new Error('pre-aborted-control'));
    const writes = f.attributions.length, jobs = f.jobs.commands.length;
    await expect(f.coordinator.retire(f.session.scope, { ...input, signal: cancelled.signal })).rejects.toThrow('pre-aborted-control');
    await expect(f.coordinator.reactivate(f.session.scope, { ...input, signal: cancelled.signal })).rejects.toThrow('pre-aborted-control');
    await expect(f.coordinator.retire(f.session.scope, { ...input, expected: { ...input.expected, policyDigest: '0'.repeat(64) } })).rejects.toMatchObject({ code: 'CALENDAR_POLICY_STALE' });
    expect(f.attributions).toHaveLength(writes); expect(f.jobs.commands).toHaveLength(jobs);
    const retired = await f.coordinator.retire(f.session.scope, input);
    expect(retired).toEqual({ ruleId: initial.ruleId, selection: initial.selection, localState: 'retired', downstream: 'retired', evidenceOwnerRequired: true });
    await f.coordinator.ready(f.record);
    expect((await f.coordinator.inspect(f.session.scope))!.rules[0]).toMatchObject({ id: initial.id, state: 'retired', downstream: { state: 'retired' } });
    const reactivated = await f.coordinator.reactivate(f.session.scope, input);
    expect(reactivated).toMatchObject({ ruleId: initial.ruleId, localState: 'active', downstream: 'active', selection: { epoch: initial.epoch + 1 }, evidenceOwnerRequired: true });
    expect(reactivated.selection.id).not.toBe(initial.id);
    await expect(f.coordinator.retire(f.session.scope, input)).rejects.toMatchObject({ code: 'CALENDAR_POLICY_STALE' });
    await expect(f.coordinator.reactivate(f.session.scope, input)).rejects.toMatchObject({ code: 'CALENDAR_POLICY_STALE' });
    await f.coordinator.ready(f.record); await f.appointment('after-explicit-reactivation'); f.coordinator.hint(createDatabaseRef(f.record.id)); await wake.flush(f.jobs.now());
    const current = (await f.coordinator.inspect(f.session.scope))!.rules[0]!;
    expect(current.selection).toEqual(reactivated.selection); expect(current.downstream).toMatchObject({ state: 'active', generation: 2, matchesPolicy: true });
    expect(f.jobs.rows(f.session.scope, 'job_schedules')).toHaveLength(1); expect(f.jobs.commands.filter(row => row.name === 'jobs.source.register')).toHaveLength(2);
  } finally { await f.close(); }
});

test('a restarted native coordinator can inspect and retire a removed rule but cannot reactivate it or a dormant rule', async () => {
  const f = await fixture(), wake = scheduler(); try {
    await f.coordinator.start(wake); const selected = (await f.coordinator.inspect(f.session.scope))!.rules[0]!; await f.coordinator.drain();
    const removed = f.replace([{ id: 'different-rule', version: '1', dueOffsetMs: 0, maxLatenessMs: 60_000 }]);
    const cold = await removed.inspect(f.session.scope); expect(cold!.rules[0]).toMatchObject({ configured: false, selection: selected.selection, downstream: { state: 'active' } });
    expect(removed.diagnostics().retainedOwners).toBe(0);
    const retired = await removed.retire(f.session.scope, { ruleId: selected.ruleId, expected: selected.selection }); expect(retired.downstream).toBe('retired');
    await removed.start(wake);
    const before = f.attributions.length;
    await expect(removed.reactivate(f.session.scope, { ruleId: selected.ruleId, expected: selected.selection })).rejects.toMatchObject({ code: 'CALENDAR_NOT_READY' });
    expect(f.attributions).toHaveLength(before); expect(f.calendar.sourceRows(f.session.scope, '_calendar_integration_policy_history')).toHaveLength(2);
    expect((await removed.inspect(f.session.scope))!.rules.find(rule => rule.ruleId === selected.ruleId)).toMatchObject({ configured: false, state: 'retired', downstream: { state: 'retired' } });
    await removed.ready(f.record); await f.appointment('healthy-after-removed-retirement');
    removed.hint(createDatabaseRef(f.record.id)); await wake.flush(f.jobs.now());
    expect(f.calendar.sourceRows(f.session.scope, '_calendar_integration_intents').map(row => row.rule_id)).toEqual(['different-rule']);
    expect(f.calendar.sourceRows(f.session.scope, '_calendar_integration_dispatch')[0]!.state).toBe('accepted');
    await removed.drain(); const dormant = f.replace(), writes = f.attributions.length;
    await expect(dormant.reactivate(f.session.scope, { ruleId: selected.ruleId, expected: selected.selection })).rejects.toMatchObject({ code: 'CALENDAR_NOT_READY' });
    expect(f.attributions).toHaveLength(writes); expect(dormant.diagnostics().retainedOwners).toBe(0);
    expect(f.calendar.sourceRows(f.session.scope, '_calendar_integration_policy_history')).toHaveLength(2);
  } finally { await f.close(); }
});

test('native inspection refuses a source policy changed during a separate Jobs read', async () => {
  const entered = deferred(), gate = deferred(); let armed = false;
  const f = await fixture({ beforeJobsRead: async operation => {
    if (armed && operation.name === 'jobs.source.capacity') { entered.resolve(); await gate.promise; }
  } }), wake = scheduler(); let inspecting: ReturnType<typeof capture> | undefined;
  try {
    await f.coordinator.start(wake); const before = (await f.coordinator.inspect(f.session.scope))!.rules[0]!;
    armed = true; inspecting = capture(f.coordinator.inspect(f.session.scope)); await entered.promise;
    expect(f.calendar.stats().activeLeases).toBe(0); expect(f.jobs.stats().activeLeases).toBe(0);
    await f.owner.command('calendar.integration.policy.retire', { ruleId: before.ruleId, epoch: before.epoch }, { idempotencyKey: 'source-changed-during-inspection' });
    gate.resolve(); const result = await inspecting; expect(result.ok).toBe(false); if (!result.ok) expect(result.error.code).toBe('CALENDAR_POLICY_STALE');
    expect(f.jobs.commands.filter(row => row.name === 'jobs.source.retire')).toHaveLength(0);
  } finally { gate.resolve(); await inspecting; await f.close(); }
});

test('a cancelled native control waiting in the owner queue is proven not started and leaves the active rule untouched', async () => {
  const f = await fixture(), wake = scheduler(), entered = deferred(), gate = deferred(); let firing: Promise<boolean> | undefined;
  try {
    await f.coordinator.start(wake); const selected = (await f.coordinator.inspect(f.session.scope))!.rules[0]!;
    f.pauseVerify(async () => { entered.resolve(); await gate.promise; });
    f.coordinator.hint(createDatabaseRef(f.record.id)); firing = wake.fire(f.jobs.now()); void firing.catch(() => {}); await entered.promise;
    const cancelled = new AbortController(), queued = capture(f.coordinator.retire(f.session.scope, { ruleId: selected.ruleId, expected: selected.selection, signal: cancelled.signal }));
    expect(f.coordinator.diagnostics().intake.queued).toBe(1); cancelled.abort(new Error('synthetic-queued-cancel'));
    const result = await queued; expect(result.ok).toBe(false); if (!result.ok) expect(result.error.message).toBe('synthetic-queued-cancel');
    expect(f.coordinator.diagnostics().intake.queued).toBe(0); gate.resolve(); await firing;
    const current = (await f.coordinator.inspect(f.session.scope))!.rules[0]!; expect(current.selection).toEqual(selected.selection); expect(current.state).toBe('active');
    expect(f.jobs.commands.filter(row => row.name === 'jobs.source.retire')).toHaveLength(0);
    expect(f.calendar.sourceRows(f.session.scope, '_calendar_integration_controls')).toHaveLength(1);
  } finally { gate.resolve(); await firing?.catch(() => {}); await f.close(); }
});

test('cancelling an admitted native retirement reports unknown and original accepted retirement remains reconcilable', async () => {
  const entered = deferred(), gate = deferred(); let hold = true;
  const f = await fixture({ afterJobsWrite: async operation => {
    if (hold && operation.name === 'jobs.source.retire') { hold = false; entered.resolve(); await gate.promise; }
  } }), wake = scheduler(); let retiring: ReturnType<typeof capture> | undefined;
  try {
    await f.coordinator.start(wake); const selected = (await f.coordinator.inspect(f.session.scope))!.rules[0]!, cancelled = new AbortController();
    retiring = capture(f.coordinator.retire(f.session.scope, { ruleId: selected.ruleId, expected: selected.selection, signal: cancelled.signal })); await entered.promise;
    cancelled.abort(new Error('synthetic-active-cancel'));
    const result = await retiring; expect(result.ok).toBe(false); if (!result.ok) expect(result.error).toMatchObject({ code: 'CALENDAR_OUTCOME_UNKNOWN', outcome: 'unknown' });
    expect((await f.owner.read<CalendarIntegrationPolicyView>('calendar.integration.policy', { ruleId: selected.ruleId })).state).toBe('retired');
    gate.resolve();
    await untilMemoryJobs(() => f.calendar.sourceRows(f.session.scope, '_calendar_integration_control_attempts').some(row => row.last_failure === 'JOBS_OUTCOME_UNKNOWN'));
    const partial = (await f.coordinator.inspect(f.session.scope))!.rules[0]!;
    expect(partial).toMatchObject({ selection: selected.selection, state: 'retired', downstream: { state: 'retired' }, pendingControl: { action: 'retire', lastFailure: 'JOBS_OUTCOME_UNKNOWN' } });
    const original = f.calendar.sourceRows(f.session.scope, '_calendar_integration_controls').find(row => row.action === 'retire')!;
    f.jobs.advance(1000);
    const reconciled = await f.coordinator.retire(f.session.scope, { ruleId: selected.ruleId, expected: selected.selection }); expect(reconciled.downstream).toBe('retired');
    expect((await f.coordinator.inspect(f.session.scope))!.rules[0]!.pendingControl).toBeNull();
    expect(f.calendar.sourceRows(f.session.scope, '_calendar_integration_controls').find(row => row.action === 'retire')!.jobs_key).toBe(original.jobs_key);
    expect(f.jobs.commands.filter(row => row.name === 'jobs.source.retire')).toHaveLength(1);
  } finally { gate.resolve(); await retiring; await f.close(); }
});

test('trusted native inspection revocation during its first Jobs read prevents capacity reads and never retains callbacks', async () => {
  const entered = deferred(), gate = deferred(), reads: string[] = []; let armed = false, revoked = false, checks = 0, confirmations = 0;
  const f = await fixture({ beforeJobsRead: async operation => {
    if (!armed) return;
    reads.push(operation.name);
    if (operation.name === 'jobs.source') { entered.resolve(); await gate.promise; }
  } }), wake = scheduler(); let inspecting: ReturnType<typeof capture> | undefined;
  try {
    await f.coordinator.start(wake); armed = true; f.sourceReads.length = 0;
    inspecting = capture(f.coordinator.inspect(f.session.scope, {
      assertCurrent() { checks++; if (revoked) throw new Error('trusted-native-authority-revoked'); },
      async confirmCurrent() { confirmations++; if (revoked) throw new Error('trusted-native-confirmation-revoked'); },
    }));
    await entered.promise; expect(reads).toEqual(['jobs.source']); expect(confirmations).toBe(3);
    expect(f.calendar.stats().activeLeases).toBe(0); expect(f.jobs.stats().activeLeases).toBe(0);
    revoked = true; gate.resolve(); const result = await inspecting;
    expect(result.ok).toBe(false); if (!result.ok) expect(result.error.message).toBe('trusted-native-authority-revoked');
    expect(reads).toEqual(['jobs.source']); expect(f.sourceReads).toEqual(['calendar.integration.inspection', 'calendar.integration.policies']);
    const oldChecks = checks, oldConfirmations = confirmations; armed = false;
    expect((await f.coordinator.inspect(f.session.scope))!.rules[0]!.state).toBe('active');
    expect(checks).toBe(oldChecks); expect(confirmations).toBe(oldConfirmations);
  } finally { gate.resolve(); await inspecting; await f.close(); }
});

test('trusted asynchronous confirmation after owner verification prevents the first private source query', async () => {
  const reads: string[] = []; let armed = false;
  const f = await fixture({ beforeJobsRead(operation) { if (armed) reads.push(operation.name); } }), wake = scheduler();
  try {
    await f.coordinator.start(wake); armed = true; f.sourceReads.length = 0;
    const proofs = f.counters().proofs, acquisitions = f.calendar.stats().acquisitions; let confirmations = 0;
    await expect(f.coordinator.inspect(f.session.scope, { async confirmCurrent() {
      confirmations++; expect(f.counters().proofs).toBe(proofs + 1); expect(f.calendar.stats().activeLeases).toBe(0);
      await Promise.resolve(); throw new Error('trusted-async-confirmation-retired');
    } })).rejects.toThrow('trusted-async-confirmation-retired');
    expect(confirmations).toBe(1); expect(f.calendar.stats().acquisitions).toBe(acquisitions + 1);
    expect(f.sourceReads).toEqual([]); expect(reads).toEqual([]);
    expect(f.coordinator.diagnostics().evidence).toMatchObject({ active: 0, queued: 0 });
    expect(f.coordinator.diagnostics().retainedOwners).toBe(1);
  } finally { await f.close(); }
});

test('a yielding trusted synchronous inspection guard fails closed before owner proof or private reads', async () => {
  const f = await fixture(); try {
    let checks = 0, confirmations = 0; const before = f.calendar.stats().acquisitions;
    await expect(f.coordinator.inspect(f.session.scope, {
      async assertCurrent() { checks++; await Promise.resolve(); throw new Error('consumed-invalid-guard-continuation'); },
      async confirmCurrent() { confirmations++; },
    })).rejects.toMatchObject({ code: 'AUTH_STATE_INVARIANT_FAILED' });
    await Promise.resolve();
    expect(checks).toBe(1); expect(confirmations).toBe(0); expect(f.counters().proofs).toBe(0);
    expect(f.calendar.stats().acquisitions).toBe(before); expect(f.sourceReads).toEqual([]); expect(f.jobs.commands).toHaveLength(0);
    expect(f.coordinator.diagnostics()).toMatchObject({ retainedOwners: 0, evidence: { active: 0, queued: 0 } });
  } finally { await f.close(); }
});
