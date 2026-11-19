/** Native Calendar/Jobs/Torrent composition with spied MEMORY transport opens.
 * This does not qualify createApp, actual owner files, actors or deployment.
 * Every database is :memory: with temp_store=MEMORY; no fixture/output is created.
 */
import { expect, spyOn, test } from 'bun:test';
import { Elysia } from 'elysia';
import { CalendarRuntime, type CalendarRuntimeOptions, type CalendarRuntimeSource } from '../../calendar/runtime';
import { memoryCalendarServiceFixture } from '../../calendar/test-support/memory-service-fixture';
import { CALENDAR_OBSERVATION_JOB, CALENDAR_OBSERVATION_WORKFLOW, calendarObservationPinInput,
  registerCalendarObservationWorkflow } from '../../calendar/integration-catalog';
import { CalendarIntegrationCoordinator } from '../../calendar/integration-coordinator';
import type { CalendarIntegrationOwner } from '../../calendar/integration-runtime';
import type { CalendarIntegrationPolicyView } from '../../calendar/integration-model';
import type { DatabaseCoordinator } from '../../databases/database-coordinator';
import { observeDatabaseCoordinatorCommits } from '../../databases/database-coordinator-commit-notifications';
import { JobsRuntime } from '../../jobs/runtime';
import { JobsError } from '../../jobs/error';
import { defineJob, JobDefinitionCatalog } from '../../jobs/definition';
import { memorySourceJobsFixture, untilMemoryJobs, type MemoryJobsOperation } from '../../jobs/test-support/memory-source-fixture';
import { ZeroAppRuntime } from '../../runtime/zero-app-runtime';
import { ZERO_CALENDAR_SERVICE, ZERO_DATABASE_COMMIT_AUTHORITY, ZERO_DATABASE_MANAGER, ZERO_JOBS_SERVICE,
  ZERO_OBSERVABILITY_RUNTIME, ZERO_SYSTEM_DB, ZERO_WORKFLOW_SERVICE } from '../../runtime/service-keys';
import { SchedulerService } from '../../scheduler/scheduler-service';
import type { StepContext } from '../../workflows/types';
import type { ResolvedConfig } from './types';
import { prepareManagedCalendarCore, mountManagedCalendar } from './app-calendar';
import { prepareManagedJobs } from './app-jobs';
import { prepareManagedCalendarIntegration, withManagedCalendarObservationJobs, type ManagedCalendarIntegrationOwner } from './app-calendar-integration';

function deferred() {
  let finish!: () => void, resolved = false;
  const promise = new Promise<void>(done => { finish = done; });
  return { promise, resolve() { resolved = true; finish(); }, done: () => resolved };
}
const rules = [{ id: 'observe', version: '1', dueOffsetMs: 0, maxLatenessMs: 60_000 }] as const;
function failureCodes(error: unknown): string[] {
  if (error instanceof AggregateError) return error.errors.flatMap(failureCodes);
  return error instanceof JobsError ? [error.code] : [];
}

