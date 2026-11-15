/** Real private Fabric subprocesses with synthetic state. Does not claim managed HTTP/Guardian/deployment qualification. */
import { expect, test } from 'bun:test';
import { jobsRealmFixture } from './test-support/realm-fixture';
import { jobOccurrenceId } from './model';

const now = Date.parse('2026-12-01T00:00:00Z'), due = now + 60_000;
const actor = { scopeId: 'application', userId: 'synthetic-owner', principal: 'synthetic-session', manageAll: false };
const admin = { ...actor, userId: 'synthetic-admin', principal: 'synthetic-admin-session', manageAll: true };
function create(id = 'job-one', overrides: Record<string, unknown> = {}, owner = actor) {
  return { actor: owner, requestId: 'create-' + id, now, admission: { id, scopeId: owner.scopeId, actorId: owner.userId, principal: owner.principal,
    definition: 'synthetic.report', definitionVersion: '1', definitionHash: 'a'.repeat(64),
    workflow: { name: 'synthetic.report', version: 1, definitionId: 'definition-one', versionId: 'version-one', fingerprint: 'b'.repeat(64) },
    input: { privateSynthetic: 'NEVER_PUBLIC' }, timing: { kind: 'once', at: new Date(due).toISOString() }, overlap: 'skip', runAs: 'actor', ...overrides },
    seal: { authorityJson: '{"synthetic":"PRIVATE_SEAL"}', authorityMac: 'c'.repeat(64) } };
}
const change = (action: string, revision: number, extra: Record<string, unknown> = {}) => ({ actor, id: 'job-one', requestId: action + '-' + revision, expectedRevision: revision, action, now: now + 1, ...extra });
const receipt = { instanceId: 'synthetic-workflow-one', name: 'synthetic.report', definitionVersion: 1, createdAt: new Date(due).toISOString() };
const cron = { kind: 'cron', pattern: '* * * * *', timezone: 'UTC', misfire: 'catch-up', maxLatenessMs: 600_000, catchUpLimit: 10 };

