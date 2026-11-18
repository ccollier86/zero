/** Pure protocol doubles: no database, process, timer, provider or filesystem fixture. */
import { expect, test } from 'bun:test';
import { JobsError } from '../jobs/error';
import type { SourceJobs } from '../jobs/source-service';
import { jobSourceId, jobSourceScheduleId, type JobSourceRegistration, type JobSourceScheduleReceipt } from '../jobs/source-model';
import { CalendarError } from './error';
import { CalendarIntegrationDispatcher, type CalendarIntegrationDispatchJobs, type CalendarIntegrationDispatchStore } from './integration-dispatcher';
import type { CalendarIntegrationIntentView, CalendarIntegrationPolicySpec } from './integration-model';
import { calendarHash } from './validation';

function latch() {
  let release!: () => void, enter!: () => void;
  const promise = new Promise<void>(resolve => { release = resolve; }), entered = new Promise<void>(resolve => { enter = resolve; });
  return { entered, release, async wait() { enter(); await promise; } };
}
function fixture() {
  const policy: CalendarIntegrationPolicySpec = { ruleId: 'observe', ruleVersion: '1', adapter: 'observation-v1', dueOffsetMs: 0, maxLatenessMs: 60_000,
    source: { identity: { domain: 'zero.calendar', databaseId: 'calendar:synthetic', ownerId: 'cal_synthetic', rootHash: 'a'.repeat(64), scopeId: 'application' },
      realmFingerprint: 'sha256:' + 'b'.repeat(64), policyVersion: 'observe-1', semanticsVersion: '1',
      definition: { name: 'synthetic.calendar', version: '1', fingerprint: 'c'.repeat(64) },
      workflow: { name: 'synthetic.calendar.workflow', version: 1, definitionId: 'definition', versionId: 'version', fingerprint: 'd'.repeat(64) } } };
  const registration: JobSourceRegistration = { id: jobSourceId(policy.source.identity), generation: 1, revision: 1, state: 'active', policyHash: calendarHash(policy.source) };
  let time = Date.parse('2026-12-01T00:00:00.000Z'), nonce = 0, generation = 0, nextAt = 0, inStore = false;
  let currentRegistration: JobSourceRegistration | null = registration;
  const lifetime = new AbortController(), receipts = new Map<string, JobSourceScheduleReceipt>();
  let intent: CalendarIntegrationIntentView = { id: 'intent-one', ruleId: 'observe', policyEpoch: 1, appointmentId: 'appointment-one', appointmentRevision: 1,
    createKey: 'calendar-create-one', cancelKey: 'calendar-cancel-one', input: { kind: 'calendar-observation-v1', intentId: 'intent-one', appointmentRevision: 1, policyEpoch: 1 },
    at: new Date(time).toISOString(), maxLatenessMs: 60_000, initiatedBy: 'factual-human', policy, registration,
    eligibility: 'current', state: 'pending', jobsReceipt: null, createAttempted: false };
  const commands: { name: string; input: Record<string, unknown>; key: string }[] = [];
  const creates: { input: unknown; options: unknown }[] = [], cancels: { id: string; options: unknown }[] = [];
  let beforeCreate: (() => void | Promise<void>) | undefined, beforeReceipt: (() => void | Promise<void>) | undefined;
  let beforeRegistration: (() => void | Promise<void>) | undefined, failAck = false, claimCalls = 0;
  const original = (): JobSourceScheduleReceipt => ({ id: jobSourceScheduleId(policy.source.identity, intent.createKey), sourceId: registration.id,
    policyGeneration: 1, revision: 1, generation: 1, control: 'active', createdAt: time, updatedAt: time });
  const assertNoLease = () => { if (inStore) throw new Error('Calendar lease escaped into Jobs.'); };
  const store: CalendarIntegrationDispatchStore = {
    signal: lifetime.signal, assertCurrent() { lifetime.signal.throwIfAborted(); },
    async command<T>(name: Parameters<CalendarIntegrationDispatchStore['command']>[0], body: unknown,
      options: Parameters<CalendarIntegrationDispatchStore['command']>[2]): Promise<T> {
      if (inStore) throw new Error('Nested source operation.'); inStore = true;
      try {
        options.signal?.throwIfAborted(); options.assertCurrent?.();
        const input = body as Record<string, unknown>; commands.push({ name, input, key: options.idempotencyKey });
        if (name === 'calendar.integration.claim') {
          claimCalls++;
          if (time < nextAt || ['suppressed', 'cancelled'].includes(intent.state) || intent.state === 'accepted' && intent.eligibility === 'current') return [] as T;
          const previouslyAttempted = intent.createAttempted; intent = { ...intent, createAttempted: true }; generation++;
          return [{ id: intent.id, nonce: input.nonce, claimGeneration: generation, previouslyAttempted, intent: structuredClone(intent) }] as T;
        }
        if (input.claimGeneration !== generation) throw new CalendarError('CALENDAR_REVISION_CONFLICT');
        if (name === 'calendar.integration.ack') {
          if (failAck) { failAck = false; throw new CalendarError('CALENDAR_OUTCOME_UNKNOWN'); }
          intent = { ...intent, state: input.phase === 'cancel' ? 'cancelled' : 'accepted',
            jobsReceipt: input.phase === 'create' ? input.receipt as JobSourceScheduleReceipt : intent.jobsReceipt };
        } else if (name === 'calendar.integration.defer') {
          nextAt = input.retryAt as number;
          intent = { ...intent, state: input.unknown ? 'unknown' : input.code === 'JOBS_CAPACITY' ? 'blocked' : 'pending',
            createAttempted: input.notCommitted === true ? false : intent.createAttempted };
        } else if (name === 'calendar.integration.suppress') intent = { ...intent, state: 'suppressed' };
        else throw new Error('Unexpected source command.');
        return structuredClone(intent) as T;
      } finally { inStore = false; }
    },
  };
  const jobs: CalendarIntegrationDispatchJobs = {
    registration: { async get() { assertNoLease(); await beforeRegistration?.(); return currentRegistration; } },
    receipts: { async get(key) { assertNoLease(); await beforeReceipt?.(); return receipts.get(key) ?? null; } },
    schedules: {
      async create(input, options) {
        assertNoLease(); creates.push({ input: structuredClone(input), options: { ...options, signal: undefined } }); await beforeCreate?.();
        const prior = receipts.get(options.idempotencyKey); if (prior) return prior;
        if (!currentRegistration || calendarHash(options.expectedRegistration) !== calendarHash(currentRegistration)) throw new JobsError('JOBS_AUTHORITY_RETIRED');
        const value = original(); receipts.set(options.idempotencyKey, value); return value;
      },
      async cancel(id, options) {
        assertNoLease(); cancels.push({ id, options: { ...options, signal: undefined } });
        const prior = receipts.get(options.idempotencyKey); if (prior) return prior;
        const value: JobSourceScheduleReceipt = { ...original(), revision: 2, control: 'cancelled' }; receipts.set(options.idempotencyKey, value); return value;
      },
      async get() {
        assertNoLease(); const value = receipts.get(intent.cancelKey) ?? receipts.get(intent.createKey) ?? original();
        return { schedule: { revision: value.revision, control: value.control }, receipt: value } as Awaited<ReturnType<SourceJobs['schedules']['get']>>;
      },
    },
  };
  const dispatcher = new CalendarIntegrationDispatcher({ store, jobs, now: () => time, nonce: () => 'claim-' + ++nonce, batchSize: 2 });
  return { dispatcher, store, jobs, commands, creates, cancels, receipts, registration, original,
    get intent() { return intent; }, setIntent(value: Partial<CalendarIntegrationIntentView>) { intent = { ...intent, ...value }; },
    advance(ms: number) { time += ms; }, now: () => time,
    setRegistration(value: JobSourceRegistration | null) { currentRegistration = value; },
    onCreate(callback?: () => void | Promise<void>) { beforeCreate = callback; },
    onReceipt(callback?: () => void | Promise<void>) { beforeReceipt = callback; },
    onRegistration(callback?: () => void | Promise<void>) { beforeRegistration = callback; },
    loseAck() { failAck = true; }, invalidateClaim() { generation++; }, claims: () => claimCalls,
  };
}

