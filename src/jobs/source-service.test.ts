/** Real JobsService -> source broker -> Jobs realm -> JobsRunner -> Torrent, entirely in memory. */
import { expect, test } from 'bun:test';
import { trustedSystemServiceDataScope } from '../auth/service-data-scope';
import { jobBinding, jobDispatchKey } from './admission';
import { JobsError } from './error';
import { DatabaseError } from '../databases/database-error';
import { WorkerError } from '../workers/worker-error';
import { jobOccurrenceId, type JobAdmissionRow, type JobOccurrenceRow } from './model';
import type { TrustedJobSource } from './source-authority';
import { jobSourcePrincipal, jobSourceScheduleId } from './source-model';
import { jobHash } from './validation';
import { memorySourceJobsFixture, untilMemoryJobs } from './test-support/memory-source-fixture';

const activate = { expectedRevision: 0, idempotencyKey: 'register-A', pinInput: { value: 1 } };
function latch() {
  let release!: () => void, enter!: () => void;
  const promise = new Promise<void>(resolve => { release = resolve; }), entered = new Promise<void>(resolve => { enter = resolve; });
  return { entered, release, async wait() { enter(); await promise; } };
}

for (const phase of ['before', 'after'] as const) test(`create receipt settlement waits for the actual ${phase}-commit callback after its caller aborts`, async () => {
  const barrier = latch(), caller = new AbortController(); let hold = true;
  const pause = async (operation: { name: string }) => {
    if (hold && operation.name === 'jobs.source.schedule.create') { hold = false; await barrier.wait(); }
  };
  const f = await memorySourceJobsFixture(phase === 'before' ? { beforeWrite: pause } : { afterWrite: pause });
  let creating: Promise<unknown> | undefined, reconciling: Promise<unknown> | undefined;
  try {
    const source = f.source(); await source.api.registration.activate(activate);
    const key = 'settle-create-' + phase;
    creating = source.api.schedules.create({ input: { value: 1 }, at: new Date(f.now() + 5_000).toISOString() },
      { idempotencyKey: key, signal: caller.signal }).then(value => ({ value }), error => ({ error }));
    await barrier.entered; caller.abort(new JobsError('JOBS_NOT_READY'));
    expect(await creating).toMatchObject({ error: { code: 'JOBS_OUTCOME_UNKNOWN' } });
    // Retire policy without aborting physical owner lifetime. Reconciliation
    // still needs the original evidence, not current new-dispatch permission.
    await source.api.registration.retire({ expectedRevision: 1, idempotencyKey: 'retire-settlement-' + phase }); source.retireEligibility();
    const before = f.commands.length; let settled = false;
    reconciling = source.api.schedules.reconcileCreate(key).then(value => { settled = true; return value; });
    await untilMemoryJobs(() => f.service.diagnostics().gate.queued === 1);
    expect(settled).toBe(false); expect(f.service.diagnostics().gate.active).toBe(1);
    barrier.release(); const result = await reconciling;
    expect(result).toEqual(await source.api.receipts.get(key));
    if (phase === 'before') { expect(result).toBeNull(); expect(f.rows(source.scope, 'job_schedules')).toHaveLength(0); }
    else expect(result).toMatchObject({ id: jobSourceScheduleId(source.identity, key), control: 'active', revision: 1, generation: 1 });
    expect(f.commands).toHaveLength(before); expect(f.service.diagnostics().gate).toMatchObject({ active: 0, queued: 0 });
    expect(f.stats()).toMatchObject({ activeLeases: 0, backendLeases: 0 });
  } finally { barrier.release(); await Promise.allSettled([creating, reconciling].filter((value): value is Promise<unknown> => !!value)); await f.close(); }
});

for (const phase of ['before', 'after'] as const) test(`registration receipt settlement waits for its original ${phase}-commit source gate callback`, async () => {
  const barrier = latch(), caller = new AbortController(); let hold = true;
  const pause = async (operation: { name: string }) => {
    if (hold && operation.name === 'jobs.source.register') { hold = false; await barrier.wait(); }
  };
  const f = await memorySourceJobsFixture(phase === 'before' ? { beforeWrite: pause } : { afterWrite: pause });
  let activating: Promise<unknown> | undefined, reconciling: Promise<unknown> | undefined;
  try {
    const source = f.source();
    activating = source.api.registration.activate({ ...activate, signal: caller.signal }).then(value => ({ value }), error => ({ error }));
    await barrier.entered; caller.abort(new JobsError('JOBS_NOT_READY'));
    expect(await activating).toMatchObject({ error: { code: 'JOBS_OUTCOME_UNKNOWN' } }); source.retireEligibility();
    const before = f.commands.length; let settled = false;
    reconciling = source.api.registration.reconcile(activate.idempotencyKey).then(value => { settled = true; return value; });
    await untilMemoryJobs(() => f.service.diagnostics().sourceGate.queued === 1); expect(settled).toBe(false);
    barrier.release(); const result = await reconciling;
    expect(result).toEqual(await source.api.receipts.get(activate.idempotencyKey));
    if (phase === 'before') { expect(result).toBeNull(); expect(f.stats().planes).toBe(0); }
    else expect(result).toMatchObject({ generation: 1, revision: 1, state: 'active' });
    expect(f.commands).toHaveLength(before); expect(f.service.diagnostics().sourceGate).toMatchObject({ active: 0, queued: 0 });
    expect(f.stats()).toMatchObject({ activeLeases: 0, backendLeases: 0 });
  } finally { barrier.release(); await Promise.allSettled([activating, reconciling].filter((value): value is Promise<unknown> => !!value)); await f.close(); }
});

test('receipt settlement is strictly typed, pre-abort is inert, and historical controls are never re-executed', async () => {
  const f = await memorySourceJobsFixture();
  try {
    const source = f.source(), aborted = new AbortController(), reason = new Error('Synthetic pre-aborted read'); aborted.abort(reason);
    const initial = f.stats();
    await expect(source.api.registration.reconcile('absent', { signal: aborted.signal })).rejects.toBe(reason);
    await expect(source.api.schedules.reconcileCreate('absent', { signal: aborted.signal })).rejects.toBe(reason);
    expect(f.stats()).toEqual(initial); expect(f.commands).toHaveLength(0); expect(f.service.diagnostics().gate).toMatchObject({ active: 0, queued: 0 });
    const invalid = { signal: undefined, kind: 'schedule' } as unknown as Parameters<typeof source.api.registration.reconcile>[1];
    await expect(source.api.registration.reconcile('absent', invalid)).rejects.toMatchObject({ code: 'JOBS_INPUT_INVALID' });
    await expect(source.api.registration.reconcile('absent', null as unknown as Parameters<typeof source.api.registration.reconcile>[1]))
      .rejects.toMatchObject({ code: 'JOBS_INPUT_INVALID' });
    await expect(source.api.schedules.reconcileCreate('absent', { signal: 'not-a-signal' } as unknown as Parameters<typeof source.api.schedules.reconcileCreate>[1]))
      .rejects.toMatchObject({ code: 'JOBS_INPUT_INVALID' });
    expect(f.stats()).toEqual(initial);
    const registered = await source.api.registration.activate(activate);
    const created = await source.api.schedules.create({ input: { value: 1 }, at: new Date(f.now() + 5_000).toISOString() }, { idempotencyKey: 'original-create' });
    const cancelled = await source.api.schedules.cancel(created.id, { expectedRevision: 1, idempotencyKey: 'original-cancel' });
    const retired = await source.api.registration.retire({ expectedRevision: 1, idempotencyKey: 'original-retire' }); source.retireEligibility();
    const before = f.commands.length;
    expect(await source.api.registration.reconcile(activate.idempotencyKey)).toEqual(registered);
    expect(await source.api.registration.reconcile('original-retire')).toEqual(retired);
    expect(await source.api.schedules.reconcileCreate('original-create')).toEqual(created);
    expect(await source.api.receipts.get('original-cancel')).toEqual(cancelled);
    await expect(source.api.registration.reconcile('original-create')).rejects.toMatchObject({ code: 'JOBS_INTENT_CONFLICT' });
    await expect(source.api.schedules.reconcileCreate(activate.idempotencyKey)).rejects.toMatchObject({ code: 'JOBS_INTENT_CONFLICT' });
    await expect(source.api.schedules.reconcileCreate('original-cancel')).rejects.toMatchObject({ code: 'JOBS_INTENT_CONFLICT' });
    expect(f.commands).toHaveLength(before); expect(f.service.diagnostics().gate).toMatchObject({ active: 0, queued: 0 });
    expect(f.rows(source.scope, 'job_schedules')).toHaveLength(1);
  } finally { await f.close(); }
});