async function fixture(options: { beforeObservation?: () => Promise<void>;
  beforeJobsRead?: (operation: MemoryJobsOperation) => Promise<void>;
  afterJobsWrite?: (operation: MemoryJobsOperation) => Promise<void> } = {}) {
  const calendar = memoryCalendarServiceFixture({ tenancy: 'single' });
  const runtime = new ZeroAppRuntime();
  const restores: Array<() => void> = [];
  let closeMemory: (() => Promise<void>) | undefined, closeScheduler: (() => Promise<void>) | undefined;
  let removeHints: (() => void) | undefined, stops = 0;
  const cleanup = async () => {
    const failures: unknown[] = [];
    try { await runtime.dispose(); } catch (error) { failures.push(error); }
    removeHints?.();
    for (const restore of [...restores].reverse()) try { restore(); } catch (error) { failures.push(error); }
    restores.length = 0;
    try { await closeMemory?.(); } catch (error) { failures.push(error); }
    try { await calendar.close(); } catch (error) { failures.push(error); }
    try { await closeScheduler?.(); } catch (error) { failures.push(error); }
    if (failures.length) throw new AggregateError(failures, 'Memory managed Calendar fixture cleanup failed.');
  };
  let executor: { execute(context: StepContext): Promise<unknown> } | undefined;
  const contexts: StepContext[] = [];
  try {
  const memory = await memorySourceJobsFixture({ definition: CALENDAR_OBSERVATION_JOB,
    registerWorkflow(registry) { registerCalendarObservationWorkflow(registry, () => ({ async execute(context) {
      contexts.push(context); await options.beforeObservation?.();
      if (!executor) throw new Error('Synthetic native executor not installed.');
      return await executor.execute(context) as never;
    } })); },
    beforeRead: async operation => { await options.beforeJobsRead?.(operation); },
    afterWrite: async operation => { await options.afterJobsWrite?.(operation); },
  });
  closeMemory = () => memory.close();
  const app = new Elysia(), scheduler = new SchedulerService();
  closeScheduler = () => scheduler.close();
  const clock = spyOn(Date, 'now').mockImplementation(() => memory.now());
  restores.push(() => clock.mockRestore());
  const openJobs = spyOn(JobsRuntime, 'open').mockResolvedValue(memory.runtime);
  restores.push(() => openJobs.mockRestore());
  const internal = calendar.runtime as unknown as { owner: DatabaseCoordinator; source: CalendarRuntimeSource | null;
    options: CalendarRuntimeOptions };
  const openCalendarMemory = async (options: CalendarRuntimeOptions) => {
    // Reproduce only native source installation around the actual memory-backed
    // CalendarRuntime. No real open/path probe/process transport is invoked.
    internal.source = await options.source?.(internal.owner) ?? null;
    for (const record of calendar.runtime.integrationOwners()) internal.source?.prepare(record);
    removeHints = observeDatabaseCoordinatorCommits(internal.owner, ref => internal.source?.wake(ref));
    return calendar.runtime;
  };
  const openCalendar = spyOn(CalendarRuntime, 'open').mockImplementation(openCalendarMemory);
  restores.push(() => openCalendar.mockRestore());
    runtime.set(ZERO_SYSTEM_DB, calendar.system);
    runtime.set(ZERO_DATABASE_MANAGER, { systemRuntime: { sqlite: { mode: 'ephemeral' } } } as never);
    runtime.set(ZERO_DATABASE_COMMIT_AUTHORITY, internal.options.authority);
    runtime.set(ZERO_OBSERVABILITY_RUNTIME, { sink: { emit() {} }, store: null, config: { console: false } });
    const config = { projectRoot: '/synthetic-private-calendar-managed-never-created', calendar: calendar.config,
      jobs: withManagedCalendarObservationJobs(memory.config), workflows: { http: false }, migrate: false } as ResolvedConfig;
    const session = calendar.session('owner', { manager: true });
    const resource = await session.api.resources.create({ label: 'PRIVATE_RESOURCE', kind: 'person', timeZone: 'UTC' }, { idempotencyKey: 'seed' });
    const jobs = (await prepareManagedJobs(app, runtime, config, memory.workflows, async () => { stops++; await memory.workflows.dispose(); }))!;
    const prepare = async (signal?: AbortSignal) => {
      const owner = (await prepareManagedCalendarIntegration({ app, runtime, config, workflows: memory.workflows, jobs, rules,
        signal, async startAuth() {} }))!;
      executor = owner; return owner;
    };
    return { app, runtime, config, calendar, memory, scheduler, session, resource, jobs, prepare, contexts, openCalendar, openCalendarMemory,
      stops: () => stops,
      async publish() {
        jobs.sealDependencies(); await memory.workflows.recoverInFlight();
        // Explicit publication double around the real recovered memory service;
        // this does not claim full managed createApp initialization coverage.
        runtime.set(ZERO_WORKFLOW_SERVICE, memory.workflows);
      },
      setExecutor(value: typeof executor) { executor = value; },
      appointment(key = 'appointment') {
        const service = runtime.get(ZERO_CALENDAR_SERVICE) ?? calendar.service;
        return service.forAuthority(session.authority).appointments.create({ title: 'PRIVATE_APPOINTMENT', resourceIds: [resource.id],
          startAt: new Date(memory.now()).toISOString(), endAt: new Date(memory.now() + 60_000).toISOString(), timeZone: 'UTC' }, { idempotencyKey: key });
      },
      close: cleanup,
    };
  } catch (error) {
    try { await cleanup(); }
    catch (failure) { throw new AggregateError([error, failure], 'Memory managed Calendar setup and cleanup failed.'); }
    throw error;
  }
}

