/** Actual native memory calendar/journal with an explicit Jobs protocol double.
 * No files, actors, app, provider or dependencies are created. Jobs assertions
 * verify durable source control precedes every separate registration mutation.
 */
import { expect, test } from 'bun:test';
import { JobsError } from '../jobs/error';
import type { WorkPool } from '../workers/work-pool';
import { jobSourceId, type JobSourceRegistration } from '../jobs/source-model';
import type { SourceJobs } from '../jobs/source-service';
import { calendarObservationPolicy, CALENDAR_OBSERVATION_WORKFLOW, normalizeCalendarObservationInput } from './integration-catalog';
import { CalendarIntegrationPolicyController, type CalendarIntegrationEligibilityGuards, type CalendarIntegrationPolicySelection } from './integration-controller';
import type { CalendarIntegrationControlView } from './integration-controls';
import type { CalendarIntegrationPolicySpec, CalendarIntegrationPolicyView } from './integration-model';
import type { CalendarIntegrationOwner } from './integration-runtime';
import { calendarHash } from './validation';
import { eventuallyCalendar, memoryCalendarServiceFixture } from './test-support/memory-service-fixture';

const capture = <T>(task: Promise<T>) => task.then(value => ({ ok: true as const, value }), error => ({ ok: false as const, error }));
function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }
const selection = (policy: CalendarIntegrationPolicyView): CalendarIntegrationPolicySelection => ({ id: policy.id, epoch: policy.epoch, policyDigest: calendarHash(policy.policy) });

async function fixture() {
  const calendar = memoryCalendarServiceFixture({ tenancy: 'single' }), session = calendar.session('owner', { manager: true });
  try {
    const resource = await session.api.resources.create({ label: 'PRIVATE_RESOURCE', kind: 'person', timeZone: 'UTC' }, { idempotencyKey: 'seed' });
    const owner = calendar.runtime.forIntegrationOwner(calendar.runtime.integrationOwners()[0]!);
    const currents = new Map<string, JobSourceRegistration>(), receipts = new Map<string, JobSourceRegistration>();
    const bindings: Array<{ policy: CalendarIntegrationPolicySpec; guards: CalendarIntegrationEligibilityGuards }> = [];
    const mutations: Array<{ action: 'activate' | 'retire'; key: string; expected: number; sourceId: string }> = [];
    let now = Date.now(), factoryCalls = 0, loseActivationReply = false, loseRetirementReply = false, rejectActivation = false;
    let beforeActivate: (() => Promise<void>) | null = null, afterActivate: (() => void) | null = null;
    const assertNoLease = () => expect(calendar.stats().activeLeases).toBe(0);
    const journal = (key: string) => {
      const row = calendar.sourceRows(session.scope, '_calendar_integration_controls').find(row => row.jobs_key === key);
      expect(row).toBeDefined(); return row!;
    };
    const jobs = (policy: CalendarIntegrationPolicySpec, guards: CalendarIntegrationEligibilityGuards): SourceJobs => {
      factoryCalls++; bindings.push({ policy, guards });
      const sourceId = jobSourceId(policy.source.identity), keyFor = (key: string) => sourceId + ':' + key;
      return { capacity: { async get() { throw new Error('Controller does not request capacity in this fixture.'); } }, registration: {
        async get() { assertNoLease(); return currents.get(sourceId) ?? null; },
        async reconcile(key) { assertNoLease(); return receipts.get(keyFor(key)) ?? null; },
        async activate(options) {
          assertNoLease(); const row = journal(options.idempotencyKey);
          expect(row.action).toBe('activate'); expect(row.expected_jobs_revision).toBe(options.expectedRevision);
          expect(row.epoch).toBe(normalizeCalendarObservationInput(options.pinInput).policyEpoch);
          const prior = receipts.get(keyFor(options.idempotencyKey));
          if (prior) return prior;
          await guards.confirmEligible(); await beforeActivate?.(); await guards.confirmEligible();
          options.signal?.throwIfAborted();
          if (rejectActivation) throw new JobsError('JOBS_CAPACITY');
          const current = currents.get(sourceId);
          if ((current?.revision ?? 0) !== options.expectedRevision) throw new JobsError('JOBS_REVISION_CONFLICT');
          const hash = calendarHash(policy.source), same = current?.state === 'active' && current.policyHash === hash;
          const registration: JobSourceRegistration = same ? current : { id: sourceId, state: 'active', policyHash: hash,
            generation: (current?.generation ?? 0) + 1, revision: (current?.revision ?? 0) + 1 };
          currents.set(sourceId, registration); receipts.set(keyFor(options.idempotencyKey), registration);
          mutations.push({ action: 'activate', key: options.idempotencyKey, expected: options.expectedRevision, sourceId });
          afterActivate?.();
          if (loseActivationReply) { loseActivationReply = false; throw new JobsError('JOBS_OUTCOME_UNKNOWN'); }
          try { guards.assertEligible(); } catch { throw new JobsError('JOBS_OUTCOME_UNKNOWN'); }
          return registration;
        },
        async retire(options) {
          assertNoLease(); const row = journal(options.idempotencyKey);
          expect(row.action).toBe('retire'); expect(row.expected_jobs_revision).toBe(options.expectedRevision);
          expect((await owner.read<CalendarIntegrationPolicyView>('calendar.integration.policy', { ruleId: policy.ruleId })).state).toBe('retired');
          const prior = receipts.get(keyFor(options.idempotencyKey)); if (prior) return prior;
          const current = currents.get(sourceId);
          if (!current || current.revision !== options.expectedRevision) throw new JobsError('JOBS_REVISION_CONFLICT');
          const registration: JobSourceRegistration = current.state === 'retired' ? current : { ...current, state: 'retired', revision: current.revision + 1 };
          currents.set(sourceId, registration); receipts.set(keyFor(options.idempotencyKey), registration);
          mutations.push({ action: 'retire', key: options.idempotencyKey, expected: options.expectedRevision, sourceId });
          if (loseRetirementReply) { loseRetirementReply = false; throw new JobsError('JOBS_OUTCOME_UNKNOWN'); }
          return registration;
        },
      }, receipts: { async get(key) { return receipts.get(keyFor(key)) ?? null; } },
      executions: { async get() { throw new Error('Controller does not execute workflows.'); } },
      schedules: { async reconcileCreate() { throw new Error('No schedule reconciliation.'); }, async create() { throw new Error('No schedules.'); }, async replace() { throw new Error('No schedules.'); },
        async cancel() { throw new Error('No schedules.'); }, async get() { throw new Error('No schedules.'); } } };
    };
    const controllers: CalendarIntegrationPolicyController[] = [];
    const controller = (source: CalendarIntegrationOwner = owner) => { const result = new CalendarIntegrationPolicyController({ owner: source, jobs, now: () => now }); controllers.push(result); return result; };
    const policy = (id = 'observation', version = '1') => calendarObservationPolicy(owner,
      { id, version, dueOffsetMs: 0, maxLatenessMs: 60_000 }, { name: CALENDAR_OBSERVATION_WORKFLOW, version: 1, definitionId: 'fixed-definition', versionId: 'fixed-version', fingerprint: '3'.repeat(64) });
    return { calendar, session, owner, resource, controller, policy, bindings, mutations, currents, receipts,
      factoryCalls: () => factoryCalls, advance(ms: number) { now += ms; },
      loseActivation() { loseActivationReply = true; }, loseRetirement() { loseRetirementReply = true; }, rejectActivation(value: boolean) { rejectActivation = value; },
      beforeActivate(callback: typeof beforeActivate) { beforeActivate = callback; }, afterActivate(callback: typeof afterActivate) { afterActivate = callback; },
      async close() { try { for (const controller of controllers) await controller.close(); } finally { await calendar.close(); } },
    };
  } catch (error) { await calendar.close(); throw error; }
}