test('receipt settlement rechecks physical source ownership after waiting and never turns owner loss into null', async () => {
  const barrier = latch(), caller = new AbortController(); let hold = true;
  const f = await memorySourceJobsFixture({ async afterWrite(operation) {
    if (hold && operation.name === 'jobs.source.schedule.create') { hold = false; await barrier.wait(); }
  } });
  let creating: Promise<unknown> | undefined, reconciling: Promise<unknown> | undefined;
  try {
    const source = f.source(); await source.api.registration.activate(activate);
    creating = source.api.schedules.create({ input: { value: 1 }, at: new Date(f.now() + 5_000).toISOString() },
      { idempotencyKey: 'owner-loss', signal: caller.signal }).then(value => ({ value }), error => ({ error }));
    await barrier.entered; caller.abort(); await creating;
    reconciling = source.api.schedules.reconcileCreate('owner-loss').then(value => ({ value }), error => ({ error }));
    await untilMemoryJobs(() => f.service.diagnostics().gate.queued === 1); source.revokeOwner(); barrier.release();
    expect(await reconciling).toMatchObject({ error: { code: 'JOBS_AUTHORITY_RETIRED' } });
    await expect(source.api.registration.reconcile('absent')).rejects.toMatchObject({ code: 'JOBS_AUTHORITY_RETIRED' });
    expect(f.service.diagnostics().gate).toMatchObject({ active: 0, queued: 0 }); expect(f.stats()).toMatchObject({ activeLeases: 0, backendLeases: 0 });
  } finally { barrier.release(); await Promise.allSettled([creating, reconciling].filter((value): value is Promise<unknown> => !!value)); await f.close(); }
});

test('a queued receipt settlement aborts without entering owner checks or leaking its gate slot', async () => {
  const barrier = latch(); let hold = true;
  const f = await memorySourceJobsFixture({ async afterWrite(operation) {
    if (hold && operation.name === 'jobs.source.schedule.create') { hold = false; await barrier.wait(); }
  } });
  let creating: Promise<unknown> | undefined, reconciling: Promise<unknown> | undefined;
  try {
    const source = f.source(); await source.api.registration.activate(activate);
    creating = source.api.schedules.create({ input: { value: 1 }, at: new Date(f.now() + 5_000).toISOString() },
      { idempotencyKey: 'queued-settlement-abort' });
    await barrier.entered;
    const controller = new AbortController(), reason = new Error('Synthetic queued settlement cancellation'), checks = f.stats().ownerChecks;
    reconciling = source.api.schedules.reconcileCreate('queued-settlement-abort', { signal: controller.signal })
      .then(value => ({ value }), error => ({ error }));
    await untilMemoryJobs(() => f.service.diagnostics().gate.queued === 1); controller.abort(reason);
    expect(await reconciling).toEqual({ error: reason }); expect(f.stats().ownerChecks).toBe(checks);
    expect(f.service.diagnostics().gate).toMatchObject({ active: 1, queued: 0 });
    barrier.release(); await creating; expect(f.service.diagnostics().gate).toMatchObject({ active: 0, queued: 0 });
  } finally { barrier.release(); await Promise.allSettled([creating, reconciling].filter((value): value is Promise<unknown> => !!value)); await f.close(); }
});

test('an active receipt settlement cancellation never returns an absence and retains its slot until read settlement', async () => {
  const barrier = latch(); let hold = false;
  const f = await memorySourceJobsFixture({ async beforeRead(operation) {
    if (hold && operation.name === 'jobs.source.receipt') { hold = false; await barrier.wait(); }
  } });
  let reconciling: Promise<unknown> | undefined;
  try {
    const source = f.source(); await source.api.registration.activate(activate); hold = true;
    const controller = new AbortController(), reason = new Error('Synthetic active settlement cancellation');
    reconciling = source.api.schedules.reconcileCreate('absent', { signal: controller.signal })
      .then(value => ({ value }), error => ({ error }));
    await barrier.entered; controller.abort(reason);
    expect(await reconciling).toEqual({ error: reason }); expect(f.service.diagnostics().gate.active).toBe(1);
    barrier.release(); await untilMemoryJobs(() => f.service.diagnostics().gate.active === 0);
    expect(f.service.diagnostics().gate.queued).toBe(0); expect(f.stats()).toMatchObject({ activeLeases: 0, backendLeases: 0 });
  } finally { barrier.release(); await Promise.allSettled(reconciling ? [reconciling] : []); await f.close(); }
});

test('invalid source timing is a typed known no-start Jobs rejection before any source writer', async () => {
  const f = await memorySourceJobsFixture();
  try {
    const source = f.source(); await source.api.registration.activate(activate); const writes = f.commands.length;
    for (const [index, timing] of [
      { at: 'not-an-instant' },
      { at: '+010000-01-01T00:00:00.000Z' },
      { at: new Date(f.now()).toISOString(), maxLatenessMs: 366 * 86_400_000 + 1 },
    ].entries()) {
      await expect(source.api.schedules.create({ input: { value: 1 }, ...timing }, { idempotencyKey: 'invalid-source-time-' + index }))
        .rejects.toMatchObject({ code: 'JOBS_INPUT_INVALID', outcome: 'not-started' });
    }
    expect(f.commands).toHaveLength(writes); expect(f.rows(source.scope, 'job_schedules')).toHaveLength(0);
  } finally { await f.close(); }
});

test('source scheduling preserves native database no-start and rollback proof without a command receipt', async () => {
  for (const failure of [
    new DatabaseError('DATABASE_BACKPRESSURE', 'Synthetic admission refusal.', { outcome: 'not-started' }),
    new DatabaseError('DATABASE_TRANSACTION_EXPIRED', 'Synthetic rolled-back operation.', { outcome: 'not-committed' }),
  ]) {
    let fail = true;
    const f = await memorySourceJobsFixture({ beforeWrite(operation) {
      if (fail && operation.name === 'jobs.source.schedule.create') { fail = false; throw failure; }
    } });
    try {
      const source = f.source(); await source.api.registration.activate(activate); const writes = f.commands.length;
      const input = { input: { value: 1 }, at: new Date(f.now() + 5_000).toISOString() }, key = 'native-no-write-proof';
      await expect(source.api.schedules.create(input, { idempotencyKey: key })).rejects.toBe(failure);
      expect(f.commands).toHaveLength(writes); expect(f.rows(source.scope, 'job_schedules')).toHaveLength(0);
      expect(await source.api.receipts.get(key)).toBeNull();
      const accepted = await source.api.schedules.create(input, { idempotencyKey: key });
      expect(await source.api.receipts.get(key)).toEqual(accepted); expect(f.rows(source.scope, 'job_schedules')).toHaveLength(1);
    } finally { await f.close(); }
  }
});