test('private managed construction is dormant; exact fixed pins prepare capture without Jobs until post-recovery startup', async () => {
  const f = await fixture(), pin = spyOn(f.memory.bridge, 'pinRegistered');
  try {
    const owner = await f.prepare();
    expect(owner.coordinator.diagnostics()).toMatchObject({ state: 'dormant', retainedOwners: 0, scheduledAt: null });
    expect(f.jobs.service.diagnostics().automaticWakes).toBe(false); expect(f.scheduler.list()).toEqual([]);
    expect(f.memory.commands).toHaveLength(0); expect(pin).not.toHaveBeenCalled();
    expect(f.openCalendar.mock.calls[0]![0].source).toBeDefined();
    const record = f.calendar.runtime.integrationOwners()[0]!;
    await owner.coordinator.ready(record);
    const native = f.calendar.runtime.forIntegrationOwner(record);
    expect((await native.read<CalendarIntegrationPolicyView>('calendar.integration.policy', { ruleId: 'observe' })).state).toBe('activating');
    expect(pin).toHaveBeenCalled(); expect(f.memory.commands).toHaveLength(0); expect(f.calendar.stats().activeLeases).toBe(0);
    await f.appointment();
    await f.publish();
    await owner.start(f.scheduler);
    expect(f.memory.commands.some(command => command.name === 'jobs.source.register')).toBe(true);
    expect(f.memory.commands.some(command => command.name === 'jobs.source.schedule.create')).toBe(true);
    f.memory.enableDiscovery(); f.jobs.start(f.scheduler); await f.jobs.service.tick();
    await untilMemoryJobs(() => f.calendar.sourceRows(f.session.scope, '_calendar_integration_effect_outcomes').length === 1);
    expect(f.contexts).toHaveLength(1); expect(f.contexts[0]!.zero).toBeNull();
  } finally { pin.mockRestore(); await f.close(); }
});

test('private managed startup requires the exact published Workflow owner and makes no Jobs write or timer before admission', async () => {
  const f = await fixture();
  try {
    const owner = await f.prepare();
    await expect(owner.start(f.scheduler)).rejects.toMatchObject({ code: 'CALENDAR_NOT_READY' });
    expect(f.memory.commands).toHaveLength(0); expect(f.scheduler.list()).toEqual([]);
    expect(owner.coordinator.diagnostics().state).toBe('dormant');
    const replacement = {} as never;
    f.runtime.set(ZERO_WORKFLOW_SERVICE, replacement);
    await expect(owner.start(f.scheduler)).rejects.toMatchObject({ code: 'CALENDAR_NOT_READY' });
    expect(f.memory.commands).toHaveLength(0); expect(f.scheduler.list()).toEqual([]);
    f.runtime.clear(ZERO_WORKFLOW_SERVICE, replacement);
    await f.publish(); await owner.start(f.scheduler);
    expect(owner.coordinator.diagnostics().state).toBe('running');
    await owner.close();
    await expect(owner.start(f.scheduler)).rejects.toBeDefined();
  } finally { await f.close(); }
});

test('managed inspection reuses native ownership but exposes only fresh Guardian-authorized reads', async () => {
  const f = await fixture();
  try {
    const owner = await f.prepare(), before = f.memory.commands.length;
    expect(Object.keys(owner.operations).sort()).toEqual(['inspect', 'reactivate', 'retire']);
    const view = owner.inspectionForAuthority(f.session.authority);
    expect(Object.keys(view)).toEqual(['get']); expect(Object.isFrozen(view)).toBe(true);
    const inspection = await view.get();
    expect(inspection).toMatchObject({ rules: [], evidenceOwnerRequired: true, snapshot: 'separate-source-and-jobs-observations' });
    expect(f.memory.commands.length).toBe(before); expect(f.scheduler.list()).toEqual([]);
    const ordinary = f.calendar.session('reader');
    await expect(owner.inspectionForAuthority(ordinary.authority).get()).rejects.toMatchObject({ code: 'CALENDAR_FORBIDDEN' });
    f.session.revoke(); await expect(view.get()).rejects.toBeDefined();
    await owner.close(); await expect(view.get()).rejects.toBeDefined();
  } finally { await f.close(); }
});