test('private Fabric controls preserve permanent intents, ownership, revisions, input privacy and rollback through restart', async () => {
  const f = await jobsRealmFixture();
  try {
    const accepted = await f.command('jobs.schedule.create', create()); expect(accepted).toMatchObject({ ok: true, value: { revision: 1, generation: 1, control: 'active' } });
    const replay = await f.command('jobs.schedule.create', create());
    expect(replay.value).toEqual(accepted.value); expect(replay.hint).toBeUndefined();
    expect((await f.command('jobs.schedule.create', create('job-one', { input: { changed: true } }))).code).toBe('JOBS_INTENT_CONFLICT');
    const view = await f.query('jobs.schedule', { actor, id: 'job-one' });
    expect(view.value.nextDueAt).toBe(due); expect(JSON.stringify(view)).not.toContain('NEVER_PUBLIC'); expect(JSON.stringify(view)).not.toContain('PRIVATE_SEAL');
    expect((await f.query('jobs.schedules', { actor })).value).toMatchObject({ total: 1, items: [{ id: 'job-one' }] });
    expect((await f.query('jobs.schedule', { actor: { ...actor, userId: 'other' }, id: 'job-one' })).code).toBe('JOBS_NOT_FOUND');
    expect((await f.command('jobs.owner.bind', { ownerId: 'wrong-owner', scopeId: 'application' })).code).toBe('JOBS_STATE_INVALID');
    expect((await f.command('jobs.schedule.change', change('pause', 9))).code).toBe('JOBS_REVISION_CONFLICT');
    expect((await f.query('jobs.receipt', { actor, requestId: 'pause-9' })).value).toBeNull();
    const paused = await f.command('jobs.schedule.change', change('pause', 1)); expect(paused.value).toMatchObject({ control: 'paused', revision: 2 });
    const pauseReplay = await f.command('jobs.schedule.change', change('pause', 1));
    expect(pauseReplay.value).toEqual(paused.value); expect(pauseReplay.hint).toBeUndefined();
    // New login may manage its own schedule, but readmission captures that new authority explicitly.
    const newActor = { ...actor, principal: 'synthetic-renewed-session' }, next = create().admission;
    const resumed = await f.command('jobs.schedule.change', change('readmit', 2, { actor: newActor, admission: { ...next, principal: newActor.principal }, seal: create().seal }));
    expect(resumed.value).toMatchObject({ revision: 3, generation: 2, control: 'active' });
    expect((await f.command('jobs.schedule.change', change('readmit', 3, { actor: admin, admission: next, seal: create().seal }))).code).toBe('JOBS_FORBIDDEN');
    expect((await f.command('jobs.schedule.change', change('cancel', 3, { actor: admin }))).value).toMatchObject({ control: 'cancelled', revision: 4 });
    expect((await f.command('jobs.schedule.change', change('pause', 4))).code).toBe('JOBS_STAGE_CONFLICT');
    await f.restart();
    expect((await f.command('jobs.schedule.create', create())).value).toEqual(accepted.value);
    expect((await f.query('jobs.schedule', { actor, id: 'job-one' })).value).toMatchObject({ revision: 4, generation: 2, control: 'cancelled' });
    await f.offline(db => {
      for (const sql of ["UPDATE _jobs_owner SET owner_id='other'", 'DELETE FROM _jobs_admissions', 'DELETE FROM _jobs_intents',
        "INSERT OR REPLACE INTO _jobs_owner VALUES('application','other','application')",
        "INSERT OR REPLACE INTO _jobs_admissions SELECT id,scope_id,schedule_id,generation,command_json,digest,'tampered',authority_mac FROM _jobs_admissions LIMIT 1",
        "UPDATE job_schedules SET actor_id='other',revision=revision+1"]) expect(() => db.run(sql)).toThrow();
      expect(db.query('SELECT count(*) AS n FROM _jobs_admissions').get()).toEqual({ n: 2 });
      // Force an owned synthetic quota fault after admission to test complete transaction rollback.
      db.run("UPDATE _jobs_usage SET count=1000 WHERE id LIKE 'owner:%'");
    });
    expect((await f.command('jobs.schedule.create', create('quota-denied'))).code).toBe('JOBS_CAPACITY');
    expect((await f.query('jobs.receipt', { actor, requestId: 'create-quota-denied' })).value).toBeNull();
    expect((await f.query('jobs.schedules', { actor })).value.total).toBe(1);
    await f.offline(db => {
      expect(db.query("SELECT count FROM _jobs_usage WHERE id='schedules'").get()).toEqual({ count: 1 });
      expect(db.query("SELECT count(*) AS n FROM _jobs_admissions WHERE schedule_id='quota-denied'").get()).toEqual({ n: 0 });
      const plan = JSON.stringify(db.query("EXPLAIN QUERY PLAN SELECT id FROM _jobs_cursors WHERE scope_id=? AND next_due_at<=? AND blocked_code IS NULL ORDER BY next_due_at,id LIMIT 32").all('application', due));
      expect(plan).toContain('jobs_due'); expect(plan).not.toContain('TEMP B-TREE');
    });
  } finally { await f.close(); }
}, 120_000);