test('source scheduling exposes an actual bounded Jobs gate refusal as native known no-start, not writer uncertainty', async () => {
  const barrier = latch();
  const f = await memorySourceJobsFixture({ async beforeWrite(operation) {
    if (operation.name === 'jobs.source.schedule.create') await barrier.wait();
  } });
  const pending: Promise<unknown>[] = [];
  try {
    const source = f.source(); await source.api.registration.activate(activate);
    const held: ReturnType<typeof f.source>[] = [];
    for (let index = 0; index < 20; index++) {
      const selected = f.source({ identity: { ownerId: 'synthetic-held-owner-' + index } });
      await selected.api.registration.activate({ ...activate, idempotencyKey: 'register-held-' + index }); held.push(selected);
    }
    const writes = f.commands.length;
    const input = { input: { value: 1 }, at: new Date(f.now() + 5_000).toISOString() };
    // Real service configuration is four active + sixteen waiting. Every
    // admitted writer is held before its memory realm command, with no SQL lease.
    for (let index = 0; index < held.length; index++) pending.push(held[index]!.api.schedules.create(input, { idempotencyKey: 'held-gate-' + index })
      .then(value => ({ value }), error => ({ error })));
    await untilMemoryJobs(() => f.service.diagnostics().gate.active === 4 && f.service.diagnostics().gate.queued === 16);
    let rejected: unknown;
    try { await source.api.schedules.create(input, { idempotencyKey: 'gate-refused' }); } catch (error) { rejected = error; }
    expect(rejected).toBeInstanceOf(WorkerError); expect(rejected).toMatchObject({ code: 'WORKER_CAPACITY', outcome: 'not-started' });
    expect(f.commands).toHaveLength(writes); expect(await source.api.receipts.get('gate-refused')).toBeNull();
    barrier.release(); await Promise.all(pending);
    expect(f.rows(source.scope, 'job_schedules')).toHaveLength(20);
  } finally { barrier.release(); await Promise.allSettled(pending); await f.close(); }
});

test('source schedules fence an exact expected registration but historical replay remains original evidence', async () => {
  const f = await memorySourceJobsFixture();
  try {
    const a = f.source(), b = f.source({ policyVersion: 'B' });
    const first = await a.api.registration.activate(activate);
    const input = { input: { value: 1 }, at: new Date(f.now() + 5_000).toISOString() };
    const receipt = await a.api.schedules.create(input, { idempotencyKey: 'mapped-original', expectedRegistration: first });
    await b.api.registration.activate({ ...activate, expectedRevision: 1, idempotencyKey: 'mapped-B' });
    const third = await a.api.registration.activate({ ...activate, expectedRevision: 2, idempotencyKey: 'mapped-A-again' });
    expect(third.policyHash).toBe(first.policyHash);
    await expect(a.api.schedules.create(input, { idempotencyKey: 'stale-mapping', expectedRegistration: first }))
      .rejects.toMatchObject({ code: 'JOBS_AUTHORITY_RETIRED' });
    expect(await a.api.schedules.create(input, { idempotencyKey: 'mapped-original', expectedRegistration: third })).toEqual(receipt);
    await expect(a.api.schedules.create({ ...input, input: { value: 2 } }, { idempotencyKey: 'mapped-original', expectedRegistration: third }))
      .rejects.toMatchObject({ code: 'JOBS_INTENT_CONFLICT' });
    expect(f.rows(a.scope, 'job_schedules')).toHaveLength(1);
    const invalidActivation = { ...activate, expectedRevision: 3, idempotencyKey: 'mapping-not-a-registration-option', expectedRegistration: third };
    await expect(a.api.registration.activate(invalidActivation as unknown as Parameters<typeof a.api.registration.activate>[0]))
      .rejects.toMatchObject({ code: 'JOBS_INPUT_INVALID' });
    const invalidCancellation = { expectedRevision: 1, idempotencyKey: 'mapping-not-a-cancel-option', expectedRegistration: third };
    await expect(a.api.schedules.cancel(receipt.id, invalidCancellation as unknown as Parameters<typeof a.api.schedules.cancel>[1]))
      .rejects.toMatchObject({ code: 'JOBS_INPUT_INVALID' });
  } finally { await f.close(); }
});

test('a mapped source create waiting at its writer cannot slide into a newer A to B to A generation', async () => {
  const barrier = latch(); let hold = false;
  const f = await memorySourceJobsFixture({ async beforeWrite(operation) {
    if (hold && operation.name === 'jobs.source.schedule.create') { hold = false; await barrier.wait(); }
  } });
  let creating: Promise<unknown> | undefined;
  try {
    const a = f.source(), b = f.source({ policyVersion: 'B' });
    const first = await a.api.registration.activate(activate); hold = true;
    creating = a.api.schedules.create({ input: { value: 1 }, at: new Date(f.now() + 5_000).toISOString() },
      { idempotencyKey: 'mapped-await', expectedRegistration: first });
    const result = creating.then(value => ({ value }), error => ({ error }));
    await barrier.entered;
    await b.api.registration.activate({ ...activate, expectedRevision: 1, idempotencyKey: 'mapped-await-B' });
    await a.api.registration.activate({ ...activate, expectedRevision: 2, idempotencyKey: 'mapped-await-A' });
    barrier.release();
    expect(await result).toMatchObject({ error: { code: 'JOBS_AUTHORITY_RETIRED' } });
    expect(await a.api.receipts.get('mapped-await')).toBeNull(); expect(f.rows(a.scope, 'job_schedules')).toHaveLength(0);
  } finally { barrier.release(); await Promise.allSettled(creating ? [creating] : []); await f.close(); }
});

test('source execution evidence proves the original Torrent key before Jobs dispatch acknowledgment and survives retirement', async () => {
  const barrier = latch(); let hold = true;
  const f = await memorySourceJobsFixture({ async beforeWrite(operation) {
    if (hold && operation.name === 'jobs.dispatch') { hold = false; await barrier.wait(); }
  } });
  let ticking: Promise<unknown> | undefined;
  try {
    const source = f.source(), registration = await source.api.registration.activate(activate), due = f.now();
    const input = { value: 1 }, created = await source.api.schedules.create({ input, at: new Date(due).toISOString() }, { idempotencyKey: 'execution-evidence' });
    const authority = f.bridge.system({ principal: jobSourcePrincipal(registration.id), reason: 'Synthetic same-principal non-Jobs start', scope: source.scope });
    const pin = f.bridge.pin(authority, f.definition.workflow.name, input, f.definition.workflow.version);
    const unrelated = await f.bridge.enqueue(authority, pin, input, 'synthetic-unrelated-execution', 'synthetic-unrelated-binding', () => {});
    expect(await source.api.executions.get(created.id, { generation: 1, scheduledAt: due })).toBeNull();
    ticking = f.tick(); await barrier.entered;
    expect(f.rows(source.scope, '_jobs_occurrences')[0]).toMatchObject({ state: 'claimed', receipt_json: null, workflow_id: null });
    const evidence = await source.api.executions.get(created.id, { generation: 1, scheduledAt: due });
    expect(evidence).toMatchObject({ scheduleId: created.id, generation: 1, scheduledAt: due, occurrenceId: jobOccurrenceId(created.id, 1, due),
      sourceId: registration.id, policyGeneration: registration.generation, policyHash: registration.policyHash, workflow: pin, inputHash: jobHash(input) });
    expect(evidence!.instanceId).not.toBe(unrelated.instanceId);
    expect(Object.keys(evidence!).sort()).toEqual(['generation', 'inputHash', 'instanceId', 'occurrenceId', 'policyGeneration', 'policyHash', 'scheduleId', 'scheduledAt', 'sourceId', 'status', 'workflow'].sort());
    await source.api.registration.retire({ expectedRevision: 1, idempotencyKey: 'retire-execution-evidence' }); source.retireEligibility();
    expect((await source.api.executions.get(created.id, { generation: 1, scheduledAt: due }))!.instanceId).toBe(evidence!.instanceId);
    expect(await source.api.executions.get(created.id, { generation: 1, scheduledAt: due + 1 })).toBeNull();
    const other = f.source({ identity: { ownerId: 'different-synthetic-owner' } });
    await expect(other.api.executions.get(created.id, { generation: 1, scheduledAt: due })).rejects.toMatchObject({ code: 'JOBS_NOT_FOUND' });
    barrier.release(); await ticking;
    expect((await source.api.executions.get(created.id, { generation: 1, scheduledAt: due }))!.instanceId).toBe(evidence!.instanceId);
  } finally { barrier.release(); await Promise.allSettled(ticking ? [ticking] : []); await f.close(); }
});

