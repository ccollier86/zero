/** Real tracked commands/read snapshots/restarts, strictly SQLite MEMORY and no generated output. */
import { Database } from 'bun:sqlite';
import { expect, spyOn, test } from 'bun:test';
import { createReactiveDB } from '../sync/reactive-db';
import { runDatabaseRealmCommand, runDatabaseRealmQuery } from '../databases/database-realm';
import type { DatabaseSerializableValue } from '../databases/database-operations';
import { createDatabaseReadQuerySession, withDatabaseReadQuerySession } from '../databases/database-read-query-capability';
import { jobSourceId, jobSourceScheduleId } from '../jobs/source-model';
import { calendarRealm } from './realm';
import { calendarHash } from './validation';
import type { CalendarIntegrationClaim, CalendarIntegrationPolicySpec } from './integration-model';

function fixture() {
  const now = 1_900_000_000_000, clock = spyOn(Date, 'now').mockReturnValue(now);
  let raw = new Database(':memory:', { strict: true }), db: ReturnType<typeof createReactiveDB> | null = null, sequence = 0;
  const attach = () => {
    raw.run('PRAGMA temp_store=MEMORY'); raw.run('PRAGMA foreign_keys=ON');
    db = createReactiveDB({ database: raw });
    for (const [name, schema] of Object.entries(calendarRealm.tables)) db.defineTable(name, schema);
  };
  const close = () => { try { db?.dispose(); } finally { try { raw.close(); } finally { clock.mockRestore(); } } };
  try {
    attach(); for (const migration of calendarRealm.migrations) migration.up(raw);
    const owner = { scopeId: 'application', expectedOwnerId: 'synthetic-queue-owner' };
    const actor = { scopeId: owner.scopeId, userId: 'synthetic-user', principal: 'synthetic-session', manageAll: true, createOwn: true };
    const command = (name: string, body: Record<string, unknown> = {}): any => (runDatabaseRealmCommand(calendarRealm, db!, 'calendar.' + name,
      { requestId: 'queue-' + ++sequence, ...body } as DatabaseSerializableValue) as any).value;
    const integration = (name: string, body: Record<string, unknown> = {}): any => command('integration.' + name, { ...owner, ...body });
    const query = (name: string, body: Record<string, unknown> = {}): any => {
      const copy = Database.deserialize(raw.serialize(), { readonly: true, strict: true });
      try { copy.run('PRAGMA temp_store=MEMORY'); return withDatabaseReadQuerySession(createDatabaseReadQuerySession(copy), context => runDatabaseRealmQuery(calendarRealm, context,
        'calendar.integration.' + name, { ...owner, ...body } as DatabaseSerializableValue)); } finally { copy.close(); }
    };
    runDatabaseRealmCommand(calendarRealm, db!, 'calendar.owner.bind', { scopeId: owner.scopeId, ownerId: owner.expectedOwnerId });
    command('resource.create', { actor, id: 'resource', label: 'PRIVATE_QUEUE_RESOURCE', kind: 'room', ownerId: null, timeZone: 'UTC' });
    const policy = (version = 'A'): CalendarIntegrationPolicySpec => ({ ruleId: 'observe', ruleVersion: '1', adapter: 'observation-v1', dueOffsetMs: 0, maxLatenessMs: 60_000,
      source: { identity: { domain: 'calendar.observe', databaseId: 'calendar:' + calendarHash(owner.scopeId), ownerId: owner.expectedOwnerId, scopeId: owner.scopeId, rootHash: '1'.repeat(64) },
        realmFingerprint: calendarRealm.fingerprint, policyVersion: version, semanticsVersion: 'observation-v1', definition: { name: 'calendar.observe', version: '1', fingerprint: '2'.repeat(64) },
        workflow: { name: 'calendar.observe', version: 1, definitionId: 'definition', versionId: 'version', fingerprint: '3'.repeat(64) } } });
    const registration = (spec = policy(), generation = 1) => ({ id: jobSourceId(spec.source.identity), generation, revision: generation, state: 'active' as const, policyHash: calendarHash(spec.source) });
    const install = (version = 'A', epoch = 0, activate = true) => {
      const spec = policy(version); integration('policy.install', { policy: spec, expectedEpoch: epoch, now });
      if (activate) integration('policy.activate', { ruleId: spec.ruleId, epoch: epoch + 1, registration: registration(spec, epoch + 1) });
    };
    const appointment = (id: string, offset = 0) => command('appointment.create', { actor, id, resourceIds: ['resource'], title: 'PRIVATE_QUEUE_APPOINTMENT',
      startAt: new Date(now + 600_000 + offset).toISOString(), endAt: new Date(now + 660_000 + offset).toISOString(), timeZone: 'UTC', bufferBeforeMinutes: 0, bufferAfterMinutes: 0 });
    const claim = (at = now, limit = 1, leaseMs = 100): CalendarIntegrationClaim[] => integration('claim', { now: at, nonce: 'nonce-' + sequence, limit, leaseMs });
    const ack = (claim: CalendarIntegrationClaim, phase: 'create' | 'cancel' = 'create') => integration('ack', { id: claim.id, nonce: claim.nonce, claimGeneration: claim.claimGeneration,
      phase, receipt: { id: jobSourceScheduleId(claim.intent.policy.source.identity, claim.intent.createKey), sourceId: claim.intent.registration!.id,
        policyGeneration: claim.intent.registration!.generation, control: phase === 'create' ? 'active' : 'cancelled', revision: phase === 'create' ? 1 : 2, generation: 1, createdAt: now, updatedAt: now } });
    const defer = (claim: CalendarIntegrationClaim, at: number, retryAt: number) => integration('defer', { id: claim.id, nonce: claim.nonce, claimGeneration: claim.claimGeneration,
      now: at, retryAt, code: 'JOBS_NOT_READY', ...(claim.previouslyAttempted || claim.intent.jobsReceipt ? {} : { notCommitted: true }) });
    const rows = (suffix: string): any[] => raw.query('SELECT * FROM _calendar_integration_' + suffix + ' ORDER BY id').all();
    const restart = () => {
      const bytes = raw.serialize(); db!.dispose(); db = null; raw.close(); raw = Database.deserialize(bytes, { strict: true }); attach();
    };
    return { get raw() { return raw; }, get db() { return db!; }, now, owner, actor, command, integration, query, policy, registration, install, appointment, claim, ack, defer, rows, restart,
      setNow: (value: number) => clock.mockReturnValue(value), close };
  } catch (error) { close(); throw error; }
}

