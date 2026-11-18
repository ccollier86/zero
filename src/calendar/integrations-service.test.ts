/** Actual Guardian/calendar realm -> source Jobs realm -> MAC-sealed Torrent -> calendar cutoff.
 * All three databases are native in-memory SQLite. Physical process/file transport
 * is explicitly simulated by the shared fixtures; this is NOT actor/package qualification.
 */
import { expect, spyOn, test } from 'bun:test';
import { serviceDataScopeKey } from '../auth/service-data-scope';
import { DatabaseError } from '../databases/database-error';
import { JobsError } from '../jobs/error';
import { createTrustedJobSource } from '../jobs/source-authority';
import { jobSourceId, jobSourcePrincipal, type JobSourceContract } from '../jobs/source-model';
import { memorySourceJobsFixture, untilMemoryJobs } from '../jobs/test-support/memory-source-fixture';
import type { StepContext } from '../workflows/types';
import { CalendarIntegrationDispatcher } from './integration-dispatcher';
import { CalendarIntegrationPolicyController } from './integration-controller';
import { CALENDAR_OBSERVATION_JOB, CALENDAR_OBSERVATION_WORKFLOW, calendarObservationPinInput, calendarObservationPolicy, registerCalendarObservationWorkflow } from './integration-catalog';
import { CalendarError } from './error';
import type { CalendarIntegrationEffectView, CalendarIntegrationIntentView, CalendarIntegrationPolicySpec, CalendarIntegrationPolicyView } from './integration-model';
import { observeCalendarIntegration, type CalendarIntegrationObservationResult } from './integration-observation';
import type { CalendarIntegrationOwner } from './integration-runtime';
import { calendarRealm } from './realm';
import { memoryCalendarServiceFixture } from './test-support/memory-service-fixture';