test('source once keeps the original due instant and durable identity, then the real runner obtains one real Torrent receipt and terminal activity', async () => {
  const f = await memorySourceJobsFixture();
  try {
    const source = f.source();
    expect(await source.api.registration.get()).toBeNull(); expect(await source.api.receipts.get('missing')).toBeNull(); expect(f.stats().planes).toBe(0);
    const registration = await source.api.registration.activate(activate);
    expect(registration).toMatchObject({ generation: 1, revision: 1, state: 'active' });
    const due = f.now() - 2_000, input = { input: { value: 1 }, at: new Date(due).toISOString(), maxLatenessMs: 60_000, initiatedBy: 'factual-human-not-an-owner' };
    const receipt = await source.api.schedules.create(input, { idempotencyKey: 'one' });
    expect(receipt.id).toBe(jobSourceScheduleId(source.identity, 'one')); expect(await source.api.receipts.get('one')).toEqual(receipt);
    const selected = await source.api.schedules.get(receipt.id);
    expect(selected.schedule).toMatchObject({ actor_id: null, principal: null, updated_by: null, source_id: registration.id, run_as: 'service' });
    expect(selected.admission).toMatchObject({ actorId: null, principal: null, initiatedBy: 'factual-human-not-an-owner', source: { id: registration.id, generation: 1 } });
    expect(selected.admission.timing).toMatchObject({ at: input.at });
    expect(f.rows(source.scope, '_jobs_cursors')[0]!.next_due_at).toBe(due);
    expect(await source.api.schedules.create(input, { idempotencyKey: 'one' })).toEqual(receipt);
    await f.tick(); await untilMemoryJobs(() => f.calls.length === 1 && f.torrentDb.list('workflow_instances')[0]?.status === 'completed');
    f.advance(1_000); await f.tick();
    const occurrence = f.rows(source.scope, '_jobs_occurrences')[0] as JobOccurrenceRow;
    expect(occurrence).toMatchObject({ id: jobOccurrenceId(receipt.id, 1, due), scheduled_at: due, generation: 1, state: 'terminal', terminal_status: 'completed' });
    const row = f.rows(source.scope, '_jobs_admissions')[0] as JobAdmissionRow;
    const authority = f.bridge.open({ authorityJson: row.authority_json, authorityMac: row.authority_mac }, jobBinding(selected.admission, 1));
    const actual = f.bridge.inspect(authority, selected.admission.workflow, selected.admission.input, jobDispatchKey(occurrence.id), jobBinding(selected.admission, 1));
    if (!actual || !occurrence.workflow_id || !occurrence.receipt_json) throw new Error('Actual Torrent handoff evidence is missing.');
    expect(actual.receipt).toEqual(JSON.parse(occurrence.receipt_json)); expect(actual.receipt.instanceId).toBe(occurrence.workflow_id);
    expect(f.torrentDb.prepare('SELECT count(*) AS n FROM _workflow_system_start_receipts').get()).toEqual({ n: 1 }); expect(f.calls).toEqual([{ value: 1 }]);
    expect(f.failures).toEqual([]); expect(f.stats()).toMatchObject({ activeLeases: 0, backendLeases: 0 });
    expect(f.stats().ownerChecks).toBeGreaterThan(0); expect(f.stats().eligibleChecks).toBeGreaterThan(0);
  } finally { await f.close(); }
});

test('a committed Torrent handoff with no Jobs dispatch reply reconciles the same original receipt after lease expiry and policy retirement', async () => {
  let lose = true;
  const f = await memorySourceJobsFixture({ beforeWrite(operation) {
    if (operation.name === 'jobs.dispatch' && lose) { lose = false; throw new JobsError('JOBS_NOT_READY'); }
  } });
  try {
    const source = f.source();
    await source.api.registration.activate(activate);
    const due = f.now(), receipt = await source.api.schedules.create({ input: { value: 1 }, at: new Date(due).toISOString() }, { idempotencyKey: 'lost-handoff' });
    await f.tick(); await untilMemoryJobs(() => f.calls.length === 1 && f.torrentDb.list('workflow_instances')[0]?.status === 'completed');
    const claimed = f.rows(source.scope, '_jobs_occurrences')[0] as JobOccurrenceRow;
    expect(claimed).toMatchObject({ id: jobOccurrenceId(receipt.id, 1, due), state: 'claimed', receipt_json: null, lease_generation: 1 });
    const detail = await source.api.schedules.get(receipt.id), row = f.rows(source.scope, '_jobs_admissions')[0] as JobAdmissionRow;
    const binding = jobBinding(detail.admission, 1), authority = f.bridge.open({ authorityJson: row.authority_json, authorityMac: row.authority_mac }, binding);
    const committed = f.bridge.inspect(authority, detail.admission.workflow, detail.admission.input, jobDispatchKey(claimed.id), binding)!;
    await source.api.registration.retire({ expectedRevision: 1, idempotencyKey: 'retire-after-commit' }); source.retireEligibility();
    f.advance(60_001); await f.tick();
    const recovered = f.rows(source.scope, '_jobs_occurrences')[0] as JobOccurrenceRow;
    expect(recovered).toMatchObject({ id: claimed.id, state: 'terminal', terminal_status: 'completed', lease_generation: 1, workflow_id: committed.receipt.instanceId });
    expect(f.commands.filter(command => command.name === 'jobs.claim')).toHaveLength(1);
    expect(f.commands.filter(command => command.name === 'jobs.dispatch.reconcile')).toHaveLength(1);
    expect(JSON.parse(recovered.receipt_json!)).toEqual(committed.receipt);
    expect(f.calls).toHaveLength(1); expect(f.torrentDb.prepare('SELECT count(*) AS n FROM _workflow_system_start_receipts').get()).toEqual({ n: 1 });
    expect(f.failures).toContain('dispatch:JOBS_NOT_READY');
  } finally { await f.close(); }
});

