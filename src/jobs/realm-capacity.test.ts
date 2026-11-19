/** Native writer/realm MEMORY tests. No files, actors, timers, dependencies or
 * generated output. Simulated broker receipt inputs are not Torrent qualification.
 */
import { expect, test } from 'bun:test';
import { memoryCapacityFixture, capacityDue, capacityIdentity, capacityNow } from './test-support/memory-capacity-fixture';
import { jobHash } from './validation';
import { jobOccurrenceId } from './model';
import { JOB_WORK_LIMITS, jobWorkSourceKey } from './realm-capacity';

test('more than 1000 completed schedules reuse working quota on one unchanged source while every original receipt survives', () => {
  const f = memoryCapacityFixture();
  try {
    let first: unknown;
    for (let index = 0; index < 1001; index++) {
      const receipt = f.create('completed-' + index); if (!index) first = receipt;
      f.finish(receipt.id);
    }
    expect(f.live('schedules')).toBe(0); expect(f.live('occurrences')).toBe(0); expect(f.live(jobWorkSourceKey(f.sourceId))).toBe(0);
    expect(f.history('schedules')).toBe(1001); expect(f.history('occurrences')).toBe(1001);
    expect(f.history('source:' + jobHash(capacityIdentity))).toBe(1001);
    expect(f.db.list('_jobs_sources')).toHaveLength(1); expect(f.db.list('_jobs_source_policies')).toHaveLength(1);
    expect(f.query<unknown>('jobs.source.receipt', { identity: capacityIdentity, requestId: 'create-completed-0' })).toEqual(first);
    expect(f.command<unknown>('jobs.source.schedule.create', f.createInput('completed-0'))).toEqual(first);
    expect(f.create('next-lifetime-schedule').revision).toBe(1);
    const capacity = f.capacity(); expect(capacity.version).toBe(2);
    expect(capacity.working.sourceSchedules.used).toBe(1); expect(capacity.retained.sourceSchedules).toEqual({ used: 1002 });
    expect(f.raw.query('PRAGMA foreign_key_check').all()).toEqual([]);
  } finally { f.close(); }
}, 15_000);

test('full source working quota rejects atomically, exact replay stays free, and one closed slot permits one new identity', () => {
  const f = memoryCapacityFixture();
  try {
    const first = f.create('full-0');
    for (let index = 1; index < JOB_WORK_LIMITS.schedulesPerSource; index++) f.create('full-' + index);
    const historical = f.db.list('_jobs_usage');
    expect(() => f.create('over-working-quota')).toThrow(expect.objectContaining({ code: 'JOBS_CAPACITY' }));
    expect(f.db.list('_jobs_usage')).toEqual(historical); expect(f.work('over-working-quota')).toBeNull();
    expect(f.command<unknown>('jobs.source.schedule.create', f.createInput('full-0'))).toEqual(first);
    f.finish(first.id); expect(f.live(jobWorkSourceKey(f.sourceId))).toBe(999);
    f.create('one-new-after-closure'); expect(f.live(jobWorkSourceKey(f.sourceId))).toBe(1000);
    expect(() => f.create('second-over-quota')).toThrow(expect.objectContaining({ code: 'JOBS_CAPACITY' }));
  } finally { f.close(); }
});

test('readmission reacquires a closed membership and rolls back its new admission when working quota is full', () => {
  const f = memoryCapacityFixture();
  try {
    f.create('closed'); f.finish('closed');
    for (let index = 0; index < 1000; index++) f.create('occupant-' + index);
    expect(() => f.replace('closed')).toThrow(expect.objectContaining({ code: 'JOBS_CAPACITY' }));
    expect(f.db.get('_jobs_admissions', 'closed:2')).toBeNull(); expect(f.db.get('job_schedules', 'closed')!.generation).toBe(1);
    f.cancel('occupant-0'); const replaced = f.replace('closed');
    expect(replaced.generation).toBe(2); expect(f.work('closed')!.occupied).toBe(1); expect(f.live(jobWorkSourceKey(f.sourceId))).toBe(1000);
    expect(f.replace('closed')).toEqual(replaced); expect(f.live(jobWorkSourceKey(f.sourceId))).toBe(1000);
  } finally { f.close(); }
});

test('old generations and expired unknown claims remain occupied after replacement/cancellation until original handoff settlement', () => {
  const f = memoryCapacityFixture();
  try {
    f.create('unknown'); f.materialize('unknown'); f.claim('unknown'); f.replace('unknown'); f.cancel('unknown', 2);
    expect(f.work('unknown')).toMatchObject({ occupied: 1, open_occurrences: 1 });
    expect(f.claim('unknown', 1, capacityDue, capacityDue + 1001)).toMatchObject({ claimed: true, dispatchAllowed: false, leaseGeneration: 2 });
    expect(f.live('occurrences')).toBe(1); f.dispatch('unknown', 1, capacityDue, 2); f.complete('unknown');
    expect(f.work('unknown')).toMatchObject({ occupied: 0, open_occurrences: 0 });
    f.complete('unknown'); expect(f.live('schedules')).toBe(0); expect(f.live('occurrences')).toBe(0);
    expect(f.history('occurrences')).toBe(1); expect(f.history('schedules')).toBe(1);
  } finally { f.close(); }
});