async function fixture(options: {
  nativeCatalog?: boolean;
  tenancy?: 'single' | 'multi';
  beforeJobsWrite?: (name: string) => void | Promise<void>;
  afterJobsWrite?: (name: string) => void | Promise<void>;
  beforeObservation?: () => void | Promise<void>;
  afterCutoff?: () => void | Promise<void>;
  twice?: boolean;
  loseCalendarAcknowledgment?: boolean;
  loseEffectAcknowledgment?: 'admit' | 'settle';
  delayEffectAdmissionMs?: number;
  maxLatenessMs?: number;
} = {}) {
  let loseAck = options.loseCalendarAcknowledgment ?? false;
  let loseEffect = options.loseEffectAcknowledgment;
  let delay = options.delayEffectAdmissionMs;
  const calendar = memoryCalendarServiceFixture({ tenancy: options.tenancy ?? 'single', beforeDispatch(operation) {
    if (delay && operation.type === 'command' && operation.name === 'calendar.integration.effect.admit') { jobs!.advance(delay); delay = undefined; }
  }, afterCommand(operation) {
    if (loseAck && operation.type === 'command' && operation.name === 'calendar.integration.ack') {
      loseAck = false; throw new DatabaseError('DATABASE_OPERATION_TIMEOUT', 'Synthetic lost source acknowledgment.', { outcome: 'unknown' });
    }
    if (loseEffect && operation.type === 'command' && operation.name === 'calendar.integration.effect.' + loseEffect) {
      loseEffect = undefined; throw new DatabaseError('DATABASE_OPERATION_TIMEOUT', 'Synthetic lost effect acknowledgment.', { outcome: 'unknown' });
    }
  } });
  let jobs: Awaited<ReturnType<typeof memorySourceJobsFixture>> | undefined, dispatcher: CalendarIntegrationDispatcher | undefined;
  const clock = spyOn(Date, 'now').mockImplementation(() => jobs?.now() ?? Date.parse('2026-12-01T00:00:00.000Z'));
  const observations: CalendarIntegrationObservationResult[] = [], activityErrors: unknown[] = [];
  const captured: StepContext[] = [];
  try {
    const session = calendar.session('synthetic-calendar-user', { manager: true });
    const resource = await session.api.resources.create({ label: 'PRIVATE_RESOURCE', kind: 'person', timeZone: 'UTC' }, { idempotencyKey: 'resource' });
    const owner = calendar.runtime.forIntegrationOwner(calendar.runtime.integrationOwners()[0]!);
    let observationOwner = owner;
    if (options.afterCutoff) observationOwner = { ...owner, async command(name, input, commandOptions) {
      const result = await owner.command(name, input, commandOptions);
      if (name === 'calendar.integration.effect.admit') await options.afterCutoff!();
      return result;
    } } as CalendarIntegrationOwner;
    jobs = await memorySourceJobsFixture({
      ...(options.nativeCatalog ? { definition: CALENDAR_OBSERVATION_JOB, registerWorkflow: (registry, activity) => registerCalendarObservationWorkflow(registry, () => ({
        async execute(context) { await activity(context); return observations.at(-1)!; },
      })) } satisfies Partial<Parameters<typeof memorySourceJobsFixture>[0]> : {}),
      tenancy: options.tenancy ?? 'single',
      beforeWrite: operation => options.beforeJobsWrite?.(operation.name),
      afterWrite: operation => options.afterJobsWrite?.(operation.name),
      activity: async (_input, context) => {
        captured.push(context);
        try {
          expect(calendar.stats().activeLeases).toBe(0);
          await options.beforeObservation?.();
          const deps = { owner: observationOwner, inspect: jobs!.workflows.get.bind(jobs!.workflows), executions: sourceJobs.executions, now: jobs!.now };
          observations.push(await observeCalendarIntegration(deps, context));
          if (options.twice) observations.push(await observeCalendarIntegration(deps, context));
        } catch (error) { activityErrors.push(error); throw error; }
      },
    });
    // The native builder chooses stable per-rule identity before pinning the same
    // fixed graph under its actual SYSTEM source principal. No fake graph runs.
    const placeholder = { name: CALENDAR_OBSERVATION_WORKFLOW, version: 1, definitionId: 'unused', versionId: 'unused', fingerprint: '0'.repeat(64) };
    const rule = { id: 'observation', version: '1', dueOffsetMs: 0, maxLatenessMs: options.maxLatenessMs ?? 60_000 };
    const identity = options.nativeCatalog ? calendarObservationPolicy(owner, rule, placeholder).source.identity : { domain: 'calendar.observation', databaseId: owner.owner.id, ownerId: owner.owner.owner_id,
      rootHash: owner.owner.root_hash, scopeId: serviceDataScopeKey(owner.scope) };
    const pinInput = options.nativeCatalog ? calendarObservationPinInput() : {};
    const pin = jobs.bridge.pin(jobs.bridge.system({ principal: jobSourcePrincipal(jobSourceId(identity)), reason: 'Synthetic calendar observation', scope: owner.scope }),
      jobs.definition.workflow.name, pinInput, jobs.definition.workflow.version);
    const source: JobSourceContract = { identity, realmFingerprint: calendarRealm.fingerprint, policyVersion: 'synthetic-A', semanticsVersion: 'observation-v1',
      definition: { name: jobs.definition.name, version: jobs.definition.version, fingerprint: jobs.definition.fingerprint }, workflow: pin };
    const policy: CalendarIntegrationPolicySpec = options.nativeCatalog ? calendarObservationPolicy(owner, rule, pin) : { ruleId: 'observation', ruleVersion: '1', adapter: 'observation-v1', source, dueOffsetMs: 0, maxLatenessMs: rule.maxLatenessMs };
    const installed = await owner.command<CalendarIntegrationPolicyView>('calendar.integration.policy.install', { policy, expectedEpoch: 0, now: jobs.now() }, { idempotencyKey: 'install-observation' });
    const assertEligible = () => owner.assertCurrent();
    const capability = createTrustedJobSource({ identity, scope: owner.scope, realmFingerprint: policy.source.realmFingerprint, definition: jobs.definition,
      policyVersion: policy.source.policyVersion, semanticsVersion: policy.source.semanticsVersion, signal: owner.signal,
      assertOwnerCurrent: () => owner.assertCurrent(), confirmOwnerCurrent: () => owner.verify(), assertEligible,
      async confirmEligible() {
        const selected = await owner.read<CalendarIntegrationPolicyView>('calendar.integration.policy', { ruleId: policy.ruleId });
        if (selected.epoch !== installed.epoch || selected.state === 'retired') throw new JobsError('JOBS_AUTHORITY_RETIRED');
      } });
    const sourceJobs = jobs.service.forSource(capability);
    const registration = await sourceJobs.registration.activate({ expectedRevision: 0, idempotencyKey: 'activate-observation', pinInput });
    await owner.command('calendar.integration.policy.activate', { ruleId: policy.ruleId, epoch: installed.epoch, registration }, { idempotencyKey: 'ack-activation' });
    dispatcher = new CalendarIntegrationDispatcher({ store: owner, jobs: sourceJobs, now: jobs.now });
    const create = (key = 'appointment', offsetMs = 0) => session.api.appointments.create({ title: 'PRIVATE_APPOINTMENT_TITLE', resourceIds: [resource.id],
      startAt: new Date(jobs!.now() + offsetMs).toISOString(), endAt: new Date(jobs!.now() + offsetMs + 3_600_000).toISOString(), timeZone: 'UTC', bufferBeforeMinutes: 0, bufferAfterMinutes: 0 },
    { idempotencyKey: key });
    const intent = async (): Promise<CalendarIntegrationIntentView> => {
      const row = calendar.sourceRows(session.scope, '_calendar_integration_intents').at(-1);
      if (!row) throw new Error('Expected committed synthetic integration intent.');
      return owner.read<CalendarIntegrationIntentView>('calendar.integration.intent', { id: row.id });
    };
    const close = async () => {
      try { await dispatcher!.close(); }
      finally { try { await jobs!.close(); } finally { try { await calendar.close(); } finally { clock.mockRestore(); } } }
    };
    return { calendar, jobs, session, resource, owner, sourceJobs, registration, policy, installed, dispatcher, observations, activityErrors, captured, create, intent, close };
  } catch (error) {
    try { await dispatcher?.close(); } finally { try { await jobs?.close(); } finally { try { await calendar.close(); } finally { clock.mockRestore(); } } }
    throw error;
  }
}