test('prepare is deterministic capture-only, reuses current policy, and never resolves Jobs', async () => {
  const f = await fixture(); try {
    const c = f.controller(), policy = f.policy(), prepared = await c.prepare(policy);
    expect(prepared.state).toBe('activating'); expect((await c.prepare(policy)).id).toBe(prepared.id); expect(f.factoryCalls()).toBe(0);
    await f.session.api.appointments.create({ title: 'PRIVATE_TITLE', resourceIds: [f.resource.id], startAt: new Date().toISOString(),
      endAt: new Date(Date.now() + 60_000).toISOString(), timeZone: 'UTC' }, { idempotencyKey: 'capture' });
    expect(f.calendar.sourceRows(f.session.scope, '_calendar_integration_intents')).toHaveLength(1);
    expect(f.calendar.sourceRows(f.session.scope, '_calendar_integration_controls')).toHaveLength(0); expect(f.factoryCalls()).toBe(0);
  } finally { await f.close(); }
});

test('activation journals original key/CAS before Jobs and replacement controller hydrates the accepted control', async () => {
  const f = await fixture(); try {
    const c = f.controller(), policy = f.policy(); await c.prepare(policy);
    const accepted = await c.activate(policy.ruleId);
    expect(accepted.policy.state).toBe('active'); expect(accepted.result?.state).toBe('accepted'); expect(f.mutations).toHaveLength(1);
    const count = f.factoryCalls(); await c.prepare(policy); expect(f.factoryCalls()).toBe(count);
    f.bindings.at(-1)!.guards.assertEligible();
    await c.close(); expect(f.owner.signal.aborted).toBe(false); await f.owner.verify();
    const next = f.controller(), recovered = await next.activate(policy.ruleId);
    expect(recovered.control.jobsKey).toBe(accepted.control.jobsKey); expect(recovered.result).toEqual(accepted.result);
    expect(f.mutations).toHaveLength(1);
  } finally { await f.close(); }
});