test('aborting after the Jobs writer commits reports unknown and permits receipt lookup without resending', async () => {
  const cancelled = new AbortController(); let abortWrite = false;
  const f = await memorySourceJobsFixture({ afterWrite(operation) { if (abortWrite && operation.name === 'jobs.source.schedule.create') cancelled.abort(); } });
  try {
    const source = f.source();
    await source.api.registration.activate(activate); abortWrite = true;
    await expect(source.api.schedules.create({ input: { value: 1 }, at: new Date(f.now() + 5_000).toISOString() },
      { idempotencyKey: 'abort-after-commit', signal: cancelled.signal })).rejects.toMatchObject({ code: 'JOBS_OUTCOME_UNKNOWN' });
    const receipt = await source.api.receipts.get('abort-after-commit');
    expect(receipt).toMatchObject({ id: jobSourceScheduleId(source.identity, 'abort-after-commit'), revision: 1 });
    expect(f.commands.filter(operation => operation.name === 'jobs.source.schedule.create')).toHaveLength(1);
    expect(f.rows(source.scope, 'job_schedules')).toHaveLength(1);
  } finally { await f.close(); }
});

test('policy A to B to A and retire/reactivate retain monotonically new epochs and never authorize an old unstarted occurrence', async () => {
  const f = await memorySourceJobsFixture();
  try {
    const a = f.source(), b = f.source({ policyVersion: 'B' });
    const first = await a.api.registration.activate(activate), due = f.now() + 5_000;
    const old = await a.api.schedules.create({ input: { value: 1 }, at: new Date(due).toISOString() }, { idempotencyKey: 'old-A' });
    const second = await b.api.registration.activate({ ...activate, expectedRevision: 1, idempotencyKey: 'register-B' });
    const third = await a.api.registration.activate({ ...activate, expectedRevision: 2, idempotencyKey: 'register-A-again' });
    expect([first.generation, second.generation, third.generation]).toEqual([1, 2, 3]); expect(third.policyHash).toBe(first.policyHash);
    await expect(a.api.registration.activate(activate)).rejects.toMatchObject({ code: 'JOBS_AUTHORITY_RETIRED' });
    const retired = await a.api.registration.retire({ expectedRevision: 3, idempotencyKey: 'retire-A' });
    expect(retired).toMatchObject({ generation: 3, revision: 4, state: 'retired' });
    expect(await a.api.receipts.get('old-A')).toEqual(old);
    await expect(a.api.schedules.create({ input: {}, at: new Date(due).toISOString() }, { idempotencyKey: 'cannot-create-retired' })).rejects.toMatchObject({ code: 'JOBS_AUTHORITY_RETIRED' });
    const reactivated = await a.api.registration.activate({ ...activate, expectedRevision: 4, idempotencyKey: 'reactivate-A' });
    expect(reactivated).toMatchObject({ generation: 4, revision: 5, state: 'active' });
    f.advance(5_000); await f.tick();
    expect(f.rows(a.scope, '_jobs_occurrences')[0]).toMatchObject({ state: 'blocked', error_code: 'JOBS_AUTHORITY_RETIRED', receipt_json: null });
    expect(f.calls).toHaveLength(0); expect(f.rows(a.scope, '_jobs_source_policies')).toHaveLength(4);
    const current = await a.api.schedules.create({ input: { value: 1 }, at: new Date(f.now()).toISOString() }, { idempotencyKey: 'current-A' });
    expect(current.policyGeneration).toBe(4); await f.tick(); await untilMemoryJobs(() => f.calls.length === 1);
  } finally { await f.close(); }
});

test('a restarted broker leaves an active unhydrated epoch recoverable until explicit current activation', async () => {
  const f = await memorySourceJobsFixture();
  try {
    const source = f.source();
    await source.api.registration.activate(activate);
    const due = f.now(), accepted = await source.api.schedules.create({ input: { value: 1 }, at: new Date(due).toISOString() }, { idempotencyKey: 'before-restart' });
    await f.restartService(); const restored = f.source();
    await f.tick();
    expect(f.rows(source.scope, '_jobs_occurrences')[0]).toMatchObject({ state: 'claimed', receipt_json: null });
    expect(f.calls).toHaveLength(0); expect(f.failures).toContain('dispatch:JOBS_NOT_READY');
    expect(await restored.api.registration.get()).toMatchObject({ revision: 1, generation: 1, state: 'active' });
    expect(await restored.api.receipts.get('before-restart')).toEqual(accepted);
    expect(await restored.api.registration.activate({ ...activate, expectedRevision: 1, idempotencyKey: 'hydrate-current-A' })).toMatchObject({ revision: 1, generation: 1 });
    expect(f.rows(source.scope, '_jobs_occurrences')[0]?.lease_until).toBe(due + 1_000);
    f.advance(1_000); await f.tick(); await untilMemoryJobs(() => f.calls.length === 1);
    expect(f.rows(source.scope, '_jobs_occurrences')[0]).toMatchObject({ id: jobOccurrenceId(accepted.id, 1, due), lease_generation: 2 });
  } finally { await f.close(); }
});

test('historical registration and retirement retries cannot evict a later healthy source generation', async () => {
  const f = await memorySourceJobsFixture();
  try {
    const a = f.source(), b = f.source({ policyVersion: 'B' });
    await a.api.registration.activate(activate);
    const retirement = await a.api.registration.retire({ expectedRevision: 1, idempotencyKey: 'retire-original' });
    await b.api.registration.activate({ ...activate, expectedRevision: 2, idempotencyKey: 'register-later-B' });
    expect(await a.api.registration.retire({ expectedRevision: 1, idempotencyKey: 'retire-original' })).toEqual(retirement);
    await expect(a.api.registration.activate(activate)).rejects.toMatchObject({ code: 'JOBS_AUTHORITY_RETIRED' });
    await expect(a.api.registration.activate({ ...activate, idempotencyKey: 'stale-new-command' })).rejects.toMatchObject({ code: 'JOBS_REVISION_CONFLICT' });
    const receipt = await b.api.schedules.create({ input: { value: 2 }, at: new Date(f.now()).toISOString() }, { idempotencyKey: 'still-healthy' });
    expect(receipt.policyGeneration).toBe(2);
    await f.tick(); await untilMemoryJobs(() => f.calls.length === 1);
    expect(f.calls).toEqual([{ value: 2 }]); expect(f.failures).toEqual([]);
  } finally { await f.close(); }
});

test('a historical retirement retry cannot fence a newer activation while its prior binding is quiesced at the writer', async () => {
  const barrier = latch(); let hold = false;
  const f = await memorySourceJobsFixture({ async beforeWrite(operation) {
    if (hold && operation.name === 'jobs.source.register') { hold = false; await barrier.wait(); }
  } });
  let activating: Promise<unknown> | undefined, retiring: Promise<unknown> | undefined;
  try {
    const a = f.source(), b = f.source({ policyVersion: 'B' }), c = f.source({ policyVersion: 'C' });
    await a.api.registration.activate(activate);
    const historical = await a.api.registration.retire({ expectedRevision: 1, idempotencyKey: 'historical-retirement' });
    a.retireEligibility();
    await b.api.registration.activate({ ...activate, expectedRevision: 2, idempotencyKey: 'register-B-after-retirement' });
    hold = true;
    activating = c.api.registration.activate({ ...activate, expectedRevision: 3, idempotencyKey: 'register-C-at-writer' });
    const activationResult = activating.then(value => ({ value }), error => ({ error }));
    await barrier.entered;
    let retiredSettled = false;
    retiring = a.api.registration.retire({ expectedRevision: 1, idempotencyKey: 'historical-retirement' });
    const retirementResult = retiring.then(value => { retiredSettled = true; return { value }; }, error => { retiredSettled = true; return { error }; });
    await untilMemoryJobs(() => retiredSettled);
    expect(await retirementResult).toEqual({ value: historical });
    barrier.release();
    expect(await activationResult).toMatchObject({ value: { generation: 3, revision: 4, state: 'active' } });
    expect(await c.api.registration.get()).toMatchObject({ generation: 3, revision: 4, state: 'active' });
    await c.api.schedules.create({ input: { value: 3 }, at: new Date(f.now()).toISOString() }, { idempotencyKey: 'healthy-C' });
    await f.tick(); await untilMemoryJobs(() => f.calls.length === 1);
    expect(f.calls).toEqual([{ value: 3 }]); expect(f.failures).toEqual([]);
  } finally { barrier.release(); await Promise.allSettled([activating, retiring].filter((value): value is Promise<unknown> => !!value)); await f.close(); }
});