for (const tenancy of ['single', 'multi'] as const) test(`actual source Jobs/Torrent observation executes once, without leases/private content (${tenancy})`, async () => {
  const f = await fixture({ twice: true, tenancy }); try {
    const accepted = await f.create(), intent = await f.intent();
    expect(intent).toMatchObject({ appointmentId: accepted.id, appointmentRevision: 1, eligibility: 'current', state: 'pending', createAttempted: false });
    expect(JSON.stringify(intent)).not.toContain('PRIVATE_APPOINTMENT_TITLE'); expect(JSON.stringify(intent)).not.toContain('PRIVATE_RESOURCE');
    expect(await f.dispatcher.runBatch()).toMatchObject({ claimed: 1, accepted: 1, deferred: 0 });
    expect((await f.intent()).state).toBe('accepted');
    // Schedule acceptance alone is deliberately NOT named "Torrent accepted" or "delivered".
    expect(f.calendar.sourceRows(f.session.scope, '_calendar_integration_effect_admissions')).toHaveLength(0);
    await f.jobs.tick(); await untilMemoryJobs(() => f.observations.length === 2);
    expect(f.activityErrors).toEqual([]); expect(f.observations).toEqual([{ intentId: intent.id, state: 'observed' }, { intentId: intent.id, state: 'observed' }]);
    expect(f.calendar.sourceRows(f.session.scope, '_calendar_integration_effect_admissions')).toHaveLength(1);
    expect(f.calendar.sourceRows(f.session.scope, '_calendar_integration_effect_outcomes')).toHaveLength(1);
    expect(f.jobs.calls).toEqual([intent.input]);
    expect(await f.dispatcher.runBatch()).toMatchObject({ claimed: 0 });
    expect(f.calendar.stats().activeLeases).toBe(0); expect(f.jobs.stats().activeLeases).toBe(0);
  } finally { await f.close(); }
});

for (const tenancy of ['single', 'multi'] as const) test(`closed native observation catalog executes the pinned workflow, not a substitute (${tenancy})`, async () => {
  const f = await fixture({ nativeCatalog: true, tenancy }); try {
    expect(f.jobs.definition.name).toBe(CALENDAR_OBSERVATION_JOB.name);
    expect(f.policy.source.workflow.name).toBe(CALENDAR_OBSERVATION_WORKFLOW);
    await f.create(); const intent = await f.intent();
    expect(await f.dispatcher.runBatch()).toMatchObject({ accepted: 1 });
    await f.jobs.tick(); await untilMemoryJobs(() => f.observations.length === 1);
    expect(f.activityErrors).toEqual([]); expect(f.jobs.calls).toEqual([intent.input]);
    expect(f.observations).toEqual([{ intentId: intent.id, state: 'observed' }]);
    expect(f.captured[0]!.zero).toBeNull(); expect(f.captured[0]!.memory).toBeUndefined();
    expect(f.calendar.sourceRows(f.session.scope, '_calendar_integration_effect_outcomes')).toHaveLength(1);
    expect(f.calendar.stats().activeLeases).toBe(0); expect(f.jobs.stats().activeLeases).toBe(0);
  } finally { await f.close(); }
});

/** Real native capability factory: controller eligibility and physical source
 * ownership are separate. It cannot replace either with a request user. */
function controllerFor(f: Awaited<ReturnType<typeof fixture>>) {
  return new CalendarIntegrationPolicyController({ owner: f.owner, now: f.jobs.now, jobs: (policy, guards) => f.jobs.service.forSource(createTrustedJobSource({
    identity: policy.source.identity, scope: f.owner.scope, realmFingerprint: policy.source.realmFingerprint, definition: f.jobs.definition,
    policyVersion: policy.source.policyVersion, semanticsVersion: policy.source.semanticsVersion, signal: f.owner.signal,
    assertOwnerCurrent: f.owner.assertCurrent, confirmOwnerCurrent: f.owner.verify, ...guards,
  })) });
}