test('limit-one claims durably rotate expired, obsolete-policy and ordinary ready classes across MEMORY restarts', () => {
  const f = fixture(); try {
    f.install();
    for (let i = 0; i < 3; i++) { f.appointment('obsolete-' + i, i * 120_000); f.ack(f.claim()[0]!); }
    for (let i = 0; i < 3; i++) { f.appointment('expired-' + i, (i + 3) * 120_000); expect(f.claim()[0]!.intent.appointmentId).toBe('expired-' + i); }
    f.install('B', 1);
    for (let i = 0; i < 3; i++) f.appointment('ready-' + i, (i + 6) * 120_000);
    f.setNow(f.now + 101);
    for (let i = 0; i < 9; i++) {
      const before = f.rows('queue_cursor'), seq = f.db.currentSeq;
      const preview = f.query('pending', { now: f.now + 101, limit: 1 });
      expect(f.query('pending', { now: f.now + 101, limit: 1 })).toEqual(preview);
      expect(f.rows('queue_cursor')).toEqual(before); expect(f.db.currentSeq).toBe(seq);
      const selected = f.claim(f.now + 101, 1, 10_000)[0]!;
      expect(selected.id).toBe(preview[0].id);
      expect(selected.intent.appointmentId.startsWith(['expired-', 'obsolete-', 'ready-'][i % 3]!)).toBe(true);
      if (i % 3 === 1) f.ack(selected, 'cancel'); else if (i % 3 === 2) f.ack(selected);
      f.restart();
    }
    expect(f.rows('queue_cursor')).toHaveLength(1);
  } finally { f.close(); }
});

test('overlapping obsolete and ready classes never claim one intent twice and empty polls never create cursor state', () => {
  const f = fixture(); try {
    expect(f.claim()).toEqual([]); expect(f.query('nextWake')).toEqual({ nextWakeAt: null }); expect(f.rows('queue_cursor')).toEqual([]);
    f.install(); f.appointment('overlap'); f.ack(f.claim()[0]!);
    f.command('appointment.cancel', { actor: f.actor, id: 'overlap', expectedRevision: 1, confirmed: true });
    f.integration('policy.retire', { ruleId: 'observe', epoch: 1 });
    const selected = f.claim(f.now, 100); expect(selected).toHaveLength(1); expect(selected[0]!.intent.eligibility).toBe('superseded');
    f.ack(selected[0]!, 'cancel'); expect(f.query('nextWake')).toEqual({ nextWakeAt: null });
  } finally { f.close(); }
});

test('a late cursor refusal rolls back both the claim and fairness advancement, retaining the same next choice', () => {
  const f = fixture(); try {
    f.install(); f.appointment('rollback');
    const before = f.rows('dispatch'), seq = f.db.currentSeq, preview = f.query('pending', { now: f.now, limit: 1 });
    f.raw.run("CREATE TRIGGER synthetic_queue_cursor_refusal BEFORE INSERT ON _calendar_integration_queue_cursor BEGIN SELECT RAISE(ABORT,'synthetic cursor refusal'); END");
    expect(() => f.claim()).toThrow(); expect(f.rows('dispatch')).toEqual(before); expect(f.rows('queue_cursor')).toEqual([]); expect(f.db.currentSeq).toBe(seq);
    expect(f.query('pending', { now: f.now, limit: 1 })).toEqual(preview);
    f.raw.run('DROP TRIGGER synthetic_queue_cursor_refusal'); expect(f.claim()[0]!.id).toBe(preview[0].id);
  } finally { f.close(); }
});

