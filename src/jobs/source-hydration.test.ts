/** Native hydration/pin tests; MEMORY writer/Torrent unless explicitly labelled
 * broker-only transport double. No files, identity deletion or timer fixture. */
import { expect, spyOn, test } from 'bun:test';
import { WorkPool } from '../workers/work-pool';
import { JobsSourceBroker, type SourceJobs } from './source-service';
import { createTrustedJobSource, requireJobSource } from './source-authority';
import type { JobsRuntime } from './runtime';
import { JobsService } from './service';
import type { JobAdmission } from './model';
import { JobsError } from './error';
import { jobSourceId, type JobSourceContract, type JobSourceRegistration } from './source-model';
import { jobHash } from './validation';
import { readJobSettlementSnapshot } from './settlement-model';
import { memorySourceJobsFixture, untilMemoryJobs } from './test-support/memory-source-fixture';

const activation = { expectedRevision: 0, idempotencyKey: 'original-hydration-activation', pinInput: { synthetic: true } };
function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }
function sourceBroker(f: Awaited<ReturnType<typeof memorySourceJobsFixture>>): JobsSourceBroker {
  return (f.service as unknown as { sources: JobsSourceBroker }).sources;
}

for (const capacity of [1, 4]) test(`demand attachment progresses with all ${capacity} schedule-pool slots held, using independent source-control capacity`, async () => {
  const f = await memorySourceJobsFixture({ nativeWriter: true });
  const service = new JobsService({ config: { ...f.config, concurrency: capacity }, runtime: f.runtime, bridge: f.bridge, now: f.now });
  const native = service as unknown as { gate: WorkPool; sourceGate: WorkPool; sources: JobsSourceBroker };
  const allEntered = deferred(), pending: Promise<unknown>[] = []; let callbacks = 0;
  try {
    const selected = new Map<string, { scope: ReturnType<typeof f.source>['scope']; api: SourceJobs; registration: JobSourceRegistration; admission: JobAdmission }>();
    for (let index = 0; index < capacity; index++) {
      const source = f.source({ identity: { databaseId: 'synthetic-demand-capacity-' + index } }), api = service.forSource(source.capability);
      const registration = await api.registration.activate(activation);
      const work = await api.schedules.create({ input: { nested: { value: index } }, at: new Date(f.now() + 1000).toISOString() }, { idempotencyKey: 'demand-capacity-work-' + index });
      const { admission } = await api.schedules.get(work.id); selected.set(registration.id, { scope: source.scope, api, registration, admission });
      expect(api.hydration!.tryDetach()).toBe('detached');
    }
    const commands = f.commands.length, sequence = f.torrentDb.currentSeq, original = f.native([...selected.values()][0]!.scope)!.engine.inspectAdmission();
    service.bindNativeSourceHydrator(async (scope, admission, signal) => {
      const entry = selected.get(admission.source!.id)!; callbacks++;
      expect(admission).not.toBe(entry.admission); expect(Object.isFrozen(admission)).toBe(true); expect(Object.isFrozen(scope)).toBe(true);
      expect(f.stats().activeLeases).toBe(0);
      if (callbacks === capacity) allEntered.resolve();
      await allEntered.promise;
      expect(native.gate.status()).toMatchObject({ active: capacity, queued: 0 });
      await entry.api.hydration!.attach({ originalActivateKey: activation.idempotencyKey, expectedRegistration: entry.registration, pinInput: {}, signal });
      return true;
    });
    expect(native.gate).not.toBe(native.sourceGate);
    for (const entry of selected.values()) pending.push(native.gate.run(async () => {
      const pin = await native.sources.prepareDispatch(entry.scope, entry.admission);
      try { return await pin.run(() => { pin.assertCurrent(); return 'attached'; }); } finally { pin.abandon(); }
    }, { key: 'schedule-demand:' + entry.admission.id }));
    await allEntered.promise; expect(await Promise.all(pending)).toEqual(new Array(capacity).fill('attached'));
    expect(callbacks).toBe(capacity); expect(service.diagnostics()).toMatchObject({ gate: { active: 0, queued: 0 }, sourceGate: { active: 0, queued: 0 } });
    expect(f.native([...selected.values()][0]!.scope)!.engine.inspectAdmission()).toEqual(original);
    expect(f.commands).toHaveLength(commands); expect(f.torrentDb.currentSeq).toBe(sequence); expect(f.calls).toHaveLength(0);
  } finally {
    allEntered.resolve(); await Promise.allSettled(pending);
    try { await service.close(); } finally { await f.close(); }
  }
});

test('native hydrator binding is construction-only, once per lifetime, proxy-safe and idempotently unregisterable', async () => {
  const f = await memorySourceJobsFixture({ nativeWriter: true });
  try {
    let invoked = 0;
    const callback = () => { invoked++; return false; }, proxy = new Proxy(callback, { apply() { throw new Error('proxy must not run'); } });
    expect(() => f.service.bindNativeSourceHydrator(proxy)).toThrow(expect.objectContaining({ code: 'JOBS_CONFIG_INVALID' }));
    const remove = f.service.bindNativeSourceHydrator(callback);
    expect(() => f.service.bindNativeSourceHydrator(callback)).toThrow(expect.objectContaining({ code: 'JOBS_CONFIG_INVALID' }));
    const source = f.source(); await source.api.registration.activate(activation);
    const created = await source.api.schedules.create({ input: {}, at: new Date(f.now() + 1000).toISOString() }, { idempotencyKey: 'binding-work' });
    const { admission } = await source.api.schedules.get(created.id), broker = sourceBroker(f);
    const live = await broker.prepareDispatch(source.scope, admission); live.abandon(); expect(invoked).toBe(0);
    remove(); remove(); expect(source.api.hydration!.tryDetach()).toBe('detached');
    await expect(broker.prepareDispatch(source.scope, admission)).rejects.toMatchObject({ code: 'JOBS_NOT_READY' });
    expect(invoked).toBe(0); expect(() => f.service.bindNativeSourceHydrator(callback)).toThrow(expect.objectContaining({ code: 'JOBS_CONFIG_INVALID' }));
  } finally { await f.close(); }
  const unbound = await memorySourceJobsFixture();
  try {
    await unbound.service.tick();
    expect(() => unbound.service.bindNativeSourceHydrator(() => false)).toThrow(expect.objectContaining({ code: 'JOBS_NOT_READY' }));
  } finally { await unbound.close(); }
});

for (const outcome of ['unmapped', 'true-without-attach', 'unselected', 'local-retired', 'failure', 'truthy'] as const)
  test(`demand ${outcome} is recoverable not-ready, never registration fallback or guessed durable retirement`, async () => {
    const f = await memorySourceJobsFixture({ nativeWriter: true }); let callbacks = 0;
    try {
      f.service.bindNativeSourceHydrator(() => {
        callbacks++;
        if (outcome === 'unselected') throw new JobsError('JOBS_NOT_READY');
        if (outcome === 'local-retired') throw new JobsError('JOBS_AUTHORITY_RETIRED');
        if (outcome === 'failure') throw new Error('synthetic native proof failed');
        if (outcome === 'truthy') return {} as unknown as boolean;
        return outcome === 'true-without-attach';
      });
      const source = f.source(); await source.api.registration.activate(activation);
      const work = await source.api.schedules.create({ input: {}, at: new Date(f.now() + 1000).toISOString() }, { idempotencyKey: 'refused-demand-work' });
      const { admission } = await source.api.schedules.get(work.id); source.api.hydration!.tryDetach();
      const before = f.native(source.scope)!.engine.inspectAdmission(), commands = f.commands.length;
      await expect(sourceBroker(f).prepareDispatch(source.scope, admission)).rejects.toMatchObject({ code: 'JOBS_NOT_READY' });
      expect(callbacks).toBe(1); expect(source.api.hydration!.inspect()).toMatchObject({ attached: false, preparing: 0 });
      expect(f.native(source.scope)!.engine.inspectAdmission()).toEqual(before); expect(f.commands).toHaveLength(commands);
      expect(f.rows(source.scope, '_jobs_sources')[0]?.state).toBe('active'); expect(f.rows(source.scope, '_jobs_occurrences')).toHaveLength(0);
    } finally { await f.close(); }
  });