test('native controller adopts retained registration without a new Jobs generation, then retires truthfully after restart', async () => {
  const f = await fixture({ nativeCatalog: true }); let controller = controllerFor(f);
  try {
    const adopted = await controller.activate(f.policy.ruleId);
    expect(adopted.result).toEqual({ state: 'accepted', registration: f.registration });
    expect(adopted.control.expectedRegistration).toEqual(f.registration);
    expect(adopted.policy.state).toBe('active');
    expect(await controller.prepare(f.policy)).toEqual(adopted.policy);
    await controller.close(); controller = controllerFor(f);
    const again = await controller.activate(f.policy.ruleId);
    expect(again.control.jobsKey).toBe(adopted.control.jobsKey);
    expect(again.result).toEqual(adopted.result);
    expect(f.jobs.rows(f.owner.scope, 'job_schedules')).toHaveLength(0);
    const retired = await controller.retire(f.policy.ruleId);
    expect(retired.result).toBe('retired'); expect(retired.policy.state).toBe('retired');
    expect(retired.registration).toEqual({ ...f.registration, state: 'retired', revision: f.registration.revision + 1 });
    expect(await f.sourceJobs.registration.get()).toEqual(retired.registration);
    expect(await controller.retire(f.policy.ruleId)).toEqual(retired);
    expect(f.calendar.stats().activeLeases).toBe(0); expect(f.jobs.stats().activeLeases).toBe(0);
  } finally { try { await controller.close(); } finally { await f.close(); } }
});

test('native retirement captures actual retained Jobs policy A even when local policy B was never activated', async () => {
  const f = await fixture({ nativeCatalog: true }); const controller = controllerFor(f);
  try {
    const next = { ...f.policy, ruleVersion: '2', source: { ...f.policy.source, policyVersion: 'unapplied-B' } };
    expect((await controller.prepare(next)).state).toBe('activating');
    expect(await f.sourceJobs.registration.get()).toEqual(f.registration);
    const retired = await controller.retire(f.policy.ruleId);
    expect(retired.policy.epoch).toBe(2); expect(retired.policy.state).toBe('retired');
    expect(retired.control!.expectedRegistration).toEqual(f.registration);
    expect(retired.registration).toMatchObject({ policyHash: f.registration.policyHash, generation: f.registration.generation, state: 'retired' });
    expect(f.calendar.sourceRows(f.session.scope, '_calendar_integration_control_results')).toHaveLength(1);
  } finally { try { await controller.close(); } finally { await f.close(); } }
});

test('lost actual Jobs activation acknowledgment reconciles the original durable control after controller replacement', async () => {
  let armed = false;
  const f = await fixture({ nativeCatalog: true, afterJobsWrite(name) { if (armed && name === 'jobs.source.register') { armed = false; throw new Error('Synthetic lost registration acknowledgment.'); } } });
  let controller = controllerFor(f);
  try {
    armed = true;
    await expect(controller.activate(f.policy.ruleId)).rejects.toMatchObject({ code: 'JOBS_OUTCOME_UNKNOWN' });
    const pending = await f.owner.read<any>('calendar.integration.controlEvidence', { ruleId: f.policy.ruleId });
    expect(pending.pending).toMatchObject({ action: 'activate', result: null, lastFailure: 'JOBS_OUTCOME_UNKNOWN' });
    const key = pending.pending.jobsKey;
    await controller.close(); controller = controllerFor(f);
    const recovered = await controller.activate(f.policy.ruleId);
    expect(recovered.control.jobsKey).toBe(key); expect(recovered.result).toEqual({ state: 'accepted', registration: f.registration });
    expect((await f.owner.read<any>('calendar.integration.controlEvidence', { ruleId: f.policy.ruleId })).pending).toBeNull();
    expect(f.calendar.sourceRows(f.session.scope, '_calendar_integration_controls')).toHaveLength(1);
    expect(f.calendar.sourceRows(f.session.scope, '_calendar_integration_control_results')).toHaveLength(1);
    expect(f.jobs.rows(f.owner.scope, 'job_schedules')).toHaveLength(0);
  } finally { try { await controller.close(); } finally { await f.close(); } }
});

test('retiring a captured policy with no Jobs registration records no invented downstream retirement', async () => {
  const f = await fixture({ nativeCatalog: true }); const controller = controllerFor(f);
  try {
    const next = { ...f.policy, ruleId: 'unregistered', source: { ...f.policy.source, identity: { ...f.policy.source.identity, domain: 'calendar.unregistered' } } };
    await controller.prepare(next);
    const retired = await controller.retire(next.ruleId);
    expect(retired).toMatchObject({ result: 'no-registration', control: null, registration: null, policy: { state: 'retired' } });
    expect(f.calendar.sourceRows(f.session.scope, '_calendar_integration_controls')).toHaveLength(0);
    expect(f.calendar.sourceRows(f.session.scope, '_calendar_integration_control_results')).toHaveLength(0);
    expect((await f.owner.read<any>('calendar.integration.controlEvidence', { ruleId: next.ruleId })).registered).toBe(false);
  } finally { try { await controller.close(); } finally { await f.close(); } }
});