test('lost activation acknowledgment reconciles original accepted key without another Jobs generation', async () => {
  const f = await fixture(); try {
    const c = f.controller(); await c.prepare(f.policy()); f.loseActivation();
    await expect(c.activate('observation')).rejects.toMatchObject({ code: 'JOBS_OUTCOME_UNKNOWN' });
    const pending = await f.owner.read<CalendarIntegrationControlView>('calendar.integration.control', { ruleId: 'observation', epoch: 1, action: 'activate' });
    expect(pending.result).toBeNull(); expect(pending.lastFailure).toBe('JOBS_OUTCOME_UNKNOWN'); expect(f.mutations).toHaveLength(1);
    await c.close(); const recovered = await f.controller().activate('observation');
    expect(recovered.control.id).toBe(pending.id); expect(recovered.control.jobsKey).toBe(pending.jobsKey);
    expect(recovered.policy.state).toBe('active'); expect(f.mutations).toHaveLength(1);
  } finally { await f.close(); }
});

test('a pending A control blocks prepare B and evidence recovery never silently revives its quiesced source', async () => {
  const f = await fixture(); try {
    const c = f.controller(); await c.prepare(f.policy()); f.loseActivation(); await expect(c.activate('observation')).rejects.toBeDefined();
    const old = f.bindings.at(-1)!.guards;
    const replacing = c.prepare(f.policy('observation', '2'));
    expect(() => old.assertEligible()).toThrow(); await expect(replacing).rejects.toMatchObject({ code: 'CALENDAR_NOT_READY' });
    expect((await f.owner.read<CalendarIntegrationPolicyView>('calendar.integration.policy', { ruleId: 'observation' })).epoch).toBe(1);
    await c.activate('observation'); expect(() => old.assertEligible()).toThrow();
    const b = await c.prepare(f.policy('observation', '2')); expect(b.epoch).toBe(2); expect(f.mutations).toHaveLength(1);
  } finally { await f.close(); }
});

test('a proven rejected activation retains backoff and retirement barrier settles absence without inventing retirement', async () => {
  const f = await fixture(); try {
    const c = f.controller(); await c.prepare(f.policy()); f.rejectActivation(true);
    await expect(c.activate('observation')).rejects.toMatchObject({ code: 'JOBS_CAPACITY' });
    const retry = await c.activate('observation'); expect(retry.result).toBeNull(); expect(retry.control.lastFailure).toBe('JOBS_CAPACITY');
    expect(f.mutations).toHaveLength(0);
    await expect(c.prepare(f.policy('observation', '2'))).rejects.toMatchObject({ code: 'CALENDAR_NOT_READY' });
    const retired = await c.retire('observation'); expect(retired.result).toBe('no-registration'); expect(retired.registration).toBeNull(); expect(retired).not.toHaveProperty('safeToDisable');
    const original = await f.owner.read<CalendarIntegrationControlView>('calendar.integration.control', { ruleId: 'observation', epoch: 1, action: 'activate' });
    expect(original.result).toEqual({ state: 'absent' }); expect(f.mutations).toHaveLength(0);
    f.rejectActivation(false); expect((await c.prepare(f.policy('observation', '2'))).epoch).toBe(2);
  } finally { await f.close(); }
});

test('retire quiesces eligibility synchronously before its queued local retirement and settles an earlier activation', async () => {
  const f = await fixture(), entered = deferred(), gate = deferred();
  try {
    const c = f.controller(); await c.prepare(f.policy()); f.beforeActivate(async () => { entered.resolve(); await gate.promise; });
    const activating = capture(c.activate('observation')); await entered.promise;
    const guard = f.bindings.at(-1)!.guards, retiring = c.retire('observation');
    expect(() => guard.assertEligible()).toThrow(); gate.resolve();
    expect((await activating).ok).toBe(false);
    const result = await retiring; expect(result.result).toBe('no-registration'); expect(result.policy.state).toBe('retired');
    expect(f.mutations).toHaveLength(0); expect(f.owner.signal.aborted).toBe(false);
  } finally { gate.resolve(); await f.close(); }
});

test('late accepted activation is acknowledged after local retirement without reviving the policy', async () => {
  const f = await fixture(); let retiring: ReturnType<CalendarIntegrationPolicyController['retire']> | undefined;
  try {
    const c = f.controller(); await c.prepare(f.policy());
    f.afterActivate(() => { retiring = c.retire('observation'); });
    await expect(c.activate('observation')).rejects.toMatchObject({ code: 'JOBS_OUTCOME_UNKNOWN' });
    const result = await retiring!; expect(result.result).toBe('retired'); expect(result.policy.state).toBe('retired');
    const activation = await f.owner.read<CalendarIntegrationControlView>('calendar.integration.control', { ruleId: 'observation', epoch: 1, action: 'activate' });
    expect(activation.result?.state).toBe('accepted'); expect(f.mutations.map(row => row.action)).toEqual(['activate', 'retire']);
  } finally { await f.close(); }
});