test('an aborted queued retirement cannot permanently fence the activation already waiting at its writer', async () => {
  const barrier = latch(); let hold = false;
  const f = await memorySourceJobsFixture({ async beforeWrite(operation) {
    if (hold && operation.name === 'jobs.source.register') { hold = false; await barrier.wait(); }
  } });
  let activating: Promise<unknown> | undefined, retiring: Promise<unknown> | undefined;
  try {
    const a = f.source(), b = f.source({ policyVersion: 'B' });
    await a.api.registration.activate(activate); hold = true;
    activating = b.api.registration.activate({ ...activate, expectedRevision: 1, idempotencyKey: 'register-B-after-aborted-retire' });
    const activationResult = activating.then(value => ({ value }), error => ({ error }));
    await barrier.entered;
    const abort = new AbortController(), reason = new JobsError('JOBS_NOT_READY');
    retiring = a.api.registration.retire({ expectedRevision: 1, idempotencyKey: 'abort-queued-retire', signal: abort.signal });
    const retirementResult = retiring.then(value => ({ value }), error => ({ error }));
    await untilMemoryJobs(() => f.service.diagnostics().sourceGate.queued === 1); abort.abort(reason);
    expect(await retirementResult).toEqual({ error: reason });
    barrier.release();
    expect(await activationResult).toMatchObject({ value: { generation: 2, revision: 2, state: 'active' } });
    expect(await b.api.receipts.get('abort-queued-retire')).toBeNull();
    await b.api.schedules.create({ input: { value: 2 }, at: new Date(f.now()).toISOString() }, { idempotencyKey: 'healthy-after-queued-abort' });
    await f.tick(); await untilMemoryJobs(() => f.calls.length === 1);
    expect(f.calls).toEqual([{ value: 2 }]); expect(f.failures).toEqual([]);
  } finally { barrier.release(); await Promise.allSettled([activating, retiring].filter((value): value is Promise<unknown> => !!value)); await f.close(); }
});

test('a retirement with an obsolete CAS cannot poison an activation whose policy committed before its reply', async () => {
  const barrier = latch(); let hold = false;
  const f = await memorySourceJobsFixture({ async afterWrite(operation) {
    if (hold && operation.name === 'jobs.source.register') { hold = false; await barrier.wait(); }
  } });
  let activating: Promise<unknown> | undefined, retiring: Promise<unknown> | undefined;
  try {
    const a = f.source(), b = f.source({ policyVersion: 'B' });
    await a.api.registration.activate(activate); hold = true;
    activating = b.api.registration.activate({ ...activate, expectedRevision: 1, idempotencyKey: 'B-committed-held-reply' });
    const activationResult = activating.then(value => ({ value }), error => ({ error }));
    await barrier.entered;
    expect(await a.api.registration.get()).toMatchObject({ generation: 2, revision: 2, state: 'active' });
    let retiredSettled = false;
    retiring = a.api.registration.retire({ expectedRevision: 1, idempotencyKey: 'retire-A-after-B-commit' });
    const retirementResult = retiring.then(value => { retiredSettled = true; return { value }; }, error => { retiredSettled = true; return { error }; });
    // The stale command must settle from durable evidence without waiting for
    // B's delayed acknowledgment or revoking B's pending live installation.
    await untilMemoryJobs(() => retiredSettled);
    expect(await retirementResult).toMatchObject({ error: { code: 'JOBS_REVISION_CONFLICT' } });
    barrier.release();
    expect(await activationResult).toMatchObject({ value: { generation: 2, revision: 2, state: 'active' } });
    expect(await b.api.receipts.get('retire-A-after-B-commit')).toBeNull();
    await b.api.schedules.create({ input: { value: 2 }, at: new Date(f.now()).toISOString() }, { idempotencyKey: 'healthy-B-after-held-reply' });
    await f.tick(); await untilMemoryJobs(() => f.calls.length === 1);
    expect(f.calls).toEqual([{ value: 2 }]); expect(f.failures).toEqual([]);
  } finally { barrier.release(); await Promise.allSettled([activating, retiring].filter((value): value is Promise<unknown> => !!value)); await f.close(); }
});

for (const kind of ['jobs', 'database'] as const) test('a proved ' + kind + ' rejection restores the quiesced prior binding without another activation', async () => {
  let reject = false;
  const reason = kind === 'jobs' ? new JobsError('JOBS_CAPACITY', 'not-committed')
    : new DatabaseError('DATABASE_BACKPRESSURE', 'Synthetic known writer rejection.', { outcome: 'not-committed' });
  const f = await memorySourceJobsFixture({ beforeWrite(operation) {
    if (reject && operation.name === 'jobs.source.register') { reject = false; throw reason; }
  } });
  try {
    const a = f.source(), b = f.source({ policyVersion: 'B' });
    await a.api.registration.activate(activate); reject = true;
    await expect(b.api.registration.activate({ ...activate, expectedRevision: 1, idempotencyKey: 'proved-rejected-B' }))
      .rejects.toBe(reason);
    expect(await a.api.registration.get()).toMatchObject({ generation: 1, revision: 1, state: 'active' });
    expect(await b.api.receipts.get('proved-rejected-B')).toBeNull();
    await a.api.schedules.create({ input: { value: 1 }, at: new Date(f.now()).toISOString() }, { idempotencyKey: 'restored-A' });
    await f.tick(); await untilMemoryJobs(() => f.calls.length === 1);
    expect(f.calls).toEqual([{ value: 1 }]); expect(f.failures).toEqual([]);
  } finally { await f.close(); }
});

test('pending retirement saturation fails without quiescing a healthy binding and releases its slot after settlement', async () => {
  const f = await memorySourceJobsFixture();
  // Set only the private accounting boundary, avoiding a thousand suspended
  // trusted callbacks or changing the production capacity for this test.
  const broker = Reflect.get(f.service, 'sources') as { pendingRetirementCount: number };
  try {
    const source = f.source(); await source.api.registration.activate(activate);
    broker.pendingRetirementCount = 1024;
    await expect(source.api.registration.retire({ expectedRevision: 1, idempotencyKey: 'saturated-retire' })).rejects.toMatchObject({ code: 'JOBS_CAPACITY' });
    expect(broker.pendingRetirementCount).toBe(1024); broker.pendingRetirementCount = 0;
    expect(await source.api.registration.get()).toMatchObject({ generation: 1, revision: 1, state: 'active' });
    expect(await source.api.receipts.get('saturated-retire')).toBeNull();
    await source.api.schedules.create({ input: { value: 1 }, at: new Date(f.now()).toISOString() }, { idempotencyKey: 'healthy-after-saturation' });
    await f.tick(); await untilMemoryJobs(() => f.calls.length === 1); expect(f.calls).toEqual([{ value: 1 }]);
    await source.api.registration.retire({ expectedRevision: 1, idempotencyKey: 'retire-after-capacity-release' });
    expect(broker.pendingRetirementCount).toBe(0); expect(f.failures).toEqual([]);
  } finally { broker.pendingRetirementCount = 0; await f.close(); }
});