test('occurrences and cursors commit atomically; stale claims reconcile the same identity after cancellation with fenced receipts', async () => {
  const f = await jobsRealmFixture(), id = jobOccurrenceId('job-one', 1, due);
  try {
    await f.command('jobs.schedule.create', create());
    expect((await f.query('jobs.due', { scopeId: 'application', now: due })).value).toEqual([{ id: 'job-one', revision: 1 }]);
    expect((await f.command('jobs.materialize', { scopeId: 'application', id: 'job-one', expectedRevision: 1, now: due })).value.created).toBe(1);
    expect((await f.command('jobs.materialize', { scopeId: 'application', id: 'job-one', expectedRevision: 1, now: due })).value.created).toBe(0);
    const claim = { scopeId: 'application', id, nonce: 'claim-one', leaseMs: 1000, now: due };
    expect((await f.command('jobs.claim', claim)).value).toMatchObject({ claimed: true, dispatchAllowed: true, leaseGeneration: 1 });
    expect((await f.command('jobs.claim', { ...claim, nonce: 'racing-claim' })).value.reason).toBe('leased');
    await f.command('jobs.schedule.change', change('cancel', 1, { now: due + 100 }));
    await f.restart();
    expect((await f.query('jobs.pending', { scopeId: 'application', now: due + 1001 })).value).toEqual([{ id, schedule_id: 'job-one' }]);
    expect((await f.command('jobs.claim', { ...claim, nonce: 'claim-two', now: due + 1001 })).value).toMatchObject({ claimed: true, dispatchAllowed: false, leaseGeneration: 2 });
    expect((await f.command('jobs.dispatch', { scopeId: 'application', id, nonce: 'claim-one', leaseGeneration: 1, receipt, now: due + 1002 })).code).toBe('JOBS_STAGE_CONFLICT');
    const dispatch = { scopeId: 'application', id, nonce: 'claim-two', leaseGeneration: 2, receipt, now: due + 1002 };
    expect((await f.command('jobs.dispatch', dispatch)).value).toEqual({ dispatched: true, instanceId: receipt.instanceId });
    expect((await f.command('jobs.dispatch', dispatch)).value.dispatched).toBe(true);
    expect((await f.command('jobs.dispatch', { ...dispatch, receipt: { ...receipt, instanceId: 'wrong-instance' } })).code).toBe('JOBS_INTENT_CONFLICT');
    const complete = { scopeId: 'application', id, instanceId: receipt.instanceId, status: 'completed', now: due + 1100 };
    expect((await f.command('jobs.complete', complete)).ok).toBe(true); expect((await f.command('jobs.complete', complete)).ok).toBe(true);
    expect((await f.command('jobs.complete', { ...complete, status: 'failed' })).code).toBe('JOBS_INTENT_CONFLICT');
    const history = (await f.query('jobs.occurrences', { actor, id: 'job-one' })).value;
    expect(history.total).toBe(1); expect(history.items[0]).toMatchObject({ state: 'terminal', workflowId: receipt.instanceId, terminalStatus: 'completed' });
    expect(JSON.stringify(history)).not.toContain('claim-two');
  } finally { await f.close(); }
}, 120_000);

test('skip, allow and queue-one are distinct; materialization capacity failure leaves the due cursor and intents unchanged', async () => {
  const f = await jobsRealmFixture();
  try {
    for (const overlap of ['skip', 'allow', 'queue-one']) {
      const scheduleId = 'job-' + overlap, first = jobOccurrenceId(scheduleId, 1, due), second = jobOccurrenceId(scheduleId, 1, due + 60_000), third = jobOccurrenceId(scheduleId, 1, due + 120_000);
      await f.command('jobs.schedule.create', create(scheduleId, { overlap, timing: cron }));
      await f.command('jobs.materialize', { scopeId: 'application', id: scheduleId, expectedRevision: 1, now: due });
      expect((await f.command('jobs.claim', { scopeId: 'application', id: first, nonce: 'first-' + overlap, leaseMs: 300_000, now: due })).value.claimed).toBe(true);
      await f.command('jobs.materialize', { scopeId: 'application', id: scheduleId, expectedRevision: 1, now: due + 120_000 });
      const secondClaim = (await f.command('jobs.claim', { scopeId: 'application', id: second, nonce: 'second-' + overlap, leaseMs: 1000, now: due + 120_000 })).value;
      expect(secondClaim).toMatchObject(overlap === 'skip' ? { claimed: false, reason: 'overlap-skipped' } : overlap === 'allow' ? { claimed: true } : { claimed: false, reason: 'terminal' });
      if (overlap === 'queue-one') {
        expect((await f.command('jobs.claim', { scopeId: 'application', id: third, nonce: 'third', leaseMs: 1000, now: due + 120_000 })).value.reason).toBe('overlap-wait');
        expect((await f.query('jobs.pending', { scopeId: 'application', now: due + 120_000 })).value.some((item: any) => item.id === third)).toBe(false);
        const history = (await f.query('jobs.occurrences', { actor, id: scheduleId })).value.items;
        expect(history.filter((item: any) => item.state === 'pending')).toHaveLength(1);
        expect(history.find((item: any) => item.id === second).terminalStatus).toBe('superseded');
      }
    }
    await f.command('jobs.schedule.create', create('capacity', { timing: cron }));
    await f.offline(db => { db.run("UPDATE _jobs_usage SET count=100000 WHERE id='occurrences'"); });
    expect((await f.command('jobs.materialize', { scopeId: 'application', id: 'capacity', expectedRevision: 1, now: due })).code).toBe('JOBS_CAPACITY');
    expect((await f.query('jobs.occurrences', { actor, id: 'capacity' })).value.total).toBe(0);
    expect((await f.query('jobs.due', { scopeId: 'application', now: due })).value.some((row: any) => row.id === 'capacity')).toBe(true);
  } finally { await f.close(); }
}, 120_000);