test('local B never applied retires the actual A registration and lost retirement acknowledgment remains exact', async () => {
  const f = await fixture(); try {
    const c = f.controller(); await c.prepare(f.policy()); const a = await c.activate('observation');
    const b = await c.prepare(f.policy('observation', '2')); expect(b.registration).toBeNull(); f.loseRetirement();
    await expect(c.retire('observation')).rejects.toMatchObject({ code: 'JOBS_OUTCOME_UNKNOWN' });
    const control = await f.owner.read<CalendarIntegrationControlView>('calendar.integration.control', { ruleId: 'observation', epoch: 2, action: 'retire' });
    expect(control.expectedRegistration).toEqual(a.result?.state === 'accepted' ? a.result.registration : null);
    await c.close(); const result = await f.controller().retire('observation');
    expect(result.result).toBe('retired'); expect(result.control?.jobsKey).toBe(control.jobsKey); expect(f.mutations).toHaveLength(2);
  } finally { await f.close(); }
});

test('registered history plus missing Jobs state fails closed, while never-registered retirement stays explicit', async () => {
  const f = await fixture(); try {
    const c = f.controller(); await c.prepare(f.policy()); await c.activate('observation');
    await c.prepare(f.policy('observation', '2')); f.currents.clear();
    await expect(c.retire('observation')).rejects.toMatchObject({ code: 'CALENDAR_STATE_INVALID' });
    expect(f.mutations).toHaveLength(1);
    const d = f.controller(); await d.prepare(f.policy('never-registered'));
    const absent = await d.retire('never-registered'); expect(absent.result).toBe('no-registration'); expect(absent.control).toBeNull();
  } finally { await f.close(); }
});

test('known source disappearance cannot be repaired by fresh activation, with or without an existing null-target control', async () => {
  for (const pending of [false, true]) {
    const f = await fixture(); try {
      const c = f.controller(); await c.prepare(f.policy()); await c.activate('observation');
      const b = await c.prepare(f.policy('observation', '2'));
      if (pending) await f.owner.command('calendar.integration.control.prepare', { ruleId: 'observation', epoch: b.epoch, action: 'activate', expectedRegistration: null }, { idempotencyKey: 'simulate-retained-null-target' });
      f.currents.clear(); f.receipts.clear();
      await expect(c.activate('observation')).rejects.toMatchObject({ code: 'CALENDAR_STATE_INVALID' });
      expect(f.mutations).toHaveLength(1); expect(f.currents.size).toBe(0);
      const control = await f.owner.read<CalendarIntegrationControlView | null>('calendar.integration.control', { ruleId: 'observation', epoch: b.epoch, action: 'activate' });
      if (!pending) expect(control).toBeNull();
    } finally { await f.close(); }
  }
});

test('restart between local retirement and Jobs target capture blocks reactivation until actual durable retirement completes', async () => {
  const f = await fixture(); try {
    const c = f.controller(), a = f.policy(); await c.prepare(a); await c.activate('observation');
    await f.owner.command('calendar.integration.policy.retire', { ruleId: 'observation', epoch: 1 }, { idempotencyKey: 'simulate-crash-after-local-retire' });
    await c.close(); const next = f.controller(), calls = f.factoryCalls();
    await expect(next.prepare(a)).rejects.toMatchObject({ code: 'CALENDAR_NOT_READY' });
    expect(f.factoryCalls()).toBe(calls); expect(f.mutations).toHaveLength(1);
    await next.retire('observation'); expect((await next.prepare(a)).epoch).toBe(2);
    const active = await next.activate('observation');
    expect(active.result?.state === 'accepted' && active.result.registration.generation).toBe(2);
  } finally { await f.close(); }
});

test('missing-rule retirement markers are bounded/cleaned and repeated queued retirements settle the shared marker', async () => {
  const f = await fixture(); try {
    const c = f.controller(), absent = Array.from({ length: 12 }, (_, index) => capture(c.retire('missing-' + index)));
    expect(c.diagnostics().retirementMarkers).toBeLessThanOrEqual(8);
    expect((await Promise.all(absent)).every(result => !result.ok)).toBe(true);
    expect(c.diagnostics().retirementMarkers).toBe(0); expect(f.factoryCalls()).toBe(0);
    await c.prepare(f.policy()); await c.activate('observation');
    const results = await Promise.all([c.retire('observation'), c.retire('observation'), c.retire('observation')]);
    expect(results.every(result => result.result === 'retired')).toBe(true);
    expect((await c.prepare(f.policy())).epoch).toBe(2);
  } finally { await f.close(); }
});