test('retirement during an actual committed activation acknowledgment wait retains historical acceptance without reviving intake', async () => {
  let armed = false, entered!: () => void, release!: () => void;
  const arrived = new Promise<void>(resolve => { entered = resolve; }), gate = new Promise<void>(resolve => { release = resolve; });
  const f = await fixture({ nativeCatalog: true, async afterJobsWrite(name) { if (armed && name === 'jobs.source.register') { armed = false; entered(); await gate; } } });
  const controller = controllerFor(f);
  try {
    armed = true;
    const activating = controller.activate(f.policy.ruleId).then(value => ({ value }), error => ({ error }));
    await arrived; const retiring = controller.retire(f.policy.ruleId); release();
    expect(await activating).toMatchObject({ error: { code: 'JOBS_OUTCOME_UNKNOWN' } });
    const retired = await retiring;
    expect(retired.policy.state).toBe('retired'); expect(retired.result).toBe('retired');
    expect(retired.registration!.policyHash).toBe(f.registration.policyHash);
    const results = f.calendar.sourceRows(f.session.scope, '_calendar_integration_control_results');
    expect(results).toHaveLength(2); expect(results.every(row => row.state === 'accepted')).toBe(true);
    expect((await f.owner.read<any>('calendar.integration.policy', { ruleId: f.policy.ruleId })).state).toBe('retired');
    expect((await f.owner.read<any>('calendar.integration.controlEvidence', { ruleId: f.policy.ruleId })).pending).toBeNull();
    await f.create(); expect(f.calendar.sourceRows(f.session.scope, '_calendar_integration_intents')).toHaveLength(0);
  } finally { release(); try { await controller.close(); } finally { await f.close(); } }
});

test('lost actual Jobs retirement acknowledgment is recovered by its original key without a new retirement', async () => {
  let armed = false;
  const f = await fixture({ nativeCatalog: true, afterJobsWrite(name) { if (armed && name === 'jobs.source.retire') { armed = false; throw new Error('Synthetic lost retirement acknowledgment.'); } } });
  let controller = controllerFor(f);
  try {
    armed = true; await expect(controller.retire(f.policy.ruleId)).rejects.toMatchObject({ code: 'JOBS_OUTCOME_UNKNOWN' });
    const pending = await f.owner.read<any>('calendar.integration.controlEvidence', { ruleId: f.policy.ruleId });
    expect(pending.pending).toMatchObject({ action: 'retire', result: null, lastFailure: 'JOBS_OUTCOME_UNKNOWN' });
    expect((await f.owner.read<any>('calendar.integration.policy', { ruleId: f.policy.ruleId })).state).toBe('retired');
    await controller.close(); controller = controllerFor(f);
    const recovered = await controller.retire(f.policy.ruleId);
    expect(recovered.result).toBe('retired'); expect(recovered.control!.jobsKey).toBe(pending.pending.jobsKey);
    expect(recovered.registration).toEqual({ ...f.registration, state: 'retired', revision: f.registration.revision + 1 });
    expect(f.calendar.sourceRows(f.session.scope, '_calendar_integration_controls')).toHaveLength(1);
    expect(f.calendar.sourceRows(f.session.scope, '_calendar_integration_control_results')).toHaveLength(1);
  } finally { try { await controller.close(); } finally { await f.close(); } }
});

test('replacement controller cannot reactivate past a committed local retirement whose downstream control never started', async () => {
  const f = await fixture({ nativeCatalog: true }); const controller = controllerFor(f);
  try {
    // Deliberate crash boundary: local retirement was durable, but no separate
    // Jobs retirement intent exists yet. New process state must not forget it.
    await f.owner.command('calendar.integration.policy.retire', { ruleId: f.policy.ruleId, epoch: f.installed.epoch }, { idempotencyKey: 'interrupted-retirement' });
    await expect(controller.prepare(f.policy)).rejects.toMatchObject({ code: 'CALENDAR_NOT_READY' });
    expect(await f.sourceJobs.registration.get()).toEqual(f.registration);
    expect((await f.owner.read<any>('calendar.integration.policy', { ruleId: f.policy.ruleId })).epoch).toBe(1);
    expect((await controller.retire(f.policy.ruleId)).result).toBe('retired');
    expect((await controller.prepare(f.policy)).epoch).toBe(2);
    const reactivated = await controller.activate(f.policy.ruleId);
    expect(reactivated.result).toMatchObject({ state: 'accepted', registration: { state: 'active', generation: 2, revision: 3 } });
  } finally { try { await controller.close(); } finally { await f.close(); } }
});