test('an uncertain replacement keeps the prior binding quiesced until the original receipt hydrates the committed epoch', async () => {
  let lose = false;
  const f = await memorySourceJobsFixture({ afterWrite(operation) {
    if (lose && operation.name === 'jobs.source.register') { lose = false; throw new JobsError('JOBS_OUTCOME_UNKNOWN'); }
  } });
  try {
    const a = f.source(), b = f.source({ policyVersion: 'B' });
    await a.api.registration.activate(activate); lose = true;
    const replacement = { ...activate, expectedRevision: 1, idempotencyKey: 'uncertain-B' };
    await expect(b.api.registration.activate(replacement)).rejects.toMatchObject({ code: 'JOBS_OUTCOME_UNKNOWN' });
    expect(await b.api.receipts.get('uncertain-B')).toMatchObject({ generation: 2, revision: 2, state: 'active' });
    const input = { input: { value: 2 }, at: new Date(f.now()).toISOString() };
    await expect(a.api.schedules.create(input, { idempotencyKey: 'old-A-stays-quiesced' })).rejects.toMatchObject({ code: 'JOBS_AUTHORITY_RETIRED' });
    expect(await b.api.registration.activate(replacement)).toMatchObject({ generation: 2, revision: 2, state: 'active' });
    await b.api.schedules.create(input, { idempotencyKey: 'hydrated-B' });
    await f.tick(); await untilMemoryJobs(() => f.calls.length === 1);
    expect(f.calls).toEqual([{ value: 2 }]); expect(f.failures).toEqual([]);
  } finally { await f.close(); }
});

test('cancellation queues on the same schedule gate as materialization and prevents never-started handoff', async () => {
  const barrier = latch(); let hold = true;
  const f = await memorySourceJobsFixture({ async beforeWrite(operation) { if (hold && operation.name === 'jobs.materialize') { hold = false; await barrier.wait(); } } });
  let ticking: Promise<void> | undefined, cancelling: Promise<unknown> | undefined;
  try {
    const source = f.source();
    await source.api.registration.activate(activate);
    const receipt = await source.api.schedules.create({ input: { value: 1 }, at: new Date(f.now()).toISOString() }, { idempotencyKey: 'cancel-before-dispatch' });
    ticking = f.tick(); await barrier.entered;
    let settled = false;
    cancelling = source.api.schedules.cancel(receipt.id, { expectedRevision: 1, idempotencyKey: 'cancel' }).finally(() => { settled = true; });
    await Bun.sleep(1); expect(settled).toBe(false); expect(f.stats()).toMatchObject({ activeLeases: 0, backendLeases: 0 });
    barrier.release(); await cancelling; await ticking;
    expect(f.rows(source.scope, 'job_schedules')[0]).toMatchObject({ control: 'cancelled', revision: 2, actor_id: null, updated_by: null });
    expect(f.rows(source.scope, '_jobs_occurrences')[0]).toMatchObject({ state: 'cancelled', terminal_status: 'not-dispatched' }); expect(f.calls).toHaveLength(0);
    expect(await source.api.receipts.get('cancel-before-dispatch')).toEqual(receipt);
  } finally { barrier.release(); await Promise.allSettled([ticking, cancelling].filter((value): value is Promise<unknown> => !!value)); await f.close(); }
});

test('retirement wins over an activation which started its asynchronous proof before the retirement epoch', async () => {
  const barrier = latch(); let hold = false;
  const f = await memorySourceJobsFixture();
  let activating: Promise<unknown> | undefined;
  try {
    const source = f.source({ async confirmEligible() { if (hold) { hold = false; await barrier.wait(); } } });
    await source.api.registration.activate(activate); hold = true;
    activating = source.api.registration.activate({ ...activate, expectedRevision: 1, idempotencyKey: 'stale-in-flight-activation' });
    await barrier.entered;
    expect(await source.api.registration.retire({ expectedRevision: 1, idempotencyKey: 'retire-racing-activation' })).toMatchObject({ revision: 2, state: 'retired' });
    barrier.release(); await expect(activating).rejects.toMatchObject({ code: 'JOBS_AUTHORITY_RETIRED' });
    expect(await source.api.registration.get()).toMatchObject({ generation: 1, revision: 2, state: 'retired' });
    expect(await source.api.receipts.get('stale-in-flight-activation')).toBeNull();
  } finally { barrier.release(); await Promise.allSettled(activating ? [activating] : []); await f.close(); }
});

test('retirement fences an activation waiting at the actual Jobs writer, not only its acknowledgment', async () => {
  const barrier = latch(); let hold = false;
  const f = await memorySourceJobsFixture({ async beforeWrite(operation) {
    if (hold && operation.name === 'jobs.source.register') { hold = false; await barrier.wait(); }
  } });
  let activating: Promise<unknown> | undefined, retiring: Promise<unknown> | undefined;
  try {
    const a = f.source(), b = f.source({ policyVersion: 'B' }); await a.api.registration.activate(activate); hold = true;
    activating = b.api.registration.activate({ ...activate, expectedRevision: 1, idempotencyKey: 'pending-B-write' });
    await barrier.entered;
    // Native promise handling must not block before the held writer is released.
    const rejected = activating.then(() => null, error => error);
    retiring = a.api.registration.retire({ expectedRevision: 1, idempotencyKey: 'retire-A-before-B-commit' });
    await untilMemoryJobs(() => f.service.diagnostics().sourceGate.queued === 1);
    barrier.release(); expect(await rejected).toMatchObject({ code: 'JOBS_AUTHORITY_RETIRED' });
    expect(await retiring).toMatchObject({ generation: 1, revision: 2, state: 'retired' });
    expect(await b.api.receipts.get('pending-B-write')).toBeNull();
    expect(f.rows(a.scope, '_jobs_source_policies')).toHaveLength(1);
  } finally { barrier.release(); await Promise.allSettled([activating, retiring].filter((value): value is Promise<unknown> => !!value)); await f.close(); }
});

test('pre-aborted and invalid-revision retirement leave healthy dispatch and policy generation untouched', async () => {
  const f = await memorySourceJobsFixture();
  try {
    const source = f.source(); await source.api.registration.activate(activate);
    const abort = new AbortController(); abort.abort(new JobsError('JOBS_NOT_READY'));
    await expect(source.api.registration.retire({ expectedRevision: 1, idempotencyKey: 'already-aborted', signal: abort.signal })).rejects.toMatchObject({ code: 'JOBS_NOT_READY' });
    await expect(source.api.registration.retire({ expectedRevision: 0, idempotencyKey: 'invalid-zero-revision' })).rejects.toMatchObject({ code: 'JOBS_INPUT_INVALID' });
    await source.api.schedules.create({ input: { value: 1 }, at: new Date(f.now()).toISOString() }, { idempotencyKey: 'healthy-after-rejected-retire' });
    await f.tick(); await untilMemoryJobs(() => f.calls.length === 1);
    expect(f.calls).toEqual([{ value: 1 }]); expect(f.failures).toEqual([]);
    expect(await source.api.registration.get()).toMatchObject({ generation: 1, revision: 1, state: 'active' });
    expect(await source.api.receipts.get('already-aborted')).toBeNull(); expect(await source.api.receipts.get('invalid-zero-revision')).toBeNull();
  } finally { await f.close(); }
});