test('a demand not-ready keeps a real runner occurrence recoverable, with no permanent block or fresh registration', async () => {
  const f = await memorySourceJobsFixture({ nativeWriter: true }); let callbacks = 0;
  try {
    f.service.bindNativeSourceHydrator(() => { callbacks++; return false; });
    const source = f.source(); await source.api.registration.activate(activation);
    await source.api.schedules.create({ input: {}, at: new Date(f.now() + 1000).toISOString() }, { idempotencyKey: 'recoverable-demand' });
    source.api.hydration!.tryDetach(); const registrations = f.commands.filter(row => row.name === 'jobs.source.register').length;
    f.advance(1000); await f.tick();
    expect(callbacks).toBe(1); expect(f.rows(source.scope, '_jobs_occurrences')[0]).toMatchObject({ state: 'claimed', error_code: null });
    expect(f.commands.filter(row => row.name === 'jobs.source.register')).toHaveLength(registrations);
    expect(f.commands.some(row => row.name === 'jobs.claim.defer')).toBe(true);
    expect((await source.api.capacity.get())!.working.sourceSchedules.used).toBe(1); expect(f.calls).toHaveLength(0);
  } finally { await f.close(); }
});

test('a real native runner demand-attaches the original source read-only and starts Torrent once without another registration or logical key', async () => {
  const f = await memorySourceJobsFixture({ nativeWriter: true }); let callbacks = 0;
  try {
    const source = f.source(), registration = await source.api.registration.activate(activation);
    const work = await source.api.schedules.create({ input: { value: 'original-demand' }, at: new Date(f.now() + 1000).toISOString() }, { idempotencyKey: 'actual-runner-demand' });
    f.service.bindNativeSourceHydrator(async (scope, admission, signal) => {
      callbacks++; expect(scope).toEqual(source.scope); expect(admission.source!.id).toBe(registration.id);
      expect(f.stats().activeLeases).toBe(0);
      await source.api.hydration!.attach({ originalActivateKey: activation.idempotencyKey, expectedRegistration: registration, pinInput: {}, signal });
      return true;
    });
    source.api.hydration!.tryDetach(); const registrations = f.commands.filter(row => row.name === 'jobs.source.register').length;
    f.advance(1000); await f.tick();
    await untilMemoryJobs(() => f.calls.length === 1 && f.torrentDb.list('workflow_instances')[0]?.status === 'completed');
    f.advance(1001); await f.tick();
    expect(callbacks).toBe(1); expect(f.calls).toEqual([{ value: 'original-demand' }]); expect(f.torrentDb.list('workflow_instances')).toHaveLength(1);
    expect(f.rows(source.scope, '_jobs_occurrences')[0]?.state).toBe('terminal');
    expect(f.commands.filter(row => row.name === 'jobs.source.register')).toHaveLength(registrations);
    expect(f.rows(source.scope, '_jobs_source_intents')).toHaveLength(2); expect(f.rows(source.scope, 'job_schedules')).toHaveLength(1);
    expect(await source.api.receipts.get('actual-runner-demand')).toEqual(work); expect(await source.api.receipts.get(activation.idempotencyKey)).toEqual(registration);
    expect(source.api.hydration!.inspect()).toMatchObject({ attached: true, preparing: 0, queued: 0, active: 0, activeDispatch: 0, preparedDispatch: 0 });
  } finally { await f.close(); }
});

test('durable-current admission with a stale local source stays recoverable; durable-old origin remains definitively retired', async () => {
  const f = await memorySourceJobsFixture({ nativeWriter: true });
  // Two native facade views over the actual same MEMORY writer model a local
  // broker that missed another admitted control's current durable generation.
  // Physical Jobs transport/owner leasing remains explicitly fixture-simulated.
  const currentService = new JobsService({ config: f.config, runtime: f.runtime, bridge: f.bridge, now: f.now });
  try {
    const prior = f.source(); await prior.api.registration.activate(activation);
    const old = await prior.api.schedules.create({ input: { value: 'old-origin' }, at: new Date(f.now() + 60_000).toISOString() }, { idempotencyKey: 'old-origin-work' });
    const oldAdmission = (await prior.api.schedules.get(old.id)).admission;
    const current = f.source({ policyVersion: 'B' }), currentApi = currentService.forSource(current.capability), activateKey = 'native-current-B';
    const registration = await currentApi.registration.activate({ expectedRevision: 1, idempotencyKey: activateKey, pinInput: {} });
    const work = await currentApi.schedules.create({ input: { value: 'durable-current' }, at: new Date(f.now() + 1000).toISOString() }, { idempotencyKey: 'durable-current-work' });
    const admission = (await currentApi.schedules.get(work.id)).admission;
    expect(prior.api.hydration!.inspect().attached).toBe(true); expect(registration.generation).toBe(2);
    await expect(sourceBroker(f).prepareDispatch(prior.scope, admission)).rejects.toMatchObject({ code: 'JOBS_NOT_READY' });
    await expect(sourceBroker(f).prepareDispatch(prior.scope, oldAdmission)).rejects.toMatchObject({ code: 'JOBS_AUTHORITY_RETIRED' });
    f.advance(1000); await f.tick();
    expect(f.rows(prior.scope, '_jobs_occurrences').find(row => row.schedule_id === work.id)).toMatchObject({ state: 'claimed', error_code: null });
    expect(f.commands.some(row => row.name === 'jobs.claim.defer')).toBe(true); expect(f.commands.some(row => row.name === 'jobs.block')).toBe(false);
    expect(f.calls).toHaveLength(0);
    const localCurrent = f.service.forSource(current.capability), before = f.native(prior.scope)!.engine.inspectAdmission();
    await localCurrent.hydration!.attach({ originalActivateKey: activateKey, expectedRegistration: registration, pinInput: {} });
    expect(f.native(prior.scope)!.engine.inspectAdmission()).toEqual(before);
    f.advance(1001); await f.tick();
    await untilMemoryJobs(() => f.calls.length === 1 && f.torrentDb.list('workflow_instances')[0]?.status === 'completed');
    f.advance(1001); await f.tick();
    expect(f.rows(prior.scope, '_jobs_occurrences').find(row => row.schedule_id === work.id)?.state).toBe('terminal');
    expect(f.calls).toEqual([{ value: 'durable-current' }]); expect(f.commands.filter(row => row.name === 'jobs.source.register')).toHaveLength(2);
    await expect(sourceBroker(f).prepareDispatch(prior.scope, oldAdmission)).rejects.toMatchObject({ code: 'JOBS_AUTHORITY_RETIRED' });
  } finally { try { await f.service.drain(); await currentService.close(); } finally { await f.close(); } }
});