test('calendar handoff releases source operations, preserves original identity/time, and acknowledges only Jobs acceptance', async () => {
  const f = fixture();
  try {
    const expected = structuredClone(f.intent); const result = await f.dispatcher.runBatch();
    expect(result).toMatchObject({ claimed: 1, accepted: 1, cancelled: 0, deferred: 0 });
    expect(f.creates).toEqual([{ input: { input: expected.input, at: expected.at, maxLatenessMs: expected.maxLatenessMs, initiatedBy: expected.initiatedBy },
      options: { idempotencyKey: expected.createKey, expectedRegistration: f.registration, signal: undefined } }]);
    expect(f.intent.state).toBe('accepted'); expect(f.intent.jobsReceipt).toEqual(f.receipts.get(expected.createKey) ?? null);
    expect(Object.hasOwn(f.intent, 'torrentReceipt')).toBe(false); expect(Object.hasOwn(f.intent, 'effectOutcome')).toBe(false);
    expect((await f.dispatcher.runBatch()).claimed).toBe(0); expect(f.creates).toHaveLength(1);
  } finally { await f.dispatcher.close(); }
});

test('death before source acknowledgment reconciles the original Jobs receipt, not another schedule', async () => {
  const f = fixture();
  try {
    f.loseAck(); expect((await f.dispatcher.runBatch()).deferred).toBe(1); expect(f.intent.state).toBe('unknown');
    f.advance(1_000); expect((await f.dispatcher.runBatch()).accepted).toBe(1);
    expect(f.creates).toHaveLength(1); expect(f.receipts.size).toBe(1); expect(f.intent.state).toBe('accepted');
  } finally { await f.dispatcher.close(); }
});

