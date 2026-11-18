/** Real JobsService -> source broker -> Jobs realm -> JobsRunner -> Torrent, entirely in memory. */
import { expect, test } from 'bun:test';
import { trustedSystemServiceDataScope } from '../auth/service-data-scope';
import { jobBinding, jobDispatchKey } from './admission';
import { JobsError } from './error';
import { jobOccurrenceId, type JobAdmissionRow, type JobOccurrenceRow } from './model';
import type { TrustedJobSource } from './source-authority';
import { jobSourceScheduleId } from './source-model';
import { memorySourceJobsFixture, untilMemoryJobs } from './test-support/memory-source-fixture';

const activate = { expectedRevision: 0, idempotencyKey: 'register-A', pinInput: { value: 1 } };
function latch() {
  let release!: () => void, enter!: () => void;
  const promise = new Promise<void>(resolve => { release = resolve; }), entered = new Promise<void>(resolve => { enter = resolve; });
  return { entered, release, async wait() { enter(); await promise; } };
}

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
    expect(recovered).toMatchObject({ id: claimed.id, state: 'terminal', terminal_status: 'completed', lease_generation: 2, workflow_id: committed.receipt.instanceId });
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