test('pool-refused retirements leave neither orphan markers nor unbounded native control work', async () => {
  const f = await fixture(), gate = deferred(); const owned: Array<Promise<unknown>> = [];
  try {
    const c = f.controller(), pool = (c as unknown as { pool: WorkPool }).pool;
    for (let slot = 0; slot < 8; slot++) owned.push(capture(pool.run(() => gate.promise, { key: 'synthetic-slot-' + slot })));
    for (let slot = 0; slot < 32; slot++) owned.push(capture(pool.run(() => undefined, { key: 'synthetic-queued' })));
    expect(c.diagnostics().pool).toMatchObject({ active: 8, queued: 32 });
    for (let index = 0; index < 12; index++) await expect(c.retire('refused-' + index)).rejects.toBeDefined();
    expect(c.diagnostics().retirementMarkers).toBe(0); expect(f.factoryCalls()).toBe(0);
    gate.resolve(); await Promise.all(owned);
  } finally { gate.resolve(); await Promise.allSettled(owned); await f.close(); }
});

test('A to B to A and retire/reactivate advance local and Jobs epochs without rotating source identity', async () => {
  const f = await fixture(); try {
    const c = f.controller(), a = f.policy(), b = f.policy('observation', '2');
    await c.prepare(a); const first = await c.activate('observation');
    await c.prepare(b); await c.activate('observation');
    const again = await c.prepare(a); expect(again.epoch).toBe(3);
    const third = await c.activate('observation');
    expect(third.result?.state === 'accepted' && third.result.registration.generation).toBe(3);
    expect(third.result?.state === 'accepted' && third.result.registration.id).toBe(first.result?.state === 'accepted' && first.result.registration.id);
    await c.retire('observation'); const reactivated = await c.prepare(a); expect(reactivated.epoch).toBe(4);
    expect((await c.activate('observation')).result?.state).toBe('accepted');
  } finally { await f.close(); }
});

test('different rules progress independently and controller close leaves native owner/evidence alive', async () => {
  const f = await fixture(), entered = deferred(), gate = deferred();
  try {
    const c = f.controller(); await c.prepare(f.policy('a')); await c.prepare(f.policy('b'));
    let first = true; f.beforeActivate(async () => { if (first) { first = false; entered.resolve(); await gate.promise; } });
    const a = capture(c.activate('a')); await entered.promise;
    let progressed = false; const b = c.activate('b').then(result => { progressed = true; return result; });
    await eventuallyCalendar(() => progressed); expect((await b).result?.state).toBe('accepted'); gate.resolve(); expect((await a).ok).toBe(true);
    await c.close(); expect(f.owner.signal.aborted).toBe(false); await f.owner.verify();
    expect(() => f.bindings.at(-1)!.guards.assertEligible()).toThrow();
    await expect(c.prepare(f.policy('c'))).rejects.toMatchObject({ code: 'CALENDAR_NOT_READY' });
    expect([...f.currents.values()].every(row => row.state === 'active')).toBe(true);
  } finally { gate.resolve(); await f.close(); }
});

test('stale and forged native selections cannot change a newer policy or poison its eligibility', async () => {
  const f = await fixture(); try {
    const c = f.controller(), a = await c.prepare(f.policy()); await c.activate(a.ruleId);
    const b = await c.prepare(f.policy('observation', '2')); await c.activate(b.ruleId);
    const live = f.bindings.at(-1)!.guards, calls = f.factoryCalls(), count = f.mutations.length;
    for (const expected of [selection(a), { ...selection(b), policyDigest: '0'.repeat(64) }]) {
      const retiring = c.retire(b.ruleId, { expected }); live.assertEligible();
      await expect(retiring).rejects.toMatchObject({ code: 'CALENDAR_POLICY_STALE' }); live.assertEligible();
      await expect(c.activate(b.ruleId, { expected })).rejects.toMatchObject({ code: 'CALENDAR_POLICY_STALE' }); live.assertEligible();
      const replacing = c.prepare(f.policy('observation', '3'), { expected }); live.assertEligible();
      await expect(replacing).rejects.toMatchObject({ code: 'CALENDAR_POLICY_STALE' }); live.assertEligible();
    }
    for (const expected of [{ ...selection(b), epoch: b.epoch + 1 }, { ...selection(b), id: 'f'.repeat(64) }, { ...selection(b), jobs: {} }]) {
      await expect(c.retire(b.ruleId, { expected })).rejects.toMatchObject({ code: 'CALENDAR_INPUT_INVALID' }); live.assertEligible();
    }
    expect((await f.owner.read<CalendarIntegrationPolicyView>('calendar.integration.policy', { ruleId: b.ruleId })).id).toBe(b.id);
    expect(c.diagnostics().retirementMarkers).toBe(0); expect(f.factoryCalls()).toBe(calls); expect(f.mutations).toHaveLength(count);
  } finally { await f.close(); }
});