test('an unknown create with a null receipt re-enters the exact original create barrier and never rekeys', async () => {
  const f = fixture(); let first = true;
  try {
    f.onCreate(() => { if (first) { first = false; throw new JobsError('JOBS_OUTCOME_UNKNOWN'); } });
    expect((await f.dispatcher.runBatch()).deferred).toBe(1); expect(f.receipts.size).toBe(0);
    f.advance(1_000); expect((await f.dispatcher.runBatch()).accepted).toBe(1);
    expect(f.creates).toHaveLength(2); expect(f.creates[0]!.input).toEqual(f.creates[1]!.input);
    expect(f.creates[0]!.options).toEqual(f.creates[1]!.options); expect(f.receipts.size).toBe(1);
    expect(f.commands.some(row => row.name === 'calendar.integration.suppress')).toBe(false);
  } finally { await f.dispatcher.close(); }
});

test('old unknown intent cannot slide into a newer source generation when original receipt is absent', async () => {
  const f = fixture();
  try {
    f.setIntent({ state: 'unknown', createAttempted: true, eligibility: 'retired' });
    f.setRegistration({ ...f.registration, generation: 3, revision: 3 });
    expect((await f.dispatcher.runBatch()).deferred).toBe(1); expect(f.creates).toHaveLength(1);
    expect(f.receipts.size).toBe(0); expect(f.commands.at(-1)!.input.code).toBe('JOBS_AUTHORITY_RETIRED');
    expect(f.commands.some(row => row.name === 'calendar.integration.suppress')).toBe(false);
  } finally { await f.dispatcher.close(); }
});

test('first obsolete/expired work is suppressed only with proven no-prior-attempt source provenance', async () => {
  const f = fixture();
  try {
    f.setIntent({ eligibility: 'superseded' }); expect((await f.dispatcher.runBatch()).suppressed).toBe(1);
    expect(f.creates).toHaveLength(0); expect(f.intent.state).toBe('suppressed');
  } finally { await f.dispatcher.close(); }
  const g = fixture();
  try {
    g.onRegistration(() => g.advance(60_001)); expect((await g.dispatcher.runBatch()).suppressed).toBe(1);
    expect(g.creates).toHaveLength(0);
  } finally { await g.dispatcher.close(); }
});

test('retired historical acceptance is still acknowledged then cancelled under its original key and CAS', async () => {
  const f = fixture();
  try {
    f.receipts.set(f.intent.createKey, f.original());
    f.setIntent({ eligibility: 'retired', state: 'unknown', createAttempted: true }); f.setRegistration(null);
    expect((await f.dispatcher.runBatch()).accepted).toBe(1); expect(f.creates).toHaveLength(0);
    expect((await f.dispatcher.runBatch()).cancelled).toBe(1);
    expect(f.cancels).toEqual([{ id: f.original().id, options: { idempotencyKey: f.intent.cancelKey, expectedRevision: 1, signal: undefined } }]);
    expect(f.intent.state).toBe('cancelled');
  } finally { await f.dispatcher.close(); }
});