test('demand completion re-proves the retained original generation; only native durable retirement yields authority-retired', async () => {
  const f = await memorySourceJobsFixture({ nativeWriter: true }), entered = deferred(), held = deferred();
  let preparing: Promise<unknown> | undefined, callbacks = 0;
  try {
    f.service.bindNativeSourceHydrator(async () => { callbacks++; entered.resolve(); await held.promise; return true; });
    const source = f.source(); await source.api.registration.activate(activation);
    const work = await source.api.schedules.create({ input: {}, at: new Date(f.now() + 1000).toISOString() }, { idempotencyKey: 'durable-reproof-work' });
    const { admission } = await source.api.schedules.get(work.id); source.api.hydration!.tryDetach();
    preparing = sourceBroker(f).prepareDispatch(source.scope, admission).then(value => ({ value }), error => ({ error }));
    await entered.promise; await source.api.registration.retire({ expectedRevision: 1, idempotencyKey: 'retired-during-demand' });
    held.resolve(); expect(await preparing).toMatchObject({ error: { code: 'JOBS_AUTHORITY_RETIRED' } });
    await expect(sourceBroker(f).prepareDispatch(source.scope, admission)).rejects.toMatchObject({ code: 'JOBS_AUTHORITY_RETIRED' });
    expect(callbacks).toBe(1); expect(source.api.hydration!.inspect()).toMatchObject({ attached: false, preparing: 0 });
  } finally { held.resolve(); await preparing; await f.close(); }
});

test('unregister and final close cannot release a cancelled outer demand pin before its native callback physically settles', async () => {
  const f = await memorySourceJobsFixture({ nativeWriter: true }), entered = deferred(), held = deferred();
  const providerClose = spyOn(f.runtime, 'close');
  let preparing: Promise<unknown> | undefined, closing: Promise<unknown> | undefined, callbackSignal: AbortSignal | undefined;
  try {
    const remove = f.service.bindNativeSourceHydrator(async (_scope, _admission, signal) => { callbackSignal = signal; entered.resolve(); await held.promise; return true; });
    const source = f.source(); await source.api.registration.activate(activation);
    const work = await source.api.schedules.create({ input: {}, at: new Date(f.now() + 1000).toISOString() }, { idempotencyKey: 'late-demand' });
    const { admission } = await source.api.schedules.get(work.id); source.api.hydration!.tryDetach();
    preparing = sourceBroker(f).prepareDispatch(source.scope, admission);
    await entered.promise; await expect(Promise.race([preparing, Promise.reject(new JobsError('JOBS_OUTCOME_UNKNOWN'))])).rejects.toMatchObject({ code: 'JOBS_OUTCOME_UNKNOWN' });
    remove(); remove(); expect(callbackSignal!.aborted).toBe(true);
    expect(f.service.tryDetachSources([source.api])).toBe('busy'); expect(source.api.hydration!.inspect().preparing).toBe(1);
    let closed = false; closing = f.service.close().then(() => { closed = true; });
    await Bun.sleep(5); expect(closed).toBe(false); expect(providerClose).not.toHaveBeenCalled();
    held.resolve(); await expect(preparing).rejects.toMatchObject({ code: 'JOBS_NOT_READY' }); await closing;
    expect(providerClose).toHaveBeenCalledTimes(1); expect(f.calls).toHaveLength(0);
    expect(f.service.diagnostics()).toMatchObject({ gate: { state: 'closed' }, sourceGate: { state: 'closed' }, persistence: { closed: true } });
  } finally {
    held.resolve(); await Promise.allSettled([preparing, closing].filter((value): value is Promise<unknown> => !!value));
    try { await f.close(); } finally { providerClose.mockRestore(); }
  }
});

test('early drainage joins a real runner demand body while leaving source evidence control capacity open', async () => {
  const f = await memorySourceJobsFixture({ nativeWriter: true }), entered = deferred(), held = deferred(); let draining: Promise<unknown> | undefined;
  try {
    f.service.bindNativeSourceHydrator(async () => { entered.resolve(); await held.promise; return true; });
    const source = f.source(), registered = await source.api.registration.activate(activation);
    await source.api.schedules.create({ input: {}, at: new Date(f.now() + 1000).toISOString() }, { idempotencyKey: 'drain-demand' });
    source.api.hydration!.tryDetach(); f.advance(1000); f.enableDiscovery(); await f.service.tick(); await entered.promise;
    let drained = false; draining = f.service.drain().then(() => { drained = true; });
    await Bun.sleep(5); expect(drained).toBe(false);
    expect(f.service.diagnostics()).toMatchObject({ gate: { state: 'open', active: 1 }, sourceGate: { state: 'open' }, persistence: { closed: false } });
    expect(await source.api.registration.reconcile(activation.idempotencyKey)).toEqual(registered);
    held.resolve(); await draining;
    expect(f.service.diagnostics()).toMatchObject({ gate: { state: 'open', active: 0 }, sourceGate: { state: 'open', active: 0 } });
    expect(await source.api.registration.reconcile(activation.idempotencyKey)).toEqual(registered); expect(f.calls).toHaveLength(0);
  } finally { held.resolve(); await draining; await f.close(); }
});

test('native set detach refuses a later busy source with zero partial release, then releases the exact duplicate-containing set without writes', async () => {
  const f = await memorySourceJobsFixture({ nativeWriter: true });
  try {
    const first = f.source(), second = f.source({ identity: { databaseId: 'synthetic-second-owner' } });
    await first.api.registration.activate(activation); await second.api.registration.activate(activation);
    const work = await second.api.schedules.create({ input: {}, at: new Date(f.now() + 1000).toISOString() }, { idempotencyKey: 'set-detach-pinned' });
    const { admission } = await second.api.schedules.get(work.id), pin = await sourceBroker(f).prepareDispatch(second.scope, admission);
    const before = f.native(first.scope)!.engine.inspectAdmission(), commands = f.commands.length, sequence = f.torrentDb.currentSeq;
    expect(f.service.tryDetachSources([first.api, second.api])).toBe('busy');
    expect(first.api.hydration!.inspect().attached).toBe(true); expect(second.api.hydration!.inspect().attached).toBe(true);
    pin.abandon();
    expect(f.service.tryDetachSources([first.api, first.api, second.api])).toBe('detached');
    expect(first.api.hydration!.inspect()).toMatchObject({ attached: false, residentSources: 0 });
    expect(second.api.hydration!.inspect().attached).toBe(false);
    expect(await second.api.receipts.get('set-detach-pinned')).toEqual(work);
    expect(f.native(first.scope)!.engine.inspectAdmission()).toEqual(before);
    expect(f.commands).toHaveLength(commands); expect(f.torrentDb.currentSeq).toBe(sequence); expect(f.calls).toHaveLength(0);
    expect(f.rows(first.scope, '_jobs_sources')).toHaveLength(2);
  } finally { await f.close(); }
});

test('set detach requires the exact current capability among selected/prior handles; absent members succeed without deleting another replacement', async () => {
  const f = await memorySourceJobsFixture({ nativeWriter: true });
  try {
    const first = f.source(), prior = f.source({ identity: { databaseId: 'synthetic-prior-owner' } });
    await first.api.registration.activate(activation); const registration = await prior.api.registration.activate(activation);
    const replacement = f.source({ identity: prior.identity });
    await replacement.api.hydration!.attach({ originalActivateKey: activation.idempotencyKey, expectedRegistration: registration, pinInput: {} });
    prior.retireEligibility();
    const before = f.native(first.scope)!.engine.inspectAdmission(), commands = f.commands.length;
    expect(f.service.tryDetachSources([first.api, prior.api])).toBe('not-current');
    expect(first.api.hydration!.inspect().attached).toBe(true); expect(replacement.api.hydration!.inspect().attached).toBe(true);
    expect(f.service.tryDetachSources([prior.api])).toBe('not-current');
    expect(f.service.tryDetachSources([first.api, prior.api, replacement.api])).toBe('detached');
    expect(first.api.hydration!.inspect().residentSources).toBe(0);
    expect(f.service.tryDetachSources([prior.api, replacement.api, first.api])).toBe('detached');
    expect(f.service.tryDetachSources([])).toBe('detached');
    expect(await prior.api.receipts.get(activation.idempotencyKey)).toEqual(registration);
    expect(f.native(first.scope)!.engine.inspectAdmission()).toEqual(before); expect(f.commands).toHaveLength(commands);
  } finally { await f.close(); }
});