test('a Jobs commit with lost acknowledgment reconciles its exact source key and dispatches only one workflow', async () => {
  let lose = true;
  const f = await fixture({ afterJobsWrite(name) { if (lose && name === 'jobs.source.schedule.create') { lose = false; throw new Error('Synthetic lost Jobs acknowledgment.'); } } });
  try {
    await f.create(); const original = await f.intent();
    expect(await f.dispatcher.runBatch()).toMatchObject({ claimed: 1, deferred: 1 });
    expect((await f.intent()).state).toBe('unknown');
    expect(await f.sourceJobs.receipts.get(original.createKey)).toMatchObject({ sourceId: f.registration.id, policyGeneration: f.registration.generation });
    f.jobs.advance(1001); expect(await f.dispatcher.runBatch()).toMatchObject({ accepted: 1 });
    expect((await f.intent()).createKey).toBe(original.createKey);
    await f.jobs.tick(); await untilMemoryJobs(() => f.observations.length === 1);
    expect(f.jobs.calls).toHaveLength(1); expect(f.jobs.rows(f.owner.scope, 'job_schedules')).toHaveLength(1);
    expect(f.activityErrors).toEqual([]);
  } finally { await f.close(); }
});

test('a lost calendar acknowledgment preserves the real accepted Jobs result, not a fresh logical schedule', async () => {
  const f = await fixture({ loseCalendarAcknowledgment: true }); try {
    await f.create(); const before = await f.intent();
    expect(await f.dispatcher.runBatch()).toMatchObject({ claimed: 1, stale: 1 });
    expect((await f.intent()).state).toBe('accepted');
    expect((await f.intent()).createKey).toBe(before.createKey);
    expect(await f.dispatcher.runBatch()).toMatchObject({ claimed: 0 });
    await f.jobs.tick(); await untilMemoryJobs(() => f.observations.length === 1);
    expect(f.jobs.calls).toHaveLength(1); expect(f.calendar.sourceRows(f.session.scope, '_calendar_integration_receipts')).toHaveLength(1);
    expect(f.activityErrors).toEqual([]);
  } finally { await f.close(); }
});

test('cancellation during a Torrent wait suppresses the final calendar effect even after Jobs acceptance', async () => {
  let entered!: () => void, release!: () => void;
  const arrived = new Promise<void>(resolve => { entered = resolve; }), waiting = new Promise<void>(resolve => { release = resolve; });
  const f = await fixture({ async beforeObservation() { entered(); await waiting; } });
  try {
    const appointment = await f.create(); await f.dispatcher.runBatch(); await f.jobs.tick(); await arrived;
    expect(f.calendar.stats().activeLeases).toBe(0);
    await f.session.api.appointments.cancel(appointment.id, { expectedRevision: 1, idempotencyKey: 'cancel-during-wait' });
    release(); await untilMemoryJobs(() => f.activityErrors.length === 1);
    expect(f.activityErrors[0]).toMatchObject({ code: 'CALENDAR_POLICY_STALE' });
    expect(f.calendar.sourceRows(f.session.scope, '_calendar_integration_effect_admissions')).toHaveLength(0);
    expect(f.calendar.sourceRows(f.session.scope, '_calendar_integration_effect_outcomes')).toHaveLength(0);
    expect((await f.intent()).eligibility).toBe('superseded');
    expect(await f.dispatcher.runBatch()).toMatchObject({ cancelled: 1 });
    expect((await f.intent()).state).toBe('cancelled');
  } finally { release(); await f.close(); }
});

test('cancellation after the committed cutoff does not erase an already admitted observation or pretend recall', async () => {
  let cancel: (() => Promise<void>) | undefined;
  const f = await fixture({ async afterCutoff() { await cancel?.(); } });
  try {
    const appointment = await f.create();
    cancel = async () => { await f.session.api.appointments.cancel(appointment.id, { expectedRevision: 1, idempotencyKey: 'cancel-after-cutoff' }); };
    await f.dispatcher.runBatch(); await f.jobs.tick(); await untilMemoryJobs(() => f.observations.length === 1);
    expect(f.activityErrors).toEqual([]); expect((await f.intent()).eligibility).toBe('superseded');
    expect(f.calendar.sourceRows(f.session.scope, '_calendar_integration_effect_admissions')).toHaveLength(1);
    expect(f.calendar.sourceRows(f.session.scope, '_calendar_integration_effect_outcomes')).toHaveLength(1);
    expect(f.observations[0]?.state).toBe('observed');
  } finally { await f.close(); }
});

test('the fixed observation adapter rejects actor, wrong source, scope, pin and input without admitting an effect', async () => {
  let f: Awaited<ReturnType<typeof fixture>>;
  f = await fixture({ async beforeObservation() {
    const context = f.captured[0]!, deps = { owner: f.owner, inspect: f.jobs.workflows.get.bind(f.jobs.workflows), executions: f.sourceJobs.executions, now: f.jobs.now };
    const denied = (next: StepContext, inspector = deps.inspect) => expect(observeCalendarIntegration({ ...deps, inspect: inspector }, next)).rejects.toBeInstanceOf(CalendarError);
    await denied({ ...context, execution: { ...context.execution, kind: 'actor' } as StepContext['execution'] });
    await denied({ ...context, execution: { ...context.execution, principal: 'jobs:source:' + '0'.repeat(64) } as StepContext['execution'] });
    await denied({ ...context, execution: { ...context.execution, scopeKind: 'tenant', scopeId: 'other', tenantId: 'other' } as StepContext['execution'] });
    await denied(context, (id, scope) => { const original = deps.inspect(id, scope); return original ? { ...original, graph_fingerprint: '0'.repeat(64) } : null; });
    await denied({ ...context, workflowInput: { ...context.input as object, appointmentRevision: 999 } });
    const unknown = { ...context.input as object, intentId: 'unknown' };
    await denied({ ...context, input: unknown, workflowInput: unknown });
    expect(f.calendar.sourceRows(f.session.scope, '_calendar_integration_effect_admissions')).toHaveLength(0);
  } });
  try { await f.create(); await f.dispatcher.runBatch(); await f.jobs.tick(); await untilMemoryJobs(() => f.observations.length === 1); expect(f.activityErrors).toEqual([]); }
  finally { await f.close(); }
});