test('source capabilities reject clones, wrong owners, mismatched scopes and another source schedule without allocating reader state', async () => {
  const f = await memorySourceJobsFixture();
  try {
    const owner = f.source(), other = f.source({ identity: { ownerId: 'other-physical-owner' } });
    expect(() => f.service.forSource({} as TrustedJobSource)).toThrow(); expect(() => f.service.forSource({ ...owner.capability } as TrustedJobSource)).toThrow();
    expect(() => f.source({ identity: { scopeId: 'tenant:forged' } })).toThrow();
    expect(await other.api.registration.get()).toBeNull(); expect(await other.api.receipts.get('missing')).toBeNull(); expect(f.stats().planes).toBe(0);
    await owner.api.registration.activate(activate);
    const accepted = await owner.api.schedules.create({ input: { value: 1 }, at: new Date(f.now() + 1_000).toISOString() }, { idempotencyKey: 'private' });
    await other.api.registration.activate({ ...activate, idempotencyKey: 'other-register' });
    await expect(other.api.schedules.get(accepted.id)).rejects.toMatchObject({ code: 'JOBS_NOT_FOUND' });
    await expect(other.api.schedules.cancel(accepted.id, { expectedRevision: 1, idempotencyKey: 'other-cancel' })).rejects.toMatchObject({ code: 'JOBS_NOT_FOUND' });
    owner.revokeOwner();
    await expect(owner.api.receipts.get('private')).rejects.toMatchObject({ code: 'JOBS_AUTHORITY_RETIRED' });
    await expect(owner.api.registration.activate({ ...activate, expectedRevision: 1, idempotencyKey: 'wrong-owner' })).rejects.toMatchObject({ code: 'JOBS_AUTHORITY_RETIRED' });
    expect(f.rows(other.scope, 'job_schedules')).toHaveLength(1); expect(f.stats()).toMatchObject({ planes: 1, activeLeases: 0, backendLeases: 0 });
  } finally { await f.close(); }
});

test('distinct tenant roots isolate identical source names, keys and owned schedule evidence', async () => {
  const f = await memorySourceJobsFixture({ tenancy: 'multi' });
  try {
    const alpha = f.source({ scope: trustedSystemServiceDataScope({ scopeKind: 'tenant', tenantId: 'alpha' }) });
    const beta = f.source({ scope: trustedSystemServiceDataScope({ scopeKind: 'tenant', tenantId: 'beta' }) });
    const [a, b] = await Promise.all([alpha.api.registration.activate(activate), beta.api.registration.activate(activate)]);
    expect(a.id).not.toBe(b.id); const input = { input: { value: 1 }, at: new Date(f.now() + 1_000).toISOString() };
    const [first, second] = await Promise.all([alpha.api.schedules.create(input, { idempotencyKey: 'same-key' }), beta.api.schedules.create(input, { idempotencyKey: 'same-key' })]);
    expect(first.id).not.toBe(second.id); await expect(alpha.api.schedules.get(second.id)).rejects.toMatchObject({ code: 'JOBS_NOT_FOUND' });
    expect(f.rows(alpha.scope, 'job_schedules')).toHaveLength(1); expect(f.rows(beta.scope, 'job_schedules')).toHaveLength(1); expect(f.stats().planes).toBe(2);
  } finally { await f.close(); }
});

test('an ordinary administrator request cannot invoke source-only definitions or manage the hidden source schedules', async () => {
  const f = await memorySourceJobsFixture();
  try {
    const source = f.source();
    await source.api.registration.activate(activate);
    const accepted = await source.api.schedules.create({ input: { value: 1 }, at: new Date(f.now() + 1_000).toISOString() }, { idempotencyKey: 'source-only' });
    const request = f.request();
    await expect(request.enqueue(f.definition, { value: 1 }, { idempotencyKey: 'ordinary-source-attempt', ownership: 'service' })).rejects.toMatchObject({ code: 'JOBS_FORBIDDEN' });
    expect((await request.schedules.list()).items).toEqual([]);
    await expect(request.schedules.get(accepted.id)).rejects.toMatchObject({ code: 'JOBS_NOT_FOUND' });
    await expect(request.schedules.cancel(accepted.id, { expectedRevision: 1, idempotencyKey: 'ordinary-cancel' })).rejects.toMatchObject({ code: 'JOBS_NOT_FOUND' });
    expect(f.rows(source.scope, 'job_schedules')).toHaveLength(1); expect(f.calls).toHaveLength(0);
  } finally { await f.close(); }
});

test('replacement and cancellation retain prior receipts and admissions while CAS rejects a new stale mutation', async () => {
  const f = await memorySourceJobsFixture();
  try {
    const source = f.source();
    await source.api.registration.activate(activate);
    const originalInput = { input: { value: 1 }, at: new Date(f.now() + 10_000).toISOString() };
    const original = await source.api.schedules.create(originalInput, { idempotencyKey: 'original' });
    const nextInput = { input: { value: 2 }, at: new Date(f.now() + 20_000).toISOString() };
    const replacement = await source.api.schedules.replace(original.id, nextInput, { expectedRevision: 1, idempotencyKey: 'replace' });
    expect(replacement).toMatchObject({ id: original.id, revision: 2, generation: 2 });
    expect(await source.api.receipts.get('original')).toEqual(original); expect(f.rows(source.scope, '_jobs_admissions')).toHaveLength(2);
    expect(f.rows(source.scope, '_jobs_cursors')[0]).toMatchObject({ next_due_at: Date.parse(nextInput.at) });
    await expect(source.api.schedules.cancel(original.id, { expectedRevision: 1, idempotencyKey: 'stale-cancel' })).rejects.toMatchObject({ code: 'JOBS_REVISION_CONFLICT' });
    expect(await source.api.receipts.get('stale-cancel')).toBeNull();
    const cancelled = await source.api.schedules.cancel(original.id, { expectedRevision: 2, idempotencyKey: 'cancel-current' });
    expect(cancelled).toMatchObject({ id: original.id, revision: 3, generation: 2, control: 'cancelled' });
    f.advance(100_000);
    expect(await source.api.schedules.replace(original.id, nextInput, { expectedRevision: 1, idempotencyKey: 'replace' })).toEqual(replacement);
    expect(await source.api.schedules.cancel(original.id, { expectedRevision: 2, idempotencyKey: 'cancel-current' })).toEqual(cancelled);
    expect(f.rows(source.scope, '_jobs_admissions')).toHaveLength(2); expect(f.calls).toHaveLength(0);
  } finally { await f.close(); }
});

test('a lost Jobs commit reply is reconciled by the original permanent source receipt without creating another schedule', async () => {
  let lose = true;
  const f = await memorySourceJobsFixture({ afterWrite(operation) { if (operation.name === 'jobs.source.schedule.create' && lose) { lose = false; throw new JobsError('JOBS_OUTCOME_UNKNOWN'); } } });
  try {
    const source = f.source();
    await source.api.registration.activate(activate);
    const input = { input: { value: 1 }, at: new Date(f.now() + 10_000).toISOString() };
    await expect(source.api.schedules.create(input, { idempotencyKey: 'lost-jobs-reply' })).rejects.toMatchObject({ code: 'JOBS_OUTCOME_UNKNOWN' });
    const retained = await source.api.receipts.get('lost-jobs-reply');
    expect(retained).toMatchObject({ id: jobSourceScheduleId(source.identity, 'lost-jobs-reply'), revision: 1 });
    if (!retained || !('sourceId' in retained)) throw new Error('Original source schedule receipt is missing.');
    f.advance(100_000);
    expect(await source.api.schedules.create(input, { idempotencyKey: 'lost-jobs-reply' })).toEqual(retained);
    expect(f.rows(source.scope, 'job_schedules')).toHaveLength(1); expect(f.rows(source.scope, '_jobs_admissions')).toHaveLength(1);
    expect(f.stats()).toMatchObject({ activeLeases: 0, backendLeases: 0 });
  } finally { await f.close(); }
});