test('private Job catalog adds only the exact branded source definition and rejects native-name collisions', async () => {
  const f = await fixture();
  try {
    const bare = { ...f.memory.config, catalog: new JobDefinitionCatalog(f.memory.config.catalog.list().filter(definition => definition !== CALENDAR_OBSERVATION_JOB)) };
    const composed = withManagedCalendarObservationJobs(bare);
    expect(composed.catalog.resolve(CALENDAR_OBSERVATION_JOB)).toBe(CALENDAR_OBSERVATION_JOB);
    expect(CALENDAR_OBSERVATION_JOB.origin).toBe('source'); expect(withManagedCalendarObservationJobs(composed)).toBe(composed);
    expect(() => bare.catalog.resolve(CALENDAR_OBSERVATION_JOB)).toThrow();
    const collision = defineJob({ name: CALENDAR_OBSERVATION_JOB.name, version: 'other', origin: 'source', access: 'admin',
      workflow: { name: CALENDAR_OBSERVATION_WORKFLOW, version: 1 }, parseInput: input => input });
    expect(() => withManagedCalendarObservationJobs({ ...bare, catalog: new JobDefinitionCatalog([collision]) }))
      .toThrow(expect.objectContaining({ code: 'CALENDAR_CONFIG_INVALID' }));
  } finally { await f.close(); }
});

test('retained native observation evidence executes through a newly prepared dormant owner before discovery or startup', async () => {
  const entered = deferred(), release = deferred();
  const f = await fixture({ beforeObservation: async () => { entered.resolve(); await release.promise; } });
  let predecessor: CalendarIntegrationCoordinator | undefined;
  try {
    predecessor = new CalendarIntegrationCoordinator({ rules, owner: record => f.calendar.runtime.forIntegrationOwner(record),
      discover: ({ after, limit }) => f.calendar.runtime.integrationOwnerPage({ ...(after === undefined ? {} : { after }), limit }),
      resolveOwner: scope => f.calendar.runtime.integrationOwnerForScope(scope), jobs: f.memory.service,
      inspect: (id, scope) => f.memory.workflows.getInstance(id, scope),
      pin: (owner: CalendarIntegrationOwner) => f.memory.bridge.pinRegistered(f.memory.bridge.system({ principal: 'calendar:observation:catalog',
        reason: 'Synthetic predecessor fixed native graph', scope: owner.scope }), CALENDAR_OBSERVATION_WORKFLOW, calendarObservationPinInput(), 1),
    });
    const record = f.calendar.runtime.integrationOwners()[0]!;
    await predecessor.ready(record); await f.appointment();
    await predecessor.start({ scheduleAt() { return { cancel() {} }; } });
    f.memory.enableDiscovery(); await f.memory.tick(); await untilMemoryJobs(entered.done);
    await predecessor.drain(); await predecessor.drainPhysicalIntake();
    // Same retained native Jobs/Torrent records, a fresh managed owner. This is
    // recovery-path composition evidence, not a file/process restart claim.
    const owner = await f.prepare();
    expect(owner.coordinator.diagnostics()).toMatchObject({ state: 'dormant', retainedOwners: 0 });
    expect(await owner.execute(f.contexts[0]! as Parameters<ManagedCalendarIntegrationOwner['execute']>[0])).toMatchObject({ state: 'observed' });
    expect(owner.coordinator.diagnostics()).toMatchObject({ state: 'dormant', retainedOwners: 0 });
    expect(f.calendar.sourceRows(f.session.scope, '_calendar_integration_effect_outcomes')).toHaveLength(1);
    release.resolve();
  } finally {
    release.resolve();
    try { await f.close(); } finally { await predecessor?.closeEvidence(); await predecessor?.drainPhysicalEvidence(); }
  }
});

test('shared cleanup retains Calendar below a late accepted Jobs writer until its actual callback settles', async () => {
  const entered = deferred(), release = deferred();
  let pause = true;
  const f = await fixture({ afterJobsWrite: async operation => {
    if (pause && operation.name === 'jobs.source.schedule.create') { entered.resolve(); await release.promise; }
  } });
  let starting: Promise<void> | undefined, closing: Promise<void> | undefined;
  try {
    const owner = await f.prepare();
    await owner.coordinator.ready(f.calendar.runtime.integrationOwners()[0]!); await f.appointment();
    await f.publish();
    starting = owner.start(f.scheduler); void starting.catch(() => {}); await untilMemoryJobs(entered.done);
    let finished = false; closing = f.runtime.dispose().then(() => { finished = true; }, error => { finished = true; throw error; });
    void closing.catch(() => {});
    await untilMemoryJobs(() => owner.coordinator.diagnostics().state === 'quiescing');
    expect(finished).toBe(false); expect(f.stops()).toBe(0);
    expect(f.calendar.runtime.diagnostics().state).toBe('ready');
    expect((f.memory.runtime.diagnostics() as unknown as { closed: boolean }).closed).toBe(false);
    expect(f.runtime.get(ZERO_CALENDAR_SERVICE)).toBeNull();
    pause = false; release.resolve(); await starting.catch(() => {});
    // Interrupting accepted startup is truthfully unknown, even though all
    // physical callbacks settle and both providers can then close safely.
    const failure = await closing.catch(error => error);
    expect(failure).toBeInstanceOf(AggregateError);
    expect(failureCodes(failure)).toContain('JOBS_OUTCOME_UNKNOWN');
    expect(f.stops()).toBe(1); expect(f.calendar.runtime.diagnostics().state).toBe('closed');
  } finally {
    pause = false; release.resolve(); await starting?.catch(() => {});
    try { await closing?.catch(() => {}); } finally { await f.close().catch(() => {}); }
  }
});