test('invalid and pre-aborted selected controls do not quiesce a healthy source', async () => {
  const f = await fixture(); try {
    const c = f.controller(), a = await c.prepare(f.policy()); await c.activate(a.ruleId);
    const live = f.bindings.at(-1)!.guards, cancelled = new AbortController(); cancelled.abort(new Error('synthetic-cancel'));
    for (const task of [c.retire(a.ruleId, { expected: selection(a), signal: cancelled.signal }),
      c.activate(a.ruleId, { expected: selection(a), signal: cancelled.signal }),
      c.prepare(f.policy('observation', '2'), { expected: selection(a), signal: cancelled.signal }),
      c.prepare(f.policy('observation', '2'), { signal: cancelled.signal })]) {
      live.assertEligible(); await expect(task).rejects.toThrow('synthetic-cancel'); live.assertEligible();
    }
    await expect(c.prepare(f.policy('observation', '2'), { requireRetired: true })).rejects.toMatchObject({ code: 'CALENDAR_INPUT_INVALID' });
    await expect(c.prepare(f.policy('observation', '2'), { expected: selection(a), requireRetired: true })).rejects.toMatchObject({ code: 'CALENDAR_POLICY_STALE' });
    const policy = f.policy('observation', '2');
    for (const opts of [undefined, { expected: selection(a) }]) {
      await expect(c.prepare({ ...policy, source: { ...policy.source, identity: { ...policy.source.identity, ownerId: 'wrong-owner' } } }, opts))
        .rejects.toMatchObject({ code: 'CALENDAR_STATE_INVALID' }); live.assertEligible();
      await expect(c.prepare({ ...policy, source: { ...policy.source, identity: { ...policy.source.identity, domain: 'wrong-permanent-source' } } }, opts))
        .rejects.toMatchObject({ code: 'CALENDAR_INTENT_CONFLICT' }); live.assertEligible();
    }
    live.assertEligible(); expect(c.diagnostics().retirementMarkers).toBe(0); expect(f.mutations).toHaveLength(1);
  } finally { await f.close(); }
});

test('busy queued stale selections are detached and never quiesce the current cell', async () => {
  const f = await fixture(), gate = deferred(); let blocker: Promise<unknown> | undefined;
  const owned: Array<ReturnType<typeof capture>> = [];
  try {
    const c = f.controller(), a = await c.prepare(f.policy()); await c.activate(a.ruleId);
    const b = await c.prepare(f.policy('observation', '2')); await c.activate(b.ruleId);
    const live = f.bindings.at(-1)!.guards, pool = (c as unknown as { pool: WorkPool }).pool;
    blocker = pool.run(() => gate.promise, { key: 'calendar-policy:' + calendarHash([f.owner.owner.id, b.ruleId]) });
    const stale = { ...selection(a) };
    owned.push(capture(c.retire(b.ruleId, { expected: stale })), capture(c.activate(b.ruleId, { expected: stale })),
      capture(c.prepare(f.policy('observation', '3'), { expected: stale })));
    Object.assign(stale, selection(b)); live.assertEligible(); expect(c.diagnostics().pool.queued).toBe(3);
    expect(c.diagnostics().retirementMarkers).toBe(0); gate.resolve(); await blocker;
    for (const result of await Promise.all(owned)) { expect(result.ok).toBe(false); if (!result.ok) expect(result.error.code).toBe('CALENDAR_POLICY_STALE'); }
    live.assertEligible(); expect(f.mutations).toHaveLength(2);
  } finally { gate.resolve(); await blocker; await Promise.allSettled(owned); await f.close(); }
});

test('selected retirement stays exact and requires deliberate retired selection to create a new same-policy epoch', async () => {
  const f = await fixture(); try {
    const c = f.controller(), policy = f.policy(), a = await c.prepare(policy); await c.activate(a.ruleId, { expected: selection(a) });
    const old = f.bindings.at(-1)!.guards, retiring = c.retire(a.ruleId, { expected: selection(a) });
    expect(() => old.assertEligible()).toThrow();
    const retired = await retiring; expect(retired.policy.id).toBe(a.id); expect(retired.policy.state).toBe('retired'); expect(retired.result).toBe('retired');
    await expect(c.prepare(policy)).rejects.toMatchObject({ code: 'CALENDAR_POLICY_STALE' });
    await expect(c.prepare(f.policy('observation', '2'))).rejects.toMatchObject({ code: 'CALENDAR_POLICY_STALE' });
    const b = await c.prepare(policy, { expected: selection(a), requireRetired: true }); expect(b.epoch).toBe(a.epoch + 1); expect(b.id).not.toBe(a.id);
    const activated = await c.activate(b.ruleId, { expected: selection(b) }); expect(activated.result?.state === 'accepted' && activated.result.registration.generation).toBe(2);
    const live = f.bindings.at(-1)!.guards; live.assertEligible();
    await expect(c.retire(b.ruleId, { expected: selection(a) })).rejects.toMatchObject({ code: 'CALENDAR_POLICY_STALE' });
    await expect(c.activate(b.ruleId, { expected: selection(a) })).rejects.toMatchObject({ code: 'CALENDAR_POLICY_STALE' });
    live.assertEligible(); expect(() => old.assertEligible()).toThrow(); expect(c.diagnostics().retirementMarkers).toBe(0);
  } finally { await f.close(); }
});