test('absence-only expected IDs refuse a bare prior coordinator binding and never grant deletion authority or partial release', async () => {
  const f = await memorySourceJobsFixture({ nativeWriter: true });
  try {
    const selected = f.source(), prior = f.source({ identity: { databaseId: 'synthetic-bare-prior-coordinator' } });
    const registration = await selected.api.registration.activate(activation), old = await prior.api.registration.activate(activation);
    const before = f.native(selected.scope)!.engine.inspectAdmission(), commands = f.commands.length;
    expect(f.service.tryDetachSources([], [old.id])).toBe('not-current');
    expect(prior.api.hydration!.inspect().attached).toBe(true);
    expect(f.service.tryDetachSources([selected.api], [old.id])).toBe('not-current');
    expect(selected.api.hydration!.inspect().attached).toBe(true); expect(prior.api.hydration!.inspect().attached).toBe(true);
    expect(f.service.tryDetachSources([selected.api, prior.api], [old.id, registration.id, old.id])).toBe('detached');
    expect(f.service.tryDetachSources([], [old.id, registration.id])).toBe('detached');
    expect(f.native(selected.scope)!.engine.inspectAdmission()).toEqual(before); expect(f.commands).toHaveLength(commands);
    expect(await prior.api.registration.get()).toEqual(old);
  } finally { await f.close(); }
});

test('an expected absent source still pins the entire set until its original retired dispatch body physically settles', async () => {
  const f = await memorySourceJobsFixture({ nativeWriter: true }), held = deferred(); let body: Promise<unknown> | undefined;
  try {
    const selected = f.source(), retiring = f.source({ identity: { databaseId: 'synthetic-expected-physical-pin' } });
    await selected.api.registration.activate(activation); const registration = await retiring.api.registration.activate(activation);
    const created = await retiring.api.schedules.create({ input: {}, at: new Date(f.now() + 1000).toISOString() }, { idempotencyKey: 'expected-pin-work' });
    const { admission } = await retiring.api.schedules.get(created.id), pin = await sourceBroker(f).prepareDispatch(retiring.scope, admission);
    body = pin.run(async () => { await held.promise; pin.assertCurrent(); });
    await retiring.api.registration.retire({ expectedRevision: 1, idempotencyKey: 'retire-expected-pin' });
    expect(retiring.api.hydration!.inspect()).toMatchObject({ attached: false, activeDispatch: 1 });
    expect(f.service.tryDetachSources([selected.api], [registration.id])).toBe('busy');
    expect(selected.api.hydration!.inspect().attached).toBe(true);
    held.resolve(); await expect(body).rejects.toMatchObject({ code: 'JOBS_NOT_READY' });
    expect(f.service.tryDetachSources([selected.api], [registration.id])).toBe('detached');
    expect(await retiring.api.receipts.get('expected-pin-work')).not.toBeNull();
  } finally { held.resolve(); await body?.catch(() => {}); await f.close(); }
});

test('absence predicates reject malformed/proxy/accessor/oversized ID containers before any owner guard or detach', async () => {
  const f = await memorySourceJobsFixture({ nativeWriter: true });
  try {
    const source = f.source(), registration = await source.api.registration.activate(activation); let evaluated = 0;
    const bomb = () => { evaluated++; throw new Error('ID accessor evaluated'); }, accessor = new Array(1);
    Object.defineProperty(accessor, '0', { get: bomb });
    const proxy = new Proxy([registration.id], { get: bomb, ownKeys: bomb }), revoked = Proxy.revocable([registration.id], {}); revoked.revoke();
    const invalid: unknown[] = [null, {}, accessor, proxy, revoked.proxy, ['not-a-source'], [registration.id.toUpperCase()], [0], new Array(1025).fill(registration.id), [registration.id, ,]];
    const checks = f.stats().ownerChecks;
    for (const ids of invalid) expect(() => f.service.tryDetachSources([source.api], ids as readonly string[])).toThrow(expect.objectContaining({ code: 'JOBS_INPUT_INVALID' }));
    expect(evaluated).toBe(0); expect(f.stats().ownerChecks).toBe(checks); expect(source.api.hydration!.inspect().attached).toBe(true);
  } finally { await f.close(); }
});

test('set detach rejects foreign, spoofed, accessor, proxy and oversized containers without evaluating supplied code or releasing any source', async () => {
  const f = await memorySourceJobsFixture({ nativeWriter: true }), foreign = await memorySourceJobsFixture();
  try {
    const source = f.source(); await source.api.registration.activate(activation);
    let evaluated = 0;
    const bomb = () => { evaluated++; throw new Error('untrusted handle code evaluated'); };
    const accessor = {}; Object.defineProperty(accessor, 'hydration', { get: bomb });
    const arrayAccessor = new Array(1); Object.defineProperty(arrayAccessor, '0', { enumerable: true, get: bomb });
    const extra = [source.api]; Object.defineProperty(extra, 'extra', { get: bomb });
    const proxy = new Proxy(source.api, { get: bomb, getOwnPropertyDescriptor: bomb, ownKeys: bomb });
    const arrayProxy = new Proxy([source.api], { get: bomb, getOwnPropertyDescriptor: bomb, ownKeys: bomb });
    const revoked = Proxy.revocable([source.api], {}); revoked.revoke();
    const invalid: unknown[] = [null, {}, [foreign.source().api], [{ ...source.api }], [accessor], [proxy], arrayAccessor,
      arrayProxy, revoked.proxy, new Array(1025).fill(source.api), [source.api, ,], extra, Object.setPrototypeOf([source.api], null)];
    const before = f.commands.length, checks = f.stats().ownerChecks;
    for (const handles of invalid) expect(() => f.service.tryDetachSources(handles as readonly SourceJobs[])).toThrow(expect.objectContaining({ code: 'JOBS_INPUT_INVALID' }));
    expect(f.stats().ownerChecks).toBe(checks); expect(evaluated).toBe(0);
    expect(source.api.hydration!.inspect().attached).toBe(true); expect(f.commands).toHaveLength(before);
  } finally { try { await foreign.close(); } finally { await f.close(); } }
});

