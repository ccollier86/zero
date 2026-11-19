/** Native hydration/pin tests; MEMORY writer/Torrent unless explicitly labelled
 * broker-only transport double. No files, identity deletion or timer fixture. */
import { expect, spyOn, test } from 'bun:test';
import { WorkPool } from '../workers/work-pool';
import { JobsSourceBroker } from './source-service';
import type { JobsRuntime } from './runtime';
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
  let lose = true;
  const f = await memorySourceJobsFixture({ nativeWriter: true, async beforeWrite(operation) {
    if (operation.name === 'jobs.dispatch' && lose) { lose = false; throw new JobsError('JOBS_OUTCOME_UNKNOWN'); }
  } });
  try {
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
    expect(f.calls).toHaveLength(1); expect(f.rows(source.scope, '_jobs_sources')[0]?.state).toBe('active');
  } finally { await f.close(); }
});

test('broker-only quota: 1025 retained registrations can attach sequentially; full residency is recoverable and stale detach cannot remove replacement', async () => {
  const f = await memorySourceJobsFixture(), gate = new WorkPool({ concurrency: 4 }), lifetime = new AbortController();
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
  const broker = new JobsSourceBroker({ config: f.config, runtime, bridge: f.bridge, gate, signal: lifetime.signal, now: f.now, wake() {} });
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
  } finally { lifetime.abort(); broker.close(); await gate.close(); await gate.drainPhysical(); await f.close(); }
});