test('stale acknowledgment cannot revive source state after claim supersession', async () => {
  const f = fixture();
  try {
    f.onCreate(() => { f.setIntent({ eligibility: 'superseded' }); f.invalidateClaim(); });
    expect((await f.dispatcher.runBatch()).stale).toBe(1); expect(f.intent.state).toBe('pending');
    expect(f.intent.eligibility).toBe('superseded'); expect(f.intent.jobsReceipt).toBeNull(); expect(f.receipts.size).toBe(1);
  } finally { await f.dispatcher.close(); }
});

test('capacity exhaustion is durably blocked/backed off without pruning evidence or allocating another identity', async () => {
  const f = fixture();
  try {
    f.onCreate(() => { throw new JobsError('JOBS_CAPACITY'); }); const now = f.now();
    expect((await f.dispatcher.runBatch()).deferred).toBe(1); expect(f.intent.state).toBe('blocked');
    expect(f.commands.at(-1)!.input).toMatchObject({ code: 'JOBS_CAPACITY', retryAt: now + 5_000, unknown: false });
    expect((await f.dispatcher.runBatch()).claimed).toBe(0); expect(f.creates).toHaveLength(1); expect(f.receipts.size).toBe(0);
    expect(f.intent.createAttempted).toBe(false); f.advance(60_001);
    expect((await f.dispatcher.runBatch()).suppressed).toBe(1); expect(f.creates).toHaveLength(1);
  } finally { await f.dispatcher.close(); }
});

test('unhydrated or asynchronous capability lookup never manufactures a writer attempt or prevents later expiry', async () => {
  for (const resolver of ['unhydrated', 'asynchronous'] as const) {
    const f = fixture();
    const dispatcher = new CalendarIntegrationDispatcher({ store: f.store, now: f.now, nonce: () => 'factory-' + resolver,
      jobs: resolver === 'unhydrated' ? () => { throw new CalendarError('CALENDAR_NOT_READY'); }
        : (() => Promise.reject(new CalendarError('CALENDAR_NOT_READY'))) as unknown as () => CalendarIntegrationDispatchJobs });
    try {
      expect((await dispatcher.runBatch()).deferred).toBe(1); expect(f.intent.createAttempted).toBe(false);
      expect(f.commands.at(-1)!.input).toMatchObject({ unknown: false, notCommitted: true });
      expect(f.creates).toHaveLength(0); f.advance(60_001);
      // The retained native capability is now hydrated; no old invocation ever
      // existed, so its source provenance safely permits expired suppression.
      expect((await f.dispatcher.runBatch()).suppressed).toBe(1); expect(f.creates).toHaveLength(0);
    } finally { await dispatcher.close(); await f.dispatcher.close(); }
  }
});

test('foreign schedule or policy-generation receipts are never acknowledged as source acceptance', async () => {
  const f = fixture();
  try {
    f.receipts.set(f.intent.createKey, { ...f.original(), policyGeneration: 2 });
    expect((await f.dispatcher.runBatch()).deferred).toBe(1); expect(f.intent.jobsReceipt).toBeNull();
    expect(f.commands.some(row => row.name === 'calendar.integration.ack')).toBe(false); expect(f.creates).toHaveLength(0);
  } finally { await f.dispatcher.close(); }
});

test('wakes coalesce into one bounded empty batch and close leaves uncertain claims recoverable', async () => {
  const f = fixture();
  try {
    f.setIntent({ state: 'suppressed' }); for (let n = 0; n < 20; n++) f.dispatcher.wake();
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    expect(f.claims()).toBe(1); expect(f.creates).toHaveLength(0);
  } finally { await f.dispatcher.close(); }
  const g = fixture(), barrier = latch();
  g.onCreate(() => barrier.wait());
  const running = g.dispatcher.runBatch().then(value => ({ value }), error => ({ error }));
  try {
    await barrier.entered; const closing = g.dispatcher.close(); barrier.release(); await closing;
    expect(await running).toHaveProperty('error'); expect(g.intent.jobsReceipt).toBeNull();
    expect(g.commands.some(row => row.name === 'calendar.integration.suppress')).toBe(false);
  } finally { barrier.release(); await running; await g.dispatcher.close(); }
});