test('a later rejecting owner guard releases none of the set; quiesce retains owner-only release but final close refuses even an empty set', async () => {
  const f = await memorySourceJobsFixture({ nativeWriter: true }); let refuse = false;
  try {
    const first = f.source(), second = f.source({ identity: { databaseId: 'synthetic-guard-owner' } });
    const original = requireJobSource(second.capability), capability = createTrustedJobSource({ ...original, assertOwnerCurrent() {
      original.assertOwnerCurrent(); if (refuse) throw new JobsError('JOBS_AUTHORITY_RETIRED');
    } }), api = f.service.forSource(capability);
    await first.api.registration.activate(activation); await api.registration.activate(activation); refuse = true;
    expect(() => f.service.tryDetachSources([first.api, api])).toThrow(expect.objectContaining({ code: 'JOBS_AUTHORITY_RETIRED' }));
    refuse = false; expect(first.api.hydration!.inspect().attached).toBe(true); expect(api.hydration!.inspect().attached).toBe(true);
    f.service.quiesce(); expect(f.service.tryDetachSources([first.api, api])).toBe('detached');
    expect(await api.registration.get()).toMatchObject({ state: 'active', generation: 1 });
    await f.service.close();
    expect(() => f.service.tryDetachSources([])).toThrow(expect.objectContaining({ code: 'JOBS_NOT_READY' }));
    expect(() => first.api.hydration!.tryDetach()).toThrow(expect.objectContaining({ code: 'JOBS_NOT_READY' }));
  } finally { refuse = false; await f.close(); }
});

test('a guard cannot reenter individual/set deletion and partially mutate an outer all-or-nothing validation', async () => {
  const f = await memorySourceJobsFixture({ nativeWriter: true }); let armed = false, nested: unknown, observed = false;
  try {
    const first = f.source(), second = f.source({ identity: { databaseId: 'synthetic-reentrant-guard' } });
    const original = requireJobSource(second.capability), capability = createTrustedJobSource({ ...original, assertOwnerCurrent() {
      original.assertOwnerCurrent();
      if (armed) { armed = false; nested = first.api.hydration!.tryDetach(); observed = first.api.hydration!.inspect().attached; }
    } }), api = f.service.forSource(capability);
    await first.api.registration.activate(activation); await api.registration.activate(activation); armed = true;
    expect(f.service.tryDetachSources([first.api, api])).toBe('detached');
    expect(nested).toBe('busy'); expect(observed).toBe(true);
    expect(first.api.hydration!.inspect().residentSources).toBe(0);
  } finally { armed = false; await f.close(); }
});

test('all guards precede the final pin/membership check when a later guard starts read-only replacement for an earlier source', async () => {
  const held = deferred(); let armed = false, hold = false, entered = false, attaching: Promise<unknown> | undefined;
  const f = await memorySourceJobsFixture({ nativeWriter: true, async beforeRead(operation) {
    if (hold && operation.name === 'jobs.source.receipt') { entered = true; await held.promise; }
  } });
  try {
    const first = f.source(), registration = await first.api.registration.activate(activation), replacement = f.source({ identity: first.identity });
    const second = f.source({ identity: { databaseId: 'synthetic-late-guard' } }), original = requireJobSource(second.capability);
    const capability = createTrustedJobSource({ ...original, assertOwnerCurrent() {
      original.assertOwnerCurrent();
      if (armed) {
        armed = false;
        attaching = replacement.api.hydration!.attach({ originalActivateKey: activation.idempotencyKey, expectedRegistration: registration, pinInput: {} });
      }
    } }), api = f.service.forSource(capability);
    await api.registration.activate(activation); const before = f.commands.length; armed = true; hold = true;
    expect(f.service.tryDetachSources([first.api, api])).toBe('busy');
    await untilMemoryJobs(() => entered && f.stats().backendLeases === 0);
    expect(first.api.hydration!.inspect().attached).toBe(true); expect(api.hydration!.inspect().attached).toBe(true);
    held.resolve(); await attaching;
    expect(first.api.hydration!.inspect().attached).toBe(false); expect(replacement.api.hydration!.inspect().attached).toBe(true);
    expect(f.service.tryDetachSources([first.api, api])).toBe('not-current'); expect(api.hydration!.inspect().attached).toBe(true);
    expect(f.service.tryDetachSources([first.api, replacement.api, api])).toBe('detached'); expect(f.commands).toHaveLength(before);
  } finally { armed = false; held.resolve(); await attaching?.catch(() => {}); await f.close(); }
});

test('set detach retains every member while a later dispatch body stays physical after outer timeout', async () => {
  const f = await memorySourceJobsFixture({ nativeWriter: true }), held = deferred(); let body: Promise<unknown> | undefined;
  try {
    const first = f.source(), second = f.source({ identity: { databaseId: 'synthetic-set-active-dispatch' } });
    await first.api.registration.activate(activation); await second.api.registration.activate(activation);
    const work = await second.api.schedules.create({ input: {}, at: new Date(f.now() + 1000).toISOString() }, { idempotencyKey: 'set-active-dispatch' });
    const { admission } = await second.api.schedules.get(work.id), pin = await sourceBroker(f).prepareDispatch(second.scope, admission);
    body = pin.run(async () => { await held.promise; pin.assertCurrent(); return 'settled'; });
    await expect(Promise.race([body, Promise.reject(new JobsError('JOBS_OUTCOME_UNKNOWN'))])).rejects.toMatchObject({ code: 'JOBS_OUTCOME_UNKNOWN' });
    expect(f.service.tryDetachSources([first.api, second.api])).toBe('busy'); expect(pin.abandon()).toBe(false);
    expect(first.api.hydration!.inspect().attached).toBe(true); expect(second.api.hydration!.inspect().activeDispatch).toBe(1);
    held.resolve(); expect(await body).toBe('settled');
    expect(f.service.tryDetachSources([first.api, second.api])).toBe('detached'); expect(f.calls).toHaveLength(0);
  } finally { held.resolve(); await body?.catch(() => {}); await f.close(); }
});

test('native detach and exact read-only attach preserve original receipts/history/working obligations and spend no key', async () => {
  const f = await memorySourceJobsFixture({ nativeWriter: true });
  try {
    const source = f.source(), registered = await source.api.registration.activate(activation);
    const created = await source.api.schedules.create({ input: { synthetic: true }, at: new Date(f.now() + 1000).toISOString() }, { idempotencyKey: 'original-work' });
    const native = f.native(source.scope)!, before = native.engine.inspectAdmission(), commands = f.commands.length, torrentSequence = f.torrentDb.currentSeq;
    expect(source.api.hydration!.inspect()).toMatchObject({ attached: true, residentSources: 1, queued: 0, active: 0, preparing: 0 });
    expect(source.api.hydration!.tryDetach()).toBe('detached'); expect(source.api.hydration!.inspect().attached).toBe(false);
    expect(await source.api.receipts.get(activation.idempotencyKey)).toEqual(registered);
    expect(await source.api.receipts.get('original-work')).toEqual(created);
    expect((await source.api.capacity.get())!.working.sourceSchedules.used).toBe(1);
    await expect(source.api.schedules.create({ input: {}, at: new Date(f.now() + 1000).toISOString() }, { idempotencyKey: 'not-hydrated' })).rejects.toMatchObject({ code: 'JOBS_NOT_READY' });
    expect(await source.api.hydration!.attach({ originalActivateKey: activation.idempotencyKey, expectedRegistration: registered, pinInput: activation.pinInput })).toEqual(registered);
    expect(native.engine.inspectAdmission()).toEqual(before); expect(f.commands).toHaveLength(commands); expect(f.calls).toHaveLength(0);
    expect(f.torrentDb.currentSeq).toBe(torrentSequence);
    expect(native.db.list('_jobs_source_intents')).toHaveLength(2); expect(native.db.list('_jobs_sources')).toHaveLength(1);
  } finally { await f.close(); }
});