test('selected unknown retirement blocks all preparation until its original downstream key is accepted', async () => {
  const f = await fixture(); try {
    const c = f.controller(), a = await c.prepare(f.policy()); await c.activate(a.ruleId); f.loseRetirement();
    await expect(c.retire(a.ruleId, { expected: selection(a) })).rejects.toMatchObject({ code: 'JOBS_OUTCOME_UNKNOWN' });
    const original = await f.owner.read<CalendarIntegrationControlView>('calendar.integration.control', { ruleId: a.ruleId, epoch: a.epoch, action: 'retire' });
    expect(original.result).toBeNull(); expect(original.lastFailure).toBe('JOBS_OUTCOME_UNKNOWN');
    await expect(c.prepare(f.policy(), { expected: selection(a), requireRetired: true })).rejects.toMatchObject({ code: 'CALENDAR_NOT_READY' });
    await expect(c.prepare(f.policy())).rejects.toMatchObject({ code: 'CALENDAR_NOT_READY' });
    const retired = await c.retire(a.ruleId, { expected: selection(a) }); expect(retired.control?.jobsKey).toBe(original.jobsKey); expect(retired.control?.result?.state).toBe('accepted');
    expect(f.mutations.map(row => row.action)).toEqual(['activate', 'retire']);
    const b = await c.prepare(f.policy(), { expected: selection(a), requireRetired: true }); expect(b.epoch).toBe(2);
  } finally { await f.close(); }
});

test('selected retirement acknowledges late activation without reviving the epoch', async () => {
  const f = await fixture(); let retiring: ReturnType<CalendarIntegrationPolicyController['retire']> | undefined;
  try {
    const c = f.controller(), a = await c.prepare(f.policy());
    f.afterActivate(() => { retiring = c.retire(a.ruleId, { expected: selection(a) }); });
    await expect(c.activate(a.ruleId, { expected: selection(a) })).rejects.toMatchObject({ code: 'JOBS_OUTCOME_UNKNOWN' });
    const retired = await retiring!; expect(retired.policy.id).toBe(a.id); expect(retired.policy.state).toBe('retired'); expect(retired.result).toBe('retired');
    const original = await f.owner.read<CalendarIntegrationControlView>('calendar.integration.control', { ruleId: a.ruleId, epoch: a.epoch, action: 'activate' });
    expect(original.result?.state).toBe('accepted'); expect(f.mutations.map(row => row.action)).toEqual(['activate', 'retire']);
    await expect(c.prepare(f.policy())).rejects.toMatchObject({ code: 'CALENDAR_POLICY_STALE' });
  } finally { await retiring?.catch(() => {}); await f.close(); }
});

test('a selected retirement source CAS refuses a newer controller policy without retiring its Jobs source', async () => {
  const f = await fixture(), entered = deferred(), gate = deferred(); let retiring: ReturnType<typeof capture> | undefined;
  try {
    const source: CalendarIntegrationOwner = { ...f.owner, async command(name, input, options) {
      if (name === 'calendar.integration.policy.retire') { entered.resolve(); await gate.promise; }
      return f.owner.command(name, input, options);
    } };
    const c = f.controller(source), a = await c.prepare(f.policy()); await c.activate(a.ruleId);
    retiring = capture(c.retire(a.ruleId, { expected: selection(a) })); await entered.promise;
    const other = f.controller(), b = await other.prepare(f.policy('observation', '2')); await other.activate(b.ruleId);
    const live = f.bindings.at(-1)!.guards; live.assertEligible(); gate.resolve();
    const result = await retiring; expect(result.ok).toBe(false); if (!result.ok) expect(result.error.code).toBe('CALENDAR_POLICY_STALE');
    live.assertEligible(); expect(f.mutations.map(row => row.action)).toEqual(['activate', 'activate']);
    const current = await f.owner.read<CalendarIntegrationPolicyView>('calendar.integration.policy', { ruleId: a.ruleId }); expect(current.id).toBe(b.id); expect(current.state).toBe('active');
  } finally { gate.resolve(); await retiring; await f.close(); }
});