test('separate Fabric roots isolate identical logical ids and scope-bound private state', async () => {
  const a = await jobsRealmFixture();
  let b: Awaited<ReturnType<typeof jobsRealmFixture>> | null = null;
  try {
    b = await jobsRealmFixture('tenant:synthetic');
    const tenantActor = { ...actor, scopeId: 'tenant:synthetic' };
    const results = await Promise.all([a.command('jobs.schedule.create', create()), b.command('jobs.schedule.create', create('job-one', {}, tenantActor))]);
    expect(results.every(result => result.ok)).toBe(true);
    expect((await a.query('jobs.schedules', { actor: tenantActor })).code).toBe('JOBS_STATE_INVALID');
    expect((await b.query('jobs.schedules', { actor: tenantActor })).value.total).toBe(1);
    expect((await a.query('jobs.schedules', { actor })).value.total).toBe(1);
    expect((await b.command('jobs.materialize', { scopeId: 'application', id: 'job-one', expectedRevision: 1, now: due })).code).toBe('JOBS_STATE_INVALID');
  } finally { await Promise.all([a.close(), ...(b ? [b.close()] : [])]); }
}, 120_000);

test('late pending work expires, uncertain old claims remain reconcilable, and readmission does not erase overlap with earlier generations', async () => {
  const f = await jobsRealmFixture();
  try {
    await f.command('jobs.schedule.create', create('late'));
    await f.command('jobs.materialize', { scopeId: 'application', id: 'late', expectedRevision: 1, now: due });
    const lateId = jobOccurrenceId('late', 1, due);
    expect((await f.command('jobs.claim', { scopeId: 'application', id: lateId, nonce: 'too-late', leaseMs: 1000, now: due + 60_001 })).value).toEqual({ claimed: false, reason: 'expired' });
    await f.command('jobs.schedule.create', create('uncertain', { timing: { kind: 'once', at: new Date(due).toISOString(), maxLatenessMs: 1000 } }));
    await f.command('jobs.materialize', { scopeId: 'application', id: 'uncertain', expectedRevision: 1, now: due });
    const uncertainId = jobOccurrenceId('uncertain', 1, due);
    await f.command('jobs.claim', { scopeId: 'application', id: uncertainId, nonce: 'original', leaseMs: 1000, now: due });
    expect((await f.command('jobs.claim', { scopeId: 'application', id: uncertainId, nonce: 'reconcile-only', leaseMs: 1000, now: due + 1001 })).value).toMatchObject({ claimed: true, dispatchAllowed: false, leaseGeneration: 2 });
    expect((await f.query('jobs.context', { scopeId: 'application', id: uncertainId, now: due + 1001 })).value.dispatchAllowed).toBe(false);
    expect((await f.command('jobs.block', { scopeId: 'application', id: uncertainId, nonce: 'reconcile-only', leaseGeneration: 2, code: 'JOBS_OUTCOME_UNKNOWN', now: due + 1002 })).code).toBe('JOBS_INPUT_INVALID');
    await f.command('jobs.schedule.create', create('job-one', { timing: cron }));
    await f.command('jobs.materialize', { scopeId: 'application', id: 'job-one', expectedRevision: 1, now: due });
    const firstId = jobOccurrenceId('job-one', 1, due);
    await f.command('jobs.claim', { scopeId: 'application', id: firstId, nonce: 'old-running', leaseMs: 1000, now: due });
    await f.command('jobs.dispatch', { scopeId: 'application', id: firstId, nonce: 'old-running', leaseGeneration: 1, receipt, now: due + 1 });
    await f.command('jobs.schedule.change', change('readmit', 1, { now: due + 2, admission: create('job-one', { timing: cron }).admission, seal: create().seal }));
    await f.command('jobs.materialize', { scopeId: 'application', id: 'job-one', expectedRevision: 2, now: due + 60_000 });
    const nextId = jobOccurrenceId('job-one', 2, due + 60_000);
    expect((await f.command('jobs.claim', { scopeId: 'application', id: nextId, nonce: 'new-generation', leaseMs: 1000, now: due + 60_000 })).value.reason).toBe('overlap-skipped');
  } finally { await f.close(); }
}, 120_000);