test('read-only attach rejects missing original proof, changed contract, stale/retired selection and retired eligibility without fresh registration', async () => {
  const f = await memorySourceJobsFixture({ nativeWriter: true });
  try {
    const source = f.source(), registered = await source.api.registration.activate(activation), native = f.native(source.scope)!;
    source.api.hydration!.tryDetach(); const before = native.engine.inspectAdmission(), commands = f.commands.length;
    await expect(source.api.hydration!.attach({ originalActivateKey: 'missing-original', expectedRegistration: registered, pinInput: {} })).rejects.toMatchObject({ code: 'JOBS_NOT_READY' });
    await expect(source.api.hydration!.attach({ originalActivateKey: activation.idempotencyKey, expectedRegistration: { ...registered, revision: 2 }, pinInput: {} })).rejects.toMatchObject({ code: 'JOBS_AUTHORITY_RETIRED' });
    const changed = f.source({ policyVersion: 'changed-current-policy' });
    await expect(changed.api.hydration!.attach({ originalActivateKey: activation.idempotencyKey, expectedRegistration: registered, pinInput: {} })).rejects.toMatchObject({ code: 'JOBS_AUTHORITY_RETIRED' });
    expect(native.engine.inspectAdmission()).toEqual(before); expect(f.commands).toHaveLength(commands);
    await source.api.registration.retire({ expectedRevision: 1, idempotencyKey: 'explicit-retirement' });
    await expect(source.api.hydration!.attach({ originalActivateKey: activation.idempotencyKey, expectedRegistration: registered, pinInput: {} })).rejects.toMatchObject({ code: 'JOBS_AUTHORITY_RETIRED' });
    source.retireEligibility();
    await expect(source.api.hydration!.attach({ originalActivateKey: activation.idempotencyKey, expectedRegistration: registered, pinInput: {} })).rejects.toMatchObject({ code: 'JOBS_AUTHORITY_RETIRED' });
    expect(await source.api.receipts.get(activation.idempotencyKey)).toEqual(registered);
    expect(native.db.list('_jobs_sources')).toHaveLength(1); expect(native.db.list('_jobs_source_policies')).toHaveLength(1);
  } finally { await f.close(); }
});

test('attach rechecks current native eligibility and compiled graph pin after its receipt wait', async () => {
  for (const drift of ['eligibility', 'pin'] as const) {
    const held = deferred(); let hold = false, entered = false, changedPin = false;
    const f = await memorySourceJobsFixture({ nativeWriter: true, async beforeRead(operation) {
      if (hold && operation.name === 'jobs.source.receipt') { entered = true; await held.promise; }
    } });
    const originalPin = f.bridge.pin.bind(f.bridge);
    const pin = spyOn(f.bridge, 'pin').mockImplementation((...args) => {
      const result = originalPin(...args); return changedPin ? { ...result, fingerprint: 'f'.repeat(64) } : result;
    });
    let pending: Promise<unknown> | undefined;
    try {
      const source = f.source(), registered = await source.api.registration.activate(activation);
      source.api.hydration!.tryDetach(); const before = f.native(source.scope)!.engine.inspectAdmission(); hold = true;
      pending = source.api.hydration!.attach({ originalActivateKey: activation.idempotencyKey, expectedRegistration: registered, pinInput: {} });
      await untilMemoryJobs(() => entered);
      if (drift === 'eligibility') source.retireEligibility(); else changedPin = true;
      held.resolve(); await expect(pending).rejects.toMatchObject({ code: 'JOBS_AUTHORITY_RETIRED' });
      expect(source.api.hydration!.inspect()).toMatchObject({ attached: false, active: 0, queued: 0, preparing: 0 });
      expect(f.native(source.scope)!.engine.inspectAdmission()).toEqual(before); expect(f.calls).toHaveLength(0);
    } finally { held.resolve(); await pending?.catch(() => {}); pin.mockRestore(); await f.close(); }
  }
});

test('cancelled active source mutation keeps its physical pin through late accepted acknowledgement', async () => {
  const held = deferred(); let hold = false, entered = false;
  const f = await memorySourceJobsFixture({ nativeWriter: true, async afterWrite(operation) {
    if (hold && operation.name === 'jobs.source.schedule.create') { entered = true; await held.promise; }
  } });
  try {
    const source = f.source(), registered = await source.api.registration.activate(activation), abort = new AbortController(); hold = true;
    const pending = source.api.schedules.create({ input: {}, at: new Date(f.now() + 1000).toISOString() }, { idempotencyKey: 'late-accepted', signal: abort.signal });
    await untilMemoryJobs(() => entered); abort.abort();
    await expect(pending).rejects.toMatchObject({ code: 'JOBS_OUTCOME_UNKNOWN' });
    expect(source.api.hydration!.tryDetach()).toBe('busy'); expect(source.api.hydration!.inspect().active).toBeGreaterThan(0);
    expect(await source.api.receipts.get('late-accepted')).not.toBeNull();
    held.resolve(); await untilMemoryJobs(() => source.api.hydration!.inspect().active === 0);
    const before = f.native(source.scope)!.engine.inspectAdmission();
    expect(source.api.hydration!.tryDetach()).toBe('detached');
    expect(await source.api.hydration!.attach({ originalActivateKey: activation.idempotencyKey, expectedRegistration: registered, pinInput: {} })).toEqual(registered);
    expect(f.native(source.scope)!.engine.inspectAdmission()).toEqual(before);
    expect((await source.api.capacity.get())!.working.sourceSchedules.used).toBe(1);
  } finally { held.resolve(); await f.close(); }
});

test('a cancelled queued hydration callback releases only its own queue pin and cannot run later', async () => {
  const held = deferred(); let hold = false, entered = false, proofReads = 0;
  const pending: Promise<unknown>[] = [];
  const f = await memorySourceJobsFixture({ nativeWriter: true, async beforeRead(operation) {
    if (hold && operation.name === 'jobs.source.receipt') { proofReads++; entered = true; await held.promise; }
  } });
  try {
    const source = f.source(), registered = await source.api.registration.activate(activation);
    source.api.hydration!.tryDetach(); hold = true;
    const input = { originalActivateKey: activation.idempotencyKey, expectedRegistration: registered, pinInput: {} };
    const first = source.api.hydration!.attach(input); pending.push(first); await untilMemoryJobs(() => entered);
    const cancel = new AbortController(), second = source.api.hydration!.attach({ ...input, signal: cancel.signal });
    pending.push(second);
    await untilMemoryJobs(() => f.stats().backendLeases === 0 && source.api.hydration!.inspect().queued === 1); cancel.abort();
    await expect(second).rejects.toThrow(); expect(source.api.hydration!.inspect().queued).toBe(0); expect(proofReads).toBe(1);
    held.resolve(); await first;
    expect(source.api.hydration!.inspect()).toMatchObject({ active: 0, queued: 0, preparing: 0 });
    expect(proofReads).toBe(1); expect(source.api.hydration!.tryDetach()).toBe('detached');
  } finally { held.resolve(); await Promise.allSettled(pending); await f.close(); }
});