test('local retirement preserves accepted Jobs evidence but refuses fresh effect admission', async () => {
  const f = await fixture(); try {
    await f.create(); await f.dispatcher.runBatch(); const original = await f.intent();
    await f.owner.command('calendar.integration.policy.retire', { ruleId: f.policy.ruleId, epoch: f.installed.epoch, now: f.jobs.now() }, { idempotencyKey: 'retire-local' });
    const retired = await f.sourceJobs.registration.retire({ expectedRevision: f.registration.revision, idempotencyKey: 'retire-jobs' });
    expect(retired.state).toBe('retired'); expect(await f.sourceJobs.receipts.get(original.createKey)).toMatchObject({ id: original.jobsReceipt!.id });
    expect(await f.dispatcher.runBatch()).toMatchObject({ cancelled: 1 });
    expect((await f.intent()).eligibility).toBe('retired');
    await f.jobs.tick(); expect(f.observations).toEqual([]);
    expect(f.calendar.sourceRows(f.session.scope, '_calendar_integration_effect_admissions')).toHaveLength(0);
  } finally { await f.close(); }
});

test('a different native SYSTEM start with the same source principal, graph and input is not the admitted Jobs occurrence', async () => {
  const f = await fixture(); try {
    await f.create(); await f.dispatcher.runBatch(); const intent = await f.intent();
    const unrelated = await f.jobs.workflows.enqueueAsSystemOnce(intent.policy.source.workflow.name, intent.input, {
      principal: jobSourcePrincipal(intent.registration!.id), reason: 'Synthetic unrelated native start', scope: f.owner.scope, idempotencyKey: 'unrelated-native-start',
    });
    await untilMemoryJobs(() => f.activityErrors.length === 1);
    expect(f.activityErrors[0]).toMatchObject({ code: 'CALENDAR_FORBIDDEN' });
    expect(f.calendar.sourceRows(f.session.scope, '_calendar_integration_effect_admissions')).toHaveLength(0);
    await f.jobs.tick(); await untilMemoryJobs(() => f.observations.length === 1);
    const evidence = f.calendar.sourceRows(f.session.scope, '_calendar_integration_effect_admissions')[0]!;
    expect(evidence.execution_id).not.toBe(unrelated.instanceId);
    expect(f.calendar.sourceRows(f.session.scope, '_calendar_integration_effect_admissions')).toHaveLength(1);
  } finally { await f.close(); }
});

for (const phase of ['admit', 'settle'] as const) test(`a lost ${phase} acknowledgment reconciles evidence without granting a second effect`, async () => {
  let f: Awaited<ReturnType<typeof fixture>>;
  f = await fixture({ loseEffectAcknowledgment: phase, async beforeObservation() {
    const deps = { owner: f.owner, inspect: f.jobs.workflows.get.bind(f.jobs.workflows), executions: f.sourceJobs.executions, now: f.jobs.now };
    await expect(observeCalendarIntegration(deps, f.captured[0]!)).rejects.toMatchObject({ code: 'CALENDAR_OUTCOME_UNKNOWN' });
  } });
  try {
    await f.create(); await f.dispatcher.runBatch(); await f.jobs.tick(); await untilMemoryJobs(() => f.observations.length === 1);
    expect(f.activityErrors).toEqual([]);
    expect(f.observations[0]?.state).toBe(phase === 'admit' ? 'admitted' : 'observed');
    // An admission with no outcome remains explicitly unsettled/unknown. It is
    // NOT a completed observation and the retry does not manufacture settlement.
    expect(f.calendar.sourceRows(f.session.scope, '_calendar_integration_effect_admissions')).toHaveLength(1);
    expect(f.calendar.sourceRows(f.session.scope, '_calendar_integration_effect_outcomes')).toHaveLength(phase === 'admit' ? 0 : 1);
    expect(f.jobs.calls).toHaveLength(1);
  } finally { await f.close(); }
});