test('a selected retirement fences an already-waiting background preparation before its source command', async () => {
  const f = await fixture(), entered = deferred(), gate = deferred();
  let preparing: ReturnType<typeof capture> | undefined, retiring: ReturnType<typeof capture> | undefined;
  try {
    const source: CalendarIntegrationOwner = { ...f.owner, async command(name, input, options) {
      if (name === 'calendar.integration.policy.install' && (input as { policy: CalendarIntegrationPolicySpec }).policy.ruleVersion === '2') { entered.resolve(); await gate.promise; }
      return f.owner.command(name, input, options);
    } };
    const c = f.controller(source), a = await c.prepare(f.policy()); await c.activate(a.ruleId);
    preparing = capture(c.prepare(f.policy('observation', '2'))); await entered.promise;
    const retirement = capture(c.retire(a.ruleId, { expected: selection(a) })); retiring = retirement; gate.resolve();
    const refused = await preparing; expect(refused.ok).toBe(false); if (!refused.ok) expect(refused.error.code).toBe('CALENDAR_NOT_READY');
    const retired = await retirement; expect(retired.ok).toBe(true); if (retired.ok) { expect(retired.value.policy.id).toBe(a.id); expect(retired.value.result).toBe('retired'); }
    expect(f.calendar.sourceRows(f.session.scope, '_calendar_integration_policy_history')).toHaveLength(1);
    expect(f.mutations.map(row => row.action)).toEqual(['activate', 'retire']);
  } finally { gate.resolve(); await preparing; await retiring; await f.close(); }
});

test('concurrent identical selected reactivations use real source CAS, not another controller historical install replay', async () => {
  const f = await fixture(), entered = deferred(), gate = deferred(); let preparing: ReturnType<typeof capture> | undefined, armed = false;
  try {
    const source: CalendarIntegrationOwner = { ...f.owner, async command(name, input, options) {
      if (armed && name === 'calendar.integration.policy.install') { entered.resolve(); await gate.promise; }
      return f.owner.command(name, input, options);
    } };
    const c = f.controller(source), a = await c.prepare(f.policy()); await c.activate(a.ruleId); await c.retire(a.ruleId, { expected: selection(a) });
    armed = true;
    preparing = capture(c.prepare(f.policy(), { expected: selection(a), requireRetired: true })); await entered.promise;
    const other = f.controller(), b = await other.prepare(f.policy(), { expected: selection(a), requireRetired: true });
    await other.activate(b.ruleId, { expected: selection(b) }); const live = f.bindings.at(-1)!.guards;
    gate.resolve(); const refused = await preparing; expect(refused.ok).toBe(false); if (!refused.ok) expect(refused.error.code).toBe('CALENDAR_POLICY_STALE');
    live.assertEligible(); expect(b.epoch).toBe(2); expect(f.calendar.sourceRows(f.session.scope, '_calendar_integration_policy_history')).toHaveLength(2);
    expect(f.mutations.map(row => row.action)).toEqual(['activate', 'retire', 'activate']);
    // Unknown/superseded selected installation is inspected, never relabelled as
    // this caller's success just because the desired content happens to match.
    await expect(c.prepare(f.policy(), { expected: selection(a), requireRetired: true })).rejects.toMatchObject({ code: 'CALENDAR_POLICY_STALE' }); live.assertEligible();
  } finally { gate.resolve(); await preparing; await f.close(); }
});

test('selected source install enforces retired state, digest and original retirement acceptance in its own transaction', async () => {
  const f = await fixture(); try {
    const c = f.controller(), a = await c.prepare(f.policy()); await c.activate(a.ruleId);
    const install = (expectedSelection: CalendarIntegrationPolicySelection, key: string) => f.owner.command('calendar.integration.policy.install', {
      policy: f.policy('observation', '2'), expectedEpoch: a.epoch, expectedSelection, requireRetired: true,
    }, { idempotencyKey: key });
    await expect(install(selection(a), 'selected-still-live')).rejects.toMatchObject({ code: 'CALENDAR_POLICY_STALE' });
    await f.owner.command('calendar.integration.policy.retire', { ruleId: a.ruleId, epoch: a.epoch, expectedSelection: selection(a) }, { idempotencyKey: 'selected-source-local-only' });
    await expect(install(selection(a), 'selected-downstream-not-retired')).rejects.toMatchObject({ code: 'CALENDAR_POLICY_STALE' });
    await c.retire(a.ruleId, { expected: selection(a) });
    await expect(install({ ...selection(a), policyDigest: 'f'.repeat(64) }, 'selected-bad-digest')).rejects.toMatchObject({ code: 'CALENDAR_POLICY_STALE' });
    await expect(install({ ...selection(a), id: 'f'.repeat(64) }, 'selected-inconsistent-id')).rejects.toMatchObject({ code: 'CALENDAR_INPUT_INVALID' });
    const installed = await install(selection(a), 'selected-valid-source-cas') as CalendarIntegrationPolicyView; expect(installed.epoch).toBe(2);
    // A fresh source command still cannot use the old selection after install.
    await expect(f.owner.command('calendar.integration.policy.install', { policy: f.policy('observation', '3'), expectedEpoch: a.epoch,
      expectedSelection: selection(a), requireRetired: true }, { idempotencyKey: 'selected-now-stale' })).rejects.toMatchObject({ code: 'CALENDAR_POLICY_STALE' });
    expect(f.calendar.sourceRows(f.session.scope, '_calendar_integration_policy_history')).toHaveLength(2);
  } finally { await f.close(); }
});