test('prepared dispatch pins have explicit abandonment; running callback pins survive an outer timeout until actual settlement', async () => {
  const f = await memorySourceJobsFixture({ nativeWriter: true }), held = deferred();
  try {
    const source = f.source(), registered = await source.api.registration.activate(activation);
    const created = await source.api.schedules.create({ input: {}, at: new Date(f.now() + 1000).toISOString() }, { idempotencyKey: 'pin-work' });
    const { admission } = await source.api.schedules.get(created.id), broker = sourceBroker(f);
    const unused = await broker.prepareDispatch(source.scope, admission);
    expect(source.api.hydration!.inspect().preparedDispatch).toBe(1); expect(source.api.hydration!.tryDetach()).toBe('busy');
    expect(unused.abandon()).toBe(true); expect(unused.abandon()).toBe(false);
    let invoked = false; await expect(unused.run(() => { invoked = true; })).rejects.toMatchObject({ code: 'JOBS_NOT_READY' }); expect(invoked).toBe(false);
    expect(source.api.hydration!.tryDetach()).toBe('detached');
    await source.api.hydration!.attach({ originalActivateKey: activation.idempotencyKey, expectedRegistration: registered, pinInput: {} });
    const active = await broker.prepareDispatch(source.scope, admission);
    // Same-capability no-op attach must preserve the exact returned guard.
    await source.api.hydration!.attach({ originalActivateKey: activation.idempotencyKey, expectedRegistration: registered, pinInput: {} }); active.assertCurrent();
    const body = active.run(async () => { await held.promise; active.assertCurrent(); return 'accepted-original-body'; });
    const outer = Promise.race([body, Promise.reject(new JobsError('JOBS_OUTCOME_UNKNOWN'))]);
    await expect(outer).rejects.toMatchObject({ code: 'JOBS_OUTCOME_UNKNOWN' });
    expect(active.abandon()).toBe(false); expect(source.api.hydration!.inspect().activeDispatch).toBe(1);
    expect(source.api.hydration!.tryDetach()).toBe('busy');
    held.resolve(); expect(await body).toBe('accepted-original-body');
    expect(source.api.hydration!.inspect()).toMatchObject({ activeDispatch: 0, preparedDispatch: 0 });
    expect(source.api.hydration!.tryDetach()).toBe('detached');
  } finally { held.resolve(); await f.close(); }
});

test('final close abandons a prepared-never-run dispatch permit without inventing an active callback join', async () => {
  const f = await memorySourceJobsFixture({ nativeWriter: true });
  try {
    const source = f.source(); await source.api.registration.activate(activation);
    const created = await source.api.schedules.create({ input: {}, at: new Date(f.now() + 1000).toISOString() }, { idempotencyKey: 'unused-close-permit' });
    const { admission } = await source.api.schedules.get(created.id), broker = sourceBroker(f);
    await expect(broker.drainPhysical()).rejects.toMatchObject({ code: 'JOBS_NOT_READY' });
    const unused = await broker.prepareDispatch(source.scope, admission);
    expect(source.api.hydration!.inspect().preparedDispatch).toBe(1);
    await f.service.close(); await broker.drainPhysical();
    expect(f.runtime.diagnostics()).toMatchObject({ closed: true });
    expect(unused.abandon()).toBe(false);
    let invoked = false;
    await expect(unused.run(() => { invoked = true; })).rejects.toMatchObject({ code: 'JOBS_NOT_READY' });
    expect(invoked).toBe(false);
    await expect(broker.prepareDispatch(source.scope, admission)).rejects.toMatchObject({ code: 'JOBS_NOT_READY' });
    await broker.drainPhysical();
  } finally { await f.close(); }
});

test('final close joins an active dispatch body even after its outer caller times out', async () => {
  const f = await memorySourceJobsFixture({ nativeWriter: true }), held = deferred(), entered = deferred();
  const providerClose = spyOn(f.runtime, 'close');
  let body: Promise<unknown> | undefined, closing: Promise<unknown> | undefined;
  try {
    const source = f.source(); await source.api.registration.activate(activation);
    const created = await source.api.schedules.create({ input: {}, at: new Date(f.now() + 1000).toISOString() }, { idempotencyKey: 'active-close-permit' });
    const { admission } = await source.api.schedules.get(created.id), broker = sourceBroker(f);
    const pin = await broker.prepareDispatch(source.scope, admission);
    body = pin.run(async () => { entered.resolve(); await held.promise; pin.assertCurrent(); });
    await entered.promise;
    await expect(Promise.race([body, Promise.reject(new JobsError('JOBS_OUTCOME_UNKNOWN'))])).rejects.toMatchObject({ code: 'JOBS_OUTCOME_UNKNOWN' });
    let closed = false; closing = f.service.close().then(() => { closed = true; });
    await Bun.sleep(5);
    expect(closed).toBe(false); expect(providerClose).not.toHaveBeenCalled();
    expect(pin.abandon()).toBe(false); expect(f.runtime.diagnostics()).toMatchObject({ closed: false });
    held.resolve(); await expect(body).rejects.toMatchObject({ code: 'JOBS_NOT_READY' });
    await closing; await broker.drainPhysical();
    expect(providerClose).toHaveBeenCalledTimes(1); expect(f.runtime.diagnostics()).toMatchObject({ closed: true });
  } finally {
    held.resolve(); await Promise.allSettled([body, closing].filter((value): value is Promise<unknown> => !!value));
    try { await f.close(); } finally { providerClose.mockRestore(); }
  }
});

test('an in-flight dispatch preparation settles its existing-read pin after final close, never publishing a late permit', async () => {
  const held = deferred(), entered = deferred(); let hold = false;
  const f = await memorySourceJobsFixture({ nativeWriter: true, async beforeRead(operation) {
    if (hold && operation.name === 'jobs.source.dispatch') { entered.resolve(); await held.promise; }
  } });
  const providerClose = spyOn(f.runtime, 'close');
  let preparing: Promise<unknown> | undefined, closing: Promise<unknown> | undefined;
  try {
    const source = f.source(); await source.api.registration.activate(activation);
    const created = await source.api.schedules.create({ input: {}, at: new Date(f.now() + 1000).toISOString() }, { idempotencyKey: 'preparing-close-permit' });
    const { admission } = await source.api.schedules.get(created.id), broker = sourceBroker(f); hold = true;
    preparing = broker.prepareDispatch(source.scope, admission).then(value => ({ value }), error => ({ error }));
    await entered.promise; expect(source.api.hydration!.inspect()).toMatchObject({ preparing: 1, preparedDispatch: 0 });
    let closed = false; closing = f.service.close().then(() => { closed = true; });
    await Bun.sleep(5);
    expect(closed).toBe(false); expect(providerClose).not.toHaveBeenCalled();
    held.resolve(); expect(await preparing).toMatchObject({ error: { code: 'JOBS_NOT_READY' } });
    await closing; await broker.drainPhysical();
    expect(providerClose).toHaveBeenCalledTimes(1); expect(f.calls).toHaveLength(0);
  } finally {
    held.resolve(); await Promise.allSettled([preparing, closing].filter((value): value is Promise<unknown> => !!value));
    try { await f.close(); } finally { providerClose.mockRestore(); }
  }
});

test('runner abandons a prepared-but-uninvoked source dispatch pin when a post-prepare clock fence refuses enqueue', async () => {
  const f = await memorySourceJobsFixture({ nativeWriter: true }); let stepBack = false;
  try {
    const source = f.source({ async confirmEligible() { if (stepBack) { stepBack = false; f.advance(-1); } } });
    await source.api.registration.activate(activation);
    await source.api.schedules.create({ input: {}, at: new Date(f.now() + 1000).toISOString() }, { idempotencyKey: 'uninvoked-prepared' });
    stepBack = true; f.advance(1000); await f.tick();
    expect(f.calls).toHaveLength(0); expect(source.api.hydration!.inspect()).toMatchObject({ active: 0, queued: 0, preparing: 0, activeDispatch: 0, preparedDispatch: 0 });
    expect(source.api.hydration!.tryDetach()).toBe('detached');
    expect(readJobSettlementSnapshot(f.plane(source.scope)!).transportUnits).toBeGreaterThanOrEqual(2);
  } finally { await f.close(); }
});