test('expiry while waiting for the final source writer cannot be bypassed by a pre-await timestamp', async () => {
  // Stay inside Torrent's owner/attempt lease: the refusal must be calendar
  // expiry itself, not a separately retired workflow runtime authority.
  const f = await fixture({ delayEffectAdmissionMs: 1_001, maxLatenessMs: 1_000 }); try {
    await f.create(); await f.dispatcher.runBatch(); await f.jobs.tick(); await untilMemoryJobs(() => f.activityErrors.length === 1);
    expect(f.activityErrors[0]).toMatchObject({ code: 'CALENDAR_POLICY_STALE' });
    expect(f.calendar.sourceRows(f.session.scope, '_calendar_integration_effect_admissions')).toHaveLength(0);
    expect(f.calendar.sourceRows(f.session.scope, '_calendar_integration_effect_outcomes')).toHaveLength(0);
    expect(f.observations).toEqual([]);
  } finally { await f.close(); }
});

test('actual native database no-start is not recorded as an unknown Jobs write and can expire without work', async () => {
  const f = await fixture({ maxLatenessMs: 1_000, beforeJobsWrite(name) {
    if (name === 'jobs.source.schedule.create') throw new DatabaseError('DATABASE_BACKPRESSURE', 'Synthetic no-start admission.', { outcome: 'not-started' });
  } });
  try {
    await f.create();
    expect(await f.dispatcher.runBatch()).toMatchObject({ deferred: 1, accepted: 0 });
    expect(await f.intent()).toMatchObject({ state: 'pending', createAttempted: false, jobsReceipt: null });
    expect(f.jobs.commands.filter(command => command.name === 'jobs.source.schedule.create')).toEqual([]);
    f.jobs.advance(1_001);
    expect(await f.dispatcher.runBatch()).toMatchObject({ suppressed: 1 });
    expect(await f.intent()).toMatchObject({ state: 'suppressed', jobsReceipt: null });
    expect(f.jobs.calls).toEqual([]);
  } finally { await f.close(); }
});

test('graceful dispatcher stop restores only untouched claimed work while an invoked Jobs callback remains unconfirmed', async () => {
  let entered!: () => void, release!: () => void;
  const arrived = new Promise<void>(resolve => { entered = resolve; }), waiting = new Promise<void>(resolve => { release = resolve; });
  let first = true, physicallyWaiting = false;
  const f = await fixture({ maxLatenessMs: 1_000, async beforeJobsWrite(name) {
    if (name === 'jobs.source.schedule.create' && first) {
      first = false; physicallyWaiting = true; entered();
      try { await waiting; } finally { physicallyWaiting = false; }
    }
  } });
  let resumed: CalendarIntegrationDispatcher | undefined;
  const pumping = f.dispatcher.runBatch.bind(f.dispatcher);
  let pending: Promise<unknown> | undefined;
  try {
    const one = await f.create();
    const otherResource = await f.session.api.resources.create({ label: 'PRIVATE_SECOND_RESOURCE', kind: 'person', timeZone: 'UTC' }, { idempotencyKey: 'second-resource' });
    const two = await f.session.api.appointments.create({ title: 'PRIVATE_SECOND_APPOINTMENT', resourceIds: [otherResource.id],
      startAt: new Date(f.jobs.now()).toISOString(), endAt: new Date(f.jobs.now() + 3_600_000).toISOString(), timeZone: 'UTC' }, { idempotencyKey: 'second-appointment' });
    // Source ordering is by opaque identity at equal time. Identify whichever
    // row entered Jobs rather than assuming a randomly generated ID order.
    pending = pumping().then(value => value, error => error);
    await arrived; await f.dispatcher.close();
    expect(physicallyWaiting).toBe(true); // caller drainage is NOT physical Jobs settlement.
    expect(f.dispatcher.diagnostics().unsettledUninvokedClaims).toEqual([]);
    const intents = f.calendar.sourceRows(f.session.scope, '_calendar_integration_intents');
    expect(intents.map(row => row.appointment_id).sort()).toEqual([one.id, two.id].sort());
    const dispatch = f.calendar.sourceRows(f.session.scope, '_calendar_integration_dispatch');
    expect(dispatch.filter(row => row.create_attempted === 1)).toHaveLength(1);
    expect(dispatch.filter(row => row.create_attempted === 0 && row.claim_nonce === null)).toHaveLength(1);
    expect(f.jobs.commands.filter(command => command.name === 'jobs.source.schedule.create')).toEqual([]);
    f.jobs.advance(1_001);
    resumed = new CalendarIntegrationDispatcher({ store: f.owner, jobs: f.sourceJobs, now: f.jobs.now });
    expect(await resumed.runBatch()).toMatchObject({ claimed: 1, suppressed: 1 });
    expect(f.calendar.sourceRows(f.session.scope, '_calendar_integration_dispatch').filter(row => row.state === 'suppressed')).toHaveLength(1);
  } finally {
    release(); await Promise.allSettled(pending ? [pending] : []);
    try { await resumed?.close(); } finally { await f.close(); }
  }
});