test('readmission of a closed schedule reacquires quota atomically and original-key replay cannot double charge', () => {
  const f = memoryCapacityFixture();
  try {
    f.create('closed'); f.finish('closed');
    for (let index = 0; index < JOB_WORK_LIMITS.schedulesPerSource; index++) f.create('occupied-' + index);
    const before = f.db.list('_jobs_usage'), admissions = f.db.list('_jobs_admissions').length;
    expect(() => f.replace('closed')).toThrow(expect.objectContaining({ code: 'JOBS_CAPACITY' }));
    expect(f.work('closed')).toMatchObject({ occupied: 0, open_occurrences: 0 });
    expect(f.db.get('job_schedules', 'closed')).toMatchObject({ revision: 1, generation: 1 });
    expect(f.db.list('_jobs_usage')).toEqual(before); expect(f.db.list('_jobs_admissions')).toHaveLength(admissions);
    f.finish('occupied-0'); const accepted = f.replace('closed');
    expect(accepted).toMatchObject({ revision: 2, generation: 2 }); expect(f.replace('closed')).toEqual(accepted);
    expect(f.live(jobWorkSourceKey(f.sourceId))).toBe(JOB_WORK_LIMITS.schedulesPerSource);
    expect(f.history('schedules')).toBe(1001); expect(f.history('source:' + jobHash(capacityIdentity))).toBe(1001);
    expect(f.db.list('_jobs_admissions')).toHaveLength(admissions + 1);
  } finally { f.close(); }
});

test('blocked review stays occupied, while known unstarted cancellation and non-materialized expiry close safely', () => {
  const f = memoryCapacityFixture();
  try {
    f.create('blocked'); f.materialize('blocked'); f.claim('blocked');
    f.command('jobs.block', { scopeId: 'application', id: jobOccurrenceId('blocked', 1, capacityDue), nonce: 'synthetic-claim', leaseGeneration: 1, code: 'JOBS_NOT_DISPATCHED', now: capacityDue });
    f.cancel('blocked'); expect(f.work('blocked')).toMatchObject({ occupied: 1, open_occurrences: 1 });
    f.create('pending'); f.materialize('pending'); f.cancel('pending');
    expect(f.claim('pending')).toEqual({ claimed: false, reason: 'cancelled' });
    expect(f.work('pending')).toMatchObject({ occupied: 0, open_occurrences: 0 });
    f.create('expired'); f.materialize('expired', 1, capacityDue + 60_001);
    expect(f.work('expired')).toMatchObject({ occupied: 0, open_occurrences: 0 });
    expect(f.live('schedules')).toBe(1); expect(f.live('occurrences')).toBe(1);
  } finally { f.close(); }
});

test('late receipt rejection rolls back history, membership, admission and quota together', () => {
  const f = memoryCapacityFixture();
  try {
    const before = f.db.list('_jobs_usage');
    f.raw.run("CREATE TRIGGER synthetic_late_work_receipt BEFORE INSERT ON _jobs_source_intents BEGIN SELECT RAISE(ABORT,'synthetic receipt refusal'); END");
    expect(() => f.create('late-rollback')).toThrow('synthetic receipt refusal');
    expect(f.db.list('_jobs_usage')).toEqual(before); expect(f.work('late-rollback')).toBeNull();
    expect(f.live('schedules')).toBe(0); expect(f.live(jobWorkSourceKey(f.sourceId))).toBe(0);
    expect(f.db.get('job_schedules', 'late-rollback')).toBeNull();
    expect(f.db.get('_jobs_admissions', 'late-rollback:1')).toBeNull();
  } finally { f.close(); }
});

test('actor and source schedules share the same working file quota without changing historical owner budgets', () => {
  const f = memoryCapacityFixture();
  try {
    const actor = { scopeId: 'application', userId: 'synthetic-user', principal: 'synthetic-session', manageAll: false };
    const { source: _source, ...base } = f.admission('actor-job');
    f.command('jobs.schedule.create', { actor, requestId: 'actor-create', now: capacityNow,
      admission: { ...base, actorId: actor.userId, principal: actor.principal, runAs: 'actor' }, seal: { authorityJson: 'SYNTHETIC_ACTOR', authorityMac: '6'.repeat(64) } });
    f.create('source-job'); expect(f.live('schedules')).toBe(2);
    f.command('jobs.schedule.change', { actor, requestId: 'pause-actor', id: 'actor-job', expectedRevision: 1, action: 'pause', now: capacityNow });
    expect(f.live('schedules')).toBe(1); expect(f.history('schedules')).toBe(2);
    expect(f.history('owner:' + jobHash(['application', actor.userId]))).toBe(1);
    f.db.update('_jobs_work_usage', 'schedules', { count: JOB_WORK_LIMITS.schedules });
    expect(() => f.create('full-file')).toThrow(expect.objectContaining({ code: 'JOBS_CAPACITY' }));
    expect(f.history('schedules')).toBe(2); expect(f.work('full-file')).toBeNull();
  } finally { f.close(); }
});