test('retirement removing the live map is not physical callback settlement or permission to detach a running pin', async () => {
  const f = await memorySourceJobsFixture({ nativeWriter: true }), held = deferred(); let body: Promise<unknown> | undefined;
  try {
    const source = f.source(); await source.api.registration.activate(activation);
    const created = await source.api.schedules.create({ input: {}, at: new Date(f.now() + 1000).toISOString() }, { idempotencyKey: 'retired-pin-work' });
    const { admission } = await source.api.schedules.get(created.id), pin = await sourceBroker(f).prepareDispatch(source.scope, admission);
    body = pin.run(async () => { await held.promise; pin.assertCurrent(); });
    await source.api.registration.retire({ expectedRevision: 1, idempotencyKey: 'retire-live-pin' });
    expect(source.api.hydration!.inspect()).toMatchObject({ attached: false, activeDispatch: 1 });
    expect(source.api.hydration!.tryDetach()).toBe('busy'); expect(pin.abandon()).toBe(false);
    held.resolve(); await expect(body).rejects.toMatchObject({ code: 'JOBS_NOT_READY' });
    expect(source.api.hydration!.tryDetach()).toBe('detached'); expect(f.calls).toHaveLength(0);
  } finally { held.resolve(); await Promise.allSettled(body ? [body] : []); await f.close(); }
});

test('detaching an idle accepted-unknown source does not erase charges or prevent original factual recovery after eligibility retirement', async () => {
  let lose = true, hydrationCalls = 0;
  const f = await memorySourceJobsFixture({ nativeWriter: true, async beforeWrite(operation) {
    if (operation.name === 'jobs.dispatch' && lose) { lose = false; throw new JobsError('JOBS_OUTCOME_UNKNOWN'); }
  } });
  try {
    f.service.bindNativeSourceHydrator(() => { hydrationCalls++; throw new JobsError('JOBS_NOT_READY'); });
    const source = f.source(); await source.api.registration.activate(activation);
    const scheduledAt = f.now();
    const created = await source.api.schedules.create({ input: {}, at: new Date(scheduledAt).toISOString() }, { idempotencyKey: 'accepted-unknown' });
    await f.tick(); await untilMemoryJobs(() => f.calls.length === 1 && f.torrentDb.list('workflow_instances')[0]?.status === 'completed');
    expect(f.rows(source.scope, '_jobs_occurrences')[0]?.state).toBe('claimed');
    const native = f.native(source.scope)!, before = readJobSettlementSnapshot(native.db);
    expect(source.api.hydration!.tryDetach()).toBe('detached'); source.retireEligibility();
    expect(readJobSettlementSnapshot(native.db)).toEqual(before); expect((await source.api.capacity.get())!.working.sourceSchedules.used).toBe(1);
    f.advance(61001); await f.tick();
    expect(f.rows(source.scope, '_jobs_occurrences')[0]?.state).toBe('terminal'); expect(source.api.hydration!.inspect().residentSources).toBe(0);
    expect(await source.api.executions.get(created.id, { generation: 1, scheduledAt })).toMatchObject({ status: 'completed' });
    expect(f.calls).toHaveLength(1); expect(f.rows(source.scope, '_jobs_sources')[0]?.state).toBe('active'); expect(hydrationCalls).toBe(0);
  } finally { await f.close(); }
});

test('broker-only quota: 1025 retained registrations can attach sequentially; full residency is recoverable and stale detach cannot remove replacement', async () => {
  const f = await memorySourceJobsFixture(), gate = new WorkPool({ concurrency: 4 }), sourceGate = new WorkPool({ concurrency: 4, maxConcurrentPerKey: 1 }), lifetime = new AbortController();
  // Explicit transport double only: this test qualifies the native broker's
  // process-wide residency, not per-file SQL history budgets or actor proof.
  const rows = new Map<string, JobSourceRegistration>(), receipts = new Map<string, { registration: JobSourceRegistration; digest: string }>(); let writes = 0;
  const runtime = {
    async readExisting<T>(_scope: unknown, name: string, input: unknown, guard: () => void): Promise<T> {
      guard(); const r = input as { identity: JobSourceContract['identity']; requestId?: string; intentDigest?: string }, id = jobSourceId(r.identity);
      if (name === 'jobs.source') return (rows.get(id) ?? null) as T;
      const receipt = receipts.get(id + ':' + r.requestId);
      if (receipt && r.intentDigest && receipt.digest !== r.intentDigest) throw new JobsError('JOBS_INTENT_CONFLICT');
      return (receipt?.registration ?? null) as T;
    },
    async write<T>(_scope: unknown, name: string, input: unknown, _key: string, guard: () => void): Promise<T> {
      guard(); if (name !== 'jobs.source.register') throw new Error('Only explicit synthetic source registrations are implemented.');
      const r = input as { contract: JobSourceContract; expectedRevision: number; requestId: string }, id = jobSourceId(r.contract.identity);
      const registration: JobSourceRegistration = { id, generation: 1, revision: 1, state: 'active', policyHash: jobHash(r.contract) };
      rows.set(id, registration); receipts.set(id + ':' + r.requestId, { registration, digest: jobHash(['register', r.contract, r.expectedRevision]) }); writes++;
      return registration as T;
    },
  } as unknown as JobsRuntime;
  const broker = new JobsSourceBroker({ config: f.config, runtime, bridge: f.bridge, gate, sourceGate, signal: lifetime.signal, now: f.now, wake() {} });
  const retained: { source: ReturnType<typeof f.source>; api: ReturnType<JobsSourceBroker['forSource']>; registration: JobSourceRegistration }[] = [];
  try {
    for (let index = 0; index < 1025; index++) {
      const source = f.source({ identity: { databaseId: 'synthetic-resident-' + index } }), api = broker.forSource(source.capability);
      const registration = await api.registration.activate(activation); retained.push({ source, api, registration });
      expect(api.hydration!.inspect().residentSources).toBe(1); expect(api.hydration!.tryDetach()).toBe('detached');
    }
    expect(rows.size).toBe(1025); expect(receipts.size).toBe(1025); expect(writes).toBe(1025);
    const first = retained[0]!, replacement = f.source({ identity: first.source.identity }), replacementApi = broker.forSource(replacement.capability);
    const attach = (entry: typeof first) => entry.api.hydration!.attach({ originalActivateKey: activation.idempotencyKey, expectedRegistration: entry.registration, pinInput: {} });
    await attach(first); await replacementApi.hydration!.attach({ originalActivateKey: activation.idempotencyKey, expectedRegistration: first.registration, pinInput: {} });
    expect(first.api.hydration!.tryDetach()).toBe('not-current'); expect(replacementApi.hydration!.inspect().attached).toBe(true); replacementApi.hydration!.tryDetach();
    for (const entry of retained.slice(0, 1024)) await attach(entry);
    expect(retained[1]!.api.hydration!.inspect().residentSources).toBe(1024);
    await expect(attach(retained[1024]!)).rejects.toMatchObject({ code: 'JOBS_NOT_READY' });
    expect(first.api.hydration!.tryDetach()).toBe('detached'); await attach(retained[1024]!);
    expect(retained[1024]!.api.hydration!.inspect().residentSources).toBe(1024);
    expect(rows.size).toBe(1025); expect(receipts.size).toBe(1025); expect(writes).toBe(1025);
  } finally {
    lifetime.abort(); broker.close();
    try { await gate.close(); } finally { try { await sourceGate.close(); } finally {
      await gate.drainPhysical(); await sourceGate.drainPhysical(); await broker.drainPhysical(); await f.close();
    } }
  }
});