test('next wake exactly follows dispatch lease, backoff, exclusive expiry and obsolete accepted retry without writes or authored time', () => {
  const f = fixture(); try {
    f.install(); f.appointment('wake'); expect(f.query('nextWake')).toEqual({ nextWakeAt: f.now });
    const first = f.claim()[0]!; expect(f.query('nextWake')).toEqual({ nextWakeAt: f.now + 100 });
    f.defer(first, f.now, f.now + 500); expect(f.query('nextWake')).toEqual({ nextWakeAt: f.now + 500 });
    expect(f.claim(f.now + 499)).toEqual([]); f.setNow(f.now + 500); f.ack(f.claim(f.now + 500)[0]!);
    const expiry = f.now + 660_001; expect(f.query('nextWake')).toEqual({ nextWakeAt: expiry });
    f.setNow(f.now + 501); expect(f.query('nextWake')).toEqual({ nextWakeAt: expiry });
    f.integration('policy.retire', { ruleId: 'observe', epoch: 1 }); expect(f.query('nextWake')).toEqual({ nextWakeAt: f.now + 501 });
    const obsolete = f.claim(f.now + 501)[0]!; f.defer(obsolete, f.now + 501, f.now + 900);
    const before = f.raw.serialize(), seq = f.db.currentSeq;
    for (let i = 0; i < 4; i++) expect(f.query('nextWake')).toEqual({ nextWakeAt: f.now + 900 });
    expect(f.raw.serialize()).toEqual(before); expect(f.db.currentSeq).toBe(seq); expect(f.claim(f.now + 899)).toEqual([]);
    expect(() => f.query('nextWake', { now: 0 })).toThrow(); expect(() => f.query('nextWake', { expectedOwnerId: 'wrong-owner' })).toThrow();
    f.setNow(f.now + 900); f.ack(f.claim(f.now + 900)[0]!, 'cancel'); expect(f.query('nextWake')).toEqual({ nextWakeAt: null });
  } finally { f.close(); }
});

test('next wake includes unresolved registration-control retries, excludes settled controls and remains bounded on policy-only state', () => {
  const f = fixture(); try {
    f.install('A', 0, false); expect(f.query('nextWake')).toEqual({ nextWakeAt: null });
    const control = f.integration('control.prepare', { ruleId: 'observe', epoch: 1, action: 'activate', expectedRegistration: null });
    expect(f.query('nextWake')).toEqual({ nextWakeAt: f.now });
    f.integration('control.fail', { id: control.id, now: f.now, retryAt: f.now + 700, code: 'JOBS_OUTCOME_UNKNOWN' });
    expect(f.query('nextWake')).toEqual({ nextWakeAt: f.now + 700 });
    f.appointment('while-activating'); const unavailable = f.claim()[0]!; expect(unavailable.intent.registration).toBeNull();
    f.defer(unavailable, f.now, f.now + 900); expect(f.query('nextWake')).toEqual({ nextWakeAt: f.now + 700 });
    f.integration('control.ack', { id: control.id, result: { state: 'accepted', registration: f.registration() } });
    expect(f.query('nextWake')).toEqual({ nextWakeAt: f.now + 900 });
    f.setNow(f.now + 901); expect(f.query('nextWake')).toEqual({ nextWakeAt: f.now + 901 });
  } finally { f.close(); }
});

test('every next-wake probe uses an equality/range index without retained-history scan or sort', () => {
  const f = fixture(); try {
    for (const [sql, index] of [
      ["SELECT next_attempt_ms FROM _calendar_integration_dispatch WHERE scope_id='application' AND claim_nonce IS NULL AND state='accepted' ORDER BY next_attempt_ms,id LIMIT 1", 'calendar_integration_ready'],
      ["SELECT claim_until_ms FROM _calendar_integration_dispatch WHERE scope_id='application' AND claim_nonce IS NOT NULL ORDER BY claim_until_ms,id LIMIT 1", 'calendar_integration_expired_claim'],
      ["SELECT next_attempt_ms FROM _calendar_integration_control_attempts WHERE scope_id='application' AND result_id IS NULL ORDER BY next_attempt_ms,id LIMIT 1", 'calendar_integration_control_pending'],
      ["SELECT id FROM _calendar_integration_dispatch WHERE scope_id='application' AND rule_id='observe' AND state='accepted' AND claim_nonce IS NULL AND blocked_code IS NULL AND policy_epoch<2 ORDER BY policy_epoch,next_attempt_ms,id LIMIT 1", 'calendar_integration_retired_policy'],
    ]) {
      const plan = JSON.stringify(f.raw.query('EXPLAIN QUERY PLAN ' + sql).all()); expect(plan).toContain(index); expect(plan).not.toContain('SCAN '); expect(plan).not.toContain('TEMP B-TREE');
    }
  } finally { f.close(); }
});