test('publication lost during native startup quiesces fresh eligibility without erasing accepted Jobs evidence', async () => {
  const entered = deferred(), release = deferred(); let pause = true;
  const f = await fixture({ afterJobsWrite: async operation => {
    if (pause && operation.name === 'jobs.source.schedule.create') { entered.resolve(); await release.promise; }
  } });
  let starting: Promise<void> | undefined;
  try {
    const owner = await f.prepare();
    await owner.coordinator.ready(f.calendar.runtime.integrationOwners()[0]!); await f.appointment();
    await f.publish(); starting = owner.start(f.scheduler); void starting.catch(() => {});
    await untilMemoryJobs(entered.done);
    f.runtime.clear(ZERO_WORKFLOW_SERVICE, f.memory.workflows);
    expect(f.runtime.get(ZERO_WORKFLOW_SERVICE)).toBeNull();
    pause = false; release.resolve();
    await expect(starting).rejects.toMatchObject({ code: 'CALENDAR_NOT_READY' });
    expect(owner.coordinator.diagnostics()).toMatchObject({ state: 'quiescing', scheduledAt: null });
    expect(f.memory.commands.filter(operation => operation.name === 'jobs.source.schedule.create')).toHaveLength(1);
    expect(f.calendar.sourceRows(f.session.scope, '_calendar_integration_receipts')).toHaveLength(1);
    expect((f.memory.runtime.diagnostics() as unknown as { closed: boolean }).closed).toBe(false);
    expect(f.calendar.runtime.diagnostics().state).toBe('ready');
  } finally { pause = false; release.resolve(); await starting?.catch(() => {}); await f.close(); }
});

test('Calendar raw evidence callback outlives its cancelled Torrent caller without final Jobs or Calendar provider closure', async () => {
  const entered = deferred(), release = deferred();
  let pause = true;
  const f = await fixture({ beforeJobsRead: async operation => {
    if (pause && operation.name === 'jobs.source.execution') { entered.resolve(); await release.promise; }
  } });
  let closing: Promise<void> | undefined;
  try {
    const owner = await f.prepare();
    await owner.coordinator.ready(f.calendar.runtime.integrationOwners()[0]!); await f.appointment();
    await f.publish(); await owner.start(f.scheduler);
    f.memory.enableDiscovery(); f.jobs.start(f.scheduler); await f.jobs.service.tick(); await untilMemoryJobs(entered.done);
    let finished = false; closing = f.runtime.dispose().then(() => { finished = true; });
    await untilMemoryJobs(() => f.stops() === 1);
    await untilMemoryJobs(() => owner.coordinator.diagnostics().evidence.state === 'closing');
    expect(finished).toBe(false); expect(owner.coordinator.diagnostics().evidence.active).toBe(1);
    expect(f.runtime.get(ZERO_JOBS_SERVICE)).toBe(f.jobs.service);
    expect(f.calendar.runtime.diagnostics().state).toBe('ready');
    expect((f.memory.runtime.diagnostics() as unknown as { closed: boolean }).closed).toBe(false);
    pause = false; release.resolve(); await closing;
    expect(f.calendar.runtime.diagnostics().state).toBe('closed');
    expect((f.memory.runtime.diagnostics() as unknown as { closed: boolean }).closed).toBe(true);
  } finally { pause = false; release.resolve(); await closing; await f.close(); }
});

test('ordinary core Calendar still has no native readiness source and disabled mounting touches no dependency', async () => {
  const f = await fixture();
  try {
    await prepareManagedCalendarCore({ app: f.app, runtime: f.runtime, config: f.config, async startAuth() {} });
    expect(f.openCalendar.mock.calls[0]![0].source).toBeUndefined();
    const guarded = new Proxy({}, { get() { throw new Error('Disabled Calendar inspected dependency.'); } });
    await mountManagedCalendar({ app: guarded as Elysia, runtime: guarded as ZeroAppRuntime,
      config: { calendar: false } as ResolvedConfig, async startAuth() { throw new Error('Disabled Calendar started auth.'); } });
  } finally { await f.close(); }
});

test('partial Calendar route preparation closes its providers and dormant Jobs without stopping its own Workflow initializer', async () => {
  const f = await fixture(), use = spyOn(f.app, 'use').mockImplementation(() => { throw new Error('Synthetic Calendar route failure.'); });
  try {
    await expect(f.prepare()).rejects.toThrow('Synthetic Calendar route failure.');
    expect(f.stops()).toBe(0); f.memory.bridge.assertRuntimeCurrent();
    expect(f.runtime.get(ZERO_CALENDAR_SERVICE)).toBeNull(); expect(f.runtime.get(ZERO_JOBS_SERVICE)).toBeNull();
    expect(f.calendar.runtime.diagnostics().state).toBe('closed');
    expect((f.memory.runtime.diagnostics() as unknown as { closed: boolean }).closed).toBe(true);
  } finally { use.mockRestore(); await f.close(); }
});

test('a refused final Calendar provider close retains the exact retired owner and permits native close retry', async () => {
  const f = await fixture();
  const original = f.calendar.runtime.close.bind(f.calendar.runtime); let attempts = 0;
  const close = spyOn(f.calendar.runtime, 'close').mockImplementation(async () => {
    attempts++; if (attempts === 1) throw new Error('Synthetic provider physical settlement not confirmed.');
    await original();
  });
  try {
    const owner = (await prepareManagedCalendarCore({ app: f.app, runtime: f.runtime, config: f.config, async startAuth() {} }))!;
    await expect(owner.closeProvider()).rejects.toBeInstanceOf(AggregateError);
    expect(f.runtime.get(ZERO_CALENDAR_SERVICE)).toBeNull(); expect(f.calendar.runtime.diagnostics().state).toBe('ready');
    await owner.closeProvider(); expect(attempts).toBe(2); expect(f.calendar.runtime.diagnostics().state).toBe('closed');
  } finally { close.mockRestore(); await f.close(); }
});

test('route failure plus refused provider close keeps partial Calendar ownership for shared preparation cleanup retry', async () => {
  const f = await fixture(), original = f.calendar.runtime.close.bind(f.calendar.runtime); let attempts = 0;
  const close = spyOn(f.calendar.runtime, 'close').mockImplementation(async () => {
    attempts++; if (attempts === 1) throw new Error('Synthetic partial provider close refusal.'); await original();
  });
  const use = spyOn(f.app, 'use').mockImplementation(() => { throw new Error('Synthetic Calendar route publication failed.'); });
  try {
    await expect(f.prepare()).rejects.toBeInstanceOf(AggregateError);
    expect(attempts).toBe(2); expect(f.stops()).toBe(0); f.memory.bridge.assertRuntimeCurrent();
    expect(f.calendar.runtime.diagnostics().state).toBe('closed'); expect(f.runtime.get(ZERO_CALENDAR_SERVICE)).toBeNull();
    expect((f.memory.runtime.diagnostics() as unknown as { closed: boolean }).closed).toBe(true);
  } finally { use.mockRestore(); close.mockRestore(); await f.close(); }
});

test('cancelled preparation waits its ignored-abort physical factory and performs no recursive Workflow stop', async () => {
  const f = await fixture(), entered = deferred(), release = deferred(), abort = new AbortController();
  f.openCalendar.mockImplementation(async options => { entered.resolve(); await release.promise; return f.openCalendarMemory(options); });
  let preparation: Promise<ManagedCalendarIntegrationOwner> | undefined;
  try {
    preparation = f.prepare(abort.signal); void preparation.catch(() => {});
    await untilMemoryJobs(entered.done); abort.abort();
    let finished = false; void preparation.then(() => { finished = true; }, () => { finished = true; });
    await Promise.resolve(); expect(finished).toBe(false);
    expect((f.memory.runtime.diagnostics() as unknown as { closed: boolean }).closed).toBe(false);
    release.resolve(); await expect(preparation).rejects.toBeDefined();
    expect(f.stops()).toBe(0); f.memory.bridge.assertRuntimeCurrent();
    expect(f.calendar.runtime.diagnostics().state).toBe('closed');
  } finally { release.resolve(); await preparation?.catch(() => {}); await f.close(); }
});
